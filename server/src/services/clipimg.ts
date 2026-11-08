/**
 * Images copied on one device for the other's clipboard. Kept in memory for 10 minutes (like clipboard text),
 * fetched once by the other side with its device token.
 */
import { randomUUID } from 'node:crypto';

export const MAX_IMAGE = 8 * 1024 * 1024;
const TTL = 10 * 60_000;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic']);
const store = new Map<string, { buf: Uint8Array<ArrayBuffer>; mime: string; at: number }>();

function prune() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL) store.delete(k);
  while (store.size > 20) store.delete(store.keys().next().value!);
}

export function putImage(b64: string, mime: string): { id: string; size: number } | { error: string } {
  if (!MIMES.has(mime)) return { error: 'unsupported image type' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'empty image' };
  if (buf.length > MAX_IMAGE) return { error: 'image too large (8 MB max)' };
  prune();
  const id = randomUUID();
  store.set(id, { buf: new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer), mime, at: Date.now() });
  return { id, size: buf.length };
}

export function getImage(id: string) { prune(); return store.get(id) ?? null; }
