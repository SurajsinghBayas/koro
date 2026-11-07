/**
 * Bridge to the Kotlin plugin (tauri-plugin-koro) on Android.
 * In a desktop browser (dev) every call falls back to a web API or a harmless no-op.
 */
export const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>('plugin:koro|call', { cmd, args });
}

async function tryCall<T>(cmd: string, args: Record<string, unknown> = {}, fallback: T): Promise<T> {
  if (!isNative) return fallback;
  try {
    return await call<T>(cmd, args);
  } catch (e) {
    console.warn(`[native] ${cmd} failed`, e);
    return fallback;
  }
}

export type Perms = { notifications: boolean; exactAlarm: boolean; dnd: boolean; usage: boolean; batteryUnrestricted: boolean; media: boolean; calendar?: boolean; location?: boolean };
export type PermKind = 'notifications' | 'exactAlarm' | 'dnd' | 'usage' | 'battery' | 'media';
export type CalEvent = { id: string; title: string; begin: number; end: number; allDay: boolean; location: string; color: string; calendar: string };
export type AppUse = { pkg: string; label: string; min: number };
export type Op = { kind: 'tasks' | 'habits' | 'grocery' | 'water'; id?: string; ml?: number; at: number };
export type NowPlaying = {
  access: boolean; active?: boolean; title?: string; artist?: string; album?: string; app?: string; package?: string;
  playing?: boolean; position?: number; duration?: number; canNext?: boolean; canPrev?: boolean; canSeek?: boolean; key?: string; art?: string;
};

const webTimers = new Map<string, number>();

