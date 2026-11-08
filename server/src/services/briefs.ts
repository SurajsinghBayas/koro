import { festivalFact } from './festivals.ts';
import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { chat } from './ai.ts';
import { getMatches } from './cricket/engine.ts';
import { getNews } from './news.ts';
import { notify } from './push.ts';
import { getWeather } from './weather.ts';
import { getX } from './x.ts';
import { getYt } from './yt.ts';

/**
 * Push briefs: 8 AM (weather, today's tasks and reminders, India/MI matches, top headlines) and
 * 10 PM (what you finished, habit streaks, what's tomorrow). Uses the phone's last weather location.
 */
type Sent = { morning?: string; night?: string; loc?: { lat: number; lon: number } };
let sent: Sent = loadSnapshot<Sent>('briefs', {});
const save = () => saveSnapshot('briefs', sent);

/** Remember where the phone asked for weather from (the 8 AM brief uses it). */
export function rememberLocation(lat: number, lon: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (sent.loc?.lat === r(lat) && sent.loc?.lon === r(lon)) return;
  sent.loc = { lat: r(lat), lon: r(lon) }; save();
}

const localDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: env.TZ });
const localHour = (d = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: env.TZ, hour: '2-digit', hour12: false }));
const fmtT = (d: Date | string) => new Date(d).toLocaleTimeString('en-IN', { timeZone: env.TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday (days_mask bit)

async function streaks(db: Db, today: string) {
  const habits = await db.query<{ id: string; name: string; days_mask: number }>('select id, name, days_mask from habits where deleted_at is null order by sort');
  const logs = await db.query<{ habit_id: string; day: string }>(`select habit_id, day from habit_logs where deleted_at is null and day >= $1`, [addDays(today, -60)]);
  const by = new Map<string, Set<string>>();
  for (const l of logs) (by.get(l.habit_id) ?? by.set(l.habit_id, new Set()).get(l.habit_id)!).add(l.day);
  return habits.filter((h) => h.days_mask & (1 << weekday(today))).map((h) => {
    const days = by.get(h.id) ?? new Set<string>();
    let n = 0, d = today;
    if (!days.has(d)) d = addDays(d, -1);
    for (let i = 0; i < 60; i++, d = addDays(d, -1)) {
      if (!(h.days_mask & (1 << weekday(d)))) continue;
      if (days.has(d)) n++; else break;
    }
    return { name: h.name, done: days.has(today), streak: n };
  });
}

function matchesOn(day: string) {
  const m = getMatches();
  return [...m.live.map((x) => `LIVE ${x.name}: ${x.status}`),
    ...m.upcoming.filter((x) => x.startsAt && localDay(new Date(x.startsAt)) === day).map((x) => `${x.short?.join(' vs ') ?? x.teams.join(' vs ')} at ${fmtT(x.startsAt!)}`)];
}

async function compose(kind: 'morning' | 'night', facts: string[], fallback: string) {
  if (!aiEnabled()) return fallback;
  try {
    const sys = kind === 'morning'
      ? 'Write a morning push notification body for one person in India. 4–5 short lines (under 70 chars each), plain text, no greeting, one emoji at the start of each line. If a festival is TODAY, open with a warm wish for it (its own emoji). Then: weather (with what to carry), the first thing to do, cricket only if there is a match, one headline. Skip any topic whose facts are empty or none (never write lines like "no tasks"). Use ONLY the facts given.'
      : 'Write a 10 PM wind-down push notification for one person. 3–5 short lines (under 70 chars each), plain text, one emoji per line, warm but not cheesy. If today was a festival, close the day with a short line about it; if one is tomorrow, mention it. Then: what got done today, habit streaks (praise kept streaks, gently name a missed habit), what is first tomorrow. If nothing was done or tracked, keep it to 2 encouraging lines about tomorrow. Use ONLY the facts given.';
    const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: facts.join('\n') }], 260, 30_000);
    const text = out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5).join('\n');
    return text || fallback;
  } catch (e) {
    console.warn('[briefs] AI failed:', (e as Error).message);
    return fallback;
  }
}

