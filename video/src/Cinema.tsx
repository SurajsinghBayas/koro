/**
 * KoroCinema: the cinematic cut of the reel. 9:16, laid out on a 1080×1920 stage (rendered at 1440×2560).
 *
 * Same beat map as the reel (the drop lands on 11.5 s), so "White Keys" goes on in Edits from 0:34.78.
 * Everything is real screen footage, staged in CSS 3D: a phone with real thickness, a MacBook with a hinged lid,
 * a moving camera with noise shake, macro "lens" shots across the live UI, rack focus, light leaks,
 * camera motion blur on the whip pans, kinetic type and a film grade.
 *
 * Footage: public/cine → video/rec (raw takes: Mac at 2940×1912, phone at 1080×2340). Kept out of git.
 */
import { CameraMotionBlur } from '@remotion/motion-blur';
import { LightLeak } from '@remotion/light-leaks';
import { noise2D } from '@remotion/noise';
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, random, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BODY, DISPLAY, GOLD, SKY, VIOLET } from './Film';

const { fontFamily: SERIF } = loadSerif('italic', { weights: ['400'], subsets: ['latin'] });

export const CINE_FPS = 30;
const s = (sec: number) => Math.round(sec * CINE_FPS);
export const CINE_DURATION = s(27.5);
const RED = '#FF6B7A', MINT = '#7EE0A1';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.45, 0, 0.15, 1); // a camera operator's ease: slow start, long settle
const outCubic = Easing.out(Easing.cubic);
const inCubic = Easing.in(Easing.cubic);

/** Keyframes → value at frame f. keys: [frame, value][] */
const kf = (f: number, keys: [number, number][], easing = ease) =>
  interpolate(f, keys.map((k) => k[0]), keys.map((k) => k[1]), { ...clamp, easing });

const src = (name: string) => staticFile(`cine/${name}.mp4`);

// ------------------------------------------------------------------------------------------------ footage geometry
const PH_W = 1080, PH_H = 2340, BAR = 110; // phone; the status bar is cropped so no real clock or notifications show
const MAC_W = 2940, MAC_H = 1912;

type Vid = { name: string; from?: number; rate?: number };
const Footage = ({ v, style }: { v: Vid; style?: CSSProperties }) => (
  <OffthreadVideo src={src(v.name)} startFrom={s(v.from ?? 0)} playbackRate={v.rate ?? 1} muted style={style} />
);

