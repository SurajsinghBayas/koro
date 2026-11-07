import { env } from '../../env.ts';
import { fetchJson } from '../../lib/http.ts';
import { normalizeFormat, ruleFor } from './rules.ts';
import type { Batter, Innings, Match, ScoreSource } from './types.ts';

/**
 * Layer B: CricketData.org (CricAPI v1). Free plan = 100 hits/day.
 * `currentMatches` returns every current match with per-innings overs in ONE hit.
 * The response's `info.hitsToday` is used as the real budget counter.
 */
const BASE = 'https://api.cricapi.com/v1';

type CdScore = { r: number; w: number; o: number; inning: string };
type CdMatch = {
  id: string; name: string; matchType: string; status: string; venue?: string; date?: string; dateTimeGMT?: string;
  teams?: string[]; teamInfo?: { name: string; shortname?: string }[]; score?: CdScore[]; series_id?: string;
  matchStarted?: boolean; matchEnded?: boolean;
};
type CdResp<T> = { status: string; reason?: string; data: T; info?: { hitsToday?: number; hitsLimit?: number; hitsUsed?: number } };

export const budget = { hitsToday: 0, hitsLimit: 100, day: new Date().toISOString().slice(0, 10) };
const roll = () => {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== budget.day) { budget.day = d; budget.hitsToday = 0; }
};
export const canSpend = (cost = 1) => {
  roll();
  return budget.hitsToday + cost <= Math.min(env.CRICKETDATA_DAILY_BUDGET, budget.hitsLimit - 2);
};

async function call<T>(path: string, params: Record<string, string | number> = {}, cost = 1): Promise<T> {
  if (!env.CRICKETDATA_API_KEY) throw new Error('CRICKETDATA_API_KEY not set');
  if (!canSpend(cost)) throw new Error(`CricketData daily budget reached (${budget.hitsToday}/${env.CRICKETDATA_DAILY_BUDGET})`);
  const qs = new URLSearchParams({ apikey: env.CRICKETDATA_API_KEY, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetchJson<CdResp<T>>(`${BASE}/${path}?${qs}`);
  budget.hitsToday = res.info?.hitsToday ?? budget.hitsToday + cost;
  if (res.info?.hitsLimit) budget.hitsLimit = res.info.hitsLimit;
  if (res.status !== 'success') throw new Error(`CricketData ${path}: ${res.reason ?? res.status}`);
  return res.data;
}

const teamOfInning = (inning: string, teams: string[]) =>
  teams.find((t) => inning.toLowerCase().startsWith(t.toLowerCase())) ?? inning.replace(/\s+inning.*$/i, '');

/** Exported for tests. */
export function mapMatch(m: CdMatch): Match {
  const teams = (m.teams?.length === 2 ? m.teams : m.name.split(/\s+vs?\s+/i).slice(0, 2)) as [string, string];
  const short = m.teamInfo?.length === 2
    ? (teams.map((t) => m.teamInfo!.find((ti) => ti.name === t)?.shortname ?? '') as [string, string])
    : undefined;
  const innings: Innings[] = (m.score ?? []).map((s, i) => ({
    team: teamOfInning(s.inning, teams), inning: i + 1, runs: s.r ?? 0, wkts: s.w ?? 0, overs: s.o ?? 0,
  }));
  const startsAt = m.dateTimeGMT ? new Date(m.dateTimeGMT.endsWith('Z') ? m.dateTimeGMT : m.dateTimeGMT + 'Z').toISOString() : undefined;
  const match: Match = {
    id: `cd:${m.id}`, source: 'cricketdata', name: m.name, format: normalizeFormat(m.matchType ?? '', teams, m.name),
    teams, short: short?.every(Boolean) ? short : undefined, startsAt, venue: m.venue, status: m.status ?? '',
    state: m.matchEnded ? 'done' : m.matchStarted ? 'live' : 'upcoming', innings, updatedAt: new Date().toISOString(),
  };
  match.rule = ruleFor(match);
  return match;
}

export const cricketdata: ScoreSource & { scorecard(id: string): Promise<Batter[]> } = {
  name: 'cricketdata',
  enabled: () => Boolean(env.CRICKETDATA_API_KEY),
  /** Upcoming + recent matches (1 hit per page). */
  async fixtures() {
    const pages = await Promise.all([0, 25].map((offset) => call<CdMatch[]>('matches', { offset }).catch(() => [] as CdMatch[])));
    return pages.flat().map(mapMatch);
  },
  /** All current matches with overs (1 hit). */
  async live() {
    return (await call<CdMatch[]>('currentMatches', { offset: 0 })).map(mapMatch);
  },
  /** Batters (for Rohit's score). Scorecard may cost more than 1 hit on the free plan, so it is used sparingly. */
  async scorecard(id: string) {
    const data = await call<{ scorecard?: { batting?: { batsman?: { name?: string }; r?: number; b?: number; 'dismissal-text'?: string }[] }[] }>(
      'match_scorecard', { id: id.replace(/^cd:/, '') }, 10,
    );
    const inns = data.scorecard ?? [];
    return (inns[inns.length - 1]?.batting ?? []).map((b) => ({
      name: b.batsman?.name ?? '?', runs: b.r ?? 0, balls: b.b ?? 0,
      out: !!b['dismissal-text'] && !/not out|batting/i.test(b['dismissal-text']),
    }));
  },
};
