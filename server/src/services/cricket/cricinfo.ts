import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../../lib/http.ts';
import { normalizeFormat, ruleFor } from './rules.ts';
import type { Innings, Match, ScoreSource } from './types.ts';

/**
 * Layer A: Cricinfo's public live-scores RSS. Free, no key, one request lists every live match.
 * Only gives totals ("India 245/4 * v Australia 320/8"), no overs/format — used to detect live
 * matches, keep totals fresh between detail calls, and as a fallback.
 */
export const CRICINFO_RSS = 'https://static.cricinfo.com/rss/livescores.xml';

export type RssLine = { id: string; teams: [string, string]; scores: [Omit<Innings, 'team' | 'inning' | 'overs'>[], Omit<Innings, 'team' | 'inning' | 'overs'>[]]; batting?: 0 | 1; title: string };

const SCORE = /(\d+)(?:\/(\d+))?(?:d|dec)?/g;

/** "India 245/4 * v Australia 320/10 & 12/0" → structured. Exported for tests. */
export function parseLine(title: string, link = ''): RssLine | null {
  const parts = title.replace(/&amp;/g, '&').split(/\s+v\s+/);
  if (parts.length !== 2) return null;
  const side = (s: string) => {
    const batting = s.includes('*');
    const clean = s.replace(/\*/g, '').trim();
    const firstScore = clean.search(/\s\d+(\/\d+)?/);
    const name = (firstScore >= 0 ? clean.slice(0, firstScore) : clean).trim();
    const scoreTxt = firstScore >= 0 ? clean.slice(firstScore) : '';
    // Cricinfo writes all-out as "/10", so a bare number ("& 7 *") means no wickets down yet.
    const scores = [...scoreTxt.matchAll(SCORE)].map((m) => ({ runs: Number(m[1]), wkts: m[2] === undefined ? 0 : Number(m[2]) }));
    return { name, scores, batting };
  };
  const a = side(parts[0]!), b = side(parts[1]!);
  if (!a.name || !b.name) return null;
  const id = link.match(/match\/(\d+)/)?.[1] ?? `${a.name}-${b.name}`.toLowerCase().replace(/\W+/g, '-');
  return { id, teams: [a.name, b.name], scores: [a.scores, b.scores], batting: a.batting ? 0 : b.batting ? 1 : undefined, title };
}

const parser = new XMLParser({ ignoreAttributes: true });

export async function fetchRssLines(): Promise<RssLine[]> {
  const { text } = await fetchText(CRICINFO_RSS, { conditional: false, timeoutMs: 10_000 });
  const items = parser.parse(text)?.rss?.channel?.item ?? [];
  return ([] as any[]).concat(items).map((it) => parseLine(String(it.title ?? ''), String(it.guid ?? it.link ?? ''))).filter(Boolean) as RssLine[];
}

/** Turn an RSS line into a minimal Match (format unknown → guessed from score shape). */
export function lineToMatch(l: RssLine): Match {
  const innings: Innings[] = [];
  // Order innings by appearance: team 0 inn 1, team 1 inn 1, team 0 inn 2, team 1 inn 2 (good enough for display)
  const max = Math.max(l.scores[0].length, l.scores[1].length);
  let n = 0;
  for (let i = 0; i < max; i++) for (const t of [0, 1] as const) {
    const s = l.scores[t][i];
    if (s) innings.push({ team: l.teams[t], inning: ++n, runs: s.runs, wkts: s.wkts, overs: 0 });
  }
  if (l.batting !== undefined) {
    // make sure the batting side is the last innings
    const idx = innings.map((x) => x.team).lastIndexOf(l.teams[l.batting]);
    if (idx >= 0 && idx !== innings.length - 1) innings.push(innings.splice(idx, 1)[0]!);
  }
  const multi = l.scores[0].length > 1 || l.scores[1].length > 1;
  const format = multi ? 'test' : normalizeFormat('t20', l.teams);
  const m: Match = {
    id: `ci:${l.id}`, source: 'cricinfo', name: `${l.teams[0]} v ${l.teams[1]}`, format, teams: l.teams,
    status: l.title, state: 'live', innings, updatedAt: new Date().toISOString(),
  };
  m.rule = ruleFor(m);
  return m;
}

export const cricinfo: ScoreSource = {
  name: 'cricinfo',
  enabled: () => true,
  async live() {
    return (await fetchRssLines()).map(lineToMatch);
  },
};
