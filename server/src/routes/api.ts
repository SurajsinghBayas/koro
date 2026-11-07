import { Hono } from 'hono';
import { z } from 'zod';
import { parseQuick } from '../../../shared/quickadd.ts';
import type { Device } from '../auth.ts';
import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { aiParse, getBrief, maybeRefreshBrief } from '../services/ai.ts';
import { getMatches } from '../services/cricket/engine.ts';
import { getNews, type NewsCat } from '../services/news.ts';
import { notify, pushEnabled } from '../services/push.ts';

type Env = { Variables: { device: Device } };

export function apiRoutes(db: Db) {
  const r = new Hono<Env>();

  const briefCtx = () => {
    const m = getMatches();
    return {
      matches: [...m.live.map((x) => `${x.summary.title}: ${x.summary.body}`), ...m.upcoming.slice(0, 2).map((x) => `${x.name} at ${x.startsAt}`)],
      headlines: [...getNews().items.india.slice(0, 3), ...getNews().items.tech.slice(0, 3)].map((n) => n.title),
    };
  };

  /** Everything the Home screen needs in one small response. */
  r.get('/home', async (c) => {
    const news = getNews();
    const matches = getMatches();
    const devices = await db.query('select id, name, kind, battery_pct, charging, battery_at, last_seen from devices order by kind, name');
    const inbox = await db.query('select id, kind, title, body, data, created_at from inbox order by id desc limit 15');
    maybeRefreshBrief(db, briefCtx);
    const body = {
      now: new Date().toISOString(),
      me: c.get('device'),
      brief: getBrief(),
      matches: { live: matches.live, upcoming: matches.upcoming.slice(0, 3), recent: matches.recent.slice(0, 2).map(({ innings, ...m }) => ({ ...m, innings })) },
      news: {
        tech: news.items.tech.slice(0, 6), india: news.items.india.slice(0, 6),
        world: news.items.world.slice(0, 4), cricket: news.items.cricket.slice(0, 4), updatedAt: news.updatedAt,
        digest: Object.fromEntries(Object.entries(news.digest ?? {}).map(([k, d]) => [k, d!.stories.slice(0, 3)])),
      },
      devices,
      inbox,
      features: { ai: aiEnabled(), push: pushEnabled(), cricketDetail: Boolean(env.CRICKETDATA_API_KEY), sportmonks: Boolean(env.SPORTMONKS_API_TOKEN) },
    };
    const json = JSON.stringify(body, (k, v) => (k === 'now' ? undefined : v));
    const etag = `W/"${Bun.hash(json).toString(36)}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    c.header('etag', etag);
    return c.json(body);
  });

  r.get('/matches', (c) => c.json(getMatches()));

  r.get('/news', (c) => {
    const cat = (c.req.query('cat') ?? 'tech') as NewsCat;
    const n = getNews();
    return c.json({ cat, items: n.items[cat] ?? [], digest: n.digest?.[cat] ?? null, updatedAt: n.updatedAt });
  });

  r.post('/devices/battery', async (c) => {
    const b = z.object({ pct: z.number().min(0).max(100), charging: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'pct (0-100) and charging required' }, 400);
    await db.query('update devices set battery_pct = $1, charging = $2, battery_at = now(), last_seen = now() where id = $3', [
      Math.round(b.data.pct), b.data.charging, c.get('device').id,
    ]);
    return c.json({ ok: true });
  });

  r.post('/devices/push-token', async (c) => {
    const b = z.object({ token: z.string().min(20).max(4096) }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'token required' }, 400);
    await db.query('update devices set push_token = $1 where id = $2', [b.data.token, c.get('device').id]);
    return c.json({ ok: true });
  });

  r.delete('/devices/:id', async (c) => {
    await db.query('delete from devices where id = $1', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  /** Public Firebase config so the phone can register for push without bundling google-services.json. */
  r.get('/config', (c) =>
    c.json({
      firebase: env.FIREBASE_APP_ID && env.FIREBASE_API_KEY && env.FIREBASE_SENDER_ID && env.FIREBASE_PROJECT_ID
        ? { appId: env.FIREBASE_APP_ID, apiKey: env.FIREBASE_API_KEY, senderId: env.FIREBASE_SENDER_ID, projectId: env.FIREBASE_PROJECT_ID }
        : null,
      tz: env.TZ,
    }),
  );

  r.get('/inbox', async (c) => c.json(await db.query('select id, kind, title, body, data, created_at from inbox order by id desc limit 50')));

  /** Send yourself a test notification (Settings → "Test push"). */
  r.post('/push/test', async (c) => c.json(await notify(db, { kind: 'system', title: 'Koro', body: 'Push is working ✅', buzz: true, tag: 'test' })));

  /** Smart quick add: AI first (when configured), local rules as fallback. Body: { text, now: "YYYY-MM-DDTHH:mm Weekday" } */
  r.post('/ai/parse', async (c) => {
    const b = z.object({ text: z.string().min(1).max(300), now: z.string().min(10).max(40) }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'text and now required' }, 400);
    if (aiEnabled()) {
      try {
        return c.json({ source: 'ai', ...(await aiParse(b.data.text, b.data.now)) });
      } catch (e) {
        console.warn('[ai] parse failed, using rules:', (e as Error).message);
      }
    }
    const q = parseQuick(b.data.text);
    return c.json({ source: 'rules', kind: q.kind, title: q.title, at: null, repeat: q.repeat ?? null, items: q.items ?? [] });
  });

  r.post('/ai/brief/refresh', (c) => { maybeRefreshBrief(db, briefCtx, true); return c.json({ ok: true, queued: aiEnabled() }); });

  return r;
}