export const native = {
  async battery(): Promise<{ pct: number; charging: boolean } | null> {
    if (isNative) return tryCall('battery', {}, null);
    try {
      const b = await (navigator as any).getBattery?.();
      return b ? { pct: Math.round(b.level * 100), charging: b.charging } : null;
    } catch { return null; }
  },

  vibrate(pattern: number | number[]) {
    if (isNative) void tryCall('vibrate', { pattern: Array.isArray(pattern) ? pattern : [pattern] }, null);
    else navigator.vibrate?.(pattern);
  },

  /** Exact alarm → notification, survives app close and reboot. */
  async scheduleReminder(r: { id: string; title: string; at: number; repeat?: string | null }) {
    if (isNative) return tryCall('reminderSchedule', { id: r.id, title: r.title, at: r.at, repeat: r.repeat ?? '' }, null);
    const prev = webTimers.get(r.id);
    if (prev) clearTimeout(prev);
    const ms = r.at - Date.now();
    if (ms > 0 && ms < 2 ** 31 - 1) webTimers.set(r.id, window.setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Koro', { body: r.title });
      else alert(`⏰ ${r.title}`);
    }, ms));
    return null;
  },
  async cancelReminder(id: string) {
    if (isNative) return tryCall('reminderCancel', { id }, null);
    const t = webTimers.get(id);
    if (t) clearTimeout(t);
    webTimers.delete(id);
    return null;
  },

  /** Focus: turns on Do Not Disturb (priority only) and schedules its end. */
  focusStart: (minutes: number) => tryCall<{ dnd: boolean }>('focusStart', { minutes }, { dnd: false }),
  focusStop: () => tryCall('focusStop', {}, null),
  /** Sleep timer: pauses whatever is playing (Spotify, YT Music…) after N minutes, with a short fade. */
  sleepStart: (minutes: number) => tryCall('sleepStart', { minutes }, null),
  sleepStop: () => tryCall('sleepStop', {}, null),

  permissions: () =>
    tryCall<Perms>('permissions', {}, { notifications: true, exactAlarm: true, dnd: false, usage: false, batteryUnrestricted: true, media: false }),
  openSettings: (kind: PermKind) => tryCall('openSettings', { kind }, null),
  async requestNotifications() {
    if (isNative) return tryCall('requestNotifications', {}, null);
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    return null;
  },

  /** Minutes used today per package (needs Usage access). */
  screenTime: (packages: string[]) => tryCall<Record<string, number>>('screenTime', { packages }, {}),

  /** Desk mode: keep screen on + landscape (native). */
  desk: (on: boolean) => tryCall('desk', { on }, null),

  /** What any app is playing (Spotify, YT Music…). Album art only when `artKey` differs from the current track. */
  media: (artKey?: string) => (isNative ? tryCall<NowPlaying | null>('media', { artKey: artKey ?? '' }, null) : Promise.resolve(mockMedia(artKey))),
  mediaControl: (action: 'toggle' | 'play' | 'pause' | 'next' | 'prev' | 'seek', pos = 0) => {
    if (!isNative) { if (action === 'toggle') __mockToggle(); else mockStart = Date.now(); return Promise.resolve(null); }
    return tryCall('mediaControl', { action, pos }, null);
  },

  /** Runtime permissions the app asks for itself (weather location, calendar). */
  requestPermission: (kind: 'location' | 'calendar') => tryCall<{ granted: boolean }>('requestPermission', { kind }, { granted: false }),

  async location(): Promise<{ granted: boolean; lat?: number; lon?: number }> {
    if (isNative) return tryCall('location', {}, { granted: false });
    return new Promise((res) => {
      if (!navigator.geolocation) return res({ granted: true, lat: 19.076, lon: 72.8777 }); // browser preview: Mumbai
      navigator.geolocation.getCurrentPosition((p) => res({ granted: true, lat: p.coords.latitude, lon: p.coords.longitude }),
        () => res({ granted: true, lat: 19.076, lon: 72.8777 }), { timeout: 6000, maximumAge: 1_800_000 });
    });
  },

  async calendar(days = 1): Promise<{ granted: boolean; events: CalEvent[] }> {
    if (isNative) return tryCall('calendar', { days }, { granted: false, events: [] });
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const at = (h: number, m = 0) => t.getTime() + (h * 60 + m) * 60_000;
    return { granted: true, events: [ // browser preview
      { id: 'a', title: 'Stand-up', begin: at(10), end: at(10, 15), allDay: false, location: 'Meet', color: '#4285F4', calendar: 'Work' },
      { id: 'b', title: 'Lunch with Riya', begin: at(13, 30), end: at(14, 30), allDay: false, location: 'Bandra', color: '#0B8043', calendar: 'Personal' },
      { id: 'c', title: 'Gym', begin: at(19), end: at(20), allDay: false, location: '', color: '#F4511E', calendar: 'Personal' },
    ] };
  },

  /** Lets the share sheet and widgets reach the server without the WebView. */
  setAuth: (server: string, token: string) => tryCall('setAuth', { server, token }, null),

  async clipboardRead(): Promise<string> {
    if (isNative) return (await tryCall<{ text: string }>('clipboardRead', {}, { text: '' })).text;
    try { return await navigator.clipboard.readText(); } catch { return ''; }
  },
  async clipboardWrite(text: string) {
    if (isNative) return tryCall('clipboardWrite', { text }, null);
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    return null;
  },

  widgetData: (data: unknown) => tryCall('widgetData', { data }, null),
  takeOps: async () => (await tryCall<{ ops: Op[] }>('takeOps', {}, { ops: [] })).ops,

  async screenTimeTop(limit = 6): Promise<{ granted: boolean; apps: AppUse[]; totalMin: number }> {
    if (isNative) return tryCall('screenTimeTop', { limit }, { granted: false, apps: [], totalMin: 0 });
    return { granted: true, totalMin: 214, apps: [
      { pkg: 'com.twitter.android', label: 'X', min: 48 }, { pkg: 'com.google.android.youtube', label: 'YouTube', min: 41 },
      { pkg: 'com.whatsapp', label: 'WhatsApp', min: 35 }, { pkg: 'com.instagram.android', label: 'Instagram', min: 27 },
      { pkg: 'com.spotify.music', label: 'Spotify', min: 22 }, { pkg: 'com.android.chrome', label: 'Chrome', min: 18 },
    ] };
  },

  /** Initialise Firebase with the server-provided config and return the FCM token. */
  pushInit: (cfg: { appId: string; apiKey: string; senderId: string; projectId: string }) =>
    tryCall<{ token: string | null }>('pushInit', cfg, { token: null }),
};

/** Browser preview only: localStorage.koroMockMedia = '1' shows a fake track so the card can be designed without a phone. */
let mockStart = Date.now();
let mockPlaying = true;
function mockMedia(artKey?: string): NowPlaying | null {
  try {
    if (/[?&]music\b/.test(location.search)) localStorage.setItem('koroMockMedia', '1');      // open with ?music to preview
    if (/[?&]nomusic\b/.test(location.search)) localStorage.removeItem('koroMockMedia');
    if (localStorage.getItem('koroMockMedia') !== '1') return null;
  } catch { return null; }
  const key = 'mock|Kesariya';
  const art = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset=".5" stop-color="#c2185b"/><stop offset="1" stop-color="#311b92"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="none" stroke="#ffd166" stroke-width="3"/></svg>')}`;
  return { access: true, active: true, title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra', app: 'Spotify', package: 'com.spotify.music',
    playing: mockPlaying, position: (Date.now() - mockStart) % 268_000, duration: 268_000, canNext: true, canPrev: true, key, ...(artKey === key ? {} : { art }) };
}
export function __mockToggle() { mockPlaying = !mockPlaying; mockStart = Date.now(); }
