import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { chatJson } from './ai.ts';
import { __state as cricket } from './cricket/engine.ts';
import { notify } from './push.ts';
import { getX, type XPost } from './x.ts';

/**
 * Notifications for X posts:
 *  - breaking cricket posts (🚨, official news, big moments, or fast-rising posts) right away, batched with an AI summary
 *  - an "X summary" (cricket + My feed) every 3 hours during the day
 * Quiet 23:00–07:00 (APP_TZ) unless India/MI are playing live.
 */
type NState = { seeded: boolean; lastBreaking: number; lastSummary: number; sent: string[] };
const st = loadSnapshot<NState>('xnotify', { seeded: false, lastBreaking: 0, lastSummary: Date.now(), sent: [] });
const save = () => saveSnapshot('xnotify', st);

const BREAKING_WINDOW = 45 * 60_000;
const SUMMARY_EVERY = 3 * 3_600_000;

const BREAKING_RE = /🚨|\bbreaking\b|\bofficial\b|\bconfirmed\b|\bannounced\b|ruled out|\binjur(y|ed)\b|\bsquad\b|playing xi|\bhundred\b|\bcentury\b|\bfifer\b|five[- ]wicket|\bhat-?trick\b|\bretire|\bcaptain\b|\btrade\b|\bwon by\b|\bwin by\b/i;
/** Exported for tests. */
export function isBreaking(p: XPost, now = Date.now()) {
  const ageMin = Math.max(1, (now - Date.parse(p.createdAt)) / 60_000);
  return BREAKING_RE.test(p.text) || p.likes / ageMin >= 80; // ~5k likes in the first hour = a big moment
}

export const liveNow = () => Object.values(cricket.tracked).some((t) => t.match.state === 'live');
function quiet(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: env.TZ }).format(now));
  return h >= 23 || h < 7;
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstImage = (ps: XPost[]) => {
  for (const p of ps) for (const m of p.media) { const u = m.type === 'photo' ? m.url : m.poster; if (u) return u; }
  return undefined;
};
const bullets = (ps: XPost[], n = 4) => ps.slice(0, n).map((p) => `• @${p.author}: ${clip(p.text.replace(/\s+/g, ' '), 90)}`);

async function aiLines(system: string, posts: XPost[], max: number): Promise<string[] | null> {
  if (!aiEnabled() || !posts.length) return null;
  try {
    const j = await chatJson<{ lines?: unknown }>([
      { role: 'system', content: `${system} Use ONLY the posts given; never invent facts. Each line max 100 chars. Reply JSON only: {"lines":[string]}` },
      { role: 'user', content: posts.map((p) => `@${p.author}: ${p.text.slice(0, 280)}`).join('\n') },
    ], 400, 20_000);
    const lines = Array.isArray(j.lines) ? j.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, max) : [];
    return lines.length ? lines.map((l) => `• ${l.replace(/^[•\-\s]+/, '')}`) : null;
  } catch (e) {
    console.warn('[xnotify] AI summary failed:', (e as Error).message);
    return null;
  }
}

function markSent(ps: XPost[]) {
  st.sent = [...ps.map((p) => p.id), ...st.sent].slice(0, 500);
}

/** Called after every X ingest. */
export async function onXIngest(db: Db, now = Date.now()) {
  const x = getX();
  if (!st.seeded) { // first run: don't notify the backlog
    markSent(x.cricket); st.seeded = true; save(); return { sent: 0 };
  }
  const live = liveNow();
  if (quiet() && !live) return { sent: 0 };
  if (now - st.lastBreaking < (live ? 3 : 10) * 60_000) return { sent: 0 }; // candidates wait for the next ingest
  const sent = new Set(st.sent);
  const fresh = x.cricket.filter((p) => !sent.has(p.id) && now - Date.parse(p.createdAt) < BREAKING_WINDOW && isBreaking(p, now));
  if (!fresh.length) return { sent: 0 };

  const one = fresh.length === 1 ? fresh[0]! : null;
  const title = one ? `🏏 @${one.author}` : `🏏 Cricket buzz · ${fresh.length} updates`;
  const body = one
    ? clip(one.text, 400)
    : ((await aiLines('Summarise these breaking cricket posts as 2–4 short bullet lines, most important first.', fresh, 4)) ?? bullets(fresh)).join('\n');
  markSent(fresh);
  st.lastBreaking = now;
  save();
  const image = firstImage(fresh);
  return notify(db, {
    kind: 'x', title, body, buzz: true, tag: one ? `x:${one.id}` : `xbuzz:${now}`,
    data: { channel: 'x_breaking', url: one?.url ?? '', ...(image ? { image } : {}) },
  });
}

/** Every 3 h in the daytime: one notification summarising new cricket posts and My feed. */
export async function maybeSummary(db: Db, now = Date.now()) {
  if (quiet() || now - st.lastSummary < SUMMARY_EVERY) return { sent: 0 };
  const x = getX();
  const since = st.lastSummary;
  const cr = x.cricket.filter((p) => Date.parse(p.createdAt) > since).sort((a, b) => b.likes - a.likes).slice(0, 15);
  const feed = x.feed.filter((p) => Date.parse(p.createdAt) > since).slice(0, 15); // already ranked by engagement
  if (!cr.length && !feed.length) return { sent: 0 };
  st.lastSummary = now;
  save();
  const [c, f] = await Promise.all([
    cr.length ? aiLines('Summarise the most important cricket news in these posts as 2–3 short bullet lines.', cr, 3) : null,
    feed.length ? aiLines('Summarise what these people on X are talking about as 2–3 short bullet lines, naming the account like "@handle: …".', feed, 3) : null,
  ]);
  const parts: string[] = [];
  if (cr.length) parts.push(`🏏 Cricket\n${(c ?? bullets(cr, 3)).join('\n')}`);
  if (feed.length) parts.push(`📰 My feed\n${(f ?? bullets(feed, 3)).join('\n')}`);
  const image = firstImage(cr.slice(0, 3)) ?? firstImage(feed.slice(0, 3));
  return notify(db, {
    kind: 'x', title: 'Your X summary', body: parts.join('\n\n'), tag: 'xsummary',
    data: { channel: 'x_digest', ...(image ? { image } : {}) },
  });
}

export function startXNotifier(db: Db) {
  setInterval(() => void maybeSummary(db).catch((e) => console.warn('[xnotify] summary failed', e)), 10 * 60_000);
}