// ------------------------------------------------------------------------------------------------ camera
/** A perspective "lens". Children live in a 3D world whose origin is the frame centre. */
const Camera = ({ children, rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0, fov = 1600, shake = 0 }: {
  children: ReactNode; rx?: number; ry?: number; rz?: number; x?: number; y?: number; z?: number; fov?: number; shake?: number;
}) => {
  const f = useCurrentFrame();
  const sx = noise2D('cx', f * 0.11, 0) * shake, sy = noise2D('cy', 0, f * 0.11) * shake, sr = noise2D('cr', f * 0.07, 3) * shake * 0.04;
  return (
    <AbsoluteFill style={{ perspective: fov, perspectiveOrigin: '50% 50%', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 540, top: 960, width: 0, height: 0, transformStyle: 'preserve-3d',
        transform: `translate3d(${sx}px, ${sy}px, ${z}px) rotateZ(${rz + sr}deg) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${x}px, ${y}px, 0)` }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Place something in the world (centred on its own box). */
const Obj = ({ children, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, w, h, blur = 0, style }: {
  children: ReactNode; x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; w: number; h: number; blur?: number; style?: CSSProperties;
}) => (
  <div style={{ position: 'absolute', width: w, height: h, left: -w / 2, top: -h / 2, transformStyle: blur > 0.3 ? 'flat' : 'preserve-3d',
    filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
    transform: `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)`, ...style }}>
    {children}
  </div>
);

// ------------------------------------------------------------------------------------------------ 3D phone
/** A phone with real thickness: stacked rounded slices make the frame, a glass front carries the screen. */
const Phone3D = ({ v, h, children, glint = 0.5, power = 1 }: { v?: Vid; h: number; children?: ReactNode; glint?: number; power?: number }) => {
  const f = useCurrentFrame();
  const sh = h, sw = sh * (PH_W / (PH_H - BAR)), k = sw / PH_W;
  const B = 13, W = sw + B * 2, H = sh + B * 2, D = 26, R = 58;
  const slices = 10;
  const band = ((f * 1.6) % 260) - 80; // a glint band drifting across the glass
  return (
    <div style={{ width: W, height: H, position: 'relative', transformStyle: 'preserve-3d' }}>
      {/* the frame: titanium slices */}
      {Array.from({ length: slices }, (_, i) => {
        const t = i / (slices - 1);
        return <div key={i} style={{ position: 'absolute', inset: 0, borderRadius: R, transform: `translateZ(${-D / 2 + t * D}px)`,
          background: `linear-gradient(${120 + t * 30}deg, #3a4150, #9aa3b5 ${30 + t * 20}%, #2a303b 60%, #c7ccd6 85%, #3a4150)`,
          boxShadow: i === 0 ? '0 50px 120px rgba(0,0,0,.85)' : undefined }} />;
      })}
      {/* back glass */}
      <div style={{ position: 'absolute', inset: 2, borderRadius: R - 2, transform: `translateZ(${-D / 2 - 0.5}px) rotateY(180deg)`,
        background: 'linear-gradient(150deg,#1d2433,#0a0d14 60%,#1a2030)' }} />
      {/* front: black glass with the screen */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: R, transform: `translateZ(${D / 2 + 0.5}px)`, background: '#05070b', padding: B,
        boxShadow: `inset 0 0 0 2px rgba(255,255,255,.10), 0 0 60px ${GOLD}18` }}>
        <div style={{ width: sw, height: sh, borderRadius: R - B, overflow: 'hidden', position: 'relative', background: '#000' }}>
          {v && <Footage v={v} style={{ position: 'absolute', left: 0, top: -BAR * k, width: sw, height: PH_H * k }} />}
          {children && <div style={{ position: 'absolute', left: 0, top: -BAR * k, width: PH_W, height: PH_H, transform: `scale(${k})`, transformOrigin: '0 0' }}>{children}</div>}
          {power < 1 && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 1 - power }} />}
          {/* glass reflections */}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, transparent ${band}%, rgba(255,255,255,${0.16 * glint}) ${band + 8}%, transparent ${band + 22}%)` }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(255,255,255,.07), transparent 35%)' }} />
        </div>
      </div>
    </div>
  );
};
const phoneSize = (h: number) => {
  const sw = h * (PH_W / (PH_H - BAR));
  return { w: sw + 26, h: h + 26, k: sw / PH_W };
};

// ------------------------------------------------------------------------------------------------ 3D MacBook
/** MacBook Air: a hinged lid (screen + aluminium back) over a keyboard deck. Origin = centre of the hinge. */
const Mac3D = ({ v, w, lean = 12, children, power = 1 }: { v?: Vid; w: number; lean?: number; children?: ReactNode; power?: number }) => {
  const h = w * (MAC_H / MAC_W), bz = w * 0.022, LW = w + bz * 2, LH = h + bz * 2.4, deck = LW * 0.68;
  const k = w / MAC_W;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformStyle: 'preserve-3d' }}>
      {/* deck (lies flat, toward the viewer) */}
      <div style={{ position: 'absolute', left: -LW * 0.52, top: 0, width: LW * 1.04, height: deck, transformOrigin: '50% 0', transform: 'rotateX(90deg)',
        borderRadius: '6px 6px 30px 30px', background: 'linear-gradient(180deg,#262b35,#3a404c 40%,#1f232b)', boxShadow: '0 0 0 1px rgba(255,255,255,.08)' }}>
        <div style={{ position: 'absolute', left: '7%', right: '7%', top: '6%', height: '48%', borderRadius: 10, background: '#0e1014',
          backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px)',
          backgroundSize: `${LW / 15}px ${deck / 9}px` }} />
        <div style={{ position: 'absolute', left: '33%', right: '33%', top: '60%', height: '32%', borderRadius: 12, background: 'linear-gradient(180deg,#363c48,#2c313b)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }} />
      </div>
      {/* lid */}
      <div style={{ position: 'absolute', left: -LW / 2, top: -LH, width: LW, height: LH, transformOrigin: '50% 100%', transform: `rotateX(${lean}deg)`, transformStyle: 'preserve-3d' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '22px 22px 6px 6px', transform: 'translateZ(-3px) rotateY(180deg)',
          background: 'linear-gradient(160deg,#3a404c,#1f232b 60%,#323844)' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '22px 22px 6px 6px', background: '#07080b', padding: `${bz}px ${bz}px ${bz * 1.4}px`,
          boxShadow: '0 0 0 2px #2b2f37, 0 40px 120px rgba(0,0,0,.7)' }}>
          <div style={{ width: w, height: h, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#000' }}>
            {v && <Footage v={v} style={{ width: '100%', height: '100%' }} />}
            {children && <div style={{ position: 'absolute', left: 0, top: 0, width: MAC_W, height: MAC_H, transform: `scale(${k})`, transformOrigin: '0 0' }}>{children}</div>}
            {power < 1 && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 1 - power }} />}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg, rgba(255,255,255,.10), transparent 30%)' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ macro lens
/**
 * A macro shot: the footage is a plane in 3D, the camera sits a few cm above it and drifts.
 * `path` gives the point of interest (in footage px) and the zoom over time; tilt-shift bands blur the edges.
 */
type Lens = { t: number; cx: number; cy: number; z: number };
const Macro = ({ v, srcW, srcH, path, tilt = 16, roll = -4, children, dof = 14, bg = '#000' }: {
  v: Vid; srcW: number; srcH: number; path: Lens[]; tilt?: number; roll?: number; children?: ReactNode; dof?: number; bg?: string;
}) => {
  const f = useCurrentFrame();
  const at = (key: 'cx' | 'cy' | 'z') => kf(f, path.map((p) => [p.t, p[key]]));
  const z = at('z'), base = 1080 / srcW, k = base * z;
  return (
    <AbsoluteFill style={{ background: bg, perspective: 1300, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `rotateX(${tilt}deg) rotateZ(${roll}deg) scale(1.18)`, transformOrigin: '50% 55%' }}>
        <div style={{ position: 'absolute', width: srcW, height: srcH, left: 540 - at('cx') * k, top: 960 - at('cy') * k, transform: `scale(${k})`, transformOrigin: '0 0' }}>
          <Footage v={v} style={{ width: srcW, height: srcH }} />
          {children}
        </div>
      </AbsoluteFill>
      {/* tilt-shift: a sharp band through the middle, the near and far edges fall out of focus */}
      <AbsoluteFill style={{ backdropFilter: `blur(${dof}px)`, WebkitBackdropFilter: `blur(${dof}px)`,
        WebkitMaskImage: 'linear-gradient(180deg, #000 0%, transparent 30%, transparent 64%, #000 100%)', maskImage: 'linear-gradient(180deg, #000 0%, transparent 30%, transparent 64%, #000 100%)' }} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------ atmosphere
const Atmos = ({ tint = GOLD, tint2 = SKY, power = 1 }: { tint?: string; tint2?: string; power?: number }) => {
  const f = useCurrentFrame();
  const blob = (c: string, x: number, y: number, r: number, k: number): CSSProperties => ({
    position: 'absolute', width: r, height: r, borderRadius: '50%', background: c, filter: 'blur(150px)', opacity: 0.3 * power,
    left: x + noise2D(`bx${k}`, f * 0.006, 0) * 160, top: y + noise2D(`by${k}`, 0, f * 0.006) * 200,
  });
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, #0d1220 0%, #04050a 55%, #000 100%)', overflow: 'hidden' }}>
      <div style={blob(tint, -260, -120, 900, 1)} />
      <div style={blob(tint2, 420, 1100, 860, 2)} />
      <div style={blob(VIOLET, -300, 1500, 620, 3)} />
    </AbsoluteFill>
  );
};

/** Floating dust in the light: tiny bokeh specks at three depths. */
const Dust = ({ n = 40, seed = 'd', color = '#fff' }: { n?: number; seed?: string; color?: string }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const d = random(`${seed}d${i}`), x = random(`${seed}x${i}`) * 1080, y = random(`${seed}y${i}`) * 1920;
        const size = 2 + d * 9, sp = 0.2 + d * 0.9;
        return <div key={i} style={{ position: 'absolute', left: (x + f * sp * 0.6) % 1100 - 10, top: (y - f * sp + 2000) % 1960 - 20, width: size, height: size,
          borderRadius: '50%', background: color, opacity: 0.08 + d * 0.3, filter: `blur(${(1 - d) * 3 + (d > 0.8 ? 2 : 0)}px)` }} />;
      })}
    </AbsoluteFill>
  );
};

/** The grade, over everything: halation-ish glow, vignette, grain. */
const Grade = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,.62) 100%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 22%, transparent 78%, rgba(0,0,0,.45) 100%)' }} />
      <svg width="1080" height="1920" style={{ position: 'absolute', opacity: 0.11, mixBlendMode: 'overlay' }}>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.floor(f / 2) % 50} /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** A white flash for hits; `at` is a local frame. */
const Flash = ({ at, peak = 0.9, len = 9, color = '#fff' }: { at: number; peak?: number; len?: number; color?: string }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + len], [peak, 0], { ...clamp, easing: Easing.out(Easing.quad) });
  if (f < at) return null;
  return o > 0.001 ? <AbsoluteFill style={{ background: color, opacity: o, mixBlendMode: 'screen' }} /> : null;
};

const Leak = ({ from = 0, dur = 30, seed = 1, hue = 0, opacity = 0.6 }: { from?: number; dur?: number; seed?: number; hue?: number; opacity?: number }) => (
  <Sequence from={from} durationInFrames={dur} layout="none">
    <AbsoluteFill style={{ mixBlendMode: 'screen', opacity }}><LightLeak durationInFrames={dur} seed={seed} hueShift={hue} /></AbsoluteFill>
  </Sequence>
);

// ------------------------------------------------------------------------------------------------ type
/**
 * Kinetic type. Words slide up out of a mask with a spring, one after another.
 * `*word*` is set in the serif italic, in the accent colour.
 */
const Words = ({ text, at = 0, gap = 3, size = 120, accent = GOLD, align = 'center', style, out }: {
  text: string; at?: number; gap?: number; size?: number; accent?: string; align?: 'center' | 'left'; style?: CSSProperties; out?: number;
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = text.split('\n');
  let idx = 0;
  const fade = out === undefined ? 1 : interpolate(f, [out, out + 6], [1, 0], clamp);
  const blurOut = out === undefined ? 0 : interpolate(f, [out, out + 6], [0, 14], clamp);
  return (
    <div style={{ textAlign: align, opacity: fade, filter: blurOut ? `blur(${blurOut}px)` : undefined, ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start', flexWrap: 'wrap', columnGap: size * 0.24 }}>
          {line.split(' ').map((w, wi) => {
            const i = idx++;
            const serif = w.startsWith('*');
            const word = w.replace(/\*/g, '');
            const k = spring({ frame: f - at - i * gap, fps, config: { damping: 15, stiffness: 140, mass: 0.7 } });
            return (
              <div key={wi} style={{ overflow: 'hidden', paddingBottom: size * 0.16, marginBottom: -size * 0.16 }}>
                <div style={{ transform: `translateY(${(1 - k) * 110}%) rotate(${(1 - k) * 6}deg)`, transformOrigin: '0 100%',
                  fontFamily: serif ? SERIF : DISPLAY, fontStyle: serif ? 'italic' : 'normal', fontWeight: serif ? 400 : 700,
                  fontSize: serif ? size * 1.12 : size, letterSpacing: serif ? '-0.01em' : '-0.045em', lineHeight: 1, color: serif ? accent : '#fff',
                  textShadow: '0 6px 40px rgba(0,0,0,.55)' }}>{word}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Small tracked caption with a rule, e.g. "— ONE TAP". */
const Caption = ({ text, at = 0, color = GOLD, out }: { text: string; at?: number; color?: string; out?: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 10], [0, 1], { ...clamp, easing: outCubic }) * (out === undefined ? 1 : interpolate(f, [out, out + 6], [1, 0], clamp));
  const w = interpolate(f, [at, at + 14], [0, 46], { ...clamp, easing: outCubic });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, opacity: o }}>
      <span style={{ width: w, height: 3, borderRadius: 2, background: color, boxShadow: `0 0 16px ${color}` }} />
      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, letterSpacing: '0.3em', color, textTransform: 'uppercase',
        transform: `translateX(${(1 - o) * 20}px)` }}>{text}</span>
    </div>
  );
};

const Top = ({ children, y = 250 }: { children: ReactNode; y?: number }) => (
  <>
    <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.5) ${y + 260}px, transparent ${y + 460}px)` }} />
    <AbsoluteFill style={{ alignItems: 'center', padding: `${y}px 70px 0` }}>{children}</AbsoluteFill>
  </>
);

