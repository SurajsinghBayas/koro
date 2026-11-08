import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { chat } from './ai.ts';
import { getMatches } from './cricket/engine.ts';
import { getNews } from './news.ts';
import { notify } from './push.ts';
import { getWeather } from './weather.ts';

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
      ? 'Write a morning push notification body for one person in India. 4–5 short lines (under 70 chars each), plain text, no greeting, one emoji at the start of each line: weather (with what to carry), the first thing to do, cricket only if there is a match, one headline. Skip any topic whose facts are empty or none (never write lines like "no tasks"). Use ONLY the facts given.'
      : 'Write a 10 PM wind-down push notification for one person. 3–5 short lines (under 70 chars each), plain text, one emoji per line, warm but not cheesy: what got done today, habit streaks (praise kept streaks, gently name a missed habit), what is first tomorrow. If nothing was done or tracked, keep it to 2 encouraging lines about tomorrow. Use ONLY the facts given.';
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
  const body = await compose('morning', facts, plain.join('\n') || 'Have a good day.');
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
