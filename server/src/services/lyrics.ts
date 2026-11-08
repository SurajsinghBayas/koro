/**
 * Lyrics from LRCLIB (free, open, no key): synced (time-stamped) when available, else plain.
 * YT Music doesn't share its lyrics with other apps, so this matches by title / artist / length.
 */
export type Lyrics = { synced: { t: number; x: string }[] | null; plain: string | null; source: 'lrclib' } | null;
const cache = new Map<string, { at: number; v: Lyrics }>();
const UA = 'Koro/1.0 (personal app; https://github.com/)';

export function parseLrc(lrc: string) {
  const out: { t: number; x: string }[] = [];
  for (const line of lrc.split('\n')) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const x = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), x });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** "Song (Official Video)" / "Artist - Topic" noise removed so the lookup matches. */
export const clean = (s: string) => s.replace(/\s*[([](official|lyric|lyrics|audio|video|visualizer|hd|4k|remaster(ed)?)[^)\]]*[)\]]/gi, '').replace(/\s*-\s*topic$/i, '').trim();

export async function getLyrics(title: string, artist: string, album = '', durationMs = 0): Promise<Lyrics> {
  const t = clean(title), a = clean(artist.split(/,|&| feat\.? | x /i)[0] ?? artist);
  const key = `${t}|${a}|${Math.round(durationMs / 2000)}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 12 * 3_600_000) return hit.v;
  const pick = (j: any): Lyrics => (j && (j.syncedLyrics || j.plainLyrics)
    ? { synced: j.syncedLyrics ? parseLrc(j.syncedLyrics) : null, plain: j.plainLyrics ?? null, source: 'lrclib' } : null);
  let v: Lyrics = null;
  try {
    const q = new URLSearchParams({ track_name: t, artist_name: a, ...(album ? { album_name: clean(album) } : {}), ...(durationMs ? { duration: String(Math.round(durationMs / 1000)) } : {}) });
    const r = await fetch(`https://lrclib.net/api/get?${q}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) v = pick(await r.json());
    if (!v) {
      const s = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: t, artist_name: a })}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      if (s.ok) {
        const list = (await s.json()) as any[];
        const near = list.filter((x) => !durationMs || Math.abs(x.duration * 1000 - durationMs) < 6000);
        v = pick(near.find((x) => x.syncedLyrics) ?? near[0]);
      }
    }
  } catch (e) { console.warn('[lyrics]', (e as Error).message); return null; }
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return v;
}
