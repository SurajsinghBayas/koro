import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Db } from '../db.ts';
import { aiEnabled } from '../env.ts';
import { chatJson } from './ai.ts';

/**
 * Read later: the phone (or the share sheet) adds a row with just a URL. This fills in the full article as plain-text
 * blocks (stored in the synced row, so it's readable offline) plus a short AI summary.
 */
export type Block = { t: 'p' | 'h' | 'li' | 'q'; x: string };
const UA = 'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Readability HTML → safe text blocks (no HTML is ever rendered by the app). Exported for tests. */
export function toBlocks(html: string): Block[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const out: Block[] = [];
  const walk = (el: Element) => {
    for (const n of Array.from(el.children)) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) { const x = clean(n.textContent ?? ''); if (x) out.push({ t: 'h', x }); }
      else if (tag === 'p') { const x = clean(n.textContent ?? ''); if (x) out.push({ t: 'p', x }); }
      else if (tag === 'li') { const x = clean(n.textContent ?? ''); if (x) out.push({ t: 'li', x }); }
      else if (tag === 'blockquote') { const x = clean(n.textContent ?? ''); if (x) out.push({ t: 'q', x }); }
      else if (tag === 'pre') { const x = (n.textContent ?? '').trim(); if (x) out.push({ t: 'p', x }); }
      else if (!['script', 'style', 'figure', 'figcaption', 'nav', 'aside', 'button', 'svg', 'form'].includes(tag)) walk(n);
    }
  };
  walk(document.body as unknown as Element);
  return out.slice(0, 600);
}

export async function extract(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*', 'accept-language': 'en-IN,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/html|xml/.test(type)) throw new Error(`not an article (${type.split(';')[0]})`);
  const html = (await res.text()).slice(0, 3_000_000);
  const { document } = parseHTML(html);
  const meta = (p: string) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.getAttribute('content') ?? undefined;
  const art = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
  const blocks = art?.content ? toBlocks(art.content) : [];
  const image = meta('og:image');
  const host = new URL(res.url || url).hostname.replace(/^www\./, '');
  return {
    title: clean(art?.title || meta('og:title') || document.title || host).slice(0, 300),
    site: clean(art?.siteName || meta('og:site_name') || host).slice(0, 100),
    image: image && /^https:\/\//.test(image) ? image : null,
    excerpt: clean(art?.excerpt || meta('og:description') || '').slice(0, 400) || null,
    blocks,
    words: blocks.reduce((n, b) => n + b.x.split(' ').length, 0),
  };
}

async function summarize(title: string, blocks: Block[]): Promise<string | null> {
  if (!aiEnabled() || !blocks.length) return null;
  const text = blocks.map((b) => b.x).join('\n').slice(0, 14_000);
  try {
    const j = await chatJson<{ lines?: unknown }>([
      { role: 'system', content: 'Summarise the article for a busy reader: 3–5 short bullet lines (max 140 chars each), key facts and numbers first. Use ONLY the text given. Reply JSON only: {"lines":[string]}' },
      { role: 'user', content: `${title}\n\n${text}` },
    ], 600, 40_000);
    const lines = Array.isArray(j.lines) ? j.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, 5) : [];
    return lines.length ? lines.join('\n') : null;
  } catch (e) {
    console.warn('[saved] summary failed:', (e as Error).message);
    return null;
  }
}

let running = false;
/** Process every pending saved article (called after sync and from POST /saved). */
export async function processSaved(db: Db) {
  if (running) return;
  running = true;
  try {
    const rows = await db.query<{ id: string; url: string; title: string | null }>(
      "select id, url, title from saved where status = 'pending' and deleted_at is null order by updated_at limit 10");
    for (const r of rows) {
      try {
        const a = await extract(r.url);
        const summary = await summarize(a.title, a.blocks);
        await db.query(
          `update saved set title = coalesce(nullif($2, ''), title), site = $3, image = $4, excerpt = $5, summary = $6, content = $7, words = $8,
             status = $9, updated_at = now(), server_seq = nextval('sync_seq') where id = $1`,
          [r.id, a.title, a.site, a.image, a.excerpt, summary, JSON.stringify(a.blocks), a.words, a.blocks.length ? 'ready' : 'failed']);
      } catch (e) {
        console.warn(`[saved] ${r.url}: ${(e as Error).message}`);
        await db.query("update saved set status = 'failed', updated_at = now(), server_seq = nextval('sync_seq') where id = $1", [r.id]);
      }
    }
  } finally {
    running = false;
  }
}

/** Server-side create (share sheet, Mac): returns the new row id. */
export async function addSaved(db: Db, url: string, title?: string) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into saved (id, url, title, status, updated_at, server_seq) values ($1, $2, $3, 'pending', now(), nextval('sync_seq'))`,
    [id, url, title ?? null]);
  void processSaved(db);
  return id;
}
