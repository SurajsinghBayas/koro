/**
 * Demo mode for screen recordings (reels, the README film). Turn it on from the WebView console with
 * `localStorage.setItem('koro.demo', '1'); location.reload()` and off with `localStorage.removeItem('koro.demo')`.
 *
 * While it's on, everything personal on screen is replaced by the tidy set below, nothing is saved
 * (kvSet is a no-op) and nothing syncs. Mac commands, the Mac's live status, music search and the
 * clipboard still go to the real server, so the phone really controls the Mac on camera.
 */
import { dayKey } from './util.ts';

export const DEMO = (() => { try { return localStorage.getItem('koro.demo') === '1'; } catch { return false; } })();

/** These still hit the network in demo mode. */
const LIVE = [/^\/v1\/mac/, /^\/v1\/music/, /^\/v1\/clip/];

const at = (h: number, m = 0, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ts = '2026-01-01T00:00:00.000Z';

const liveMatch = {
  id: 'demo-ind-aus', name: 'India vs Australia, 3rd T20I', format: 't20', teams: ['India', 'Australia'], short: ['IND', 'AUS'],
  startsAt: ago(150), venue: 'Wankhede Stadium, Mumbai', state: 'live', team: 'india', rule: 'india_t20', series: 'Australia tour of India',
  status: 'Australia need 45 runs from 21 balls',
  innings: [{ team: 'India', inning: 1, runs: 186, wkts: 4, overs: 20 }, { team: 'Australia', inning: 2, runs: 142, wkts: 6, overs: 16.3 }],
};
const nextMatch = {
  id: 'demo-ind-aus-4', name: 'India vs Australia, 4th T20I', format: 't20', teams: ['India', 'Australia'], short: ['IND', 'AUS'],
  startsAt: at(19, 0, 3).toISOString(), venue: 'Eden Gardens, Kolkata', state: 'upcoming', team: 'india', rule: 'india_t20', series: 'Australia tour of India',
  status: 'Starts in 3 days', innings: [],
};
const lastMatch = {
  id: 'demo-ind-aus-2', name: 'India vs Australia, 2nd T20I', format: 't20', teams: ['India', 'Australia'], short: ['IND', 'AUS'],
  startsAt: at(19, 0, -3).toISOString(), venue: 'MA Chidambaram Stadium, Chennai', state: 'done', team: 'india', rule: 'india_t20', series: 'Australia tour of India',
  status: 'India won by 7 wickets', winner: 'India',
  innings: [{ team: 'Australia', inning: 1, runs: 171, wkts: 8, overs: 20 }, { team: 'India', inning: 2, runs: 174, wkts: 3, overs: 18.2 }],
};

const empty = { world: [], india: [], ai: [], startups: [], cricket: [] };
function home() {
  return {
    now: new Date().toISOString(),
    me: { id: 'demo-phone', name: 'Galaxy S25', kind: 'phone' },
    brief: {
      at: ago(12),
      text: [
        '☀️ 24°, clear skies all evening. Perfect for a run before the gym at 7.',
        '✅ 3 things today: ship the Koro update, gym at 7, call Mom.',
        '🏏 India need 4 wickets to go 3–0 up. Australia chasing 187 at Wankhede.',
        '💧 1.25 L of water so far. Two more glasses before dinner.',
      ].join('\n'),
    },
    matches: { live: [liveMatch], upcoming: [nextMatch], recent: [lastMatch] },
    news: { ...empty, updatedAt: ago(20), digest: {} },
    devices: [
      { id: 'demo-mac', name: 'MacBook Pro', kind: 'mac', battery_pct: 86, charging: false, battery_at: ago(1), last_seen: ago(0) },
      { id: 'demo-phone', name: 'Galaxy S25', kind: 'phone', battery_pct: 92, charging: true, battery_at: ago(0), last_seen: ago(0) },
    ],
    inbox: [],
    x: { at: null, digest: null, feed: [], cricket: [] },
    features: { ai: true, push: true, cricketDetail: true, sportmonks: false },
  };
}

function weather() {
  const hours = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + i + 1); return { at: d.toISOString(), temp: 24 - Math.round(i / 3), code: 0, rain: 0 }; });
  return {
    place: 'Mumbai', now: { temp: 24, feels: 24, code: 0, wind: 9, humidity: 48, isDay: true },
    today: { max: 29, min: 21, rainChance: 0, sunrise: at(6, 42).toISOString(), sunset: at(18, 2).toISOString(), uv: 3 },
    hours, aqi: 42, rainSoon: null, at: new Date().toISOString(),
  };
}

