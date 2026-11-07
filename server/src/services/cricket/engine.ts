import type { Db } from '../../db.ts';
import { loadSnapshot, saveSnapshot } from '../../lib/snapshot.ts';
import { notify } from '../push.ts';
import { cricinfo } from './cricinfo.ts';
import { budget as cdBudget, canSpend, cricketdata } from './cricketdata.ts';
import { abbreviate, currentInnings, detectEvents, isMI, isResult, oversToReal, RULES, summarize } from './rules.ts';
import { form, getHistory } from './history.ts';
import { sportmonks } from './sportmonks.ts';
import type { Match } from './types.ts';

type Tracked = {
  match: Match;
  sent: string[];                 // event keys already notified
  nextDetailAt: number;
  lastSeenRss: number;
  samples: { t: number; inning: number; overs: number }[]; // for over-rate estimates
  lastScorecardAt?: number;
};

type EngineState = {
  fixtures: Match[];              // tracked upcoming/recent from CricketData
  fixturesAt: number;
  tracked: Record<string, Tracked>;
  recent: Match[];                // finished tracked matches (newest first)
  health: Record<string, { ok: boolean; at: string; error?: string }>;
};

const state: EngineState = loadSnapshot<EngineState>('matches', { fixtures: [], fixturesAt: 0, tracked: {}, recent: [], health: {} });

const FIXTURE_EVERY = 12 * 3_600_000;            // 2 pages × 2/day = 4 hits
const IDLE_TICK = 3 * 60_000, ACTIVE_TICK = 60_000;
const MPO_DEFAULT = { t20: 4.2, t20i: 4.2, odi: 4.0, test: 4.2 } as const; // minutes per over

export const teamKey = (teams: [string, string]) => teams.map(abbreviate).sort().join('|');

function mark(source: string, ok: boolean, error?: string) {
  state.health[source] = { ok, at: new Date().toISOString(), error: error?.slice(0, 200) };
}

function minutesPerOver(t: Tracked) {
  const inn = currentInnings(t.match);
  const s = t.samples.filter((x) => x.inning === inn?.inning).slice(-6);
  if (s.length >= 2) {
    const dOvers = oversToReal(s[s.length - 1]!.overs) - oversToReal(s[0]!.overs);
    const dMin = (s[s.length - 1]!.t - s[0]!.t) / 60_000;
    if (dOvers >= 1 && dMin > 0) return Math.min(8, Math.max(2.5, dMin / dOvers));
  }
  return MPO_DEFAULT[t.match.format];
}

/** When should we next spend a detail call on this match? Exported for tests. */
export function nextDetailDelay(t: Tracked, hasFreeFastSource: boolean): number {
  const m = t.match;
  if (hasFreeFastSource) return 60_000;
  if (m.state === 'upcoming') return 5 * 60_000;
  const rule = m.rule ? RULES[m.rule] : undefined;
  const mpo = minutesPerOver(t);
  const inn = currentInnings(m);
  const clamp = (ms: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, ms));
  if (rule?.every === 'over') return clamp(mpo * 60_000, 75_000, 6 * 60_000);
  if (rule?.atOvers) {
    const done = inn ? oversToReal(inn.overs) : 0;
    const next = rule.atOvers.find((x) => x > Math.floor(done));
    if (next === undefined) return 10 * 60_000;                 // all milestones done this innings → wait for innings end/result
    const toGo = next - done;
    if (toGo <= 1.5) return 75_000;
    return clamp((toGo - 1.2) * mpo * 60_000, 75_000, 30 * 60_000);
  }
  if (rule?.atSessions) return 10 * 60_000;
  return 10 * 60_000;
}

function mergeRssTotals(base: Match, rss: Match) {
  rss.innings.forEach((ri, idx) => {
    const bi = base.innings[idx];
    if (!bi) base.innings.push({ ...ri });
    else if (bi.runs !== ri.runs || bi.wkts !== ri.wkts) { bi.runs = ri.runs; bi.wkts = ri.wkts; }
  });
  if (base.state === 'upcoming') base.state = 'live';
  base.updatedAt = new Date().toISOString();
}

let db: Db;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

export function startCricket(database: Db) {
  db = database;
  const loop = async () => {
    const active = await tick().catch((e) => { console.warn('[cricket] tick failed:', e); return false; });
    timer = setTimeout(loop, active ? ACTIVE_TICK : IDLE_TICK);
  };
  timer = setTimeout(loop, 2_000);
}
export const stopCricket = () => timer && clearTimeout(timer);

