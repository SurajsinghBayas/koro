import { describe, expect, test } from 'bun:test';
import { parseQuick } from '../../shared/quickadd.ts';
import { migrate, openDb } from '../src/db.ts';
import { pull, applyChange } from '../src/routes/sync.ts';
import { lineToMatch, parseLine } from '../src/services/cricket/cricinfo.ts';
import { mapMatch } from '../src/services/cricket/cricketdata.ts';
import { nextDetailDelay } from '../src/services/cricket/engine.ts';
import { detectEvents, isIndia, isResult, ruleFor, summarize } from '../src/services/cricket/rules.ts';
import { mapFixture } from '../src/services/cricket/sportmonks.ts';
import type { Match } from '../src/services/cricket/types.ts';
import { parseFeed } from '../src/services/news.ts';

const base = (over: Partial<Match>): Match => ({
  id: 'cd:1', source: 'cricketdata', name: 'India vs Australia', format: 'odi', teams: ['India', 'Australia'],
  status: 'India batting', state: 'live', innings: [], updatedAt: new Date().toISOString(), ...over,
});

describe('cricinfo rss', () => {
  test('parses multi-innings line with batting marker', () => {
    const l = parseLine('Bangladesh 386/10  v West Indies 356/10 &amp;  7 *', 'http://www.cricinfo.com/ci/engine/match/1553296.html')!;
    expect(l.id).toBe('1553296');
    expect(l.teams).toEqual(['Bangladesh', 'West Indies']);
    expect(l.scores[1]).toEqual([{ runs: 356, wkts: 10 }, { runs: 7, wkts: 0 }]);
    expect(l.batting).toBe(1);
    const m = lineToMatch(l);
    expect(m.format).toBe('test');
    expect(m.innings.at(-1)).toMatchObject({ team: 'West Indies', runs: 7 });
  });
  test('team names with suffix and live score', () => {
    const l = parseLine('Zimbabwe A 261/10 * v Ireland A 424/10 ')!;
    expect(l.teams).toEqual(['Zimbabwe A', 'Ireland A']);
    expect(lineToMatch(parseLine('India 245/4 * v Australia ')!).rule).toBe('india_t20');
  });
});

describe('rules', () => {
  test('India filter is exact', () => {
    expect(isIndia('India')).toBe(true);
    for (const t of ['India A', 'India U19', 'India Legends', 'India Women']) expect(isIndia(t)).toBe(false);
  });
  test('rule selection', () => {
    expect(ruleFor({ teams: ['Mumbai Indians', 'Chennai Super Kings'], format: 't20', name: '', series: '' })).toBe('ipl_mi');
    expect(ruleFor({ teams: ['India', 'England'], format: 'test', name: '', series: '' })).toBe('india_test');
    expect(ruleFor({ teams: ['Australia', 'England'], format: 'odi', name: '', series: '' })).toBeUndefined();
  });
  test('toss is not a result', () => {
    expect(isResult('India won the toss and elected to bat')).toBe(false);
    expect(isResult('India won by 7 wkts')).toBe(true);
    expect(isResult('India need 45 runs in 30 balls')).toBe(false);
  });
  test('ODI milestones: only the latest crossed, once', () => {
    const sent = new Set<string>();
    const prev = base({ rule: 'india_odi', innings: [{ team: 'India', inning: 1, runs: 40, wkts: 0, overs: 8.3 }] });
    const cur = base({ rule: 'india_odi', innings: [{ team: 'India', inning: 1, runs: 61, wkts: 1, overs: 10.2 }] });
    expect(detectEvents(prev, cur, sent).map((e) => e.key)).toEqual(['i1:o10']);
    sent.add('i1:o10');
    expect(detectEvents(cur, cur, sent)).toEqual([]);
    const later = base({ rule: 'india_odi', innings: [{ team: 'India', inning: 1, runs: 170, wkts: 3, overs: 31 }] });
    expect(detectEvents(cur, later, sent).map((e) => e.key)).toEqual(['i1:o30']);
    expect(sent.has('i1:o20')).toBe(true);
  });
  test('T20I milestones 5/10/15/20', () => {
    const cur = base({ format: 't20i', rule: 'india_t20', innings: [{ team: 'India', inning: 1, runs: 52, wkts: 1, overs: 5.1 }] });
    expect(detectEvents(cur, cur, new Set()).map((e) => e.key)).toEqual(['i1:o5']);
  });
  test('IPL every over, never on first sight', () => {
    const p = base({ format: 't20', teams: ['Mumbai Indians', 'CSK'], rule: 'ipl_mi', innings: [{ team: 'Mumbai Indians', inning: 1, runs: 30, wkts: 0, overs: 3.4 }] });
    const c = base({ ...p, innings: [{ team: 'Mumbai Indians', inning: 1, runs: 41, wkts: 0, overs: 4.1 }] });
    expect(detectEvents(undefined, c, new Set())).toEqual([]);
    expect(detectEvents(p, c, new Set()).map((e) => e.key)).toEqual(['i1:o4']);
  });
  test('Test sessions and result buzz', () => {
    const lunch = base({ format: 'test', rule: 'india_test', status: 'Day 2: Lunch - India lead by 120 runs' });
    expect(detectEvents(undefined, lunch, new Set()).map((e) => e.key)).toEqual(['d2:lunch']);
    const done = base({ format: 'test', rule: 'india_test', status: 'India won by an innings and 40 runs', state: 'done' });
    expect(detectEvents(undefined, done, new Set())).toEqual([{ key: 'result', kind: 'result', buzz: true }]);
  });
  test('summary text', () => {
    const m = base({ rule: 'india_odi', innings: [{ team: 'India', inning: 1, runs: 168, wkts: 3, overs: 30 }], batters: [{ name: 'Rohit Sharma', runs: 72, balls: 70, out: false }] });
    expect(summarize(m)).toEqual({ title: 'IND vs AUS', body: 'IND 168/3 (30 ov) · Rohit 72* (70) · RR 5.6' });
  });
  test('detail scheduling targets the next milestone', () => {
    const t = { match: base({ rule: 'india_odi', innings: [{ team: 'India', inning: 1, runs: 10, wkts: 0, overs: 2 }] }), sent: [], nextDetailAt: 0, lastSeenRss: 0, samples: [] };
    const ms = nextDetailDelay(t as any, false);
    expect(ms).toBeGreaterThan(20 * 60_000);   // ~6.8 overs × 4 min away
    t.match.innings[0]!.overs = 9.1;
    expect(nextDetailDelay(t as any, false)).toBe(75_000);
  });
});

