import { aiEnabled } from '../../env.ts';
import { loadSnapshot, saveSnapshot } from '../../lib/snapshot.ts';
import { chatJson } from '../ai.ts';
import { cricketdata, mapMatch, seriesCall, type CdMatch } from './cricketdata.ts';
import { isIndia, isMI } from './rules.ts';
import type { Match } from './types.ts';

/**
 * Off-season view: recent results (with AI recaps), the schedule ahead and the IPL table,
 * for India and Mumbai Indians. Refreshed twice a day from CricketData (≈ 10–15 hits),
 * results never change so their details and recaps are cached for good.
 */
export type TableRow = { team: string; short?: string; img?: string; p: number; w: number; l: number; nr: number; pts: number };
export type Table = { series: string; rows: TableRow[] };
export type HMatch = Match & { series?: string; recap?: string; winner?: string; team: 'india' | 'mi' };
export type History = {
  at: number;
  recent: HMatch[];
  upcoming: HMatch[];
  tables: Table[];
  story: { india?: string; mi?: string; at?: string };
  recaps: Record<string, string>;
  details: Record<string, Match>;
  series: { id: string; name: string }[];
};

const REFRESH = 12 * 3_600_000;
const state: History = loadSnapshot<History>('history', { at: 0, recent: [], upcoming: [], tables: [], story: {}, recaps: {}, details: {}, series: [] });

export const getHistory = () => state;

type CdSeries = { id: string; name: string; startDate?: string; endDate?: string };
type CdPoints = { teamname: string; shortname?: string; img?: string; matches?: number; wins?: number; loss?: number; ties?: number; nr?: number };

const yearOf = (s: CdSeries) => Number(s.name.match(/\b(20\d\d)\b/)?.[1] ?? s.startDate?.slice(0, 4) ?? 0);
const newest = (a: CdSeries, b: CdSeries) => yearOf(b) - yearOf(a) || String(b.startDate ?? '').localeCompare(String(a.startDate ?? ''));
const teamOf = (m: Match): 'india' | 'mi' | null =>
  m.teams.some((t) => isMI(t)) ? 'mi' : m.teams.some((t) => isIndia(t)) ? 'india' : null;

/** "India won by 6 wkts" → "India". Exported for tests. */
export function winnerOf(status: string, teams: [string, string]): string | undefined {
  const m = status.match(/^(.+?)\s+won\b/i);
  if (!m) return undefined;
  const w = m[1]!.trim().toLowerCase();
  return teams.find((t) => t.toLowerCase() === w || w.startsWith(t.toLowerCase()) || t.toLowerCase().startsWith(w));
}

/** Points table rows, sorted like the official table. Exported for tests. */
export function toTable(series: string, rows: CdPoints[]): Table {
  return {
    series,
    rows: rows.map((r) => {
      const w = r.wins ?? 0, nr = (r.nr ?? 0) + (r.ties ?? 0);
      return { team: r.teamname, short: r.shortname, img: r.img, p: r.matches ?? 0, w, l: r.loss ?? 0, nr, pts: w * 2 + nr };
    }).sort((a, b) => b.pts - a.pts || b.w - a.w),
  };
}

let running = false;
export async function refreshHistory(force = false, engineRecent: Match[] = []) {
  if (running) return;
  running = true;
  try {
    if (cricketdata.enabled() && (force || Date.now() - state.at > REFRESH)) await fromCricketData();
    mergeEngine(engineRecent);
    await writeRecaps();
    saveSnapshot('history', state);
  } catch (e) {
    console.warn('[history] refresh failed:', (e as Error).message);
  } finally {
    running = false;
  }
}

async function fromCricketData() {
  // 1. Which series: the latest IPL + the 3 most recent India series (2 hits)
  const [ipl, ind] = await Promise.all([
    seriesCall<CdSeries[]>('series', { offset: 0, search: 'Indian Premier League' }).catch(() => [] as CdSeries[]),
    seriesCall<CdSeries[]>('series', { offset: 0, search: 'India' }).catch(() => [] as CdSeries[]),
  ]);
  const iplLatest = ipl.filter((s) => /indian premier league/i.test(s.name) && !/women/i.test(s.name)).sort(newest)[0];
  const indiaSeries = ind
    .filter((s) => /\bindia\b/i.test(s.name) && !/premier league|women|under-?19|\bA\b tour|legends|masters/i.test(s.name) && yearOf(s) >= new Date().getFullYear() - 1)
    .sort(newest).slice(0, 3);
  const chosen = [...(iplLatest ? [iplLatest] : []), ...indiaSeries];
  if (!chosen.length) return;
  state.series = chosen.map((s) => ({ id: s.id, name: s.name }));

  // 2. Fixtures and results of each series (1 hit each)
  const all: HMatch[] = [];
  for (const s of chosen) {
    try {
      const info = await seriesCall<{ info?: { name?: string }; matchList?: CdMatch[] }>('series_info', { id: s.id });
      for (const raw of info.matchList ?? []) {
        const m = mapMatch(raw);
        const team = teamOf(m);
        if (team) all.push({ ...m, series: s.name, team });
      }
    } catch (e) { console.warn('[history] series_info', s.name, (e as Error).message); }
  }

  // 3. IPL table (1 hit)
  state.tables = [];
  if (iplLatest) {
    try { state.tables.push(toTable(iplLatest.name, await seriesCall<CdPoints[]>('series_points', { id: iplLatest.id }))); }
    catch (e) { console.warn('[history] series_points', (e as Error).message); }
  }

  const now = Date.now();
  const done = all.filter((m) => m.state === 'done' || /won|tied|drawn|no result|abandon/i.test(m.status))
    .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));
  state.upcoming = all.filter((m) => m.state === 'upcoming' && m.startsAt && Date.parse(m.startsAt) > now - 3_600_000)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!)).slice(0, 10);

  // 4. Scores for the latest few results (1 hit each, cached forever)
  const want = [...done.filter((m) => m.team === 'india').slice(0, 4), ...done.filter((m) => m.team === 'mi').slice(0, 4)];
  for (const m of want) {
    if (state.details[m.id] || m.innings.length) continue;
    try {
      const d = mapMatch(await seriesCall<CdMatch>('match_info', { id: m.id.replace(/^cd:/, '') }));
      state.details[m.id] = d;
    } catch { break; } // budget reached or API down: try again next refresh
  }
  state.recent = done.slice(0, 16).map((m) => {
    const d = state.details[m.id];
    const merged: HMatch = d ? { ...m, innings: d.innings.length ? d.innings : m.innings, status: d.status || m.status, venue: d.venue ?? m.venue } : m;
    merged.state = 'done';
    merged.winner = winnerOf(merged.status, merged.teams);
    return merged;
  });
  state.at = now;
  console.log(`[history] ${state.recent.length} results, ${state.upcoming.length} upcoming, ${state.tables.length} table(s)`);
}

