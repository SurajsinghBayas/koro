/**
 * Quick-add parser shared by the app (instant, offline) and the server (fallback when AI is off).
 * "milk, eggs" → grocery · "6pm call mom" → reminder · "read daily" → habit · anything else → task.
 * Times are computed in the *caller's* local time zone (the phone's).
 */
export type QuickKind = 'task' | 'reminder' | 'grocery' | 'habit';
export interface QuickResult {
  kind: QuickKind;
  title: string;
  at?: string;           // ISO (reminders)
  repeat?: 'daily' | null;
  items?: string[];      // grocery
  confidence: number;    // 0..1 — below 0.7 the app may ask the AI
}

const GROCERY = new Set(('milk eggs egg bread butter rice atta dal sugar salt oil tea coffee curd dahi paneer cheese banana bananas ' +
  'apple apples onion onions tomato tomatoes potato potatoes chicken mutton fish vegetables veggies fruits soap shampoo ' +
  'toothpaste detergent water biscuits maggi noodles ghee yogurt juice cereal oats flour ginger garlic lemon lemons chilli ' +
  'chillies coriander spinach cucumber carrot carrots mango mangoes grapes orange oranges cornflakes jam ketchup sauce ' +
  'chips namkeen poha besan masala jeera haldi pasta bread milk honey peanut butter almonds cashews dates tissues').split(' '));

const pad = (n: number) => String(n).padStart(2, '0');

function at(base: Date, h: number, m = 0, dayOffset = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Returns the parsed date and the text with the time phrase removed. */
export function extractTime(input: string, now = new Date()): { date?: Date; rest: string; repeat: 'daily' | null } {
  let s = ` ${input} `;
  let date: Date | undefined;
  let repeat: 'daily' | null = null;
  const take = (re: RegExp) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };

  if (take(/\b(every ?day|daily|everyday)\b/i)) repeat = 'daily';

  const rel = take(/\bin\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i);
  if (rel) {
    const n = Number(rel[1]);
    date = new Date(now.getTime() + (/^h/i.test(rel[2]!) ? n * 60 : n) * 60_000);
  }
  let dayOffset = 0, dayWord = false;
  if (take(/\b(day after tomorrow)\b/i)) { dayOffset = 2; dayWord = true; }
  else if (take(/\b(tomorrow|tmrw|tmr)\b/i)) { dayOffset = 1; dayWord = true; }
  else if (take(/\btoday\b/i)) { dayWord = true; }
  const weekday = take(/\b(?:on\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
  if (weekday) {
    const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekday[1]!.toLowerCase());
    dayOffset = (idx - now.getDay() + 7) % 7 || 7;
    dayWord = true;
  }

  let part: [number, number] | undefined;
  const hm = take(/\b(?:at\s+)?(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);   // 6:30, 18:00, 6.30pm
  const hOnly = hm ? null : take(/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i); // 6pm, 7 am
  if (hm || hOnly) {
    let h = Number((hm ?? hOnly)![1]);
    const min = hm ? Number(hm[2]) : 0;
    const ap = (hm ? hm[3] : hOnly![2])?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h <= 23 && min <= 59) part = [h, min];
  } else {
    const p = take(/\b(tonight|morning|afternoon|evening|night|noon)\b/i)?.[1]?.toLowerCase();
    if (p) part = ({ tonight: [21, 0], night: [21, 0], morning: [9, 0], afternoon: [14, 0], evening: [18, 0], noon: [12, 0] } as const)[p] as [number, number];
  }

  if (!date && (part || dayWord)) {
    const [h, m] = part ?? [9, 0];
    date = at(now, h, m, dayOffset);
    if (!dayWord && date.getTime() <= now.getTime()) date = at(now, h, m, 1); // "6pm" after 6pm → tomorrow
  }
  return { date, rest: s.replace(/\s+/g, ' ').trim(), repeat };
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.replace(/^(to|that|about|-|:)\s+/i, '').replace(/\s+(at|on|by)$/i, '').trim();

export function parseQuick(input: string, now = new Date(), hint?: QuickKind): QuickResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (!raw) return { kind: 'task', title: '', confidence: 0 };

  // explicit prefixes win
  const pre = raw.match(/^(task|todo|remind(?:er)?(?:\s+me)?(?:\s+to)?|grocery|buy|habit)\s*[:\-]?\s+(.*)$/i);
  let kind: QuickKind | undefined = hint;
  let body = raw;
  if (pre) {
    const w = pre[1]!.toLowerCase();
    kind = w.startsWith('remind') ? 'reminder' : w === 'buy' || w === 'grocery' ? 'grocery' : w === 'habit' ? 'habit' : 'task';
    body = pre[2]!;
  }
  if (/^remind me\b/i.test(body)) { kind = 'reminder'; body = body.replace(/^remind me\s*(to\s+)?/i, ''); }

  const { date, rest, repeat } = extractTime(body, now);

  if (kind === 'grocery' || (!kind && !date)) {
    const items = rest.split(/\s*(?:,|\band\b|&|\+)\s*/i).map((x) => x.trim()).filter(Boolean);
    const groceryish = items.length > 0 && items.every((x) => x.split(' ').some((w) => GROCERY.has(w.toLowerCase().replace(/s$/, '')) || GROCERY.has(w.toLowerCase())));
    if (kind === 'grocery' || groceryish) {
      return { kind: 'grocery', title: items.map(cap).join(', '), items: items.map(cap), confidence: kind === 'grocery' || groceryish ? 0.9 : 0.6 };
    }
  }
  if (kind === 'habit' || (!kind && repeat === 'daily' && !date)) {
    return { kind: 'habit', title: cap(clean(rest)), repeat: 'daily', confidence: 0.85 };
  }
  if (kind === 'reminder' || date) {
    const when = date ?? at(now, 9, 0, 1);
    return { kind: 'reminder', title: cap(clean(rest)), at: when.toISOString(), repeat, confidence: date ? 0.9 : 0.6 };
  }
  return { kind: 'task', title: cap(clean(rest)), confidence: rest.split(' ').length <= 8 ? 0.8 : 0.65 };
}

/** "2026-11-10T18:00" (local wall-clock from the AI) → Date in the caller's zone. */
export function localWallClock(s: string): Date | undefined {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

export const fmtLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
