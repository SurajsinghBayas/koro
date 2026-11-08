import type { Db } from '../db.ts';
import { notify } from './push.ts';

/**
 * Phone ⇄ Mac relay. The Mac agent long-polls GET /v1/mac/events; the phone posts clipboard text, links and
 * remote commands (lock, sleep, media, volume). Mac → phone goes out as a push (clipboard / link).
 * Kept in memory on purpose: commands expire after a minute (never lock the Mac hours later).
 */
export type MacEvent =
  | { seq: number; at: number; type: 'clip'; text: string }
  | { seq: number; at: number; type: 'link'; url: string; title?: string }
  | { seq: number; at: number; type: 'cmd'; cmd: MacCmd; value?: number; app?: string };
export const MAC_CMDS = ['lock', 'sleep', 'toggle', 'next', 'prev', 'volume', 'volup', 'voldown', 'mute', 'battery',
  'brightness', 'brightup', 'brightdown', 'displayoff', 'awake', 'ring', 'openapp', 'workmode'] as const;
export type MacCmd = (typeof MAC_CMDS)[number];
type NewEvent = { type: 'clip'; text: string } | { type: 'link'; url: string; title?: string } | { type: 'cmd'; cmd: MacCmd; value?: number; app?: string };

let seq = Date.now(); // survives restarts monotonically (agent keeps its last seq)
let events: MacEvent[] = [];
const waiters = new Set<(e: MacEvent[]) => void>();
const TTL = { clip: 10 * 60_000, link: 10 * 60_000, cmd: 60_000 };

export const status = { lastPoll: 0, volume: null as number | null, muted: null as boolean | null, brightness: null as number | null, awake: false, at: 0 };

/** What's playing on the Mac (the agent reports changes + a heartbeat every minute). */
export const macMedia = { title: '', artist: '', app: '', url: '', playing: false, at: 0 };
export function macMediaNow() {
  return macMedia.title && Date.now() - macMedia.at < 3 * 60_000 && macOnline() ? { ...macMedia } : null;
}

function prune(now = Date.now()) { events = events.filter((e) => now - e.at < TTL[e.type]).slice(-50); }

export function pushToMac(ev: NewEvent) {
  prune();
  const e = { ...ev, seq: ++seq, at: Date.now() } as MacEvent;
  events.push(e);
  for (const w of waiters) w([e]);
  waiters.clear();
  return e.seq;
}

/** Long-poll: resolves with events after `since`, or [] after `waitMs`. */
export function nextEvents(since: number, waitMs = 25_000): Promise<MacEvent[]> {
  status.lastPoll = Date.now();
  prune();
  // First poll after an agent restart (since = 0): don't replay old events, just hand back the current seq.
  if (since === 0) return Promise.resolve([]);
  const pending = events.filter((e) => e.seq > since);
  if (pending.length) return Promise.resolve(pending);
  return new Promise((resolve) => {
    const done = (e: MacEvent[]) => { clearTimeout(t); waiters.delete(done); resolve(e); };
    const t = setTimeout(() => done([]), waitMs);
    waiters.add(done);
  });
}
export const currentSeq = () => seq;
export const macOnline = () => Date.now() - status.lastPoll < 45_000;

/** Mac clipboard → phone (push: the phone copies it and shows a quiet notification; links open on tap). */
export async function clipToPhone(db: Db, text: string) {
  const t = text.trim();
  const url = /^https?:\/\/\S+$/i.test(t) ? t : '';
  return notify(db, {
    kind: 'clip' as any, title: url ? 'Link from your Mac' : 'Copied from your Mac', body: t.slice(0, 160), tag: 'clip',
    data: { text: t.slice(0, 2500), url }, // FCM data is capped at 4 KB
  }, { inbox: false });
}

// ---------- Mac → phone (menu bar remote) ----------
export const PHONE_CMDS = ['toggle', 'next', 'prev', 'volup', 'voldown', 'ring', 'link'] as const;
export type PhoneCmd = (typeof PHONE_CMDS)[number];
/** What the phone last reported (media session changes are posted by its notification listener). */
export const phone = { title: '', artist: '', app: '', playing: false, at: 0 };

export function cmdToPhone(db: Db, cmd: PhoneCmd, url = '') {
  return notify(db, { kind: 'cmd' as any, title: '', body: '', tag: `cmd-${cmd}`, data: { cmd, url } }, { inbox: false });
}