/** A finger tap ripple at (x, y) in the parent's coordinates. */
const Tap = ({ x, y, at, r = 40 }: { x: number; y: number; at: number; r?: number }) => {
  const f = useCurrentFrame() - at;
  if (f < -6 || f > 22) return null;
  const press = interpolate(f, [-6, 0, 8], [0, 1, 0.9], clamp), ring = interpolate(f, [0, 20], [0, 1], { ...clamp, easing: outCubic });
  return (
    <>
      <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', background: 'rgba(255,255,255,.55)',
        opacity: press * interpolate(f, [8, 18], [1, 0], clamp), transform: `scale(${0.6 + press * 0.4})` }} />
      <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `${r / 12}px solid #fff`,
        opacity: (1 - ring) * (f >= 0 ? 1 : 0), transform: `scale(${1 + ring * 1.8})` }} />
    </>
  );
};

// ------------------------------------------------------------------------------------------------ transitions
/**
 * Wraps a shot and moves the whole frame in/out at its edges.
 * whip = a fast lateral pan (motion-blurred by the CameraMotionBlur around the cut); punch = a zoom hit; push = fly into the screen.
 */
type Fx = 'none' | 'whipL' | 'whipR' | 'punch' | 'push' | 'drift';
const Shot = ({ len, fin = 'none', fout = 'none', children }: { len: number; fin?: Fx; fout?: Fx; children: ReactNode }) => {
  const f = useCurrentFrame();
  const W = 5;
  let tx = 0, sc = 1, bright = 1, rot = 0;
  // in
  const ti = interpolate(f, [0, W], [1, 0], { ...clamp, easing: outCubic });
  if (fin === 'whipL') { tx += ti * 620; rot += ti * 2; }
  if (fin === 'whipR') { tx -= ti * 620; rot -= ti * 2; }
  if (fin === 'punch') { sc *= 1 + interpolate(f, [0, 7], [0.22, 0], { ...clamp, easing: outCubic }); }
  if (fin === 'push') { sc *= 1 + interpolate(f, [0, 9], [0.45, 0], { ...clamp, easing: outCubic }); bright += interpolate(f, [0, 6], [0.8, 0], clamp); }
  // out
  const to = interpolate(f, [len - W, len], [0, 1], { ...clamp, easing: inCubic });
  if (fout === 'whipL') { tx -= to * 620; rot -= to * 2; }
  if (fout === 'whipR') { tx += to * 620; rot += to * 2; }
  if (fout === 'punch') { sc *= 1 + interpolate(f, [len - 4, len], [0, 0.12], { ...clamp, easing: inCubic }); bright += interpolate(f, [len - 3, len], [0, 0.6], clamp); }
  if (fout === 'push') { sc *= 1 + interpolate(f, [len - 8, len], [0, 1.6], { ...clamp, easing: inCubic }); bright += interpolate(f, [len - 4, len], [0, 1.2], clamp); }
  return (
    <AbsoluteFill style={{ transform: `translateX(${tx}px) scale(${sc}) rotate(${rot}deg)`, filter: bright !== 1 ? `brightness(${bright})` : undefined, background: '#000' }}>
      {children}
    </AbsoluteFill>
  );
};

