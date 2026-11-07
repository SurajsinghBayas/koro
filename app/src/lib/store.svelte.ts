import { localWallClock, parseQuick, type QuickResult } from '../../../shared/quickadd.ts';
import { ApiError, request } from './api.ts';
import { kvClear, kvGet, kvSet } from './kv.ts';
import { native, type NowPlaying } from './native.ts';
import { dayKey, localNowLabel, nowIso, uuid7 } from './util.ts';

// ---------- types ----------
type Base = { id: string; updated_at: string; deleted_at?: string | null };
export type Task = Base & { title: string; notes?: string | null; due_on?: string | null; due_time?: string | null; priority: number; done_at?: string | null; sort: number };
export type Grocery = Base & { name: string; category?: string | null; need_by?: string | null; bought_at?: string | null; sort: number };
export type Habit = Base & { name: string; days_mask: number; remind_time?: string | null; sort: number };
export type HabitLog = Base & { habit_id: string; day: string };
export type Reminder = Base & { title: string; fire_at: string; repeat?: string | null; done_at?: string | null };
type Tables = { tasks: Task; grocery_items: Grocery; habits: Habit; habit_logs: HabitLog; reminders: Reminder };
export type TableName = keyof Tables;
const TABLES: TableName[] = ['tasks', 'grocery_items', 'habits', 'habit_logs', 'reminders'];

export type Innings = { team: string; inning: number; runs: number; wkts: number; overs: number };
export type Match = {
  id: string; name: string; format: string; teams: [string, string]; short?: [string, string]; startsAt?: string; venue?: string;
  status: string; state: 'upcoming' | 'live' | 'done'; innings: Innings[]; rule?: string; summary?: { title: string; body: string };
  series?: string; recap?: string; winner?: string; team?: 'india' | 'mi';
};
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string; cat: string; desc?: string; image?: string };
export type Story = { title: string; summary: string; url: string; image?: string; publishedAt: string; sources: { source: string; url: string }[] };
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
  news: Record<'tech' | 'india' | 'world' | 'cricket', NewsItem[]> & { updatedAt: string | null; digest?: Partial<Record<string, Story[]>> };
  devices: DeviceRow[];
  inbox: { id: number; kind: string; title: string; body: string; created_at: string }[];
  features: { ai: boolean; push: boolean; cricketDetail: boolean; sportmonks: boolean };
  me: { id: string; name: string; kind: string };
};
export type Tab = 'home' | 'matches' | 'news' | 'lists' | 'settings';
type Cfg = { server: string; token: string; deviceId: string; name: string };
type Prefs = { theme: 'auto' | 'light' | 'dark'; xLimit: number; xPackage: string; focusMin: number; sleepMin: number };

// ---------- state ----------
export const app = $state({
  ready: false,
  cfg: { server: '', token: '', deviceId: '', name: '' } as Cfg,
  prefs: { theme: 'auto', xLimit: 30, xPackage: 'com.twitter.android', focusMin: 25, sleepMin: 30 } as Prefs,
  tab: 'home' as Tab,
  desk: false,
  tasks: [] as Task[],
  grocery_items: [] as Grocery[],
  habits: [] as Habit[],
  habit_logs: [] as HabitLog[],
  reminders: [] as Reminder[],
  home: null as Home | null,
  homeEtag: '' as string,
  matchesFull: null as null | MatchesFull,
  news: {} as Record<string, NewsItem[]>,
  digest: {} as Record<string, { at: string; stories: Story[] } | null>,
  media: null as null | (NowPlaying & { at: number }),
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
  applyTheme();
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
export function addHabit(name: string, remind_time: string | null = null) { write('habits', { id: uuid7(), name, days_mask: 127, remind_time, sort: Date.now() % 1e9, updated_at: '' } as Habit); }
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
    return void native.scheduleReminder({ id: `habit:${h.id}`, title: `Habit: ${h.name}`, at: at.getTime(), repeat: 'daily' });
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

// ---------- quick add ----------
export async function quickAdd(text: string, hint?: QuickResult['kind']): Promise<string> {
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

export async function loadHome() {
  if (!paired()) return;
  try {
    const r = await request<Home>(app.cfg.server, '/v1/home', { token: app.cfg.token, etag: app.homeEtag });
    if (r.data) { app.home = r.data; app.homeEtag = r.etag ?? ''; void kvSet('home', r.data); }
    app.status.online = true;
  } catch (e) { handleError(e); }
}

export async function loadMatches() {
  if (!paired()) return;
  try {
    const r = await request<MatchesFull>(app.cfg.server, '/v1/matches', { token: app.cfg.token });
    if (r.data) app.matchesFull = r.data;
  } catch (e) { handleError(e); }
}

export async function loadNews(cat: string) {
  if (!paired()) return;
  try {
    const r = await request<{ items: NewsItem[]; digest: { at: string; stories: Story[] } | null }>(app.cfg.server, `/v1/news?cat=${cat}`, { token: app.cfg.token });
    if (r.data) { app.news[cat] = r.data.items; app.digest[cat] = r.data.digest; }
  } catch (e) { handleError(e); }
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
  if (!paired()) return;
  await Promise.all([sync(), loadHome(), reportBattery(), refreshScreenTime()]);
}

export async function pair(server: string, code: string, name: string) {
  server = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) server = `http://${server}`;
  const { data } = await request<{ deviceId: string; token: string; name: string }>(server, '/v1/pair', { body: { code: code.trim(), name: name || 'Galaxy S25', kind: 'phone' } });
  if (!data) throw new Error('No response');
  app.cfg = { server, token: data.token, deviceId: data.deviceId, name: data.name };
  await kvSet('cfg', app.cfg);
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
export async function startFocus() {
  const r = await native.focusStart(app.prefs.focusMin);
  app.focus = { endsAt: Date.now() + app.prefs.focusMin * 60_000 };
  void kvSet('focus', app.focus);
  native.vibrate(15);
  toast(r.dnd ? 'Focus on · Do Not Disturb enabled' : 'Focus on (allow DND access in Settings to silence calls)');
}
export async function stopFocus() {
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
/** Polls the phone's media session while something needs it: every 2 s when playing, 8 s when paused/idle. */
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
    if (!stop) t = setTimeout(tick, app.media?.playing ? 2000 : 8000);
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