/** Without CricketData (or for matches it misses), finished matches seen live via Cricinfo still count. */
function mergeEngine(engineRecent: Match[]) {
  for (const m of engineRecent) {
    const team = teamOf(m);
    if (!team || state.recent.some((r) => r.id === m.id || (r.teams.join() === m.teams.join() && r.startsAt === m.startsAt))) continue;
    state.recent.push({ ...m, team, state: 'done', winner: winnerOf(m.status, m.teams) });
  }
  state.recent.sort((a, b) => (b.startsAt ?? b.updatedAt).localeCompare(a.startsAt ?? a.updatedAt));
  state.recent = state.recent.slice(0, 16);
  // keep the detail cache small
  const keep = new Set(state.recent.map((r) => r.id));
  for (const id of Object.keys(state.details)) if (!keep.has(id)) delete state.details[id];
}

const line = (m: HMatch) => {
  const sc = m.innings.map((i) => `${i.team} ${i.runs}/${i.wkts} (${i.overs} ov)`).join(', ');
  return `id=${m.id} | ${m.name}${m.series ? ` | ${m.series}` : ''} | ${m.startsAt?.slice(0, 10) ?? ''} | ${m.venue ?? ''} | ${sc || 'no scores'} | result: ${m.status}`;
};

async function writeRecaps() {
  if (!aiEnabled()) return;
  const todo = state.recent.filter((m) => !state.recaps[m.id]).slice(0, 8);
  if (todo.length) {
    try {
      const j = await chatJson<Record<string, unknown>>([
        { role: 'system', content:
          'You write short cricket match recaps for an Indian fan of Rohit Sharma, Mumbai Indians and the Indian team. For each match write 1–2 sentences ' +
          '(max 220 chars) about how it went, from the fan\'s side. Use ONLY the data given (teams, scores, overs, venue, result). Never invent player names, ' +
          'individual scores, or moments that are not in the data. Reply JSON only: {"<id>": "recap", ...}' },
        { role: 'user', content: todo.map(line).join('\n') },
      ], 900, 40_000);
      for (const m of todo) if (typeof j[m.id] === 'string') state.recaps[m.id] = (j[m.id] as string).slice(0, 300);
    } catch (e) { console.warn('[history] recaps failed:', (e as Error).message); }
  }
  for (const m of state.recent) m.recap = state.recaps[m.id];
  const keep = new Set(state.recent.map((r) => r.id));
  for (const id of Object.keys(state.recaps)) if (!keep.has(id)) delete state.recaps[id];

  // The "story so far" for each team, at most twice a day
  if (!state.recent.length) return;
  if (state.story.at && Date.now() - Date.parse(state.story.at) < REFRESH && !todo.length) return;
  const table = state.tables[0];
  const ctx = (team: 'india' | 'mi') => state.recent.filter((m) => m.team === team).slice(0, 6).map(line).join('\n');
  try {
    const j = await chatJson<{ india?: unknown; mi?: unknown }>([
      { role: 'system', content:
        'Write two short paragraphs (max 260 chars each) for a fan: how India have been doing lately, and how Mumbai Indians did in their latest IPL season. ' +
        'Mention form (wins/losses) and, for MI, their table position if given. Use ONLY the data given; if there is no data for a team, return an empty string. ' +
        'Reply JSON only: {"india": string, "mi": string}' },
      { role: 'user', content:
        `INDIA RECENT:\n${ctx('india') || 'none'}\n\nMI RECENT:\n${ctx('mi') || 'none'}\n\n` +
        (table ? `${table.series} TABLE:\n${table.rows.map((r, i) => `${i + 1}. ${r.team} P${r.p} W${r.w} L${r.l} Pts ${r.pts}`).join('\n')}` : '') },
    ], 500, 30_000);
    state.story = { india: typeof j.india === 'string' ? j.india : undefined, mi: typeof j.mi === 'string' ? j.mi : undefined, at: new Date().toISOString() };
  } catch (e) { console.warn('[history] story failed:', (e as Error).message); }
}

/** W/L/D for the last five results. */
export const form = (team: 'india' | 'mi') =>
  state.recent.filter((m) => m.team === team).slice(0, 5).map((m) => {
    if (!m.winner) return 'D';
    const ours = team === 'mi' ? isMI(m.winner) : isIndia(m.winner);
    return ours ? 'W' : 'L';
  });