// ================================================================================================ SHOTS
// Beat map (timeline seconds, after the song is slipped to 0:34.78): … 0.52 1.28 1.98 2.72 3.46 4.18 4.92 5.68 6.38 7.12 7.84
// 8.54 9.30 10.06 10.76 | 11.50 DROP | 12.24 13.00 13.70 14.42 15.16 15.88 16.62 17.38 18.08 18.84 19.54 20.28 21.00 21.76 22.48 23.24 23.94 24.68 …
const T = { open: 0, sleep: 2.72, workA: 5.68, workB: 7.12, clip: 8.54, build: 10.06, drop: 11.5,
  m: [13.0, 14.42, 15.88, 17.38, 18.84, 20.28, 21.76, 23.24], end: 24.68 };
const L = (a: number, b: number) => s(b) - s(a);

/** 1 · Cold open. Darkness, a light sweep finds the phone's edge, the screen wakes on the first beat. */
const Open = () => {
  const f = useCurrentFrame(), len = L(T.open, T.sleep);
  const P = phoneSize(1260);
  const power = kf(f, [[s(0.5), 0], [s(0.68), 1]], outCubic);
  const rim = kf(f, [[0, -40], [s(1.4), 140]], Easing.inOut(Easing.quad));
  return (
    <AbsoluteFill>
      <Atmos tint={SKY} tint2={VIOLET} power={kf(f, [[0, 0], [s(0.7), 1]])} />
      <Camera rx={kf(f, [[0, 46], [len, 30]])} rz={kf(f, [[0, -24], [len, -12]])} ry={kf(f, [[0, 10], [len, -6]])} z={kf(f, [[0, -620], [len, -120]])} y={80} shake={3}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's1_sleep.phone', from: 1.8 }} h={1260} power={power} glint={1} /></Obj>
      </Camera>
      {/* the light sweep across the frame edge */}
      <AbsoluteFill style={{ background: `linear-gradient(118deg, transparent ${rim - 12}%, rgba(255,240,210,.22) ${rim}%, transparent ${rim + 12}%)`, mixBlendMode: 'screen' }} />
      <Dust n={36} seed="open" />
      <Top y={230}><Words text={"Apple won't\ndo this."} at={s(0.52)} gap={s(0.38)} size={132} /></Top>
    </AbsoluteFill>
  );
};

/** 2 · "So I built it." The Mac in the back, the phone close to the lens; focus racks between them as the Mac sleeps and wakes. */
const Sleep = () => {
  const f = useCurrentFrame(), len = L(T.sleep, T.workA);
  const P = phoneSize(860), k = P.k;
  // focus: phone (0) ↔ mac (1)
  const focus = kf(f, [[s(0.45), 0], [s(0.8), 1], [s(1.85), 1], [s(2.05), 0], [s(2.35), 0], [s(2.6), 1]]);
  const macPower = kf(f, [[s(0.85), 1], [s(0.95), 0], [s(2.25), 0], [s(2.4), 1]], Easing.linear);
  return (
    <AbsoluteFill>
      <Atmos tint={GOLD} tint2={SKY} />
      <Camera rx={kf(f, [[0, 14], [len, 6]])} ry={kf(f, [[0, -30], [len, -14]])} z={kf(f, [[0, -380], [len, -120]])} shake={4}>
        <Obj w={0} h={0} x={-60} y={150} z={-300} blur={focus < 0.5 ? (1 - focus * 2) * 9 : 0}>
          <Mac3D v={{ name: 's1_sleep.mac', from: 0.5 }} w={980} lean={14} power={macPower} />
        </Obj>
        <Obj w={P.w} h={P.h} x={260} y={420} z={400} rx={22} ry={-26} rz={6} blur={focus * 10}>
          <Phone3D v={{ name: 's1_sleep.phone', from: 3.2 }} h={860}>
            <Tap x={540} y={904} at={s(0.75)} r={70} /><Tap x={540} y={904} at={s(2.2)} r={70} />
          </Phone3D>
        </Obj>
      </Camera>
      <Dust n={28} seed="sleep" color={GOLD} />
      <Top y={230}>
        <Words text={'So I *built* *it.*'} at={0} gap={3} size={128} />
        <div style={{ height: 34 }} />
        <Caption text="one tap · mac sleeps" at={s(0.9)} color={SKY} />
      </Top>
      <Flash at={0} peak={0.35} len={8} />
    </AbsoluteFill>
  );
};