const matchesFull = () => ({
  live: [liveMatch], upcoming: [nextMatch], recent: [lastMatch], tables: [],
  story: { india: 'Unbeaten in the series. Suryakumar\'s 68 off 34 set up 186, and Bumrah has two in two overs to put the squeeze on Australia.', at: ago(5) },
  form: { india: ['W', 'W', 'L', 'W', 'W'], mi: [] },
});

/** Fixture for a server path, or undefined to let the request go out for real. */
export function demoResponse(path: string): unknown {
  if (LIVE.some((r) => r.test(path))) return undefined;
  const p = path.split('?')[0]!;
  if (p === '/v1/home') return home();
  if (p === '/v1/matches') return matchesFull();
  if (p === '/v1/weather') return weather();
  if (p === '/v1/news') return { items: [], digest: null };
  if (p === '/v1/x') return { at: null, digest: null, feed: [], cricket: [] };
  if (p === '/v1/sync') return { changes: [], cursor: 0, rejected: [] };
  if (p === '/v1/yt') return { channels: [], videos: [], at: null };
  return {};
}

const row = (id: string) => ({ id: `demo-${id}`, updated_at: ts, deleted_at: null });
const today = () => dayKey();

/** The tidy data shown instead of the real lists, screen time and calendar. */
export function demoState() {
  const t = today();
  const days = (n: number) => dayKey(new Date(Date.now() - n * 86_400_000));
  return {
    tasks: [
      { ...row('t1'), title: 'Ship the Koro update', priority: 1, due_on: t, due_time: null, done_at: null, sort: 1 },
      { ...row('t2'), title: 'Gym', priority: 0, due_on: t, due_time: '19:00', done_at: null, sort: 2 },
      { ...row('t3'), title: 'Call Mom', priority: 0, due_on: t, due_time: '21:30', done_at: null, sort: 3 },
      { ...row('t4'), title: 'Book flights for Goa', priority: 0, due_on: t, due_time: null, done_at: new Date().toISOString(), sort: 4 },
    ],
    reminders: [
      { ...row('r1'), title: 'Gym', fire_at: at(19).toISOString(), repeat: null, done_at: null },
      { ...row('r2'), title: 'Call Mom', fire_at: at(21, 30).toISOString(), repeat: null, done_at: null },
    ],
    habits: [
      { ...row('h1'), name: 'Read 20 pages', days_mask: 127, remind_time: '22:00', sort: 1 },
      { ...row('h2'), name: 'No phone after 11', days_mask: 127, remind_time: '23:00', sort: 2 },
    ],
    habit_logs: [1, 2, 3, 4, 5, 6].map((n) => ({ ...row(`l1-${n}`), habit_id: 'demo-h1', day: days(n) }))
      .concat([1, 2, 3].map((n) => ({ ...row(`l2-${n}`), habit_id: 'demo-h2', day: days(n) }))),
    grocery_items: ['Oat milk', 'Eggs', 'Avocados', 'Coffee beans'].map((name, i) => ({ ...row(`g${i}`), name, category: null, need_by: null, bought_at: null, sort: i })),
    water_logs: [{ ...row('w1'), day: t, ml: 1250 }],
    saved: [],
    apps: {
      totalMin: 171,
      apps: [
        { pkg: 'com.instagram.android', label: 'Instagram', min: 62 },
        { pkg: 'com.google.android.youtube', label: 'YouTube', min: 38 },
        { pkg: 'com.whatsapp', label: 'WhatsApp', min: 24 },
        { pkg: 'com.google.android.apps.youtube.music', label: 'YT Music', min: 19 },
        { pkg: 'com.android.chrome', label: 'Chrome', min: 12 },
        { pkg: 'com.google.android.gm', label: 'Gmail', min: 9 },
        { pkg: 'com.google.android.apps.maps', label: 'Maps', min: 7 },
      ],
    },
    appLimits: { 'com.instagram.android': { min: 60, label: 'Instagram' }, 'com.google.android.youtube': { min: 90, label: 'YouTube' } },
    events: [
      { id: 'demo-e1', title: 'Design review', begin: at(16).getTime(), end: at(16, 45).getTime(), allDay: false, location: '', color: '#5EC8FF', calendar: 'Work' },
      { id: 'demo-e2', title: 'Dinner with friends', begin: at(20, 30).getTime(), end: at(22).getTime(), allDay: false, location: 'Bandra', color: '#F2C14E', calendar: 'Personal' },
    ],
    weather: weather(),
    home: home(),
    matchesFull: matchesFull(),
  };
}
