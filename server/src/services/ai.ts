import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';

/** Bedrock Mantle (OpenAI-compatible chat completions). Server-side only: the key never reaches the phone. */
export async function chat(messages: { role: 'system' | 'user'; content: string }[], maxTokens = 300, timeoutMs = 20_000) {
  if (!aiEnabled()) throw new Error('AI not configured');
  const res = await fetch(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL, max_tokens: maxTokens, temperature: 0.2, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** Chat that must return a JSON object: parses leniently and retries once with a stricter reminder. */
export async function chatJson<T = Record<string, unknown>>(messages: { role: 'system' | 'user'; content: string }[], maxTokens = 600, timeoutMs = 40_000): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0 ? messages : [...messages, { role: 'user' as const, content: 'Your previous reply was not valid JSON. Reply again with ONLY valid JSON. Escape any double quotes inside strings.' }];
    try {
      const j = firstJson(await chat(msgs, maxTokens, timeoutMs));
      if (j && typeof j === 'object') return j as T;
      last = new Error('no JSON object');
    } catch (e) { last = e; if ((e as Error).message.startsWith('AI ')) throw e; }
  }
  throw last instanceof Error ? last : new Error('AI returned no usable JSON');
}

const firstJson = (s: string) => {
  const m = s.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
};

export type AiParse = { kind: 'task' | 'reminder' | 'grocery' | 'habit'; title: string; at: string | null; repeat: 'daily' | null; items: string[] };

/** Natural-language quick add. `now` is the phone's local wall clock ("2026-11-08T14:05 Sunday"). */
export async function aiParse(text: string, now: string): Promise<AiParse> {
  const out = await chat([
    {
      role: 'system',
      content:
        'You turn a short note into JSON for a personal organizer. Reply with JSON only, no prose:\n' +
        '{"kind":"task|reminder|grocery|habit","title":string,"at":"YYYY-MM-DDTHH:mm"|null,"repeat":"daily"|null,"items":[string]}\n' +
        'Rules: if the note has a specific time or day, kind is "reminder" and "at" is local time. Groceries/shopping items → "grocery" with each item in items. ' +
        'Recurring routines without a time ("read daily", "gym every day") → "habit". Otherwise "task". Keep title short, no time words. ' +
        `Current local time: ${now}.`,
    },
    { role: 'user', content: text.slice(0, 300) },
  ], 200, 12_000);
  const j = firstJson(out);
  if (!j || !['task', 'reminder', 'grocery', 'habit'].includes(j.kind)) throw new Error('AI returned no usable JSON');
  return { kind: j.kind, title: String(j.title ?? text).slice(0, 200), at: j.at ?? null, repeat: j.repeat === 'daily' ? 'daily' : null, items: Array.isArray(j.items) ? j.items.map(String).slice(0, 30) : [] };
}

export type AiItem = AiParse & { days: number[] | null; time: string | null };
/** Several things in one note ("milk eggs, call bank tomorrow 10am, gym every Mon Wed Fri 7am") → one entry each. */
export async function aiParseMulti(text: string, now: string): Promise<AiItem[]> {
  const out = await chat([
    {
      role: 'system',
      content:
        'Split a note into separate items for a personal organizer. Reply with JSON only: {"items":[{"kind":"task|reminder|grocery|habit","title":string,"at":"YYYY-MM-DDTHH:mm"|null,"repeat":"daily"|null,"items":[string],"days":[int]|null,"time":"HH:mm"|null}]}\n' +
        'Rules: all shopping/grocery things go in ONE grocery entry with each product in items (title "Grocery"). A one-off thing with a day or time → reminder, "at" in local time (a day without a time → 09:00). ' +
        'Recurring routines ("gym every Mon Wed Fri 7am", "read daily") → habit; days = weekdays 0=Mon … 6=Sun (null = every day), time = HH:mm or null. ' +
        'A recurring thing that is clearly a reminder ("take pills every day at 9pm") → reminder with repeat "daily". Anything else → task. Titles short, no time words, keep the user\'s language. ' +
        `Current local time: ${now}.`,
    },
    { role: 'user', content: text.slice(0, 600) },
  ], 600, 20_000);
  const j = firstJson(out);
  const list: any[] = Array.isArray(j?.items) ? j.items : j?.kind ? [j] : [];
  const items = list.filter((x) => x && ['task', 'reminder', 'grocery', 'habit'].includes(x.kind)).slice(0, 12).map((x): AiItem => ({
    kind: x.kind, title: String(x.title ?? '').slice(0, 200), at: typeof x.at === 'string' ? x.at : null, repeat: x.repeat === 'daily' ? 'daily' : null,
    items: Array.isArray(x.items) ? x.items.map(String).slice(0, 30) : [],
    days: Array.isArray(x.days) ? x.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : null,
    time: typeof x.time === 'string' && /^\d{1,2}:\d{2}$/.test(x.time) ? x.time.padStart(5, '0') : null,
  }));
  if (!items.length) throw new Error('AI returned no usable JSON');
  return items;
}

type Brief = { text: string; at: string; day: string };
let brief: Brief | null = loadSnapshot<Brief | null>('brief', null);
let generating: Promise<void> | null = null;

export const getBrief = () => brief;

/**
 * A 3-line morning brief from today's tasks, reminders, matches and headlines.
 * Generated at most every 3 hours (and on the first request of a new day). Never blocks a request.
 */
export function maybeRefreshBrief(db: Db, ctx: () => { matches: string[]; headlines: string[] }, force = false) {
  if (!aiEnabled() || generating) return;
  const day = new Date().toLocaleDateString('en-CA', { timeZone: env.TZ });
  if (!force && brief && brief.day === day && Date.now() - Date.parse(brief.at) < 3 * 3_600_000) return;
  generating = (async () => {
    try {
      const tasks = await db.query<{ title: string }>(
        `select title from tasks where deleted_at is null and done_at is null and (due_on is null or due_on <= $1) order by priority desc, sort limit 8`, [day]);
      const rem = await db.query<{ title: string; fire_at: Date }>(
        `select title, fire_at from reminders where deleted_at is null and done_at is null and fire_at >= now() and fire_at < now() + interval '24 hours' order by fire_at limit 6`);
      const { matches, headlines } = ctx();
      const fmtT = (d: Date) => new Date(d).toLocaleTimeString('en-IN', { timeZone: env.TZ, hour: '2-digit', minute: '2-digit' });
      const prompt = [
        `Date: ${new Date().toLocaleString('en-IN', { timeZone: env.TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
        `Open tasks: ${tasks.map((t) => t.title).join('; ') || 'none'}`,
        `Reminders next 24h: ${rem.map((r) => `${fmtT(r.fire_at)} ${r.title}`).join('; ') || 'none'}`,
        `Cricket (MI / India): ${matches.join('; ') || 'no match today'}`,
        `Headlines: ${headlines.slice(0, 6).join(' | ')}`,
      ].join('\n');
      const text = await chat([
        { role: 'system', content: 'You write a calm, useful daily brief for one person. Exactly 3 short lines, each under 90 characters, no bullet symbols, no greetings, no emojis. Line 1: the most important thing to do today. Line 2: cricket (or a key reminder if no cricket). Line 3: one headline worth knowing.' },
        { role: 'user', content: prompt },
      ], 220);
      brief = { text: text.split('\n').map((l) => l.replace(/^[-•*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3).join('\n'), at: new Date().toISOString(), day };
      saveSnapshot('brief', brief);
      console.log('[ai] brief refreshed');
    } catch (e) {
      console.warn('[ai] brief failed:', (e as Error).message);
    } finally {
      generating = null;
    }
  })();
}
