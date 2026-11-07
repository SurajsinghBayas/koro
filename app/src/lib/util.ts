/** UUID v7 (time-ordered) so rows created on the phone sort naturally. */
export function uuid7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowIso = () => new Date().toISOString();

export const fmtTime = (d: Date | string | number) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

export function fmtWhen(d: Date | string | number) {
  const t = new Date(d);
  const today = dayKey();
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const k = dayKey(t);
  if (k === today) return fmtTime(t);
  if (k === tomorrow) return `Tomorrow ${fmtTime(t)}`;
  return `${t.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(t)}`;
}

export function ago(d: string | number | Date | null | undefined) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export const greeting = (h = new Date().getHours()) => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

/** Local wall clock string for the AI: "2026-11-08T14:05 Sunday". */
export const localNowLabel = (d = new Date()) =>
  `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())} ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Pixel dissolve between two states (Bayer 4×4 threshold, ~300 ms). Respects reduced motion. */
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export function dissolve(swap: () => void, color: string) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.power === 'save') return swap();
  const c = document.createElement('canvas');
  const C = 12, w = Math.ceil(innerWidth / C), h = Math.ceil(innerHeight / C);
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '999', pointerEvents: 'none', imageRendering: 'pixelated' });
  c.width = w; c.height = h;
  document.body.append(c);
  const ctx = c.getContext('2d')!;
  let i = 0, dir = 1;
  const steps = 8;
  const iv = setInterval(() => {
    i += dir;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (B4[(y & 3) * 4 + (x & 3)]! < i / steps) ctx.fillRect(x, y, 1, 1);
    if (i === steps) { swap(); dir = -1; }
    if (i === 0 && dir === -1) { clearInterval(iv); c.remove(); }
  }, 22);
}
