import type { Db } from '../db.ts';
import { aiEnabled } from '../env.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { chat, chatJson } from './ai.ts';

/**
 * YouTube: new videos from the channels you add (read from each channel's public Videos page, no key) with an AI summary of each.
 * Transcripts come from the Mac (Agent-Reach / yt-dlp), because YouTube blocks most cloud IPs; until one
 * arrives (or if there is none) the summary is written from the video description.
 */
export type Channel = { id: string; title: string; handle?: string };
export type Video = {
  id: string; channelId: string; channel: string; title: string; publishedAt: string; thumb: string; desc: string;
  summary?: string[]; from?: 'transcript' | 'description'; tries?: number; transcript?: 'none' | 'got' | 'missing';
  transcriptText?: string; subTries?: number;
  explain?: { md: string; at: string; from: 'transcript' | 'description' }; explainAsked?: number;
};
type YtState = { channels: Channel[]; videos: Video[]; at: string | null };
const st = loadSnapshot<YtState>('yt', { channels: [], videos: [], at: null });
const save = () => saveSnapshot('yt', st);
/** Feed for the app: long fields (transcript, full explanation) stay on the server. */
export const getYt = () => ({ channels: st.channels, at: st.at,
  videos: st.videos.slice(0, 40).map(({ transcriptText, explain, desc, ...v }) => ({ ...v, hasExplain: !!explain })) });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const KEEP = 14 * 86_400_000;
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** "3 days ago" / "Streamed 2 hours ago" → ISO time (approximate; the page only gives relative ages). */
export function fromAgo(label: string, now = Date.now()): string {
  const m = label.match(/(\d+)\s*(second|minute|min|hour|hr|day|week|wk|month|mo|year|yr)/i);
  if (!m) return new Date(now).toISOString();
  const unit = m[2]!.toLowerCase();
  const ms = unit.startsWith('s') ? 1e3 : unit.startsWith('mi') ? 6e4 : unit.startsWith('h') ? 3.6e6 : unit.startsWith('d') ? 8.64e7
    : unit.startsWith('w') ? 6.048e8 : unit.startsWith('mo') ? 2.592e9 : 3.1536e10;
  return new Date(now - Number(m[1]) * ms).toISOString();
}

/** Channel "Videos" page (ytInitialData) → title + videos. YouTube retired channel RSS feeds. Exported for tests. */
export function parseChannelPage(html: string, channelId: string, now = Date.now()): { title: string; videos: Video[] } {
  const raw = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  const title = dec(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? channelId);
  if (!raw) return { title, videos: [] };
  const lockups: any[] = [];
  const walk = (o: any) => { if (!o || typeof o !== 'object') return; if (o.lockupViewModel) lockups.push(o.lockupViewModel); else if (o.videoRenderer) lockups.push({ legacy: o.videoRenderer }); for (const k in o) walk(o[k]); };
  walk(JSON.parse(raw));
  const videos: Video[] = [];
  for (const l of lockups) {
    let id: string | undefined, vt: string | undefined, ago = '';
    if (l.legacy) {
      id = l.legacy.videoId; vt = l.legacy.title?.runs?.[0]?.text; ago = l.legacy.publishedTimeText?.simpleText ?? '';
    } else if (l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      id = l.contentId;
      const md = l.metadata?.lockupMetadataViewModel;
      vt = md?.title?.content;
      for (const row of md?.metadata?.contentMetadataViewModel?.metadataRows ?? []) for (const part of row.metadataParts ?? []) {
        const a = part.accessibilityLabel ?? part.text?.content ?? '';
        if (/\bago\b/i.test(a)) ago = a;
      }
    }
    if (!id || !/^[\w-]{11}$/.test(id) || !vt || /#shorts/i.test(vt)) continue;
    videos.push({ id, channelId, channel: title, title: vt, publishedAt: fromAgo(ago, now), thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, desc: '', transcript: 'none', tries: 0 });
  }
  return { title, videos };
}

async function get(url: string) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en', cookie: 'SOCS=CAI; CONSENT=YES+' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  return r.text();
}

