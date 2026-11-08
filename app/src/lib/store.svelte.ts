import { localWallClock, parseQuick, type QuickResult } from '../../../shared/quickadd.ts';
import { ApiError, request } from './api.ts';
import { kvClear, kvGet, kvSet } from './kv.ts';
import { native, type AppUse, type CalEvent, type NowPlaying } from './native.ts';
import { dayKey, localNowLabel, nowIso, uuid7 } from './util.ts';

// ---------- types ----------
type Base = { id: string; updated_at: string; deleted_at?: string | null };
export type Task = Base & { title: string; notes?: string | null; due_on?: string | null; due_time?: string | null; priority: number; done_at?: string | null; sort: number };
export type Grocery = Base & { name: string; category?: string | null; need_by?: string | null; bought_at?: string | null; sort: number };
export type Habit = Base & { name: string; days_mask: number; remind_time?: string | null; sort: number };
export type HabitLog = Base & { habit_id: string; day: string };
export type Reminder = Base & { title: string; fire_at: string; repeat?: string | null; done_at?: string | null };
export type WaterLog = Base & { day: string; ml: number };
export type Block = { t: 'p' | 'h' | 'li' | 'q'; x: string };
export type Saved = Base & { url: string; title?: string | null; site?: string | null; image?: string | null; excerpt?: string | null; summary?: string | null;
  content?: string | null; words?: number | null; status?: 'pending' | 'ready' | 'failed'; read_at?: string | null };
type Tables = { tasks: Task; grocery_items: Grocery; habits: Habit; habit_logs: HabitLog; reminders: Reminder; water_logs: WaterLog; saved: Saved };
export type TableName = keyof Tables;
const TABLES: TableName[] = ['tasks', 'grocery_items', 'habits', 'habit_logs', 'reminders', 'water_logs', 'saved'];

export type Innings = { team: string; inning: number; runs: number; wkts: number; overs: number };
export type Match = {
  id: string; name: string; format: string; teams: [string, string]; short?: [string, string]; startsAt?: string; venue?: string;
  status: string; state: 'upcoming' | 'live' | 'done'; innings: Innings[]; rule?: string; summary?: { title: string; body: string };
  series?: string; recap?: string; winner?: string; team?: 'india' | 'mi';
};
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string; cat: string; desc?: string; image?: string };
export type Story = { title: string; summary: string; url: string; image?: string; publishedAt: string; sources: { source: string; url: string }[] };
export type XMedia = { type: 'photo' | 'video'; url: string; poster?: string };
export type XPost = { id: string; author: string; text: string; url: string; createdAt: string; likes: number; retweets: number; replies: number; views: number; media: XMedia[]; quoted?: { author: string; text: string } };
export type XData = { at: string | null; digest: { at: string; lines: string[] } | null; feed: XPost[]; cricket: XPost[] };
export type TableRow = { team: string; short?: string; img?: string; p: number; w: number; l: number; nr: number; pts: number };
export type MatchesFull = {
  live: Match[]; upcoming: Match[]; recent: Match[];
  tables?: { series: string; rows: TableRow[] }[];
  story?: { india?: string; mi?: string; at?: string };
  form?: { india: string[]; mi: string[] };
};
export type DeviceRow = { id: string; name: string; kind: string; battery_pct: number | null; charging: boolean | null; battery_at: string | null; last_seen: string | null };
export type Home = {
  brief: { text: string; at: string } | null;
  matches: { live: Match[]; upcoming: Match[]; recent: Match[] };
  news: Record<'world' | 'india' | 'ai' | 'startups' | 'cricket', NewsItem[]> & { updatedAt: string | null; digest?: Partial<Record<string, Story[]>> };
  x?: XData;
  devices: DeviceRow[];
  mac?: MacState;
  inbox: { id: number; kind: string; title: string; body: string; created_at: string }[];
  features: { ai: boolean; push: boolean; cricketDetail: boolean; sportmonks: boolean };
  me: { id: string; name: string; kind: string };
};
export type Weather = {
  place: string | null; now: { temp: number; feels: number; code: number; wind: number; humidity: number; isDay: boolean };
  today: { max: number; min: number; rainChance: number; sunrise: string; sunset: string; uv: number };
  hours: { at: string; temp: number; code: number; rain: number }[]; aqi: number | null; rainSoon: string | null; at: string;
};
export type YtVideo = { id: string; channelId: string; channel: string; title: string; publishedAt: string; thumb: string; summary?: string[]; from?: 'transcript' | 'description'; hasExplain?: boolean };
export type Explain = { status: 'ready' | 'pending' | 'failed' | 'missing'; md?: string; at?: string; from?: 'transcript' | 'description'; title?: string; channel?: string; waiting?: 'transcript' | 'writing'; error?: string };
export type YtData = { channels: { id: string; title: string; handle?: string }[]; videos: YtVideo[]; at: string | null };
export type MacState = { online: boolean; volume: number | null; muted: boolean | null; brightness?: number | null; awake?: boolean;
  media?: { title: string; artist: string; app: string; url?: string; art?: string; playing: boolean } | null };
