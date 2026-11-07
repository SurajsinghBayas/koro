import { aiEnabled } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { chatJson } from './ai.ts';

/**
 * Posts from X, collected on the Mac by Agent-Reach (logged-in browser session, no API fees)
 * and sent here by mac-companion/koro-x.py. Two streams:
 *  - feed:    top posts (by engagement) from the accounts you follow
 *  - cricket: latest posts from fast cricket-update accounts, with images and videos
 */
export type XMedia = { type: 'photo' | 'video'; url: string; poster?: string };
export type XPost = {
  id: string; author: string; text: string; url: string; createdAt: string;
  likes: number; retweets: number; replies: number; views: number; media: XMedia[];
  quoted?: { author: string; text: string };
};
type XState = { feed: XPost[]; cricket: XPost[]; at: string | null; digest: { at: string; lines: string[] } | null };

export const CRICKET_HANDLES = ['mufaddal_vohra', 'CricCrazyJohns'];
const KEEP_MS = 3 * 86_400_000;
const state: XState = loadSnapshot<XState>('x', { feed: [], cricket: [], at: null, digest: null });

export const getX = () => state;

const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '0').replace(/[^\d.]/g, '')) || 0);
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u);

/** Media lists arrive as arrays, comma strings, or a Python-style "['https://…']" string. */
const urlList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter(isHttps) : typeof v === 'string' ? v.match(/https:\/\/[^\s'",\]]+/g) ?? [] : []);

/** OpenCLI tweet row → XPost. Exported for tests. */
export function normalize(raw: Record<string, any>): XPost | null {
  const id = String(raw.id ?? raw.rest_id ?? '').trim();
  const author = String(raw.author ?? raw.screen_name ?? '').replace(/^@/, '');
  if (!/^\d+$/.test(id) || !author) return null;
  const urls = urlList(raw.media_urls), posters = urlList(raw.media_posters);
  const media: XMedia[] = urls.slice(0, 4).map((u, i) => {
    const video = /video\.twimg\.com|\.mp4(\?|$)|\.m3u8(\?|$)/.test(u);
    return video ? { type: 'video', url: u, poster: posters[i] ?? posters[0] } : { type: 'photo', url: u };
  });
  const t = Date.parse(String(raw.created_at ?? ''));
  const q = raw.quoted_tweet && typeof raw.quoted_tweet === 'object' ? raw.quoted_tweet : null;
  return {
    id, author,
    text: String(raw.text ?? '').replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim(),
    url: isHttps(raw.url) ? raw.url : `https://x.com/${author}/status/${id}`,
    createdAt: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(),
    likes: num(raw.likes), retweets: num(raw.retweets), replies: num(raw.replies), views: num(raw.views),
    media,
    ...(q?.text ? { quoted: { author: String(q.author ?? q.screen_name ?? ''), text: String(q.text).slice(0, 400) } } : {}),
  };
}

function merge(old: XPost[], incoming: XPost[], max: number, sort: (a: XPost, b: XPost) => number) {
  const byId = new Map(old.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, { ...byId.get(p.id), ...p }); // fresher counts win
  const cutoff = Date.now() - KEEP_MS;
  return [...byId.values()].filter((p) => Date.parse(p.createdAt) > cutoff).sort(sort).slice(0, max);
}
const newest = (a: XPost, b: XPost) => b.createdAt.localeCompare(a.createdAt);
/** Same weights OpenCLI uses for --top-by-engagement, decayed by age so yesterday's hits make room. */
export const score = (p: XPost, now = Date.now()) =>
  (p.likes + p.retweets * 3 + p.replies * 2 + Math.log10(p.views + 1) * 0.5) / Math.pow(1 + (now - Date.parse(p.createdAt)) / 3_600_000 / 12, 1.2);

export function ingest(body: { feed?: unknown[]; cricket?: unknown[] }) {
  const norm = (arr: unknown[] | undefined) => (arr ?? []).map((r) => (r && typeof r === 'object' ? normalize(r as Record<string, any>) : null)).filter((p): p is XPost => !!p);
  const isRt = (p: XPost) => /^RT @\w+:/.test(p.text);
  // retweets carry no counts of their own and repeat other people's posts: skip them
  const feed = norm(body.feed).filter((p) => !isRt(p)), cricket = norm(body.cricket).filter((p) => !isRt(p));
  if (feed.length) state.feed = merge(state.feed, feed, 60, (a, b) => score(b) - score(a));
  if (cricket.length) state.cricket = merge(state.cricket, cricket, 80, newest);
  state.at = new Date().toISOString();
  saveSnapshot('x', state);
  if (feed.length) void refreshDigest();
  return { feed: feed.length, cricket: cricket.length };
}

let digesting = false;
async function refreshDigest() {
  if (!aiEnabled() || digesting) return;
  if (state.digest && Date.now() - Date.parse(state.digest.at) < 60 * 60_000) return;
  const top = state.feed.slice(0, 25);
  if (top.length < 3) return;
  digesting = true;
  try {
    const j = await chatJson<{ lines?: unknown }>([
      { role: 'system', content:
        'You summarise what the people someone follows on X are talking about. Write 3–5 short lines (max 110 chars each), most interesting first, ' +
        'naming the account like "@handle: …". Use ONLY the posts given; never invent facts. Reply JSON only: {"lines":[string]}' },
      { role: 'user', content: top.map((p) => `@${p.author} (${p.likes} likes): ${p.text.slice(0, 280)}`).join('\n') },
    ], 500, 30_000);
    const lines = Array.isArray(j.lines) ? j.lines.filter((l): l is string => typeof l === 'string').slice(0, 5) : [];
    if (lines.length) { state.digest = { at: new Date().toISOString(), lines }; saveSnapshot('x', state); }
  } catch (e) {
    console.warn('[x] digest failed:', (e as Error).message);
  } finally {
    digesting = false;
  }
}
