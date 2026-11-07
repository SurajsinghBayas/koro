import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, any>;
export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

/**
 * Neon (or any Postgres) via postgres.js in production.
 * `pglite:<dir>` = embedded Postgres (WASM) for local dev and tests, no install needed.
 */
export async function openDb(url: string): Promise<Db> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = url.slice('pglite:'.length);
    if (dir && dir !== 'memory') mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir === 'memory' || !dir ? undefined : dir);
    return {
      kind: 'pglite',
      query: async (text, params = []) => (await pg.query(text, params as any[])).rows as any,
      exec: async (text) => { await pg.exec(text); },
      close: () => pg.close(),
    };
  }
  const postgres = (await import('postgres')).default;
  const local = /localhost|127\.0\.0\.1/.test(url);
  const sql = postgres(url, {
    max: 5,
    idle_timeout: 20,          // release connections so Neon can scale to zero
    connect_timeout: 15,
    prepare: false,            // required for Neon's pooled (PgBouncer) endpoint
    ssl: local ? false : 'require',
  });
  return {
    kind: 'postgres',
    query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as any,
    exec: async (text) => { await sql.unsafe(text).simple(); }, // multi-statement SQL (migrations) needs the simple protocol
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function migrate(db: Db, dir = join(import.meta.dir, '..', 'migrations')) {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('.')).sort()) {
    if (done.has(file)) continue;
    await db.exec(readFileSync(join(dir, file), 'utf8'));
    await db.query('insert into schema_migrations (name) values ($1)', [file]);
    console.log(`[db] applied ${file}`);
  }
}