export type Tab = 'home' | 'matches' | 'news' | 'well' | 'lists' | 'settings';
type Cfg = { server: string; token: string; deviceId: string; name: string };
type Prefs = { theme: 'auto' | 'light' | 'dark'; xLimit: number; xPackage: string; focusMin: number; sleepMin: number;
  appLimits: Record<string, { min: number; label: string }>; waterGoal: number; waterGlass: number; waterRemind: boolean; waterStart: string; waterEnd: string; waterEvery: number };

// ---------- state ----------
export const app = $state({
  ready: false,
  cfg: { server: '', token: '', deviceId: '', name: '' } as Cfg,
  prefs: { theme: 'auto', xLimit: 30, xPackage: 'com.twitter.android', focusMin: 25, sleepMin: 30,
    appLimits: {} as Record<string, { min: number; label: string }>, waterGoal: 2500, waterGlass: 250, waterRemind: false, waterStart: '09:00', waterEnd: '21:00', waterEvery: 2 } as Prefs,
  tab: 'home' as Tab,
  desk: false,
  tasks: [] as Task[],
  grocery_items: [] as Grocery[],
  habits: [] as Habit[],
  habit_logs: [] as HabitLog[],
  reminders: [] as Reminder[],
  water_logs: [] as WaterLog[],
  saved: [] as Saved[],
  weather: null as Weather | null,
  events: [] as CalEvent[],
  eventsAllowed: null as boolean | null,
  apps: null as null | { apps: AppUse[]; totalMin: number },
  focusLog: [] as { day: string; min: number }[],
  yt: null as YtData | null,
  mac: null as MacState | null,
  home: null as Home | null,
  homeEtag: '' as string,
  matchesFull: null as null | MatchesFull,
  news: {} as Record<string, NewsItem[]>,
  digest: {} as Record<string, { at: string; stories: Story[] } | null>,
  media: null as null | (NowPlaying & { at: number }),
  x: null as null | XData,
  focus: { endsAt: 0 },
  sleep: { endsAt: 0 },
  screenTime: null as number | null,
  battery: null as null | { pct: number; charging: boolean },
  status: { syncing: false, lastSync: 0, error: '', online: true },
  toast: '' as string,
});

let outbox: { table: TableName; row: Base }[] = [];
let cursor = 0;

const live = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deleted_at);
export const paired = () => Boolean(app.cfg.server && app.cfg.token);

export function toast(msg: string, ms = 2500) {
  app.toast = msg;
  setTimeout(() => { if (app.toast === msg) app.toast = ''; }, ms);
}

// ---------- persistence ----------
async function persist(table: TableName) { await kvSet(`t:${table}`, app[table]); }
const saveOutbox = () => kvSet('outbox', outbox);

export async function init() {
  app.cfg = await kvGet('cfg', app.cfg);
  app.prefs = { ...app.prefs, ...(await kvGet('prefs', {})) };
  for (const t of TABLES) (app as any)[t] = await kvGet(`t:${t}`, []);
  outbox = await kvGet('outbox', []);
  cursor = await kvGet('cursor', 0);
  app.home = await kvGet('home', null);
  app.focus = await kvGet('focus', { endsAt: 0 });
  app.sleep = await kvGet('sleep', { endsAt: 0 });
  app.weather = await kvGet('weather', null);
  app.focusLog = await kvGet('focusLog', []);
  applyTheme();
  if (app.cfg.server && app.cfg.token) void native.setAuth(app.cfg.server, app.cfg.token);
  if (!app.prefs.appLimits) app.prefs.appLimits = {};
  if (!Object.keys(app.prefs.appLimits).length && app.prefs.xLimit) { app.prefs.appLimits = { [app.prefs.xPackage]: { min: app.prefs.xLimit, label: 'X' } }; void savePrefs(); }
  void native.setLimits(app.prefs.appLimits);
  rollRepeatingReminders();
  app.ready = true;
  void refreshAll();
}

export async function savePrefs() { await kvSet('prefs', app.prefs); applyTheme(); }

export function applyTheme() {
  const html = document.documentElement;
  if (app.prefs.theme === 'auto') delete html.dataset.theme;
  else html.dataset.theme = app.prefs.theme;
}

// ---------- local writes (instant) + outbox ----------
function write<K extends TableName>(table: K, row: Tables[K]) {
  row.updated_at = nowIso();
  const list = app[table] as Tables[K][];
  const i = list.findIndex((r) => r.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  outbox = outbox.filter((o) => !(o.table === table && o.row.id === row.id));
  outbox.push({ table, row: JSON.parse(JSON.stringify(row)) });
  void persist(table);
  void saveOutbox();
  scheduleAlarm(table, row);
  scheduleSync();
  scheduleWidgets();
}
/** Public edit (title, date, time, repeat…). */
export function update<K extends TableName>(table: K, row: Tables[K]) { write(table, { ...row }); }

export function remove(table: TableName, id: string) {
  const row = (app[table] as Base[]).find((r) => r.id === id);
  if (!row) return;
  write(table, { ...(row as any), deleted_at: nowIso() });
  if (table === 'habits') for (const l of app.habit_logs.filter((x) => x.habit_id === id && !x.deleted_at)) write('habit_logs', { ...l, deleted_at: nowIso() });
}

// tasks
export const todayTasks = () => {
  const today = dayKey();
  return live(app.tasks)
    .filter((t) => (!t.due_on || t.due_on <= today) && (!t.done_at || dayKey(new Date(t.done_at)) === today))
    .sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || b.priority - a.priority || a.sort - b.sort);
};
export const allTasks = () => live(app.tasks).sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || (b.done_at ?? '').localeCompare(a.done_at ?? '') || a.sort - b.sort);
export function addTask(title: string, due_on: string | null = null, due_time: string | null = null) {
  write('tasks', { id: uuid7(), title, due_on: due_on ?? (due_time ? dayKey() : null), due_time, priority: 0, sort: Date.now() % 1e9, updated_at: '' } as Task);
}
/** Local Date for a task's due date + time (time defaults to end of day for sorting). */
export const taskDue = (t: Task) => (t.due_on ? new Date(`${t.due_on}T${t.due_time ?? '23:59'}:00`) : null);
export function toggleTask(t: Task) {
  write('tasks', { ...t, done_at: t.done_at ? null : nowIso() });
  native.vibrate(t.done_at ? 8 : [10, 40, 10]);
}

