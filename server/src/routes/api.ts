import { Hono } from 'hono';
import { z } from 'zod';
import { parseQuick } from '../../../shared/quickadd.ts';
import type { Device } from '../auth.ts';
import type { Db } from '../db.ts';
import { aiEnabled, env } from '../env.ts';
import { aiParse, aiParseMulti } from '../services/ai.ts';
import { getTodayBrief, morningBrief, nightBrief, refreshTodayBrief, rememberLocation } from '../services/briefs.ts';
import { getMatches } from '../services/cricket/engine.ts';
import { getNews, type NewsCat } from '../services/news.ts';
import { notify, pushEnabled } from '../services/push.ts';
import { onXIngest } from '../services/xnotify.ts';
import { CRICKET_HANDLES, getX, ingest } from '../services/x.ts';
import { clipToPhone, cmdToPhone, currentSeq, MAC_CMDS, macMedia, macMediaNow, macOnline, nextEvents, phone, PHONE_CMDS, pushToMac, status as macStatus } from '../services/mac.ts';
import { addSaved } from '../services/saved.ts';
import { getWeather } from '../services/weather.ts';
import { getLyrics } from '../services/lyrics.ts';
import { addChannel, explainVideo, getYt, pendingTranscripts, putTranscript, refreshYt, removeChannel } from '../services/yt.ts';

type Env = { Variables: { device: Device } };