describe('providers map', () => {
  test('cricketdata currentMatches item', () => {
    const m = mapMatch({ id: 'abc', name: 'India vs Australia, 2nd ODI', matchType: 'odi', status: 'India opt to bat', teams: ['India', 'Australia'],
      teamInfo: [{ name: 'India', shortname: 'IND' }, { name: 'Australia', shortname: 'AUS' }], score: [{ r: 120, w: 2, o: 21.3, inning: 'India Inning 1' }],
      dateTimeGMT: '2026-11-09T03:30:00', matchStarted: true, matchEnded: false });
    expect(m).toMatchObject({ id: 'cd:abc', format: 'odi', rule: 'india_odi', state: 'live', short: ['IND', 'AUS'], startsAt: '2026-11-09T03:30:00.000Z' });
    expect(m.innings[0]).toEqual({ team: 'India', inning: 1, runs: 120, wkts: 2, overs: 21.3 });
  });
  test('sportmonks fixture', () => {
    const m = mapFixture({ id: 9, league_id: 3, status: '2nd Innings', note: 'India need 30', localteam: { id: 1, name: 'India', code: 'IND' }, visitorteam: { id: 2, name: 'England', code: 'ENG' },
      runs: [{ team_id: 2, inning: 1, score: 180, wickets: 6, overs: 20 }, { team_id: 1, inning: 2, score: 151, wickets: 3, overs: 16.2 }] })!;
    expect(m).toMatchObject({ rule: 'india_t20', state: 'live' });
    expect(m.innings[1]).toMatchObject({ team: 'India', overs: 16.2 });
  });
});

describe('news', () => {
  test('rss + atom', () => {
    const rss = `<rss><channel><item><title><![CDATA[Hello &amp; world]]></title><link>https://a.com/1</link><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(rss, 'tech', 'A')[0]).toMatchObject({ title: 'Hello & world', url: 'https://a.com/1' });
    const atom = `<feed><entry><title>T</title><link rel="alternate" href="https://b.com/2"/><published>2026-11-07T10:00:00Z</published></entry></feed>`;
    expect(parseFeed(atom, 'tech', 'B')[0]).toMatchObject({ url: 'https://b.com/2' });
  });
});

describe('quick add', () => {
  const now = new Date(2026, 10, 8, 14, 0); // Sun 8 Nov 2026 14:00 local
  test('grocery list', () => expect(parseQuick('milk, eggs and bread', now)).toMatchObject({ kind: 'grocery', items: ['Milk', 'Eggs', 'Bread'] }));
  test('reminder with time', () => {
    const r = parseQuick('6pm call mom', now);
    expect(r.kind).toBe('reminder');
    expect(r.title).toBe('Call mom');
    expect(new Date(r.at!).getHours()).toBe(18);
  });
  test('relative + tomorrow', () => {
    expect(new Date(parseQuick('remind me to stretch in 30 min', now).at!).getTime() - now.getTime()).toBe(30 * 60_000);
    const t = new Date(parseQuick('tomorrow 7:30 am gym', now).at!);
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([9, 7, 30]);
  });
  test('past time rolls to tomorrow', () => expect(new Date(parseQuick('9am standup', now).at!).getDate()).toBe(9));
  test('habit and task', () => {
    expect(parseQuick('read 20 pages daily', now)).toMatchObject({ kind: 'habit', title: 'Read 20 pages' });
    expect(parseQuick('finish koro backend', now)).toMatchObject({ kind: 'task', title: 'Finish koro backend' });
  });
});

describe('sync (embedded postgres)', () => {
  test('push, pull, last-write-wins, tombstones', async () => {
    const db = await openDb('pglite:memory');
    await migrate(db);
    const id = crypto.randomUUID();
    await applyChange(db, 'tasks', { id, title: 'A', updated_at: '2026-11-08T10:00:00Z' });
    let p = await pull(db, 0);
    expect(p.changes).toHaveLength(1);
    const cursor = p.cursor;
    await applyChange(db, 'tasks', { id, title: 'old edit', updated_at: '2026-11-08T09:00:00Z' }); // older → ignored
    await applyChange(db, 'tasks', { id, title: 'B', updated_at: '2026-11-08T11:00:00Z', done_at: '2026-11-08T11:00:00Z' });
    p = await pull(db, cursor);
    expect(p.changes[0]!.row).toMatchObject({ title: 'B' });
    await applyChange(db, 'tasks', { id, title: 'B', updated_at: '2026-11-08T12:00:00Z', deleted_at: '2026-11-08T12:00:00Z' });
    p = await pull(db, p.cursor);
    expect(p.changes[0]!.row.deleted_at).toBeTruthy();
    await db.close();
  });
});