// grocery
export const groceryOpen = () => live(app.grocery_items).filter((g) => !g.bought_at).sort((a, b) => a.sort - b.sort);
export const groceryBought = () => live(app.grocery_items).filter((g) => g.bought_at && Date.now() - Date.parse(g.bought_at) < 3 * 86_400_000);
export function addGrocery(names: string[], need_by: string | null = null) {
  for (const n of names) {
    const existing = live(app.grocery_items).find((g) => g.name.toLowerCase() === n.toLowerCase());
    if (existing) { if (existing.bought_at || need_by) write('grocery_items', { ...existing, bought_at: null, need_by: need_by ?? existing.need_by ?? null }); continue; }
    write('grocery_items', { id: uuid7(), name: n, need_by, sort: Date.now() % 1e9, updated_at: '' } as Grocery);
  }
}
export function toggleGrocery(g: Grocery) { write('grocery_items', { ...g, bought_at: g.bought_at ? null : nowIso() }); native.vibrate(10); }
/** Past items, most frequent first, for one-tap re-adding. */
export const grocerySuggestions = () => {
  const open = new Set(groceryOpen().map((g) => g.name.toLowerCase()));
  return live(app.grocery_items).filter((g) => g.bought_at && !open.has(g.name.toLowerCase())).map((g) => g.name).slice(0, 12);
};