export function apiRoutes(db: Db) {
  const r = new Hono<Env>();

  /** Everything the Home screen needs in one small response. */
  r.get('/home', async (c) => {
    const news = getNews();
    const matches = getMatches();
    const devices = await db.query('select id, name, kind, battery_pct, charging, battery_at, last_seen from devices order by kind, name');
    const inbox = await db.query('select id, kind, title, body, data, created_at from inbox order by id desc limit 15');
    refreshTodayBrief(db);
    const body = {
      now: new Date().toISOString(),
      me: c.get('device'),
      brief: getTodayBrief(),
      matches: { live: matches.live, upcoming: matches.upcoming.slice(0, 3), recent: matches.recent.slice(0, 2).map(({ innings, ...m }) => ({ ...m, innings })) },
      news: {
        world: news.items.world.slice(0, 4), india: news.items.india.slice(0, 4), ai: news.items.ai.slice(0, 4),
        startups: news.items.startups.slice(0, 4), cricket: news.items.cricket.slice(0, 4), updatedAt: news.updatedAt,
        digest: Object.fromEntries(Object.entries(news.digest ?? {}).map(([k, d]) => [k, d!.stories.slice(0, 3)])),
      },
      devices,
      mac: { online: macOnline(), volume: macStatus.volume, muted: macStatus.muted },
      inbox,
      x: (() => { const x = getX(); return { at: x.at, digest: x.digest, feed: x.feed.slice(0, 3), cricket: x.cricket.slice(0, 3) }; })(),
      features: { ai: aiEnabled(), push: pushEnabled(), cricketDetail: Boolean(env.CRICKETDATA_API_KEY), sportmonks: Boolean(env.SPORTMONKS_API_TOKEN) },
    };
    const json = JSON.stringify(body, (k, v) => (k === 'now' ? undefined : v));
    const etag = `W/"${Bun.hash(json).toString(36)}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    c.header('etag', etag);
    return c.json(body);
  });

  r.get('/matches', (c) => c.json(getMatches()));

  // ---- X (collected on the Mac by Agent-Reach, see mac-companion/koro-x.py) ----
  r.get('/x', (c) => { const x = getX(); return c.json({ at: x.at, digest: x.digest, feed: x.feed.slice(0, 40), cricket: x.cricket.slice(0, 50) }); });
  r.get('/x/config', (c) => c.json({ cricket: CRICKET_HANDLES, feedTop: 25, feedScan: 120, cricketPerHandle: 15 }));
  r.post('/x/ingest', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'JSON body required' }, 400);
    const b = body as { feed?: unknown; cricket?: unknown };
    if ((b.feed && !Array.isArray(b.feed)) || (b.cricket && !Array.isArray(b.cricket))) return c.json({ error: 'feed and cricket must be arrays' }, 400);
    const res = ingest({ feed: (b.feed as unknown[] | undefined)?.slice(0, 300), cricket: (b.cricket as unknown[] | undefined)?.slice(0, 300) });
    void onXIngest(db).catch((e) => console.warn('[xnotify] failed', e));
    return c.json({ ok: true, ...res });
  });

  r.get('/news', (c) => {
    const cat = (c.req.query('cat') ?? 'world') as NewsCat;
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

  r.post('/ai/parse-multi', async (c) => {
    const b = z.object({ text: z.string().min(1).max(600), now: z.string().min(10).max(40) }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'text and now required' }, 400);
    if (!aiEnabled()) return c.json({ error: 'AI is off on the server' }, 503);
    try { return c.json({ items: await aiParseMulti(b.data.text, b.data.now) }); }
    catch (e) { return c.json({ error: `AI couldn't split that: ${(e as Error).message}` }, 502); }
  });

  /** Send the 8 AM / 10 PM brief now (to preview it). */
  r.post('/briefs/:kind/test', async (c) => {
    const k = c.req.param('kind');
    if (k !== 'morning' && k !== 'night') return c.json({ error: 'morning or night' }, 400);
    return c.json({ ok: true, body: await (k === 'morning' ? morningBrief(db) : nightBrief(db)) });
  });

  r.post('/ai/brief/refresh', (c) => { refreshTodayBrief(db, true); return c.json({ ok: true, queued: aiEnabled() }); });

  // ---------- lyrics ----------
  r.get('/lyrics', async (c) => {
    const title = c.req.query('title') ?? '', artist = c.req.query('artist') ?? '';
    if (!title) return c.json({ error: 'title required' }, 400);
    return c.json({ lyrics: await getLyrics(title, artist, c.req.query('album') ?? '', Number(c.req.query('duration') ?? 0) || 0) });
  });

  // ---------- weather ----------
  r.get('/weather', async (c) => {
    const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return c.json({ error: 'lat and lon required' }, 400);
    rememberLocation(lat, lon);
    try { return c.json(await getWeather(lat, lon, env.TZ)); }
    catch (e) { return c.json({ error: `Weather unavailable: ${(e as Error).message}` }, 502); }
  });

  // ---------- phone ⇄ Mac ----------
  const isMac = (c: { get: (k: 'device') => Device }) => c.get('device').kind === 'mac';
  /** Mac agent long-poll. `since=0` on start returns the current cursor without replaying old events. */
  r.get('/mac/events', async (c) => {
    if (!isMac(c)) return c.json({ error: 'Mac only' }, 403);
    const since = Number(c.req.query('since') ?? 0) || 0;
    const events = await nextEvents(since);
    return c.json({ seq: events.length ? events[events.length - 1]!.seq : Math.max(since, currentSeq()), events });
  });
  r.post('/mac/status', async (c) => {
    if (!isMac(c)) return c.json({ error: 'Mac only' }, 403);
    const b = z.object({ volume: z.number().min(0).max(100).nullable().optional(), muted: z.boolean().nullable().optional(),
      brightness: z.number().min(0).max(100).nullable().optional(), awake: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'volume/muted' }, 400);
    Object.assign(macStatus, { volume: b.data.volume ?? null, muted: b.data.muted ?? null, at: Date.now() });
    if (b.data.brightness !== undefined) macStatus.brightness = b.data.brightness;
    if (b.data.awake !== undefined) macStatus.awake = b.data.awake;
    return c.json({ ok: true });
  });
  r.get('/mac/status', (c) => c.json({ online: macOnline(), media: macMediaNow(), volume: macStatus.volume, muted: macStatus.muted, brightness: macStatus.brightness, awake: macStatus.awake, at: macStatus.at || null }));

  r.post('/mac/media', async (c) => {
    if (!isMac(c)) return c.json({ error: 'Mac only' }, 403);
    const b = z.object({ title: z.string().max(300), artist: z.string().max(300).optional(), app: z.string().max(80).optional(),
      url: z.string().max(500).optional(), playing: z.boolean().optional() }).passthrough().safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'bad media' }, 400);
    Object.assign(macMedia, { title: b.data.title, artist: b.data.artist ?? '', app: b.data.app ?? '', url: b.data.url ?? '', playing: !!b.data.playing, at: Date.now() });
    return c.json({ ok: true });
  });

  // ---------- Mac → phone ----------
  /** The phone's notification listener reports what's playing, so the Mac menu bar can show it. */
  r.post('/phone/status', async (c) => {
    const b = z.object({ title: z.string().max(300).optional(), artist: z.string().max(300).optional(), app: z.string().max(80).optional(), playing: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'bad status' }, 400);
    Object.assign(phone, { title: b.data.title ?? '', artist: b.data.artist ?? '', app: b.data.app ?? '', playing: !!b.data.playing, at: Date.now() });
    return c.json({ ok: true });
  });
  r.get('/phone/status', async (c) => {
    const d = await db.query<{ name: string; battery_pct: number | null; charging: boolean | null; battery_at: Date | null }>(
      "select name, battery_pct, charging, battery_at from devices where kind = 'phone' order by last_seen desc limit 1");
    return c.json({ device: d[0] ?? null, media: phone.at && Date.now() - phone.at < 6 * 3_600_000 ? phone : null });
  });
  r.post('/phone/cmd', async (c) => {
    const b = z.object({ cmd: z.enum(PHONE_CMDS), url: z.string().url().max(2000).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: `cmd must be one of ${PHONE_CMDS.join(', ')}` }, 400);
    const r2 = await cmdToPhone(db, b.data.cmd, b.data.url ?? '');
    return c.json({ ok: true, sent: r2.sent });
  });
  /** Phone → Mac: clipboard text, a link to open, or a command. */
  r.post('/mac/send', async (c) => {
    const b = z.union([
      z.object({ type: z.literal('clip'), text: z.string().min(1).max(20_000) }),
      z.object({ type: z.literal('link'), url: z.string().url().max(4000), title: z.string().max(300).optional() }),
      z.object({ type: z.literal('cmd'), cmd: z.enum(MAC_CMDS), value: z.number().min(0).max(100).optional(), app: z.string().regex(/^[\w .&'+-]{1,60}$/).optional() }),
    ]).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'Invalid request' }, 400);
    pushToMac(b.data);
    return c.json({ ok: true, online: macOnline() });
  });
  /** Mac → phone clipboard / link. */
  r.post('/clip', async (c) => {
    const b = z.object({ text: z.string().min(1).max(20_000) }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'text required' }, 400);
    return c.json(await clipToPhone(db, b.data.text));
  });

  // ---------- read later ----------
  r.post('/saved', async (c) => {
    const b = z.object({ url: z.string().url().max(4000), title: z.string().max(300).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'url required' }, 400);
    return c.json({ ok: true, id: await addSaved(db, b.data.url, b.data.title) });
  });

  // ---------- YouTube ----------
  r.get('/yt', (c) => c.json(getYt()));
  r.post('/yt/channels', async (c) => {
    const b = z.object({ input: z.string().min(2).max(300) }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'Paste a channel link or @handle' }, 400);
    try { return c.json({ ok: true, channel: await addChannel(b.data.input) }); }
    catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  r.delete('/yt/channels/:id', (c) => { removeChannel(c.req.param('id')); return c.json({ ok: true }); });
  r.post('/yt/refresh', async (c) => { await refreshYt(); return c.json(getYt()); });
  r.get('/yt/pending', (c) => c.json({ videos: pendingTranscripts() }));
  /** Full written explanation of a video (POST asks for it, both return status / the Markdown). */
  const explain = async (c: any) => {
    const id = c.req.param('id');
    if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'bad id' }, 400);
    return c.json(await explainVideo(id));
  };
  r.post('/yt/:id/explain', explain);
  r.get('/yt/:id/explain', explain);

  r.post('/yt/transcript', async (c) => {
    const b = z.object({ id: z.string().regex(/^[\w-]{11}$/), text: z.string().max(400_000).nullable().optional(), description: z.string().max(20_000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'id and text required' }, 400);
    return c.json({ ok: await putTranscript(b.data.id, b.data.text ?? null, b.data.description) });
  });

  return r;
}
