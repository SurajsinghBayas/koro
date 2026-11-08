/**
 * Indian festivals, holidays and observances (Google's public "Holidays in India" calendar, no account needed).
 * Fetched once a day; the briefs use it for a festive touch ("Happy Diwali 🪔") and to mention what's coming.
 */
const ICS = 'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

export type Festival = { day: string; name: string; holiday: boolean };
let cache: { at: number; list: Festival[] } = { at: 0, list: [] };

export function parseIcs(text: string): Festival[] {
  const out: Festival[] = [];
  for (const block of text.replace(/\r/g, '').replace(/\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    const d = block.match(/^DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/m);
    const s = block.match(/^SUMMARY:(.+)$/m)?.[1]?.replace(/\\,/g, ',').trim();
    if (!d || !s) continue;
    out.push({ day: `${d[1]}-${d[2]}-${d[3]}`, name: s, holiday: /Public holiday/i.test(block.match(/^DESCRIPTION:(.*)$/m)?.[1] ?? '') });
  }
  // a festival can appear twice (e.g. regional names); keep one per day+name, public holidays first
  const seen = new Set<string>();
  return out.sort((a, b) => a.day.localeCompare(b.day) || Number(b.holiday) - Number(a.holiday))
    .filter((f) => !seen.has(f.day + f.name) && seen.add(f.day + f.name));
}

async function list(): Promise<Festival[]> {
  if (Date.now() - cache.at < 24 * 3_600_000 && cache.list.length) return cache.list;
  try {
    const res = await fetch(ICS, { signal: AbortSignal.timeout(12_000) });
    if (res.ok) cache = { at: Date.now(), list: parseIcs(await res.text()) };
  } catch (e) { console.warn('[festivals] fetch failed:', (e as Error).message); }
  return cache.list;
}

/** Festivals on `day` (YYYY-MM-DD) and in the next `ahead` days. */
export async function festivalsAround(day: string, ahead = 5) {
  const all = await list();
  const end = new Date(Date.parse(day + 'T00:00:00Z') + ahead * 86_400_000).toISOString().slice(0, 10);
  return { today: all.filter((f) => f.day === day), soon: all.filter((f) => f.day > day && f.day <= end) };
}

/** Fact line for the AI, or null when nothing is on. */
export async function festivalFact(day: string) {
  const { today, soon } = await festivalsAround(day).catch(() => ({ today: [] as Festival[], soon: [] as Festival[] }));
  const parts: string[] = [];
  if (today.length) parts.push(`TODAY is ${today.map((f) => f.name + (f.holiday ? ' (public holiday)' : '')).join(' and ')}`);
  if (soon.length) parts.push(`coming up: ${soon.map((f) => `${f.name} on ${new Date(f.day + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`).join(', ')}`);
  return parts.length ? `Festivals: ${parts.join('; ')}` : null;
}
