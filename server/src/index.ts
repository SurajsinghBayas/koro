import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { pairDevice, requireDevice, type Device } from './auth.ts';
import { migrate, openDb } from './db.ts';
import { aiEnabled, env } from './env.ts';
import { apiRoutes } from './routes/api.ts';
import { syncRoutes } from './routes/sync.ts';
import { __state as cricketState, startCricket } from './services/cricket/engine.ts';
import { refreshHistory } from './services/cricket/history.ts';
import { refreshNews } from './services/news.ts';
import { pushEnabled } from './services/push.ts';

const db = await openDb(env.DATABASE_URL);
await migrate(db);

const app = new Hono<{ Variables: { device: Device } }>();
app.use('*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type', 'if-none-match'], exposeHeaders: ['etag'] }));
app.use('*', compress());

app.get('/healthz', async (c) => {
  await db.query('select 1');
  return c.json({ ok: true, at: new Date().toISOString() });
});

app.post('/v1/pair', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return c.json(await pairDevice(db, ip, await c.req.json().catch(() => ({}))));
});

app.use('/v1/*', requireDevice(db));
app.route('/v1/sync', syncRoutes(db));
app.route('/v1', apiRoutes(db));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error('[http]', err);
  return c.json({ error: 'Server error' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Background jobs: news every 30 min, cricket scheduler (adaptive), all in-process.
if (env.JOBS) {
  const news = () => refreshNews().catch((e) => console.warn('[news] failed', e));
  setTimeout(news, 1_000);
  setInterval(news, 30 * 60_000);
  startCricket(db);
  const history = () => refreshHistory(false, cricketState.recent);
  setTimeout(history, 20_000);
  setInterval(history, 30 * 60_000);
}

const server = Bun.serve({ port: env.PORT, hostname: env.HOST, fetch: app.fetch, idleTimeout: 30 });
console.log(`Koro server on http://${env.HOST}:${server.port}  db=${db.kind}  ai=${aiEnabled() ? env.AI_MODEL : 'off'}  push=${pushEnabled() ? 'fcm' : 'inbox-only'}  cricketdata=${env.CRICKETDATA_API_KEY ? 'on' : 'off'}  sportmonks=${env.SPORTMONKS_API_TOKEN ? 'on' : 'off'}`);
if (!env.SETUP_CODE) console.warn('⚠️  SETUP_CODE is empty — devices cannot pair. Set it in .env');

const shutdown = async () => { server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, db };