/** "@handle", a channel URL, a video URL or a UC… id → channel. */
export async function resolveChannel(input: string): Promise<Channel> {
  const s = input.trim();
  let id = s.match(/(UC[\w-]{22})/)?.[1];
  const handle = s.match(/@([\w.-]{3,})/)?.[1];
  if (!id) {
    const page = handle ? `https://www.youtube.com/@${handle}` : /^https?:\/\//.test(s) ? s : `https://www.youtube.com/@${s.replace(/^@/, '')}`;
    const html = await get(page);
    id = html.match(/"(?:externalId|channelId|browseId)":"(UC[\w-]{22})"/)?.[1] ?? html.match(/channel_id=(UC[\w-]{22})/)?.[1];
    if (!id) throw new Error('Could not find that channel');
  }
  const { title } = parseChannelPage(await get(`https://www.youtube.com/channel/${id}/videos`), id);
  return { id, title, ...(handle ? { handle } : {}) };
}

export async function addChannel(input: string) {
  const ch = await resolveChannel(input);
  if (!st.channels.some((c) => c.id === ch.id)) st.channels.push(ch);
  save();
  void refreshYt();
  return ch;
}
export function removeChannel(id: string) {
  st.channels = st.channels.filter((c) => c.id !== id);
  st.videos = st.videos.filter((v) => v.channelId !== id);
  save();
}

/** Video description from the watch page (used when there's no transcript). */
async function description(id: string) {
  const html = await get(`https://www.youtube.com/watch?v=${id}`);
  const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  return m ? (JSON.parse(`"${m[1]}"`) as string).slice(0, 4000) : '';
}

let refreshing = false;
export async function refreshYt() {
  if (refreshing || !st.channels.length) return;
  refreshing = true;
  try {
    const byId = new Map(st.videos.map((v) => [v.id, v]));
    for (const ch of st.channels) {
      try {
        const { videos } = parseChannelPage(await get(`https://www.youtube.com/channel/${ch.id}/videos`), ch.id);
        for (const v of videos) if (!byId.has(v.id) && Date.now() - Date.parse(v.publishedAt) < KEEP) byId.set(v.id, v);
      } catch (e) { console.warn(`[yt] ${ch.title}: ${(e as Error).message}`); }
    }
    st.videos = [...byId.values()].filter((v) => Date.now() - Date.parse(v.publishedAt) < KEEP)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 120);
    st.at = new Date().toISOString();
    save();
    // No transcript after 3 h (or none exists): summarise from the description instead.
    for (const v of st.videos.slice(0, 20)) {
      if (v.summary || !(v.transcript === 'missing' || Date.now() - Date.parse(v.publishedAt) > 3 * 3_600_000)) continue;
      if (!v.desc) v.desc = await description(v.id).catch(() => '');
      if (v.desc.length > 80) await summarize(v, v.desc, 'description');
    }
  } finally { refreshing = false; }
}

async function summarize(v: Video, text: string, from: 'transcript' | 'description') {
  if (!aiEnabled()) return;
  try {
    const j = await chatJson<{ lines?: unknown }>([
      { role: 'system', content: `Summarise this YouTube video for someone deciding whether to watch it: 3–5 short bullet lines (max 130 chars each), the key points or takeaways first. ${from === 'description' ? 'You only have the description, so stick to what it says.' : ''} Ignore sponsor reads and channel plugs. Use ONLY the text given. Reply JSON only: {"lines":[string]}` },
      { role: 'user', content: `${v.title} — ${v.channel}\n\n${text.slice(0, 16_000)}` },
    ], 500, 40_000);
    const lines = Array.isArray(j.lines) ? j.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, 5) : [];
    if (lines.length) { v.summary = lines; v.from = from; save(); }
  } catch (e) { console.warn('[yt] summary failed:', (e as Error).message); }
}

/**
 * Videos the Mac should help with. YouTube shows cloud servers a "confirm you're not a bot" page, so the Mac
 * sends the description (a plain page read from a home connection) and, for fresh videos, the transcript.
 */