/** One scheduler step. Returns true when a tracked match is live or about to start. */
export async function tick(now = Date.now()): Promise<boolean> {
  if (running) return true;
  running = true;
  try {
    // 1. Fixtures twice a day (CricketData; skipped without a key)
    if (cricketdata.enabled() && now - state.fixturesAt > FIXTURE_EVERY && canSpend(2)) {
      try {
        const all = await cricketdata.fixtures!();
        state.fixtures = all.filter((m) => m.rule && m.startsAt && Math.abs(Date.parse(m.startsAt) - now) < 6 * 86_400_000);
        state.fixturesAt = now;
        mark('cricketdata', true);
      } catch (e) { mark('cricketdata', false, (e as Error).message); }
    }

    // 2. Cricinfo RSS: free live totals for every match
    let rss: Match[] = [];
    try {
      rss = (await cricinfo.live()).filter((m) => m.rule);
      mark('cricinfo', true);
    } catch (e) { mark('cricinfo', false, (e as Error).message); }

    for (const r of rss) {
      const key = teamKey(r.teams);
      let t = Object.values(state.tracked).find((x) => teamKey(x.match.teams) === key);
      if (!t) {
        const fixture = state.fixtures.find((f) => teamKey(f.teams) === key && f.state !== 'done');
        const base: Match = fixture ? structuredClone(fixture) : structuredClone(r);
        t = { match: base, sent: [], nextDetailAt: 0, lastSeenRss: now, samples: [] };
        state.tracked[base.id] = t;
        console.log(`[cricket] now tracking ${base.name} (${base.rule})`);
      }
      t.lastSeenRss = now;
      mergeRssTotals(t.match, r);
    }

    // fixtures starting within 30 minutes are tracked too (so the first detail call happens on time)
    for (const f of state.fixtures) {
      const start = f.startsAt ? Date.parse(f.startsAt) : NaN;
      if (f.state !== 'done' && start - now < 30 * 60_000 && now - start < 12 * 3_600_000 && !state.tracked[f.id]
          && !Object.values(state.tracked).some((x) => teamKey(x.match.teams) === teamKey(f.teams))) {
        state.tracked[f.id] = { match: structuredClone(f), sent: [], nextDetailAt: 0, lastSeenRss: 0, samples: [] };
      }
    }

    // 3. Detail calls, shared: at most one CricketData + one Sportmonks call per tick
    const due = Object.values(state.tracked).filter((t) => t.match.state !== 'done' && now >= t.nextDetailAt);
    const wantSm = due.some((t) => t.match.rule === 'india_t20') && sportmonks.enabled();
    const wantCd = due.some((t) => !(t.match.rule === 'india_t20' && sportmonks.enabled())) && cricketdata.enabled() && canSpend(1);
    const [smLive, cdLive] = await Promise.all([
      wantSm ? sportmonks.live().then((x) => { mark('sportmonks', true); return x; }).catch((e) => { mark('sportmonks', false, e.message); return null; }) : null,
      wantCd ? cricketdata.live().then((x) => { mark('cricketdata', true); return x; }).catch((e) => { mark('cricketdata', false, e.message); return null; }) : null,
    ]);

    for (const t of due) {
      const prev = structuredClone(t.match);
      const useSm = t.match.rule === 'india_t20' && smLive;
      const pool = useSm ? smLive : cdLive;
      const fresh = pool?.find((m) => teamKey(m.teams) === teamKey(t.match.teams));
      if (fresh) {
        const keepId = t.match.id.startsWith('ci:') ? fresh.id : t.match.id;
        t.match = { ...fresh, id: keepId, rule: t.match.rule ?? fresh.rule, batters: t.match.batters };
        const inn = currentInnings(t.match);
        if (inn) t.samples = [...t.samples, { t: now, inning: inn.inning, overs: inn.overs }].slice(-12);
      }
      // failed / over-budget call → back off 3 min instead of retrying every tick
      t.nextDetailAt = now + (pool ? nextDetailDelay(t, Boolean(useSm)) : 3 * 60_000);
      await emitEvents(prev, t, now);
    }

    // 4. RSS-only matches (no detail source): finish when they drop off the feed for 15 minutes
    for (const t of Object.values(state.tracked)) {
      if (t.match.state !== 'done' && t.lastSeenRss && now - t.lastSeenRss > 15 * 60_000 && !cricketdata.enabled()) {
        const prev = structuredClone(t.match);
        t.match.state = 'done';
        if (!isResult(t.match.status)) t.match.status = 'Match ended';
        await emitEvents(prev, t, now);
      }
    }

    // 5. Retire finished matches
    for (const [id, t] of Object.entries(state.tracked)) {
      if (t.match.state === 'done' && t.sent.includes('result')) {
        state.recent = [t.match, ...state.recent.filter((m) => teamKey(m.teams) !== teamKey(t.match.teams) || m.id !== t.match.id)].slice(0, 10);
        delete state.tracked[id];
      } else if (now - Date.parse(t.match.updatedAt) > 2 * 86_400_000) delete state.tracked[id];
    }
    saveSnapshot('matches', state);

    const soon = state.fixtures.some((f) => f.startsAt && Math.abs(Date.parse(f.startsAt) - now) < 30 * 60_000);
    return soon || Object.values(state.tracked).some((t) => t.match.state === 'live');
  } finally {
    running = false;
  }
}

