import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db.ts';

/** Synced tables and their client-writable columns (besides id / updated_at / deleted_at). */
export const SYNC_TABLES = {
  tasks: ['title', 'notes', 'due_on', 'priority', 'done_at', 'sort'],
  grocery_items: ['name', 'category', 'bought_at', 'sort'],
  habits: ['name', 'days_mask', 'sort'],
  habit_logs: ['habit_id', 'day'],
  reminders: ['title', 'fire_at', 'repeat', 'done_at'],
} as const;
export type SyncTable = keyof typeof SYNC_TABLES;

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const change = z.object({
  table: z.enum(Object.keys(SYNC_TABLES) as [SyncTable, ...SyncTable[]]),
  row: z.object({ id: uuid, updated_at: iso, deleted_at: iso.nullable().optional() }).passthrough(),
});
const body = z.object({ cursor: z.coerce.number().int().min(0).default(0), changes: z.array(change).max(2000).default([]) });

const REQUIRED: Partial<Record<SyncTable, string[]>> = {
  tasks: ['title'], grocery_items: ['name'], habits: ['name'], habit_logs: ['habit_id', 'day'], reminders: ['title', 'fire_at'],
};

/** Not-null columns that clients may omit. */
const DEFAULTS: Record<string, unknown> = { priority: 0, sort: 0, days_mask: 127 };

export async function applyChange(db: Db, table: SyncTable, row: Record<string, any>) {
  const cols = SYNC_TABLES[table] as readonly string[];
  for (const r of REQUIRED[table] ?? []) if (row[r] === undefined || row[r] === null || row[r] === '') {
    if (!row.deleted_at) throw new Error(`${table}.${r} is required`);
    row[r] = r === 'fire_at' ? row.updated_at : r === 'habit_id' ? '00000000-0000-0000-0000-000000000000' : '';
  }
  const all = ['id', ...cols, 'updated_at', 'deleted_at'];
  const values = all.map((c) => (row[c] === undefined || row[c] === null ? (DEFAULTS[c] ?? null) : row[c]));
  const placeholders = all.map((_, i) => `$${i + 1}`).join(', ');
  const updates = [...cols, 'updated_at', 'deleted_at'].map((c) => `${c} = excluded.${c}`).join(', ');
  // Last write wins: only overwrite when the incoming edit is at least as new as what we have.
  await db.query(
    `insert into ${table} (${all.join(', ')}, server_seq) values (${placeholders}, nextval('sync_seq'))
     on conflict (id) do update set ${updates}, server_seq = nextval('sync_seq')
     where ${table}.updated_at <= excluded.updated_at`,
    values,
  );
}

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

export async function pull(db: Db, cursor: number) {
  const out: { table: SyncTable; row: Record<string, unknown> }[] = [];
  let max = cursor;
  for (const table of Object.keys(SYNC_TABLES) as SyncTable[]) {
    const rows = await db.query(`select * from ${table} where server_seq > $1 order by server_seq limit 5000`, [cursor]);
    for (const r of rows) {
      const seq = Number(r.server_seq);
      if (seq > max) max = seq;
      const { server_seq, ...rest } = r;
      for (const k of Object.keys(rest)) rest[k] = toIso(rest[k]);
      out.push({ table, row: rest });
    }
  }
  return { changes: out, cursor: max };
}

export function syncRoutes(db: Db) {
  const r = new Hono();
  r.post('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid sync payload', issues: parsed.error.issues.slice(0, 5) }, 400);
    const rejected: { id: string; error: string }[] = [];
    for (const ch of parsed.data.changes) {
      try {
        await applyChange(db, ch.table, ch.row as Record<string, any>);
      } catch (e) {
        rejected.push({ id: ch.row.id, error: (e as Error).message });
      }
    }
    return c.json({ ...(await pull(db, parsed.data.cursor)), rejected });
  });
  return r;
}
