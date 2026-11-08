/**
 * "Play X" for the phone: find the best song (YouTube Music) or video (YouTube) for a query, so the app can open
 * music.youtube.com/watch?v=ID directly. YT Music ignores play-from-search requests from other apps, but a watch
 * link starts playing at once (plus a radio queue of similar songs).
 */
export type Found = { id: string; title: string; artist: string; target: 'music' | 'yt' };

const cache = new Map<string, { at: number; v: Found | null }>();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SONGS_FILTER = 'EgWKAQIIAWoKEAoQCRADEAQQBQ=='; // YT Music search → "Songs" tab

/** Depth-first search for the first object that has `key`. */
function findKey(o: unknown, key: string): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  if (key in (o as object)) return (o as Record<string, Record<string, unknown>>)[key]!;
  for (const v of Object.values(o as object)) { const r = findKey(v, key); if (r) return r; }
  return null;
}
const runs = (col: unknown) => ((findKey(col, 'runs') as unknown as { text: string }[] | null) ?? []).map((r) => r.text);

async function searchMusic(q: string): Promise<Found | null> {
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://music.youtube.com', 'user-agent': UA },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241023.01.00', hl: 'en', gl: 'IN' } }, query: q, params: SONGS_FILTER }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const item = findKey(await res.json(), 'musicResponsiveListItemRenderer');
  if (!item) return null;
  const id = (findKey(item, 'playlistItemData') as { videoId?: string } | null)?.videoId ?? (findKey(item, 'watchEndpoint') as { videoId?: string } | null)?.videoId;
  const cols = (item.flexColumns as unknown[] | undefined) ?? [];
  if (!id) return null;
  const sub = runs(cols[1]).filter((t) => t.trim() && t !== ' • ');
  return { id, title: runs(cols[0]).join('') || q, artist: sub[0] ?? '', target: 'music' };
}

async function searchYouTube(q: string): Promise<Found | null> {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`, {
    headers: { 'user-agent': UA, 'accept-language': 'en', cookie: 'SOCS=CAI; CONSENT=YES+' }, signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/s);
  if (!m) return null;
  const owner = html.slice(m.index!, m.index! + 4000).match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
  const un = (s: string) => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };
  return { id: m[1]!, title: un(m[2]!), artist: un(owner), target: 'yt' };
}

export async function findPlayable(q: string, target: 'music' | 'yt'): Promise<Found | null> {
  const key = `${target}:${q.toLowerCase().trim()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.v;
  let v: Found | null = null;
  try { v = target === 'music' ? await searchMusic(q) : await searchYouTube(q); } catch (e) { console.warn('[music] search failed:', (e as Error).message); }
  if (v || !hit) cache.set(key, { at: Date.now(), v });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return v;
}