/** 3a · Macro on the phone: the lens glides over the Mac panel and lands on Work mode as it's tapped. */
const WorkA = () => {
  const f = useCurrentFrame(), len = L(T.workA, T.workB);
  return (
    <AbsoluteFill>
      <Macro v={{ name: 's1_sleep.phone', from: 0.2 }} srcW={PH_W} srcH={PH_H} tilt={20} roll={-6} dof={16}
        path={[{ t: 0, cx: 520, cy: 760, z: 1.9 }, { t: s(0.6), cx: 560, cy: 1180, z: 2.3 }, { t: len, cx: 560, cy: 1330, z: 2.75 }]}>
        <Tap x={540} y={1312} at={s(0.7)} r={60} />
      </Macro>
      <Top y={260}><Words text={'*work* mode'} at={s(0.1)} gap={4} size={140} accent={GOLD} /></Top>
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 380 }}>
        <Caption text="one tap" at={s(0.7)} color={GOLD} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 3b · …and on the Mac, the apps open. The windows are softened (real inboxes), the app names fly out at the lens. */
const WorkB = () => {
  const f = useCurrentFrame(), len = L(T.workB, T.clip);
  const { fps } = useVideoConfig();
  const apps: [string, number, number, string][] = [['WhatsApp', -300, 0.05, MINT], ['Terminal', 0, 0.3, '#fff'], ['Gmail', 290, 0.55, RED]];
  return (
    <AbsoluteFill>
      <Atmos tint={GOLD} tint2={VIOLET} />
      <Camera rx={kf(f, [[0, 6], [len, 2]])} ry={kf(f, [[0, 26], [len, 12]])} z={kf(f, [[0, -200], [len, 140]])} shake={3}>
        <Obj w={0} h={0} y={260}>
          <Mac3D v={{ name: 's2_work.mac', from: 0.9 }} w={1000} lean={10}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 70, bottom: 0, backdropFilter: 'blur(22px)', background: 'rgba(12,14,20,.35)' }} />
          </Mac3D>
        </Obj>
        {apps.map(([name, x, t, c]) => {
          const k = spring({ frame: f - s(t), fps, config: { damping: 14, stiffness: 120 } });
          return (
            <Obj key={name} w={420} h={110} x={x} y={-80 - k * 60} z={-60 + k * 420}>
              <div style={{ width: 420, height: 110, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, opacity: Math.min(1, k * 1.5),
                background: 'rgba(16,18,26,.78)', border: `2px solid ${c}66`, boxShadow: `0 20px 60px rgba(0,0,0,.6), 0 0 40px ${c}33`,
                fontFamily: DISPLAY, fontWeight: 700, fontSize: 46, color: '#fff' }}>
                <span style={{ width: 16, height: 16, borderRadius: 8, background: c, boxShadow: `0 0 18px ${c}` }} />{name}
              </div>
            </Obj>
          );
        })}
      </Camera>
      <Top y={250}><Caption text="opens everything I work in" at={2} color={GOLD} /></Top>
    </AbsoluteFill>
  );
};

/** 4 · Clipboard: ⌘C on the Mac, the image lifts off the screen, arcs through the air and lands on the phone. */
const Clip = () => {
  const f = useCurrentFrame(), len = L(T.clip, T.build);
  const { fps } = useVideoConfig();
  const P = phoneSize(900);
  const fly = kf(f, [[s(0.5), 0], [s(1.15), 1]], Easing.inOut(Easing.cubic));
  const keyK = spring({ frame: f - 1, fps, config: { damping: 9, stiffness: 200 } });
  const keyOut = interpolate(f, [s(0.55), s(0.7)], [1, 0], clamp);
  const note = spring({ frame: f - s(1.1), fps, config: { damping: 15 } });
  const focus = kf(f, [[s(0.7), 0], [s(1.1), 1]]); // mac → phone
  // card path: from the Mac screen (back left) to the phone (front right), arcing toward the lens
  const cx = interpolate(fly, [0, 1], [-170, 200]), cy = interpolate(fly, [0, 0.5, 1], [-330, -520, 80]), cz = interpolate(fly, [0, 0.5, 1], [-300, 520, 390]);
  return (
    <AbsoluteFill>
      <Atmos tint={SKY} tint2={VIOLET} />
      <Camera rx={kf(f, [[0, 10], [len, 4]])} ry={kf(f, [[0, -16], [len, 14]])} z={kf(f, [[0, -320], [len, -160]])} shake={3}>
        <Obj w={0} h={0} x={-170} y={0} z={-300} blur={focus * 8}>
          <Mac3D v={{ name: 's3_clip.mac', from: 1.2 }} w={1000} lean={12} />
        </Obj>
        <Obj w={P.w} h={P.h} x={200} y={300} z={300} rx={16} ry={-22} rz={5} blur={(1 - focus) * 9}>
          <Phone3D v={{ name: 's6_today.phone', from: 0.2, rate: 0.25 }} h={900}>
            {/* Android's quiet "copied" notification, drawn as the phone shows it */}
            <div style={{ position: 'absolute', left: 30, right: 30, top: BAR + 40, padding: 34, borderRadius: 54, background: 'rgba(28,32,44,.97)', display: 'flex', gap: 30,
              alignItems: 'center', transform: `translateY(${(1 - note) * -320}px)`, opacity: f < s(1.1) ? 0 : 1, boxShadow: '0 20px 80px rgba(0,0,0,.6)', fontFamily: BODY }}>
              <div style={{ width: 150, height: 150, borderRadius: 30, flex: 'none', backgroundImage: `url(${staticFile('reel/photo.png')})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <div>
                <div style={{ color: SKY, fontSize: 32, fontWeight: 600 }}>Koro · now</div>
                <div style={{ color: '#fff', fontSize: 44, fontWeight: 600, marginTop: 4 }}>Image copied from your Mac</div>
              </div>
            </div>
          </Phone3D>
        </Obj>
        {f >= s(0.5) && f < s(1.2) && (
          <Obj w={300} h={300} x={cx} y={cy} z={cz} rz={interpolate(fly, [0, 1], [-8, 14])} ry={interpolate(fly, [0, 1], [0, -30])}>
            <div style={{ width: 300, height: 300, borderRadius: 34, backgroundImage: `url(${staticFile('reel/photo.png')})`, backgroundSize: 'cover', backgroundPosition: 'center',
              boxShadow: `0 40px 90px rgba(0,0,0,.6), 0 0 60px ${SKY}55`, border: '3px solid rgba(255,255,255,.5)', opacity: interpolate(fly, [0.85, 1], [1, 0], clamp) }} />
          </Obj>
        )}
      </Camera>
      {/* the keystroke */}
      {f < s(0.75) && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 900 }}>
          <div style={{ padding: '30px 54px', borderRadius: 36, background: 'linear-gradient(180deg,#2a2e38,#14161c)', boxShadow: `0 ${18 - keyK * 10}px 0 #07080b, 0 40px 90px rgba(0,0,0,.7), 0 0 60px ${SKY}33`,
            border: '2px solid rgba(255,255,255,.18)', color: '#fff', fontFamily: DISPLAY, fontWeight: 700, fontSize: 120, opacity: keyOut,
            transform: `rotateX(28deg) translateY(${(1 - keyK) * -200}px) scale(${0.6 + keyK * 0.4})` }}>⌘ C</div>
        </AbsoluteFill>
      )}
      <Top y={230}>
        <Words text={'copy on mac,'} at={0} gap={3} size={112} out={len - 6} />
        <Words text={'*paste* on phone'} at={s(0.76)} gap={3} size={112} accent={SKY} out={len - 6} />
      </Top>
    </AbsoluteFill>
  );
};