async function emitEvents(prev: Match, t: Tracked, now: number) {
  const sent = new Set(t.sent);
  const events = detectEvents(prev, t.match, sent);
  if (!events.length) { t.sent = [...sent]; return; }
  // Rohit's score: one scorecard call per event burst, at most every 20 min, only if budget allows
  const rohitMatch = t.match.teams.some((x) => /^india$/i.test(x) || isMI(x));
  if (rohitMatch && cricketdata.enabled() && t.match.id.startsWith('cd:') && canSpend(30)
      && (!t.lastScorecardAt || now - t.lastScorecardAt > 20 * 60_000)) {
    try { t.match.batters = await cricketdata.scorecard(t.match.id); t.lastScorecardAt = now; } catch { /* optional */ }
  }
  const { title, body } = summarize(t.match);
  for (const e of events) {
    sent.add(e.key);
    await notify(db, {
      kind: 'match', title, body, buzz: e.buzz, tag: `match:${t.match.id}`,
      data: { matchId: t.match.id, event: e.kind, final: e.kind === 'result' ? '1' : '0' },
    }).catch((err) => console.warn('[cricket] notify failed', err));
  }
  t.sent = [...sent];
}

export function getMatches() {
  const now = Date.now();
  const live = Object.values(state.tracked).map((t) => t.match).filter((m) => m.state === 'live');
  const upcoming = state.fixtures
    .filter((f) => f.state === 'upcoming' && f.startsAt && Date.parse(f.startsAt) > now - 3_600_000 && !live.some((l) => teamKey(l.teams) === teamKey(f.teams)))
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
  const h = getHistory();
  const sameGame = (a: Match, b: Match) => teamKey(a.teams) === teamKey(b.teams) && (a.startsAt ?? '').slice(0, 10) === (b.startsAt ?? '').slice(0, 10);
  const recentFromFixtures = state.fixtures.filter((f) => f.state === 'done');
  const recent = [...h.recent, ...state.recent, ...recentFromFixtures]
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id || sameGame(x, m)) === i)
    .sort((a, b) => (b.startsAt ?? b.updatedAt).localeCompare(a.startsAt ?? a.updatedAt)).slice(0, 12);
  const allUpcoming = [...upcoming, ...h.upcoming.filter((u) => Date.parse(u.startsAt!) > now - 3_600_000 && !live.some((l) => teamKey(l.teams) === teamKey(u.teams)))]
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id || sameGame(x, m)) === i)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
  return {
    live: live.map((m) => ({ ...m, summary: summarize(m) })),
    upcoming: allUpcoming.slice(0, 10),
    recent: recent.map((m) => ({ ...m, summary: summarize(m) })),
    tables: h.tables,
    story: h.story,
    form: { india: form('india'), mi: form('mi') },
    sources: {
      cricinfo: state.health.cricinfo ?? null,
      cricketdata: cricketdata.enabled() ? { ...state.health.cricketdata, hitsToday: cdBudget.hitsToday, hitsLimit: cdBudget.hitsLimit } : 'not configured',
      sportmonks: sportmonks.enabled() ? state.health.sportmonks ?? null : 'not configured',
    },
    rules: RULES,
  };
}

/** Test helpers */
export const __state = state;