// habits
export const habits = () => live(app.habits).sort((a, b) => a.sort - b.sort);
export function addHabit(name: string, remind_time: string | null = null, days_mask = 127) { write('habits', { id: uuid7(), name, days_mask, remind_time, sort: Date.now() % 1e9, updated_at: '' } as Habit); }
export const doneOn = (h: Habit, day = dayKey()) => app.habit_logs.some((l) => l.habit_id === h.id && l.day === day && !l.deleted_at);
export function toggleHabit(h: Habit) {
  const day = dayKey();
  const log = app.habit_logs.find((l) => l.habit_id === h.id && l.day === day);
  if (log && !log.deleted_at) write('habit_logs', { ...log, deleted_at: nowIso() });
  else if (log) write('habit_logs', { ...log, deleted_at: null });
  else write('habit_logs', { id: uuid7(), habit_id: h.id, day, updated_at: '' } as HabitLog);
  native.vibrate(doneOn(h) ? [10, 40, 10] : 8);
}
export function streak(h: Habit) {
  let n = 0;
  const d = new Date();
  if (!doneOn(h, dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet doesn't break the streak
  while (doneOn(h, dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const week = (h: Habit) => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (6 - i));
  return doneOn(h, dayKey(d));
});

// reminders
export const upcomingReminders = () => live(app.reminders).filter((r) => !r.done_at).sort((a, b) => a.fire_at.localeCompare(b.fire_at));
export function addReminder(title: string, at: Date, repeat: 'daily' | null = null) {
  write('reminders', { id: uuid7(), title, fire_at: at.toISOString(), repeat, updated_at: '' } as Reminder);
}
export function doneReminder(r: Reminder) {
  if (r.repeat === 'daily') {
    const next = new Date(r.fire_at);
    while (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    write('reminders', { ...r, fire_at: next.toISOString() });
  } else write('reminders', { ...r, done_at: nowIso() });
}
async function scheduleNative(r: Reminder) {
  if (r.deleted_at || r.done_at) return native.cancelReminder(r.id);
  const at = Date.parse(r.fire_at);
  if (at > Date.now()) return native.scheduleReminder({ id: r.id, title: r.title, at, repeat: r.repeat });
}
/** Tasks with a time and habits with a nudge time get their own exact alarms (ids prefixed so they never clash). */
function scheduleAlarm(table: TableName, row: Base) {
  if (table === 'reminders') return void scheduleNative(row as Reminder);
  if (table === 'tasks') {
    const t = row as Task;
    const at = t.due_time ? taskDue(t) : null;
    if (t.deleted_at || t.done_at || !at || at.getTime() <= Date.now()) return void native.cancelReminder(`task:${t.id}`);
    return void native.scheduleReminder({ id: `task:${t.id}`, title: t.title, at: at.getTime() });
  }
  if (table === 'habits') {
    const h = row as Habit;
    if (h.deleted_at || !h.remind_time) return void native.cancelReminder(`habit:${h.id}`);
    const [hh, mm] = h.remind_time.split(':').map(Number);
    const at = new Date(); at.setHours(hh ?? 9, mm ?? 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    const mask = h.days_mask ?? 127;
    return void native.scheduleReminder({ id: `habit:${h.id}`, title: `Habit: ${h.name}`, at: at.getTime(), repeat: mask === 127 ? 'daily' : `days:${mask}` });
  }
}
function rollRepeatingReminders() {
  for (const r of live(app.reminders)) {
    if (r.repeat === 'daily' && !r.done_at && Date.parse(r.fire_at) < Date.now() - 60_000) doneReminder(r);
  }
}
/** Re-arm every future alarm (idempotent) — after install, reboot or sync. */
export async function rescheduleAll() {
  for (const r of upcomingReminders()) await scheduleNative(r);
  for (const t of live(app.tasks)) if (t.due_time && !t.done_at) scheduleAlarm('tasks', t);
  for (const h of live(app.habits)) if (h.remind_time) scheduleAlarm('habits', h);
}

// ---------- wellbeing: water ----------
export const waterToday = (day = dayKey()) => live(app.water_logs).filter((w) => w.day === day).reduce((n, w) => n + (w.ml || 0), 0);
export function addWater(ml = app.prefs.waterGlass) {
  write('water_logs', { id: uuid7(), day: dayKey(), ml, updated_at: '' } as WaterLog);
  native.vibrate(waterToday() >= app.prefs.waterGoal ? [10, 40, 10, 40, 10] : 10);
}
export function undoWater() {
  const last = live(app.water_logs).filter((w) => w.day === dayKey()).sort((a, b) => b.id.localeCompare(a.id))[0];
  if (last) write('water_logs', { ...last, deleted_at: nowIso() });
}
export const waterWeek = () => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return { day: dayKey(d), ml: waterToday(dayKey(d)) }; });
const waterTimes = () => {
  const [sh, sm] = app.prefs.waterStart.split(':').map(Number), [eh, em] = app.prefs.waterEnd.split(':').map(Number);
  const out: string[] = [];
  for (let t = (sh ?? 9) * 60 + (sm ?? 0); t <= (eh ?? 21) * 60 + (em ?? 0); t += Math.max(1, app.prefs.waterEvery) * 60) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return out.slice(0, 16);
};
/** Daily repeating water nudges (native alarms with a "+1 glass" button). */
export async function scheduleWater() {
  const prev: string[] = await kvGet('waterAlarms', []);
  for (const id of prev) await native.cancelReminder(id);
  if (!app.prefs.waterRemind) { await kvSet('waterAlarms', []); return; }
  const ids: string[] = [];
  for (const hm of waterTimes()) {
    const [h, m] = hm.split(':').map(Number);
    const at = new Date(); at.setHours(h ?? 9, m ?? 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    const id = `water:${hm}`;
    await native.scheduleReminder({ id, title: '💧 Time for a glass of water', at: at.getTime(), repeat: 'daily' });
    ids.push(id);
  }
  await kvSet('waterAlarms', ids);
}

// ---------- focus log (for Wellbeing) ----------
function logFocus(min: number) {
  if (min < 1) return;
  const day = dayKey();
  const i = app.focusLog.findIndex((f) => f.day === day);
  if (i >= 0) app.focusLog[i] = { day, min: app.focusLog[i]!.min + min }; else app.focusLog.push({ day, min });
  app.focusLog = app.focusLog.slice(-30);
  void kvSet('focusLog', app.focusLog);
}
export const focusToday = () => app.focusLog.find((f) => f.day === dayKey())?.min ?? 0;

// ---------- read later ----------
export const savedList = () => live(app.saved).sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || b.id.localeCompare(a.id));
export function saveForLater(url: string, title?: string) {
  const existing = live(app.saved).find((x) => x.url === url);
  if (existing) { toast('Already in Read later'); return; }
  write('saved', { id: uuid7(), url, title: title ?? null, status: 'pending', updated_at: '' } as Saved);
  toast('Saved. Full article and summary are on the way');
}
export function markRead(x: Saved, read = true) { write('saved', { ...x, read_at: read ? nowIso() : null }); }
export const blocks = (x: Saved): Block[] => { try { return x.content ? JSON.parse(x.content) : []; } catch { return []; } };

// ---------- weather & calendar ----------
export async function loadWeather(ask = false) {
  if (!paired()) return;
  let loc = await native.location();
  if (!loc.granted && ask) { await native.requestPermission('location'); await new Promise((r) => setTimeout(r, 2500)); loc = await native.location(); }
  if (loc.lat === undefined || loc.lon === undefined) return;
  try {
    const r = await request<Weather>(app.cfg.server, `/v1/weather?lat=${loc.lat.toFixed(3)}&lon=${loc.lon.toFixed(3)}`, { token: app.cfg.token });
    if (r.data) { app.weather = r.data; void kvSet('weather', r.data); }
  } catch { /* keep the last forecast */ }
}
export async function loadCalendar(ask = false) {
  let r = await native.calendar(1);
  if (!r.granted && ask) { await native.requestPermission('calendar'); await new Promise((res) => setTimeout(res, 2500)); r = await native.calendar(1); }
  app.eventsAllowed = r.granted;
  app.events = r.events;
}
export async function loadApps() {
  const r = await native.screenTimeTop(12);
  if (!r.granted) { app.apps = null; return; }
  // apps with a limit always show, even if they're not in today's top list
  const extra = Object.keys(app.prefs.appLimits).filter((p) => !r.apps.some((a) => a.pkg === p));
  const used = extra.length ? await native.screenTime(extra) : {};
  const apps = [...r.apps, ...extra.map((pkg) => ({ pkg, label: app.prefs.appLimits[pkg]!.label, min: used[pkg] ?? 0 }))];
  app.apps = { apps, totalMin: r.totalMin };
}
/** Daily limit for any app (0 = none). Enforced natively every 15 min, even when Koro is closed. */
export async function setAppLimit(pkg: string, label: string, min: number) {
  const next = { ...app.prefs.appLimits };
  if (min > 0) next[pkg] = { min, label }; else delete next[pkg];
  app.prefs.appLimits = next;
  if (pkg === app.prefs.xPackage && min > 0) app.prefs.xLimit = min;
  await savePrefs();
  await native.setLimits(next);
  toast(min > 0 ? `${label}: ${min} min a day` : `${label}: no limit`);
}

// ---------- Mac ----------
export async function loadMac() {
  if (!paired()) return;
  try { const r = await request<MacState>(app.cfg.server, '/v1/mac/status', { token: app.cfg.token }); if (r.data) app.mac = r.data; } catch { /* offline */ }
}
/** Keeps the Mac's state live in the app (what it plays, volume, brightness): every 2.5 s while the app is open. */
export function startMacLoop() {
  let stop = false, t: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stop) return;
    if (!document.hidden && paired()) await loadMac();
    if (!stop) t = setTimeout(tick, 2500);
  };
  const vis = () => { if (!document.hidden) { clearTimeout(t); void tick(); } };
  document.addEventListener('visibilitychange', vis);
  void tick();
  return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}