export const pendingTranscripts = () =>
  [...st.videos.filter(explainWaiting), ...st.videos.filter((v) => !v.summary && (v.tries ?? 0) < 4 && Date.now() - Date.parse(v.publishedAt) < 14 * 86_400_000)]
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 6).map((v) => ({
      id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`,
      wantSub: explainWaiting(v) || (v.transcript === 'none' && Date.now() - Date.parse(v.publishedAt) < 3 * 86_400_000),
      wantDesc: !v.desc,
    }));
const explainWaiting = (v: Video) => !!v.explainAsked && !v.explain && v.transcript !== 'got' && (v.subTries ?? 0) < 3;

export async function putTranscript(id: string, text: string | null, desc?: string | null) {
  const v = st.videos.find((x) => x.id === id);
  if (!v) return false;
  v.tries = (v.tries ?? 0) + 1;
  if (text !== null && text !== undefined) v.subTries = (v.subTries ?? 0) + 1;
  if (desc && desc.trim() && !v.desc) v.desc = desc.slice(0, 4000);
  if (text && text.trim().length > 200) { v.transcript = 'got'; v.transcriptText = text.slice(0, 120_000); save(); await summarize(v, text, 'transcript'); }
  else if (text !== null && text !== undefined) v.transcript = 'missing';
  if (v.explainAsked && !v.explain && (v.transcript === 'got' || explainGiveUp(v))) void makeExplain(v);
  if (!v.summary && v.desc && v.desc.length > 80) await summarize(v, v.desc, 'description');
  save();
  return true;
}

export function startYt(_db: Db) {
  setTimeout(() => void refreshYt(), 30_000);
  setInterval(() => void refreshYt(), 30 * 60_000);
}

// ---------- full explanation (on request) ----------
/** Wait up to 8 min for the Mac to send the transcript, then explain from the description. */
const explainGiveUp = (v: Video) => v.transcript === 'missing' || (v.subTries ?? 0) >= 3 || Date.now() - (v.explainAsked ?? 0) > 8 * 60_000;
const making = new Set<string>();

async function makeExplain(v: Video) {
  if (making.has(v.id) || v.explain || !aiEnabled()) return;
  const from: 'transcript' | 'description' = v.transcriptText ? 'transcript' : 'description';
  const text = v.transcriptText ?? v.desc;
  if (!text || text.length < 80) return;
  making.add(v.id);
  try {
    const md = await chat([
      { role: 'system', content: `You turn a YouTube video into a complete written explanation, so someone can understand everything without watching it. Write Markdown with these sections:
# <video title>
**Channel:** … · **Source:** ${from === 'transcript' ? 'full transcript' : 'video description only (no transcript available)'}
## TL;DR
## Key points
## Full explanation
## Notable quotes & numbers
## Terms explained
## Takeaways
Section guide (do NOT copy these notes into the headings): TL;DR is 2–3 sentences. Key points is 5–10 bullets. Full explanation walks through the video in order with ### sub-headings for each part, explaining every idea, argument, example, number and step in plain language and defining jargon the first time; it is the longest section. Quotes/numbers and Terms are bullets (drop the section if there are none). Takeaways is what to remember or do.
Ignore sponsor reads, merch and "like and subscribe". Use ONLY what is in the text; never invent facts.${from === 'description' ? ' You only have the description, so keep it proportionate and say so.' : ''}` },
      { role: 'user', content: `Title: ${v.title}\nChannel: ${v.channel}\n\n${text.slice(0, 60_000)}` },
    ], 6000, 180_000);
    if (md.trim()) { v.explain = { md: tidyHeadings(md.trim()), at: new Date().toISOString(), from }; save(); }
  } catch (e) { console.warn('[yt] explain failed:', (e as Error).message); }
  finally { making.delete(v.id); }
}

/** Drop any section-guide text the model copied into a heading ("## TL;DR — 2–3 sentences."). */
export function tidyHeadings(md: string) {
  return md.replace(/^(##\s+(?:TL;DR|Key points|Full explanation|Notable quotes & numbers|Terms explained|Takeaways))(?:\s+[—–-]\s.*|\.)$/gm, '$1');
}

/** Ask for (or poll) the full explanation of a video. */
export async function explainVideo(id: string) {
  const v = st.videos.find((x) => x.id === id);
  if (!v) return { status: 'missing' as const };
  if (v.explain) return { status: 'ready' as const, title: v.title, channel: v.channel, ...v.explain, md: tidyHeadings(v.explain.md) };
  if (!aiEnabled()) return { status: 'failed' as const, error: 'AI is off on the server' };
  if (!v.explainAsked) { v.explainAsked = Date.now(); save(); }
  if (v.transcript === 'got' || explainGiveUp(v)) {
    if (!v.transcriptText && !v.desc) v.desc = await description(v.id).catch(() => '');
    if (!v.transcriptText && (!v.desc || v.desc.length < 80)) return { status: 'failed' as const, error: "No transcript or description for this video yet. Your Mac will try again; check back in a few minutes." };
    void makeExplain(v);
  }
  return { status: 'pending' as const, waiting: v.transcript === 'got' || explainGiveUp(v) ? 'writing' : 'transcript' };
}
