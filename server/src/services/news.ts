import { XMLParser } from 'fast-xml-parser';
import { aiEnabled } from '../env.ts';
import { fetchText } from '../lib/http.ts';
import { chatJson } from './ai.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';

export type NewsCat = 'world' | 'india' | 'ai' | 'startups' | 'cricket';
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string; cat: NewsCat; desc?: string; image?: string };
/** AI digest: duplicate headlines merged into one story with a one-line summary. */
export type Story = { title: string; summary: string; url: string; image?: string; publishedAt: string; sources: { source: string; url: string }[] };
export type Digest = { at: string; stories: Story[] };

export const FEEDS: { cat: NewsCat; source: string; url: string }[] = [
  { cat: 'world', source: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { cat: 'world', source: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { cat: 'world', source: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { cat: 'india', source: 'The Hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
  { cat: 'india', source: 'Indian Express', url: 'https://indianexpress.com/section/india/feed/' },
  { cat: 'india', source: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms' },
  { cat: 'ai', source: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { cat: 'ai', source: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { cat: 'ai', source: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/' },
  { cat: 'ai', source: 'The Decoder', url: 'https://the-decoder.com/feed/' },
  { cat: 'ai', source: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/' },
  { cat: 'ai', source: 'MIT Tech Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { cat: 'startups', source: 'TechCrunch', url: 'https://techcrunch.com/category/startups/feed/' },
  { cat: 'startups', source: 'TechCrunch Venture', url: 'https://techcrunch.com/category/venture/feed/' },
  { cat: 'startups', source: 'Crunchbase News', url: 'https://news.crunchbase.com/feed/' },
  { cat: 'startups', source: 'Inc42', url: 'https://inc42.com/feed/' },
  { cat: 'startups', source: 'YourStory', url: 'https://yourstory.com/feed' },
  { cat: 'cricket', source: 'ESPNcricinfo', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml' },
];

const PER_CAT = 40;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });

const text = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  return text(v['#text'] ?? v['@href'] ?? '');
};
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#822[01];|&[lr]dquo;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

const httpsUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\//.test(u.trim()) ? u.trim().replace(/&amp;/g, '&') : undefined);
/** Thumbnail from media:content / media:thumbnail / enclosure / first <img>. https only. */
function pickImage(it: any, html: string): string | undefined {
  const arr = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const media = [...arr(it['media:content']), ...arr(it['media:group']?.['media:content'])];
  const img = media.find((m) => !m['@medium'] || m['@medium'] === 'image' || /image/.test(m['@type'] ?? ''));
  return httpsUrl(img?.['@url'])
    ?? httpsUrl(arr(it['media:thumbnail'])[0]?.['@url'])
    ?? httpsUrl(arr(it.enclosure).find((e: any) => /^image\//.test(e['@type'] ?? ''))?.['@url'])
    ?? httpsUrl(html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]);
}

/** Parses RSS 2.0 and Atom into items. Exported for tests. */
export function parseFeed(xml: string, cat: NewsCat, source: string): NewsItem[] {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item;
  const atomEntries = doc?.feed?.entry;
  const raw: any[] = rssItems ? [].concat(rssItems) : atomEntries ? [].concat(atomEntries) : [];
  const out: NewsItem[] = [];
  for (const it of raw) {
    const title = decode(text(it.title));
    let url = text(it.link);
    if (Array.isArray(it.link)) {
      const alt = it.link.find((l: any) => !l['@rel'] || l['@rel'] === 'alternate');
      url = text(alt?.['@href'] ?? it.link[0]?.['@href'] ?? it.link[0]);
    } else if (it.link && typeof it.link === 'object') url = text(it.link['@href'] ?? it.link);
    const date = text(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']);
    const t = Date.parse(date);
    if (!title || !url) continue;
    const rawDesc = text(it.description ?? it.summary ?? it['media:group']?.['media:description'] ?? '');
    const html = String(it['content:encoded'] ?? (typeof it.content === 'string' ? it.content : it.content?.['#text']) ?? '') + ' ' + rawDesc;
    let desc = decode(rawDesc);
    if (/^(article url|comments)\b/i.test(desc) || desc.toLowerCase() === title.toLowerCase()) desc = '';
    const item: NewsItem = { id: url, title, url: url.trim(), source, publishedAt: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(), cat };
    if (desc) item.desc = desc.length > 240 ? desc.slice(0, 237).replace(/\s+\S*$/, '') + '…' : desc;
    const image = pickImage(it, html)?.replace(/(ichef\.bbci\.co\.uk\/[^/]+\/[^/]+\/)240\//, '$1480/');
    if (image) item.image = image;
    out.push(item);
  }
  return out;
}

type NewsState = { items: Record<NewsCat, NewsItem[]>; updatedAt: string | null; errors: Record<string, string>; digest?: Partial<Record<NewsCat, Digest>> };
const empty = (): NewsState => ({ items: { world: [], india: [], ai: [], startups: [], cricket: [] }, updatedAt: null, errors: {}, digest: {} });
let state: NewsState = loadSnapshot<NewsState>('news', empty());
state.items = { ...empty().items, ...Object.fromEntries(Object.entries(state.items).filter(([k]) => k in empty().items)) } as NewsState['items'];
state.digest = Object.fromEntries(Object.entries(state.digest ?? {}).filter(([k]) => k in empty().items));

export const getNews = () => state;

export async function refreshNews() {
  const next = empty();
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => ({ f, items: parseFeed((await fetchText(f.url)).text, f.cat, f.source) })),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') next.items[r.value.f.cat].push(...r.value.items.slice(0, 20));
    else {
      const f = FEEDS[results.indexOf(r)]!;
      next.errors[f.source] = String((r.reason as Error)?.message ?? r.reason).slice(0, 160);
      next.items[f.cat].push(...state.items[f.cat].filter((i) => i.source === f.source)); // keep last good
    }
  }
  for (const cat of Object.keys(next.items) as NewsCat[]) {
    const seen = new Set<string>();
    next.items[cat] = next.items[cat]
      .filter((i) => {
        const k = i.title.toLowerCase().slice(0, 80);
        if (seen.has(i.url) || seen.has(k)) return false;
        seen.add(i.url); seen.add(k);
        return true;
      })
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, PER_CAT);
  }
  next.updatedAt = new Date().toISOString();
  next.digest = state.digest ?? {};
  state = next;
  saveSnapshot('news', state);
  const failed = Object.keys(next.errors);
  console.log(`[news] refreshed: ${Object.values(next.items).flat().length} items${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
  void refreshDigests();
  return state;
}

// ---------- AI digest ----------
const DIGEST_EVERY = 90 * 60_000;
const FOCUS: Record<NewsCat, string> = {
  world: 'the biggest world news of the day that matters to a reader in India',
  india: 'India: national news, policy, economy and big state stories',
  ai: 'AI: model and product launches, research breakthroughs, big-tech AI moves, regulation. Skip general gadget news',
  startups: 'AI startups: funding rounds, launches, acquisitions, IPOs and notable founders, global and Indian. Prefer AI companies; skip non-startup stories',
  cricket: 'cricket, with priority to the Indian team, Rohit Sharma and Mumbai Indians',
};
let digesting = false;

/** Builds a Story list from an AI answer. Exported for tests. */
export function storiesFromAi(raw: { title?: unknown; summary?: unknown; items?: unknown }[], items: NewsItem[]): Story[] {
  const out: Story[] = [];
  const used = new Set<number>();
  for (const r of raw) {
    const idx = (Array.isArray(r.items) ? r.items : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < items.length && !used.has(i));
    if (!idx.length || typeof r.title !== 'string' || !r.title.trim()) continue;
    idx.forEach((i) => used.add(i));
    const group = idx.map((i) => items[i]!);
    const lead = group.find((g) => g.image) ?? group[0]!;
    const sources = [...new Map(group.map((g) => [g.source, { source: g.source, url: g.url }])).values()];
    out.push({
      title: r.title.trim().slice(0, 120),
      summary: typeof r.summary === 'string' ? r.summary.trim().slice(0, 240) : group[0]!.desc ?? '',
      url: group[0]!.url,
      image: lead.image,
      publishedAt: group.map((g) => g.publishedAt).sort().pop()!,
      sources,
    });
  }
  return out;
}

export async function refreshDigests(force = false) {
  if (digesting) return;
  if (!aiEnabled()) return;
  digesting = true;
  try {
    for (const cat of Object.keys(state.items) as NewsCat[]) {
      const d = state.digest?.[cat];
      if (!force && d && Date.now() - Date.parse(d.at) < DIGEST_EVERY) continue;
      const items = state.items[cat].slice(0, 24);
      if (items.length < 3) continue;
      const list = items.map((n, i) => `${i}. [${n.source}] ${n.title}${n.desc ? ` — ${n.desc.slice(0, 160)}` : ''}`).join('\n');
      try {
        const j = await chatJson<{ stories?: unknown }>([
          { role: 'system', content:
            `You are a news editor for one reader. Topic: ${FOCUS[cat]}. From the numbered headlines pick the 6 most important DISTINCT stories. ` +
            'Merge headlines about the same event into one story. For each story write a clear neutral title (max 80 chars) and ONE summary sentence ' +
            '(max 160 chars) that says what happened and why it matters. Use ONLY facts present in the given headlines and descriptions; never invent numbers, names or quotes. ' +
            'Reply with JSON only: {"stories":[{"title":string,"summary":string,"items":[numbers]}]} most important first.' },
          { role: 'user', content: list },
        ], 900, 40_000);
        const stories = storiesFromAi(Array.isArray(j.stories) ? j.stories : [], items);
        if (stories.length) {
          state.digest![cat] = { at: new Date().toISOString(), stories };
          console.log(`[news] AI digest ${cat}: ${stories.length} stories`);
        }
      } catch (e) {
        console.warn(`[news] AI digest ${cat} failed:`, (e as Error).message);
      }
    }
    saveSnapshot('news', state);
  } finally {
    digesting = false;
  }
}