export async function macSend(body: { type: 'clip'; text: string } | { type: 'link'; url: string; title?: string } | { type: 'cmd'; cmd: string; value?: number; app?: string }) {
  native.vibrate(8);
  try {
    const { data } = await request<{ ok: boolean; online: boolean }>(app.cfg.server, '/v1/mac/send', { token: app.cfg.token, body });
    if (data && !data.online) toast('Your Mac looks offline. It will get this when it wakes (within a minute).');
    if (body.type === 'cmd' && /^(vol|bright|mute|awake)/.test(body.cmd)) setTimeout(loadMac, 1200);
    return true;
  } catch (e) { toast((e as Error).message); return false; }
}
export async function sendClipboardToMac() {
  const text = (await native.clipboardRead()).trim();
  if (!text) return toast('Clipboard is empty');
  if (await macSend(/^https?:\/\/\S+$/.test(text) ? { type: 'link', url: text } : { type: 'clip', text })) toast(/^https?:\/\//.test(text) ? 'Link opened on your Mac' : 'Copied to your Mac');
}

// ---------- YouTube ----------
export async function loadYt() {
  if (!paired()) return;
  try { const r = await request<YtData>(app.cfg.server, '/v1/yt', { token: app.cfg.token }); if (r.data) app.yt = r.data; } catch (e) { handleError(e); }
}
export async function addYtChannel(input: string) {
  const { data } = await request<{ ok: boolean; channel: { title: string } }>(app.cfg.server, '/v1/yt/channels', { token: app.cfg.token, body: { input }, timeoutMs: 30_000 });
  toast(`Following ${data?.channel.title ?? 'channel'}. New videos appear in a minute`);
  setTimeout(loadYt, 8000);
  await loadYt();
}
/** Full written explanation of a video. Ready ones are kept on the phone for offline reading. */
export async function explainVideo(id: string, ask = false): Promise<Explain> {
  const cached = await kvGet<Explain | null>(`explain:${id}`, null);
  if (cached?.md) return cached;
  const { data } = await request<Explain>(app.cfg.server, `/v1/yt/${id}/explain`, { token: app.cfg.token, method: ask ? 'POST' : 'GET', ...(ask ? { body: {} } : {}), timeoutMs: 20_000 });
  if (data?.status === 'ready') await kvSet(`explain:${id}`, data);
  return data ?? { status: 'failed', error: 'No response' };
}

export async function removeYtChannel(id: string) {
  await request(app.cfg.server, `/v1/yt/channels/${id}`, { token: app.cfg.token, method: 'DELETE' });
  await loadYt();
}

// ---------- widgets & actions taken outside the app ----------
let widgetTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleWidgets() { clearTimeout(widgetTimer); widgetTimer = setTimeout(() => void pushWidgets(), 800); }
export async function pushWidgets() {
  const today = dayKey();
  const tasks = todayTasks().slice(0, 12).map((t) => ({ id: t.id, text: t.title, done: !!t.done_at, meta: t.due_time && !t.done_at ? t.due_time : '' }));
  const hs = habits().map((h) => ({ id: h.id, text: h.name, done: doneOn(h, today), meta: streak(h) ? `${streak(h)}🔥` : '' }));
  const grocery = groceryOpen().slice(0, 20).map((g) => ({ id: g.id, text: g.name, done: false, meta: '' }));
  await native.widgetData({ tasks, habits: hs, grocery });
}
/** Ticks made on widgets and "+1 glass" taps on notifications while the app was closed. */
export async function applyOps() {
  const ops = await native.takeOps();
  for (const op of ops) {
    if (op.kind === 'water') { write('water_logs', { id: uuid7(), day: dayKey(new Date(op.at)), ml: op.ml ?? app.prefs.waterGlass, updated_at: '' } as WaterLog); continue; }
    if (op.kind === 'tasks') { const t = app.tasks.find((x) => x.id === op.id); if (t) write('tasks', { ...t, done_at: t.done_at ? null : new Date(op.at).toISOString() }); }
    if (op.kind === 'habits') { const h = app.habits.find((x) => x.id === op.id); if (h) toggleHabit(h); }
    if (op.kind === 'grocery') { const g = app.grocery_items.find((x) => x.id === op.id); if (g && !g.bought_at) write('grocery_items', { ...g, bought_at: new Date(op.at).toISOString() }); }
  }
  if (ops.length) toast(`Synced ${ops.length} change${ops.length > 1 ? 's' : ''} from your home screen`);
}

// ---------- quick add ----------
type AiItem = { kind: QuickResult['kind']; title: string; at: string | null; repeat: 'daily' | null; items: string[]; days: number[] | null; time: string | null };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Looks like several things at once: "milk eggs, call bank tomorrow 10am, gym every Mon Wed Fri 7am". */
const looksMulti = (t: string) => /[,;\n]| and then | also /i.test(t) && t.trim().split(/\s+/).length >= 4;

export async function quickAdd(text: string, hint?: QuickResult['kind']): Promise<string> {
  if (!hint && looksMulti(text) && paired() && app.home?.features.ai) {
    try {
      const { data } = await request<{ items: AiItem[] }>(app.cfg.server, '/v1/ai/parse-multi', { token: app.cfg.token, body: { text, now: localNowLabel() }, timeoutMs: 20_000 });
      if (data?.items?.length) return data.items.map(applyItem).join('\n');
    } catch { /* offline or AI down: fall back to one item */ }
  }
  let q = parseQuick(text, new Date(), hint);
  if (!q.title && !q.items?.length) return '';
  if (q.confidence < 0.75 && !hint && paired() && app.home?.features.ai) {
    try {
      const { data } = await request<{ kind: QuickResult['kind']; title: string; at: string | null; repeat: 'daily' | null; items: string[] }>(
        app.cfg.server, '/v1/ai/parse', { token: app.cfg.token, body: { text, now: localNowLabel() }, timeoutMs: 8000 });
      if (data) {
        const at = data.at ? localWallClock(data.at) : undefined;
        q = { kind: data.kind, title: data.title, items: data.items, repeat: data.repeat, at: at?.toISOString(), confidence: 1 };
      }
    } catch { /* offline or AI down: keep local parse */ }
  }
  switch (q.kind) {
    case 'grocery': addGrocery(q.items?.length ? q.items : [q.title]); return `Added to grocery: ${(q.items ?? [q.title]).join(', ')}`;
    case 'habit': addHabit(q.title); return `New habit: ${q.title}`;
    case 'reminder': {
      const at = q.at ? new Date(q.at) : new Date(Date.now() + 3_600_000);
      addReminder(q.title, at, q.repeat ?? null);
      return `Reminder: ${q.title} · ${at.toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }
    default: addTask(q.title); return `Task added: ${q.title}`;
  }
}

function applyItem(it: AiItem): string {
  switch (it.kind) {
    case 'grocery': { const names = it.items.length ? it.items : [it.title]; addGrocery(names); return `🛒 ${names.join(', ')}`; }
    case 'habit': {
      const mask = it.days?.length ? it.days.reduce((m, d) => m | (1 << d), 0) : 127;
      addHabit(it.title, it.time, mask);
      return `🔁 ${it.title}${mask === 127 ? ' daily' : ` ${it.days!.map((d) => DAYS[d]).join(' ')}`}${it.time ? ` ${it.time}` : ''}`;
    }
    case 'reminder': {
      const at = (it.at ? localWallClock(it.at) : undefined) ?? new Date(Date.now() + 3_600_000);
      addReminder(it.title, at, it.repeat);
      return `⏰ ${it.title} · ${at.toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }
    default: addTask(it.title); return `✅ ${it.title}`;
  }
}

/** Ask the Mac for its battery now (the agent replies within a second or two), then refresh Home. */
export async function refreshDevices() {
  void reportBattery();
  if (paired()) await macSend({ type: 'cmd', cmd: 'battery' }).catch(() => false);
  setTimeout(() => void loadHome(), 2500);
}

// ---------- server ----------
let syncTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(ms = 3000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), ms);
}

