import { readFileSync } from 'node:fs';
import type { Db } from '../db.ts';
import { env } from '../env.ts';

/**
 * Firebase Cloud Messaging (HTTP v1). Data-only, high-priority messages: the phone's Kotlin service
 * renders them as ONE notification per match that updates in place. Every alert is also written to
 * the `inbox` table so the app shows it even when push isn't configured.
 */
type ServiceAccount = { client_email: string; private_key: string; project_id: string };
let sa: ServiceAccount | null | undefined;
let cachedToken: { value: string; exp: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  if (sa !== undefined) return sa;
  const raw = env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    sa = raw ? JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8')) : null;
  } catch (e) {
    console.warn('[push] invalid FCM_SERVICE_ACCOUNT_JSON:', (e as Error).message);
    sa = null;
  }
  return sa ?? null;
}
export const pushEnabled = () => Boolean(serviceAccount());

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const acc = serviceAccount()!;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const der = Buffer.from(acc.private_key.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type Alert = { kind: 'match' | 'system' | 'x'; title: string; body: string; tag?: string; buzz?: boolean; data?: Record<string, string> };

export async function notify(db: Db, alert: Alert) {
  await db.query('insert into inbox (kind, title, body, data) values ($1,$2,$3,$4)', [
    alert.kind, alert.title, alert.body, JSON.stringify({ tag: alert.tag, buzz: !!alert.buzz, ...alert.data }),
  ]);
  if (!pushEnabled()) {
    console.log(`[push] (inbox only) ${alert.title} — ${alert.body}`);
    return { sent: 0 };
  }
  const devices = await db.query<{ id: string; push_token: string }>(
    "select id, push_token from devices where push_token is not null and kind = 'phone'",
  );
  let sent = 0;
  for (const d of devices) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount()!.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.push_token,
            data: { kind: alert.kind, title: alert.title, body: alert.body, tag: alert.tag ?? alert.kind, buzz: alert.buzz ? '1' : '0', ...alert.data },
            android: { priority: 'HIGH', ttl: '900s' },
          },
        }),
      });
      if (res.ok) sent++;
      else {
        const txt = await res.text();
        if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) {
          await db.query('update devices set push_token = null where id = $1', [d.id]);
        }
        console.warn(`[push] FCM ${res.status}: ${txt.slice(0, 200)}`);
      }
    } catch (e) {
      console.warn('[push] send failed:', (e as Error).message);
    }
  }
  return { sent };
}
