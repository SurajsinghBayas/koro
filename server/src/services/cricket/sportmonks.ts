import { env } from '../../env.ts';
import { fetchJson } from '../../lib/http.ts';
import { ruleFor } from './rules.ts';
import type { Innings, Match, ScoreSource } from './types.ts';

/**
 * Layer C: Sportmonks free plan — T20 Internationals (plus BBL / CSA T20), 180 calls/hour/endpoint.
 * Used for India T20Is at no cost.
 */
const BASE = 'https://cricket.sportmonks.com/api/v2.0';

type SmTeam = { id: number; name: string; code?: string };
type SmFixture = {
  id: number; league_id: number; type?: string; status: string; note?: string; starting_at?: string;
  localteam?: SmTeam; visitorteam?: SmTeam; runs?: { team_id: number; inning: number; score: number; wickets: number; overs: number }[];
};

const calls: number[] = [];
const underLimit = () => {
  const hourAgo = Date.now() - 3_600_000;
  while (calls.length && calls[0]! < hourAgo) calls.shift();
  return calls.length < 170;
};

/** Exported for tests. */
export function mapFixture(f: SmFixture): Match | null {
  if (!f.localteam || !f.visitorteam) return null;
  const teams: [string, string] = [f.localteam.name, f.visitorteam.name];
  const byId = new Map([[f.localteam.id, f.localteam], [f.visitorteam.id, f.visitorteam]]);
  const innings: Innings[] = (f.runs ?? []).sort((a, b) => a.inning - b.inning).map((r) => ({
    team: byId.get(r.team_id)?.name ?? '?', inning: r.inning, runs: r.score, wkts: r.wickets, overs: r.overs,
  }));
  const finished = /finished|aban|cancl|no result/i.test(f.status);
  const m: Match = {
    id: `sm:${f.id}`, source: 'sportmonks', name: `${teams[0]} vs ${teams[1]}`, format: 't20i', teams,
    short: f.localteam.code && f.visitorteam.code ? [f.localteam.code, f.visitorteam.code] : undefined,
    startsAt: f.starting_at, status: f.note || f.status, state: finished ? 'done' : f.status === 'NS' ? 'upcoming' : 'live',
    innings, updatedAt: new Date().toISOString(),
  };
  m.rule = ruleFor(m);
  return m;
}

export const sportmonks: ScoreSource = {
  name: 'sportmonks',
  enabled: () => Boolean(env.SPORTMONKS_API_TOKEN),
  async live() {
    if (!underLimit()) throw new Error('Sportmonks hourly limit reached');
    calls.push(Date.now());
    const res = await fetchJson<{ data: SmFixture[] }>(
      `${BASE}/livescores?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}&include=localteam,visitorteam,runs`,
    );
    return (res.data ?? []).map(mapFixture).filter(Boolean) as Match[];
  },
};