export async function sync() {
  if (!paired() || app.status.syncing) return;
  app.status.syncing = true;
  const sending = outbox.slice();
  try {
    const { data } = await request<{ changes: { table: TableName; row: Base }[]; cursor: number; rejected: { id: string; error: string }[] }>(
      app.cfg.server, '/v1/sync', { token: app.cfg.token, body: { cursor, changes: sending } });
    if (!data) return;
    outbox = outbox.filter((o) => !sending.some((s) => s.table === o.table && s.row.id === o.row.id && s.row.updated_at === o.row.updated_at));
    const touched = new Set<TableName>();
    for (const ch of data.changes) {
      const list = app[ch.table] as Base[];
      const i = list.findIndex((r) => r.id === ch.row.id);
      const pending = outbox.some((o) => o.table === ch.table && o.row.id === ch.row.id);
      if (pending) continue;
      if (i < 0) list.push(ch.row as any);
      else if (list[i]!.updated_at <= ch.row.updated_at) list[i] = ch.row as any;
      else continue;
      touched.add(ch.table);
      scheduleAlarm(ch.table, ch.row);
    }
    cursor = data.cursor;
    await Promise.all([...touched].map(persist));
    await saveOutbox();
    await kvSet('cursor', cursor);
    app.status.lastSync = Date.now();
    app.status.error = '';
    app.status.online = true;
  } catch (e) {
    handleError(e);
  } finally {
    app.status.syncing = false;
  }
}

