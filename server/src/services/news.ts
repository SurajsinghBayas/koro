import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../lib/http.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';

export type NewsCat = 'tech' | 'india' | 'world' | 'cricket';
export type NewsItem = { id: string; title: string; url: string; source: string; publishedAt: string; cat: NewsCat };

export const FEEDS: { cat: NewsCat; source: string; url: string }[] = [
  { cat: 'tech', source: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { cat: 'tech', source: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { cat: 'tech', source: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { cat: 'india', source: 'The Hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
  { cat: 'india', source: 'Indian Express', url: 'https://indianexpress.com/section/india/feed/' },
  { cat: 'india', source: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms' },
  { cat: 'world', source: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { cat: 'world', source: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { cat: 'cricket', source: 'ESPNcricinfo', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml' },
];

const PER_CAT = 30;
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
    out.push({ id: url, title, url: url.trim(), source, publishedAt: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(), cat });
  }
  return out;
}

type NewsState = { items: Record<NewsCat, NewsItem[]>; updatedAt: string | null; errors: Record<string, string> };
const empty = (): NewsState => ({ items: { tech: [], india: [], world: [], cricket: [] }, updatedAt: null, errors: {} });
let state: NewsState = loadSnapshot<NewsState>('news', empty());

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
  state = next;
  saveSnapshot('news', state);
  const failed = Object.keys(next.errors);
  console.log(`[news] refreshed: ${Object.values(next.items).flat().length} items${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
  return state;
}
