import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Db } from './db.ts';
import { env } from './env.ts';

export type Device = { id: string; name: string; kind: string };

const sha256 = async (s: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex');

const cache = new Map<string, { device: Device; at: number }>();
const failures = new Map<string, { n: number; until: number }>();

function timingSafeEqual(a: string, b: string) {
  const ab = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

/** Pair a new device with the SETUP_CODE. Returns a long random bearer token (shown once, stored hashed). */
export async function pairDevice(db: Db, ip: string, body: { code?: string; name?: string; kind?: string }) {
  const f = failures.get(ip);
  if (f && f.until > Date.now()) throw new HTTPException(429, { message: 'Too many attempts, wait a minute' });
  if (!env.SETUP_CODE) throw new HTTPException(503, { message: 'SETUP_CODE is not configured on the server' });
  if (!body.code || !timingSafeEqual(body.code.trim().toUpperCase(), env.SETUP_CODE.toUpperCase())) {
    const n = (f?.n ?? 0) + 1;
    failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    throw new HTTPException(401, { message: 'Wrong pairing code' });
  }
  failures.delete(ip);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const id = crypto.randomUUID();
  const kind = ['phone', 'mac', 'other'].includes(body.kind ?? '') ? body.kind! : 'other';
  // One phone and one Mac: re-pairing replaces the old entry (and keeps the name you gave it).
  const prev = kind === 'other' ? [] : await db.query<{ id: string; name: string }>(
    'select id, name from devices where kind = $1 order by last_seen desc nulls last', [kind]);
  const name = (prev[0]?.name || body.name || 'Device').slice(0, 60);
  await db.query('insert into devices (id, name, kind, token_hash, last_seen) values ($1,$2,$3,$4, now())', [
    id, name, kind, await sha256(token),
  ]);
  if (prev.length) {
    await db.query(`delete from devices where kind = $1 and id <> $2`, [kind, id]);
    cache.clear(); // old tokens stop working right away
  }
  return { deviceId: id, token, name, kind };
}

export function requireDevice(db: Db) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new HTTPException(401, { message: 'Missing token' });
    const hash = await sha256(token);
    let hit = cache.get(hash);
    if (!hit || Date.now() - hit.at > 5 * 60_000) {
      const rows = await db.query<Device>('select id, name, kind from devices where token_hash = $1', [hash]);
      if (!rows[0]) { cache.delete(hash); throw new HTTPException(401, { message: 'Unknown device' }); }
      hit = { device: rows[0], at: Date.now() };
      cache.set(hash, hit);
      db.query('update devices set last_seen = now() where id = $1', [rows[0].id]).catch(() => {});
    }
    c.set('device', hit.device);
    await next();
  };
}

export function forgetDevice(id: string) {
  for (const [k, v] of cache) if (v.device.id === id) cache.delete(k);
}