function handleError(e: unknown) {
  const err = e as ApiError;
  app.status.error = err.message;
  app.status.online = err.status !== 0;
  if (err.status === 401) toast('This device was removed from the server. Pair again in Settings.');
}

/** Last ETag per endpoint: an unchanged reply is a tiny 304 and the data on screen stays as it is. */
const etags: Record<string, string> = {};
async function getFresh<T>(path: string): Promise<T | null> {
  const r = await request<T>(app.cfg.server, path, { token: app.cfg.token, etag: etags[path] });
  if (r.etag) etags[path] = r.etag;
  return r.data;
}

/** `fresh` (pull-to-refresh) also asks the server for a new Today brief. */
export async function loadHome(fresh = false) {
  if (!paired()) return;
  try {
    const r = await request<Home>(app.cfg.server, fresh ? '/v1/home?fresh=1' : '/v1/home', { token: app.cfg.token, etag: app.homeEtag });
    if (r.data) { app.home = r.data; app.homeEtag = r.etag ?? ''; void kvSet('home', r.data); }
    app.status.online = true;
  } catch (e) { handleError(e); }
}

export async function loadMatches() {
  if (!paired()) return;
  try {
    const d = await getFresh<MatchesFull>('/v1/matches');
    if (d) app.matchesFull = d;
  } catch (e) { handleError(e); }
}

/** Replaces the list with the latest; returns how many stories are new since what was on screen. */
export async function loadNews(cat: string, fresh = false): Promise<number> {
  if (!paired()) return 0;
  try {
    // ETag key without ?fresh so a pull and a normal load share it
    const r = await request<{ items: NewsItem[]; digest: { at: string; stories: Story[] } | null }>(app.cfg.server,
      `/v1/news?cat=${cat}${fresh ? '&fresh=1' : ''}`, { token: app.cfg.token, etag: etags['news:' + cat] });
    if (r.etag) etags['news:' + cat] = r.etag;
    if (!r.data) return 0;
    const before = new Set((app.news[cat] ?? []).map((i) => i.id));
    const added = before.size ? r.data.items.filter((i) => !before.has(i.id)).length : 0;
    app.news[cat] = r.data.items; app.digest[cat] = r.data.digest;
    return added;
  } catch (e) { handleError(e); return 0; }
}

export async function loadX() {
  if (!paired()) return;
  try {
    const d = await getFresh<XData>('/v1/x');
    if (d) app.x = d;
  } catch (e) { handleError(e); }
}

// ---------- pull to refresh ----------
/** Each screen registers what a pull does; it may return a short message for a toast. */
const pullHandlers: Partial<Record<Tab, () => Promise<string | void>>> = {};
export function onPull(tab: Tab, fn: () => Promise<string | void>) {
  pullHandlers[tab] = fn;
  return () => { if (pullHandlers[tab] === fn) delete pullHandlers[tab]; };
}
export const canPull = (tab: Tab) => !!pullHandlers[tab];
export async function runPull(tab: Tab) {
  const fn = pullHandlers[tab];
  if (!fn) return;
  native.vibrate(10);
  try { const msg = await fn(); if (msg) toast(msg); } catch { toast('Could not refresh'); }
}

export async function reportBattery() {
  const b = await native.battery();
  app.battery = b;
  if (b && paired()) await request(app.cfg.server, '/v1/devices/battery', { token: app.cfg.token, body: b }).catch(() => {});
}

export async function refreshScreenTime() {
  const m = await native.screenTime([app.prefs.xPackage]);
  app.screenTime = m[app.prefs.xPackage] ?? null;
}

export async function setupPush(): Promise<string> {
  if (!paired()) return 'Not paired';
  try {
    const { data } = await request<{ firebase: { appId: string; apiKey: string; senderId: string; projectId: string } | null }>(app.cfg.server, '/v1/config', { token: app.cfg.token });
    if (!data?.firebase) return 'Push not configured on server (alerts go to the inbox)';
    const { token } = await native.pushInit(data.firebase);
    if (!token) return 'Could not get a push token on this device';
    await request(app.cfg.server, '/v1/devices/push-token', { token: app.cfg.token, body: { token } });
    return 'Push ready';
  } catch (e) { return (e as Error).message; }
}