/** 5 · The build: macro on the Mac's volume HUD filling, then the screen dims to black. Shake rises into the drop. */
const Build = () => {
  const f = useCurrentFrame(), len = L(T.build, T.drop);
  const half = s(0.7);
  const shake = kf(f, [[0, 2], [len, 26]], Easing.in(Easing.quad));
  const dim = kf(f, [[half + 2, 0], [len - 8, 0.94]], Easing.in(Easing.quad));
  return (
    <AbsoluteFill>
      {f < half ? (
        <Macro v={{ name: 's4_volbright.mac', from: 2.7, rate: 1.4 }} srcW={MAC_W} srcH={MAC_H} tilt={14} roll={-3} dof={18}
          path={[{ t: 0, cx: 2330, cy: 150, z: 4.6 }, { t: half, cx: 2380, cy: 160, z: 5.6 }]} />
      ) : (
        <>
          <Atmos tint={GOLD} tint2={RED} power={1 - dim} />
          <Camera rx={6} ry={kf(f, [[half, -10], [len, 4]])} z={kf(f, [[half, -140], [len, 260]], Easing.in(Easing.quad))} shake={shake}>
            <Obj w={0} h={0} y={300}><Mac3D v={{ name: 's4_volbright.mac', from: 4.4, rate: 1.4 }} w={1000} lean={11} power={1 - dim} /></Obj>
          </Camera>
        </>
      )}
      <Top y={250}>
        {f < half ? <Words text="volume." at={0} size={150} /> : <Words text={'*brightness.*'} at={half} size={150} accent={GOLD} />}
      </Top>
      <AbsoluteFill style={{ background: '#000', opacity: kf(f, [[len - 6, 0], [len - 1, 1]], Easing.linear) }} />
    </AbsoluteFill>
  );
};

/** 6 · DROP. Flash, a 3D extruded logo swings in, light leak, dust bursts outward, the camera takes the hit. */
const Drop = () => {
  const f = useCurrentFrame(), len = L(T.drop, T.m[0]);
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - 1, fps, config: { damping: 12, stiffness: 120 } });
  const hit = Math.max(0, 1 - f / 14);
  const sweep = interpolate(f, [2, 40], [-30, 140], clamp);
  const layers = 16;
  const logo: CSSProperties = { fontFamily: DISPLAY, fontWeight: 700, fontSize: 330, letterSpacing: '-0.06em', lineHeight: 1, whiteSpace: 'nowrap' };
  return (
    <AbsoluteFill>
      <Atmos tint={VIOLET} tint2={SKY} />
      <Camera rx={kf(f, [[0, 18], [len, 4]])} ry={interpolate(k, [0, 1], [-38, 10]) + kf(f, [[20, 0], [len, 8]])} z={kf(f, [[0, -500], [len, 60]], outCubic)} shake={hit * 30}>
        {/* extruded: back layers darker, the front face carries the holographic sweep */}
        {Array.from({ length: layers }, (_, i) => {
          const front = i === layers - 1;
          const t = i / (layers - 1);
          return (
            <Obj key={i} w={900} h={340} z={-80 + t * 80}>
              <div style={{ ...logo, textAlign: 'center',
                ...(front
                  ? { color: 'transparent', WebkitBackgroundClip: 'text', backgroundClip: 'text',
                      backgroundImage: `linear-gradient(110deg,#fff 0%,#fff ${sweep - 22}%,${GOLD} ${sweep - 8}%,${SKY} ${sweep}%,${VIOLET} ${sweep + 8}%,#fff ${sweep + 22}%,#fff 100%)` }
                  : { color: `rgb(${30 + t * 60}, ${24 + t * 40}, ${60 + t * 90})` }) }}>koro</div>
            </Obj>
          );
        })}
      </Camera>
      {/* dust bursting out from the logo */}
      <AbsoluteFill>
        {Array.from({ length: 60 }, (_, i) => {
          const a = random(`a${i}`) * Math.PI * 2, sp = 6 + random(`s${i}`) * 26, d = random(`d${i}`);
          const r = (f + 2) * sp * (1 - Math.min(1, f / 60) * 0.5);
          return <div key={i} style={{ position: 'absolute', left: 540 + Math.cos(a) * r, top: 960 + Math.sin(a) * r * 1.2, width: 3 + d * 8, height: 3 + d * 8, borderRadius: '50%',
            background: [GOLD, SKY, VIOLET, '#fff'][i % 4], opacity: interpolate(f, [0, 4, 40], [0, 0.9, 0], clamp) * (0.4 + d * 0.6), filter: `blur(${d > 0.7 ? 2 : 0}px)` }} />;
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 520 }}>
        <Caption text="phone ⇄ mac, finally" at={s(0.45)} color="#fff" />
      </AbsoluteFill>
      <Flash at={0} peak={1} len={6} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------ montage
const Label = ({ text, color, kicker }: { text: string; color: string; kicker: string }) => (
  <Top y={240}>
    <Caption text={kicker} at={1} color={color} />
    <div style={{ height: 22 }} />
    <Words text={text} at={2} gap={2} size={104} accent={color} />
  </Top>
);

/** m1 · lyrics: the lens crawls down the synced lyrics as the line lights up. */
const MLyrics = () => (
  <AbsoluteFill>
    <Macro v={{ name: 's5_player.phone', from: 2.4 }} srcW={PH_W} srcH={PH_H} tilt={22} roll={-5} dof={18} bg="#1a0f2a"
      path={[{ t: 0, cx: 520, cy: 1330, z: 1.5 }, { t: s(1.42), cx: 560, cy: 1520, z: 1.8 }]} />
    <Label kicker="now playing" text={'synced *lyrics*'} color={VIOLET} />
  </AbsoluteFill>
);

/** m2 · holographic player: the phone turns in the light, the foil catches it. */
const MHolo = () => {
  const f = useCurrentFrame(), len = L(T.m[1], T.m[2]);
  const P = phoneSize(1200);
  return (
    <AbsoluteFill>
      <Atmos tint={VIOLET} tint2={SKY} />
      <Camera rx={8} ry={kf(f, [[0, -34], [len, 22]], Easing.inOut(Easing.sin))} z={kf(f, [[0, -260], [len, -60]])} y={140} shake={2}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's12_holo.phone', from: 4.0 }} h={1200} glint={1.6} /></Obj>
      </Camera>
      <AbsoluteFill style={{ background: `linear-gradient(${100 + f * 2}deg, transparent 35%, ${VIOLET}33 48%, ${SKY}33 54%, transparent 66%)`, mixBlendMode: 'screen' }} />
      <Label kicker="the player" text={'*holographic*'} color={VIOLET} />
    </AbsoluteFill>
  );
};