export async function morningBrief(db: Db) {
  const today = localDay();
  const facts: string[] = [], plain: string[] = [];
  const all = await gatherToday(db).catch(() => [] as string[]);
  if (sent.loc) {
    try {
      const w = await getWeather(sent.loc.lat, sent.loc.lon, env.TZ);
      facts.push(`Weather in ${w.place ?? 'your area'}: now ${Math.round(w.now.temp)}°C, high ${Math.round(w.today.max)}° low ${Math.round(w.today.min)}°, rain chance ${w.today.rainChance}%, UV ${Math.round(w.today.uv)}, AQI ${w.aqi ?? 'n/a'}${w.rainSoon ? `, ${w.rainSoon}` : ''}`);
      plain.push(`☀️ ${Math.round(w.now.temp)}° now, high ${Math.round(w.today.max)}°, rain ${w.today.rainChance}%`);
    } catch { /* no weather today */ }
  }
  const tasks = await db.query<{ title: string; due_time: string | null }>(
    `select title, due_time from tasks where deleted_at is null and done_at is null and due_on is not null and due_on <= $1 order by due_time nulls last, priority desc limit 8`, [today]);
  const rem = await db.query<{ title: string; fire_at: Date }>(
    `select title, fire_at from reminders where deleted_at is null and done_at is null and fire_at >= now() and fire_at < now() + interval '16 hours' order by fire_at limit 6`);
  facts.push(`Tasks today: ${tasks.map((t) => (t.due_time ? `${t.due_time} ${t.title}` : t.title)).join('; ') || 'none'}`);
  facts.push(`Reminders today: ${rem.map((r) => `${fmtT(r.fire_at)} ${r.title}`).join('; ') || 'none'}`);
  if (tasks.length || rem.length) plain.push(`✅ ${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${rem.length} reminder${rem.length === 1 ? '' : 's'} today`);
  const games = matchesOn(today);
  facts.push(`India / MI cricket today: ${games.join('; ') || 'no match'}`);
  if (games.length) plain.push(`🏏 ${games[0]}`);
  const n = getNews();
  const heads = [...(n.digest?.india?.stories ?? []), ...(n.digest?.world?.stories ?? [])].map((s) => s.title);
  const top = heads.length ? heads : [...n.items.india, ...n.items.world].map((x) => x.title);
  facts.push(`Top headlines: ${top.slice(0, 4).join(' | ')}`);
  if (top[0]) plain.push(`📰 ${top[0]}`);
  const fest = await festivalFact(today);
  if (fest) { facts.unshift(fest); const t = fest.match(/TODAY is ([^;(]+)/)?.[1]?.trim(); if (t) plain.unshift(`🎉 Happy ${t}!`); }
  const body = await compose('morning', all.length > 2 ? all : facts, plain.join('\n') || 'Have a good day.');
  await notify(db, { kind: 'brief', title: 'Good morning ☀️', body, tag: 'brief-morning' });
  return body;
}

export async function nightBrief(db: Db) {
  const today = localDay(), tomorrow = addDays(today, 1);
  const done = await db.query<{ title: string }>(
    `select title from tasks where deleted_at is null and done_at is not null and done_at >= now() - interval '20 hours' order by done_at limit 10`);
  const hs = await streaks(db, today);
  const next = await db.query<{ title: string; due_time: string | null }>(
    `select title, due_time from tasks where deleted_at is null and done_at is null and due_on = $1 order by due_time nulls last limit 6`, [tomorrow]);
  const rem = await db.query<{ title: string; fire_at: Date }>(
    `select title, fire_at from reminders where deleted_at is null and done_at is null and fire_at >= now() and fire_at < now() + interval '26 hours' order by fire_at limit 5`);
  const games = matchesOn(tomorrow).filter((g) => !g.startsWith('LIVE'));
  const facts = [
    `Finished today: ${done.map((t) => t.title).join('; ') || 'nothing marked done'}`,
    `Habits today: ${hs.map((h) => `${h.name} ${h.done ? 'done' : 'missed'} (streak ${h.streak} days)`).join('; ') || 'no habits'}`,
    `Tomorrow tasks: ${next.map((t) => (t.due_time ? `${t.due_time} ${t.title}` : t.title)).join('; ') || 'none'}`,
    `Tomorrow reminders: ${rem.map((r) => `${fmtT(r.fire_at)} ${r.title}`).join('; ') || 'none'}`,
    `Cricket tomorrow: ${games.join('; ') || 'none'}`,
  ];
  const fest = await festivalFact(today);
  if (fest) facts.unshift(fest);
  const plain = [
    `✅ ${done.length} done today`,
    ...(hs.length ? [`🔥 ${hs.filter((h) => h.done).length}/${hs.length} habits · best streak ${Math.max(...hs.map((h) => h.streak))} days`] : []),
    `📅 Tomorrow: ${next[0]?.title ?? rem[0]?.title ?? 'nothing planned yet'}`,
  ];
  const body = await compose('night', facts, plain.join('\n'));
  await notify(db, { kind: 'brief', title: 'Today, wrapped 🌙', body, tag: 'brief-night' });
  return body;
}

/** Checked every minute; each brief goes out once a day (a restart at 8:05 still sends it, up to 10:59 / 23:59). */
export function startBriefs(db: Db) {
  const tick = async () => {
    const day = localDay(), h = localHour();
    try {
      if (h >= 8 && h < 11 && sent.morning !== day) { sent.morning = day; save(); await morningBrief(db); console.log('[briefs] morning sent'); }
      if (h >= 22 && sent.night !== day) { sent.night = day; save(); await nightBrief(db); console.log('[briefs] night sent'); }
    } catch (e) { console.warn('[briefs] failed:', (e as Error).message); }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
}

// ---------- "Today's brief" card on Home ----------
/**
 * Everything Koro knows about today, as fact lines. Empty categories are left out entirely, so the AI never
 * writes "no tasks" filler.
 */
export async function gatherToday(db: Db) {
  const today = localDay();
  const out: string[] = [];
  out.push(`Now: ${new Date().toLocaleString('en-IN', { timeZone: env.TZ, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true })}`);
  const fest = await festivalFact(today);
  if (fest) out.push(fest);
  if (sent.loc) {
    try {
      const w = await getWeather(sent.loc.lat, sent.loc.lon, env.TZ);
      out.push(`Weather ${w.place ?? ''}: ${Math.round(w.now.temp)}°C now (feels ${Math.round(w.now.feels)}°), high ${Math.round(w.today.max)}°, low ${Math.round(w.today.min)}°, rain chance ${w.today.rainChance}%${w.rainSoon ? ` (${w.rainSoon})` : ''}, UV ${Math.round(w.today.uv)}${w.aqi !== null ? `, AQI ${w.aqi}` : ''}, sunset ${fmtT(w.today.sunset)}`);
    } catch { /* skip */ }
  }
  const tasks = await db.query<{ title: string; due_on: string | null; due_time: string | null }>(
    `select title, due_on, due_time from tasks where deleted_at is null and done_at is null and (due_on is null or due_on <= $1) order by due_on nulls last, due_time nulls last, priority desc limit 8`, [today]);
  const overdue = tasks.filter((t) => t.due_on && t.due_on < today);
  if (tasks.length) out.push(`Open tasks (${tasks.length}${overdue.length ? `, ${overdue.length} overdue` : ''}): ${tasks.map((t) => `${t.due_time ? `${t.due_time} ` : ''}${t.title}`).join('; ')}`);
  const doneToday = await db.query<{ n: number }>(`select count(*)::int as n from tasks where deleted_at is null and done_at >= now() - interval '18 hours'`);
  if (doneToday[0]?.n) out.push(`Tasks finished today: ${doneToday[0].n}`);
  const rem = await db.query<{ title: string; fire_at: Date }>(
    `select title, fire_at from reminders where deleted_at is null and done_at is null and fire_at >= now() and fire_at < now() + interval '18 hours' order by fire_at limit 6`);
  if (rem.length) out.push(`Coming up: ${rem.map((r) => `${fmtT(r.fire_at)} ${r.title}`).join('; ')}`);
  const hs = await streaks(db, today);
  if (hs.length) out.push(`Habits today: ${hs.map((h) => `${h.name} ${h.done ? '✓' : 'not yet'}${h.streak > 1 ? ` (${h.streak}-day streak)` : ''}`).join('; ')}`);
  const water = await db.query<{ ml: number }>(`select coalesce(sum(ml), 0)::int as ml from water_logs where deleted_at is null and day = $1`, [today]);
  if (water[0]?.ml) out.push(`Water so far: ${(water[0].ml / 1000).toFixed(2)} L`);
  const grocery = await db.query<{ name: string }>(`select name from grocery_items where deleted_at is null and bought_at is null order by sort limit 8`);
  if (grocery.length) out.push(`Grocery list: ${grocery.map((g) => g.name).join(', ')}`);
  const m = getMatches();
  const games = [...m.live.map((x) => `LIVE ${x.name}: ${x.status}`),
    ...m.upcoming.filter((x) => x.startsAt && Date.parse(x.startsAt) - Date.now() < 36 * 3_600_000).map((x) => `${x.short?.join(' vs ') ?? x.teams.join(' vs ')} ${localDay(new Date(x.startsAt!)) === today ? 'today' : 'tomorrow'} at ${fmtT(x.startsAt!)}`),
    ...m.recent.filter((x) => Date.now() - Date.parse(x.updatedAt) < 20 * 3_600_000).slice(0, 1).map((x) => `Result: ${x.name}: ${x.status}`)];
  if (games.length) out.push(`India / MI cricket: ${games.join('; ')}`);
  const x = getX();
  const buzz = x.cricket.filter((p) => Date.now() - Date.parse(p.createdAt) < 12 * 3_600_000).sort((a, b) => b.likes - a.likes).slice(0, 2);
  if (buzz.length) out.push(`Cricket buzz on X: ${buzz.map((p) => p.text.replace(/\s+/g, ' ').slice(0, 140)).join(' | ')}`);
  if (x.digest?.lines.length && Date.now() - Date.parse(x.digest.at) < 12 * 3_600_000) out.push(`People you follow on X: ${x.digest.lines.slice(0, 2).join(' | ')}`);
  const n = getNews();
  const heads = [...(n.digest?.india?.stories ?? []), ...(n.digest?.world?.stories ?? []), ...(n.digest?.ai?.stories ?? [])].map((s) => s.title);
  const top = heads.length ? heads : [...n.items.india, ...n.items.world, ...n.items.ai].map((i) => i.title);
  if (top.length) out.push(`Headlines: ${top.slice(0, 5).join(' | ')}`);
  const yt = getYt().videos.filter((v) => Date.now() - Date.parse(v.publishedAt) < 30 * 3_600_000);
  if (yt.length) out.push(`New YouTube videos: ${yt.slice(0, 3).map((v) => `${v.channel}: ${v.title}`).join(' | ')}`);
  const saved = await db.query<{ n: number }>(`select count(*)::int as n from saved where deleted_at is null and read_at is null and status = 'ready'`);
  if (saved[0]?.n) out.push(`Unread in Read later: ${saved[0].n}`);
  const dev = await db.query<{ name: string; battery_pct: number | null; charging: boolean | null }>(`select name, battery_pct, charging from devices`);
  const low = dev.filter((d) => d.battery_pct !== null && d.battery_pct < 25 && !d.charging);
  if (low.length) out.push(`Low battery: ${low.map((d) => `${d.name} ${d.battery_pct}%`).join(', ')}`);
  return out;
}

type HomeBrief = { text: string; at: string; day: string };
let homeBrief: HomeBrief | null = loadSnapshot<HomeBrief | null>('brief', null);
let making: Promise<void> | null = null;
export const getTodayBrief = () => homeBrief;

/** Regenerated at most every 90 min (and on a new day). Never blocks a request. */
export function refreshTodayBrief(db: Db, force = false) {
  if (!aiEnabled() || making) return;
  const day = localDay();
  if (!force && homeBrief && homeBrief.day === day && Date.now() - Date.parse(homeBrief.at) < 90 * 60_000) return;
  making = (async () => {
    try {
      const facts = await gatherToday(db);
      const text = await chat([
        { role: 'system', content: 'You write the "Today" card at the top of a personal app for one person in India. 4 short lines (max 85 characters each), plain text, each starting with one fitting emoji. If the facts say a festival is TODAY, the first line is a warm wish for it in your own words with a fitting emoji, mentioning one real ritual or custom of that festival, and you may tie other lines to it (sweets on the grocery list, firecracker smoke and AQI, festive traffic). Then pick the most useful facts right now: what is next or overdue, weather worth acting on (rain, heat, AQI), cricket if there is any, a festival coming in the next days, one interesting headline or video. Mention only things present in the facts; never say something is empty, missing or "no …". No other greetings. Use ONLY the facts given.' },
        { role: 'user', content: facts.join('\n') },
      ], 300, 30_000);
      const lines = text.split('\n').map((l) => l.replace(/^[-•*\d.\s]+(?=\p{Extended_Pictographic})/u, '').trim()).filter(Boolean).slice(0, 4);
      if (lines.length) { homeBrief = { text: lines.join('\n'), at: new Date().toISOString(), day }; saveSnapshot('brief', homeBrief); console.log('[briefs] home brief refreshed'); }
    } catch (e) { console.warn('[briefs] home brief failed:', (e as Error).message); }
    finally { making = null; }
  })();
}
