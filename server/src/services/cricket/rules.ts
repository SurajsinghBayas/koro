import { env } from '../../env.ts';
import type { Format, Innings, Match, RuleKey } from './types.ts';

/** What you asked for: when each kind of match sends an update. */
export const RULES: Record<RuleKey, { label: string; every?: 'over'; atOvers?: number[]; atSessions?: string[] }> = {
  ipl_mi:     { label: 'IPL · Mumbai Indians', every: 'over' },
  india_t20:  { label: 'India T20I', atOvers: [5, 10, 15, 20] },
  india_odi:  { label: 'India ODI', atOvers: [10, 20, 30, 40, 50] },
  india_test: { label: 'India Test', atSessions: ['lunch', 'tea', 'stumps'] },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Exact "India" (men) — not India A, U19, Legends, Masters; Women only when enabled. */
export function isIndia(team: string) {
  const t = norm(team);
  if (t === 'india' || t === 'ind') return true;
  if (env.TRACK_INDIA_WOMEN && (t === 'india women' || t === 'india w' || t === 'ind w' || t === 'indw')) return true;
  return false;
}
export const isMI = (team: string) => ['mumbai indians', 'mi'].includes(norm(team));

export function ruleFor(m: Pick<Match, 'teams' | 'format' | 'name' | 'series'>): RuleKey | undefined {
  const [a, b] = m.teams;
  if (isMI(a) || isMI(b)) return 'ipl_mi';
  if (isIndia(a) || isIndia(b)) {
    if (m.format === 'test') return 'india_test';
    if (m.format === 'odi') return 'india_odi';
    if (m.format === 't20i' || m.format === 't20') return 'india_t20';
  }
  return undefined;
}

export function normalizeFormat(raw: string, teams: string[], series = ''): Format {
  const r = raw.toLowerCase();
  if (r.includes('test')) return 'test';
  if (r.includes('odi') || r === 'list a') return 'odi';
  if (r.includes('t20')) {
    // A T20 between national sides (or a series named T20I) is a T20I; franchise leagues stay t20.
    if (r.includes('t20i') || /t20i|t20 international/i.test(series)) return 't20i';
    if (teams.some((t) => isIndia(t))) return 't20i';
    return 't20';
  }
  return 't20';
}

export const currentInnings = (m: Match): Innings | undefined => m.innings[m.innings.length - 1];

/** cricket overs "12.3" → 12.5 (real overs) — needed for rate maths. */
export const oversToReal = (o: number) => Math.floor(o) + ((o * 10) % 10) / 6;

const RESULT_RE = /\b(won|win|wins|drawn|draw|tied|tie|no result|abandoned|match ends?)\b/i;
export const isResult = (status: string) =>
  RESULT_RE.test(status) && !/need|require|trail|lead by|toss|opt(ed)? to|elected/i.test(status);
export const sessionIn = (status: string) => {
  const s = status.toLowerCase();
  if (/\bstumps\b/.test(s)) return 'stumps';
  if (/\btea\b/.test(s)) return 'tea';
  if (/\blunch\b/.test(s)) return 'lunch';
  if (/\bdinner\b/.test(s)) return 'dinner';
  return undefined;
};

export type MilestoneEvent = { key: string; kind: 'over' | 'milestone' | 'session' | 'result'; buzz: boolean };

/**
 * Compare previous vs current snapshot of a tracked match and return the events your rules ask for.
 * `sent` holds keys already notified (dedupe across restarts).
 */
export function detectEvents(prev: Match | undefined, cur: Match, sent: Set<string>): MilestoneEvent[] {
  const rule = cur.rule ? RULES[cur.rule] : undefined;
  if (!rule) return [];
  const out: MilestoneEvent[] = [];
  const push = (e: MilestoneEvent) => { if (!sent.has(e.key)) out.push(e); };

  if (cur.state === 'done' || isResult(cur.status)) {
    push({ key: 'result', kind: 'result', buzz: true });
    return out;
  }
  const inn = currentInnings(cur);
  if (inn) {
    const done = Math.floor(inn.overs);
    if (rule.every === 'over') {
      const before = prev ? Math.floor(prev.innings.find((i) => i.inning === inn.inning)?.overs ?? -1) : -1;
      // only the latest completed over (no backlog spam after a gap), and never on first sight
      if (prev && done > before && done >= 1) push({ key: `i${inn.inning}:o${done}`, kind: 'over', buzz: false });
    }
    if (rule.atOvers) {
      const crossed = rule.atOvers.filter((m) => done >= m);
      const latest = crossed[crossed.length - 1];
      if (latest !== undefined) {
        // mark older ones as sent silently, notify only the latest crossed milestone
        for (const m of crossed.slice(0, -1)) sent.add(`i${inn.inning}:o${m}`);
        push({ key: `i${inn.inning}:o${latest}`, kind: 'milestone', buzz: false });
      }
    }
  }
  if (rule.atSessions) {
    const s = sessionIn(cur.status);
    const day = cur.status.match(/day\s*(\d)/i)?.[1] ?? dayOfMatch(cur);
    if (s && rule.atSessions.includes(s)) push({ key: `d${day}:${s}`, kind: 'session', buzz: false });
  }
  return out;
}

function dayOfMatch(m: Match) {
  if (!m.startsAt) return '?';
  return String(Math.max(1, Math.floor((Date.now() - Date.parse(m.startsAt)) / 86_400_000) + 1));
}

/** Short text used in notifications and the Home card. */
export function summarize(m: Match): { title: string; body: string } {
  const short = (t: string) => {
    const i = m.teams.indexOf(t);
    return (i >= 0 && m.short?.[i]) || abbreviate(t);
  };
  const vs = `${short(m.teams[0])} vs ${short(m.teams[1])}`;
  const inns = m.innings.map((i) => `${short(i.team)} ${i.runs}/${i.wkts}${m.format === 'test' ? '' : ` (${fmtOvers(i.overs)})`}`);
  const cur = currentInnings(m);
  const rr = cur && cur.overs > 0 ? ` · RR ${(cur.runs / oversToReal(cur.overs)).toFixed(1)}` : '';
  const rohit = m.batters?.find((b) => /rohit/i.test(b.name));
  const rohitTxt = rohit ? ` · Rohit ${rohit.runs}${rohit.out ? '' : '*'} (${rohit.balls})` : '';
  if (m.state === 'done' || isResult(m.status)) return { title: `${vs} · Result`, body: `${m.status}${inns.length ? ` — ${inns.join(', ')}` : ''}` };
  const head = cur ? `${short(cur.team)} ${cur.runs}/${cur.wkts} (${fmtOvers(cur.overs)} ov)` : m.status;
  const other = inns.length > 1 ? ` · ${inns.slice(0, -1).join(', ')}` : '';
  const sess = sessionIn(m.status);
  return { title: `${vs}${sess ? ` · ${sess[0]!.toUpperCase()}${sess.slice(1)}` : ''}`, body: `${head}${rohitTxt}${rr}${other}` };
}

export const fmtOvers = (o: number) => (Number.isInteger(o) ? String(o) : o.toFixed(1));
export function abbreviate(team: string) {
  const known: Record<string, string> = {
    'mumbai indians': 'MI', 'chennai super kings': 'CSK', 'royal challengers bengaluru': 'RCB', 'royal challengers bangalore': 'RCB',
    'kolkata knight riders': 'KKR', 'sunrisers hyderabad': 'SRH', 'delhi capitals': 'DC', 'punjab kings': 'PBKS',
    'rajasthan royals': 'RR', 'gujarat titans': 'GT', 'lucknow super giants': 'LSG', india: 'IND', australia: 'AUS',
    england: 'ENG', 'south africa': 'SA', 'new zealand': 'NZ', pakistan: 'PAK', 'sri lanka': 'SL', bangladesh: 'BAN',
    'west indies': 'WI', afghanistan: 'AFG', ireland: 'IRE', zimbabwe: 'ZIM', 'india women': 'IND-W',
  };
  const k = norm(team);
  return known[k] ?? (team.length <= 4 ? team.toUpperCase() : team.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4));
}