/** m3 · today: top-down, the phone lies on the desk and the camera unwinds above it. */
const MToday = () => {
  const f = useCurrentFrame(), len = L(T.m[2], T.m[3]);
  const P = phoneSize(1250);
  return (
    <AbsoluteFill>
      <Atmos tint={GOLD} tint2={SKY} />
      <Camera rz={kf(f, [[0, -26], [len, -6]])} rx={kf(f, [[0, 24], [len, 10]])} z={kf(f, [[0, 260], [len, -60]])} y={120} shake={2}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's6_today.phone', from: 0.4 }} h={1250} /></Obj>
      </Camera>
      <Label kicker="today" text={'AI plans *my* *day*'} color={GOLD} />
    </AbsoluteFill>
  );
};

/** m4 · cricket: starts on the photo in extreme close-up, pulls back to reveal the phone. */
const MCricket = () => {
  const f = useCurrentFrame(), len = L(T.m[3], T.m[4]);
  const P = phoneSize(1250);
  const z = kf(f, [[0, 1300], [len, -80]], Easing.out(Easing.quad));
  return (
    <AbsoluteFill>
      <Atmos tint={RED} tint2={GOLD} />
      <Camera z={z} rx={kf(f, [[0, 0], [len, 12]])} ry={kf(f, [[0, 0], [len, -14]])} x={kf(f, [[0, 20], [len, 0]])} y={kf(f, [[0, -10], [len, 110]])} shake={3}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's7_cricket.phone', from: 1.4 }} h={1250} /></Obj>
      </Camera>
      <Label kicker="mumbai indians · india" text={'cricket, *live*'} color={RED} />
    </AbsoluteFill>
  );
};

/** m5 · X feed: the phone lies back like a page, the camera flies low over it. */
const MFeed = () => {
  const f = useCurrentFrame(), len = L(T.m[4], T.m[5]);
  const P = phoneSize(1350);
  return (
    <AbsoluteFill>
      <Atmos tint={SKY} tint2={VIOLET} />
      <Camera rx={kf(f, [[0, 50], [len, 34]])} rz={-8} z={kf(f, [[0, 120], [len, 320]])} y={kf(f, [[0, 300], [len, 40]])} shake={2}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's10_feed.phone', from: 1.4 }} h={1350} /></Obj>
      </Camera>
      <Label kicker="my X feed" text={'*summarised*'} color={SKY} />
    </AbsoluteFill>
  );
};

/** m6 · news: three phones at three depths, the camera trucks past them. */
const MNews = () => {
  const f = useCurrentFrame(), len = L(T.m[5], T.m[6]);
  const P = phoneSize(1000);
  const truck = kf(f, [[0, 260], [len, -260]], Easing.linear);
  return (
    <AbsoluteFill>
      <Atmos tint={MINT} tint2={SKY} />
      <Camera x={truck} rx={8} ry={-18} z={-200} y={160} shake={2}>
        <Obj w={P.w} h={P.h} x={-640} z={-520} ry={10} blur={7}><Phone3D v={{ name: 's9_news.phone', from: 0.6 }} h={1000} /></Obj>
        <Obj w={P.w} h={P.h} x={640} z={-520} ry={-10} blur={7}><Phone3D v={{ name: 's11_yt.phone', from: 3.0 }} h={1000} /></Obj>
        <Obj w={P.w} h={P.h} z={60}><Phone3D v={{ name: 's9_news.phone', from: 2.2 }} h={1000} /></Obj>
      </Camera>
      <Label kicker="the news" text={'summarised *by* *AI*'} color={MINT} />
    </AbsoluteFill>
  );
};

/** m7 · YouTube: head-on, then the camera pushes through the glass into the video. */
const MYouTube = () => {
  const f = useCurrentFrame(), len = L(T.m[6], T.m[7]);
  const P = phoneSize(1180);
  return (
    <AbsoluteFill>
      <Atmos tint={RED} tint2={VIOLET} />
      <Camera z={kf(f, [[0, -200], [len, 640]], Easing.in(Easing.quad))} y={kf(f, [[0, 120], [len, 330]], Easing.in(Easing.quad))} rx={kf(f, [[0, 10], [len, 0]])} ry={kf(f, [[0, 12], [len, 0]])}>
        <Obj w={P.w} h={P.h}><Phone3D v={{ name: 's11_yt.phone', from: 1.2 }} h={1180} /></Obj>
      </Camera>
      <Label kicker="any youtube video" text={'*explained*'} color={RED} />
    </AbsoluteFill>
  );
};

/** m8 · wellbeing: macro across the screen-time bars. */
const MWell = () => (
  <AbsoluteFill>
    <Macro v={{ name: 's8_well.phone', from: 2.9 }} srcW={PH_W} srcH={PH_H} tilt={24} roll={5} dof={16} bg="#0b0f18"
      path={[{ t: 0, cx: 380, cy: 1150, z: 1.6 }, { t: s(1.44), cx: 640, cy: 1260, z: 1.95 }]} />
    <Label kicker="screen time" text={'ends my *doomscrolling*'} color={GOLD} />
  </AbsoluteFill>
);

