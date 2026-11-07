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

export type Perms = { notifications: boolean; exactAlarm: boolean; dnd: boolean; usage: boolean; batteryUnrestricted: boolean };
export type PermKind = 'notifications' | 'exactAlarm' | 'dnd' | 'usage' | 'battery';

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
    tryCall<Perms>('permissions', {}, { notifications: true, exactAlarm: true, dnd: false, usage: false, batteryUnrestricted: true }),
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

  /** Initialise Firebase with the server-provided config and return the FCM token. */
  pushInit: (cfg: { appId: string; apiKey: string; senderId: string; projectId: string }) =>
    tryCall<{ token: string | null }>('pushInit', cfg, { token: null }),
};