/** Everything a fresh app open needs, in parallel. */
export async function refreshAll() {
  void applyOps();
  void loadCalendar();
  void loadApps();
  if (!paired()) return;
  await Promise.all([sync(), loadHome(), reportBattery(), refreshScreenTime()]);
  void pushWidgets();
  if (!app.weather || Date.now() - Date.parse(app.weather.at) > 30 * 60_000) void loadWeather();
}

export async function pair(server: string, code: string, name: string) {
  server = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) server = `http://${server}`;
  const { data } = await request<{ deviceId: string; token: string; name: string }>(server, '/v1/pair', { body: { code: code.trim(), name: name || 'Galaxy S25', kind: 'phone' } });
  if (!data) throw new Error('No response');
  app.cfg = { server, token: data.token, deviceId: data.deviceId, name: data.name };
  await kvSet('cfg', app.cfg);
  void native.setAuth(server, data.token);
  cursor = 0;
  await kvSet('cursor', 0);
  // everything created before pairing goes up on the first sync
  outbox = TABLES.flatMap((t) => (app[t] as Base[]).map((row) => ({ table: t, row: JSON.parse(JSON.stringify(row)) })));
  await saveOutbox();
  await refreshAll();
  void setupPush();
  void native.requestNotifications();
}

export async function unpair(wipe = false) {
  app.cfg = { server: '', token: '', deviceId: '', name: '' };
  await kvSet('cfg', app.cfg);
  if (wipe) { await kvClear(); location.reload(); }
}

// ---------- focus / sleep ----------
export async function setTimerMin(kind: 'focus' | 'sleep', min: number) {
  const v = Math.max(5, Math.min(180, Math.round(min / 5) * 5));
  if (kind === 'focus') app.prefs.focusMin = v; else app.prefs.sleepMin = v;
  await savePrefs();
}
/** +/- minutes on a running timer (re-arms the native alarm). */
export async function extendTimer(kind: 'focus' | 'sleep', deltaMin: number) {
  const t = kind === 'focus' ? app.focus : app.sleep;
  if (t.endsAt <= Date.now()) return;
  const left = Math.max(1, Math.round((t.endsAt - Date.now()) / 60_000) + deltaMin);
  if (kind === 'focus') { await native.focusStart(left); app.focus = { endsAt: Date.now() + left * 60_000, startedAt: (app.focus as any).startedAt } as any; void kvSet('focus', app.focus); }
  else { await native.sleepStart(left); app.sleep = { endsAt: Date.now() + left * 60_000 }; void kvSet('sleep', app.sleep); }
  native.vibrate(8);
  toast(`${kind === 'focus' ? 'Focus' : 'Sleep timer'}: ${left} min left`);
}
export async function startFocus() {
  const r = await native.focusStart(app.prefs.focusMin);
  app.focus = { endsAt: Date.now() + app.prefs.focusMin * 60_000, startedAt: Date.now() } as any;
  void kvSet('focus', app.focus);
  native.vibrate(15);
  toast(r.dnd ? 'Focus on · Do Not Disturb enabled' : 'Focus on (allow DND access in Settings to silence calls)');
}
export async function stopFocus() {
  const started = (app.focus as any).startedAt as number | undefined;
  if (started) logFocus(Math.round((Math.min(Date.now(), app.focus.endsAt) - started) / 60_000));
  await native.focusStop();
  app.focus = { endsAt: 0 };
  void kvSet('focus', app.focus);
}
export async function startSleep() {
  await native.sleepStart(app.prefs.sleepMin);
  app.sleep = { endsAt: Date.now() + app.prefs.sleepMin * 60_000 };
  void kvSet('sleep', app.sleep);
  toast(`Music stops in ${app.prefs.sleepMin} min`);
}
export async function stopSleep() {
  await native.sleepStop();
  app.sleep = { endsAt: 0 };
  void kvSet('sleep', app.sleep);
}

// ---------- now playing ----------
/** Polls the phone's media session while the app is open: every 2 s when playing, 3 s when paused/idle. */
export function startMediaLoop() {
  let stop = false, t: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stop) return;
    if (!document.hidden) {
      const prev = app.media;
      const m = await native.media(prev?.key);
      if (m) app.media = { ...m, art: m.art ?? (m.key && m.key === prev?.key ? prev?.art : undefined), at: Date.now() };
      else app.media = null;
    }
    if (!stop) t = setTimeout(tick, app.media?.playing ? 2000 : 3000);
  };
  void tick();
  return () => { stop = true; clearTimeout(t); };
}
export async function mediaControl(action: 'toggle' | 'next' | 'prev' | 'seek', pos = 0) {
  if (app.media && action === 'toggle') app.media = { ...app.media, playing: !app.media.playing, at: Date.now() }; // instant feedback
  native.vibrate(8);
  await native.mediaControl(action, pos);
  setTimeout(async () => { const m = await native.media(app.media?.key); if (m) app.media = { ...m, art: m.art ?? app.media?.art, at: Date.now() }; }, 350);
}