/** 7 · Hero end shot: Mac and phone together, the camera cranes up, the logo lands. */
const End = () => {
  const f = useCurrentFrame(), len = L(T.end, 27.5);
  const { fps } = useVideoConfig();
  const P = phoneSize(620);
  const lk = spring({ frame: f - 6, fps, config: { damping: 16 } });
  const sweep = (f * 2.2) % 300;
  return (
    <AbsoluteFill>
      <Atmos tint={GOLD} tint2={VIOLET} />
      {/* negative rx = the camera looks down onto the desk (positive would look up at the deck's underside) */}
      <Camera rx={kf(f, [[0, -16], [len, -7]])} ry={kf(f, [[0, -20], [len, -6]])} z={kf(f, [[0, -800], [len, -600]])} y={kf(f, [[0, 30], [len, -10]])}>
        <Obj w={0} h={0} x={-70} y={210} z={-160}><Mac3D v={{ name: 's4_volbright.mac', from: 6.6 }} w={820} lean={10} /></Obj>
        <Obj w={P.w} h={P.h} x={380} y={40} z={540} rx={4} ry={-16} rz={3}><Phone3D v={{ name: 's12_holo.phone', from: 5.0 }} h={620} glint={1.4} /></Obj>
      </Camera>
      <Dust n={40} seed="end" color={GOLD} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 210 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 220, letterSpacing: '-0.06em', lineHeight: 1, color: 'transparent', WebkitBackgroundClip: 'text', backgroundClip: 'text',
          backgroundImage: `linear-gradient(110deg, ${GOLD}, ${SKY} 35%, ${VIOLET} 65%, ${GOLD})`, backgroundSize: '300% 100%', backgroundPosition: `${sweep}% 0`,
          transform: `translateY(${(1 - lk) * 80}px) scale(${0.9 + lk * 0.1})`, opacity: lk, filter: `blur(${(1 - lk) * 12}px)` }}>koro</div>
        <div style={{ height: 16 }} />
        <Caption text="built with AI · in a weekend" at={s(0.5)} color="#fff" />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 330, background: 'linear-gradient(0deg, rgba(0,0,0,.75) 0%, rgba(0,0,0,.5) 520px, transparent 760px)' }}>
        <Words text={'comment *KORO*'} at={s(0.9)} gap={3} size={92} />
        <div style={{ fontFamily: BODY, fontSize: 30, color: 'rgba(255,255,255,.62)', marginTop: 18, opacity: kf(f, [[s(1.4), 0], [s(1.8), 1]]) }}>and I'll send you the link</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#000', opacity: kf(f, [[len - 12, 0], [len, 1]], Easing.linear) }} />
    </AbsoluteFill>
  );
};

// ================================================================================================ timeline
type Cut = { at: number; to: number; C: () => JSX.Element; fin?: Fx; fout?: Fx };
const CUTS: Cut[] = [
  { at: T.open, to: T.sleep, C: Open },
  { at: T.sleep, to: T.workA, C: Sleep, fin: 'punch', fout: 'whipL' },
  { at: T.workA, to: T.workB, C: WorkA, fin: 'whipL', fout: 'whipL' },
  { at: T.workB, to: T.clip, C: WorkB, fin: 'whipL', fout: 'push' },
  { at: T.clip, to: T.build, C: Clip, fin: 'push', fout: 'punch' },
  { at: T.build, to: T.drop, C: Build, fin: 'punch' },
  { at: T.drop, to: T.m[0], C: Drop, fout: 'punch' },
  { at: T.m[0], to: T.m[1], C: MLyrics, fin: 'punch', fout: 'whipR' },
  { at: T.m[1], to: T.m[2], C: MHolo, fin: 'whipR', fout: 'punch' },
  { at: T.m[2], to: T.m[3], C: MToday, fin: 'punch', fout: 'whipL' },
  { at: T.m[3], to: T.m[4], C: MCricket, fin: 'whipL', fout: 'punch' },
  { at: T.m[4], to: T.m[5], C: MFeed, fin: 'punch', fout: 'whipR' },
  { at: T.m[5], to: T.m[6], C: MNews, fin: 'whipR', fout: 'punch' },
  { at: T.m[6], to: T.m[7], C: MYouTube, fin: 'punch', fout: 'whipL' },
  { at: T.m[7], to: T.end, C: MWell, fin: 'whipL', fout: 'push' },
  { at: T.end, to: 27.5, C: End, fin: 'push' },
];
/** Frames where a whip crosses the cut: rendered with real camera motion blur. */
const WHIPS = CUTS.filter((c) => c.fin === 'whipL' || c.fin === 'whipR').map((c) => s(c.at));

const Timeline = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    {CUTS.map(({ at, to, C, fin, fout }) => (
      <Sequence key={at} from={s(at)} durationInFrames={s(to) - s(at)}>
        <Shot len={s(to) - s(at)} fin={fin} fout={fout}><C /></Shot>
      </Sequence>
    ))}
    <Leak from={s(T.open)} dur={s(1.6)} seed={3} hue={0} opacity={0.45} />
    <Leak from={s(T.drop)} dur={s(1.4)} seed={7} hue={0} opacity={0.7} />
    <Leak from={s(T.m[4])} dur={s(0.8)} seed={5} hue={170} opacity={0.4} />
    <Leak from={s(T.end)} dur={s(1.4)} seed={9} hue={0} opacity={0.25} />
  </AbsoluteFill>
);

export const Cinema = () => {
  const f = useCurrentFrame();
  const blur = WHIPS.some((w) => f >= w - 5 && f <= w + 4);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* the stage is 1080×1920; scale it to whatever the composition size is */}
      <ScaleToFit>
        {blur ? <CameraMotionBlur shutterAngle={240} samples={10}><Timeline /></CameraMotionBlur> : <Timeline />}
        <Grade />
      </ScaleToFit>
    </AbsoluteFill>
  );
};

const ScaleToFit = ({ children }: { children: ReactNode }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ width: 1080, height: 1920, transform: `scale(${width / 1080})`, transformOrigin: '0 0', overflow: 'hidden' }}>{children}</AbsoluteFill>;
};
