import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { loadFont as loadDisplay } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadBody } from '@remotion/google-fonts/Inter';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { INTRO, OUTRO, SCENE, SCENES, T, type Scene } from './scenes';

const { fontFamily: DISPLAY } = loadDisplay('normal', { weights: ['500', '700'], subsets: ['latin'] });
const { fontFamily: BODY } = loadBody('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });

const GOLD = '#F2C14E', SKY = '#5EC8FF', VIOLET = '#C38BFF', INK = '#05070E';
const HOLO = `linear-gradient(115deg, ${GOLD}, ${SKY} 35%, ${VIOLET} 65%, ${GOLD})`;

/** Everything is laid out on a 1920×1080 stage and scaled 2× → crisp 3840×2160 text and vectors. */
const Stage = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ width: 1920, height: 1080, transform: 'scale(2)', transformOrigin: '0 0' }}>{children}</AbsoluteFill>
);

// ---------- background: drifting light blobs, a slow holographic foil and grain ----------
const Backdrop = ({ tint = GOLD }: { tint?: string }) => {
  const f = useCurrentFrame();
  const blob = (c: string, x: number, y: number, r: number, k: number): CSSProperties => ({
    position: 'absolute', width: r, height: r, borderRadius: '50%', background: c, filter: 'blur(120px)', opacity: 0.42,
    left: x + Math.sin(f / (70 + k * 13)) * 120, top: y + Math.cos(f / (90 + k * 7)) * 90,
  });
  return (
    <AbsoluteFill style={{ background: INK, overflow: 'hidden' }}>
      <div style={blob(tint, -200, -260, 900, 1)} />
      <div style={blob(SKY, 1200, 500, 820, 2)} />
      <div style={blob(VIOLET, 500, 700, 700, 3)} />
      <AbsoluteFill style={{ background: `repeating-linear-gradient(115deg, ${GOLD} 0 6%, ${SKY} 12%, ${VIOLET} 18%, ${GOLD} 24%)`,
        backgroundSize: '300% 300%', backgroundPosition: `${(f * 0.35) % 300}% 0`, mixBlendMode: 'color-dodge', opacity: 0.07 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.65))' }} />
      <svg width="1920" height="1080" style={{ position: 'absolute', opacity: 0.06, mixBlendMode: 'overlay' }}>
        <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={Math.floor(f / 2)} /></filter>
        <rect width="100%" height="100%" filter="url(#g)" />
      </svg>
    </AbsoluteFill>
  );
};

// ---------- the phone ----------
const Phone = ({ clip, rate = 1, start = 0, tilt = 0, enter = 0, children }: { clip?: string; rate?: number; start?: number; tilt?: number; enter?: number; children?: ReactNode }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const H = 900, W = H * (1080 / 2340);
  const s = spring({ frame: f - enter, fps, config: { damping: 16, mass: 0.9 } });
  const float = Math.sin(f / 28) * 6;
  return (
    <div style={{ perspective: 2400 }}>
      <div style={{ width: W + 24, height: H + 24, borderRadius: 64, padding: 12, position: 'relative',
        transform: `translateY(${(1 - s) * 140 + float}px) rotateY(${tilt * (1.2 - s * 0.6)}deg) scale(${0.9 + s * 0.1})`, opacity: s,
        background: 'linear-gradient(160deg, #1b2236, #070a12)',
        boxShadow: `0 60px 140px rgba(0,0,0,.65), 0 0 0 2px rgba(255,255,255,.06), 0 0 80px ${GOLD}22` }}>
        <div style={{ position: 'absolute', inset: -2, borderRadius: 66, padding: 2, background: HOLO, opacity: 0.55,
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor' }} />
        <div style={{ width: W, height: H, borderRadius: 52, overflow: 'hidden', background: '#000', position: 'relative' }}>
          {clip ? <OffthreadVideo src={staticFile(`clips/${clip}`)} playbackRate={rate} startFrom={Math.round(start * fps)} muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : children}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(125deg, rgba(255,255,255,.14), transparent 28%, transparent 70%, rgba(255,255,255,.05))', pointerEvents: 'none' }} />
        </div>
      </div>
    </div>
  );
};

// ---------- text ----------
const Kicker = ({ text, color, delay = 0 }: { text: string; color: string; delay?: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [delay, delay + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: o, transform: `translateX(${(1 - o) * -20}px)` }}>
      <span style={{ width: 36, height: 3, borderRadius: 2, background: color }} />
      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, letterSpacing: '0.28em', color }}>{text}</span>
    </div>
  );
};
const Title = ({ text, delay = 0, size = 92 }: { text: string; delay?: number; size?: number }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.035em', color: '#fff' }}>
      {text.split('\n').map((line, i) => {
        const o = interpolate(f, [delay + i * 6, delay + i * 6 + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
        return <div key={i} style={{ overflow: 'hidden', paddingBottom: '0.14em', marginBottom: '-0.14em' }}><div style={{ transform: `translateY(${(1 - o) * 100}%)`, opacity: o }}>{line}</div></div>;
      })}
    </div>
  );
};
const Bullets = ({ items, color, delay = 0 }: { items: string[]; color: string; delay?: number }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 44 }}>
      {items.map((b, i) => {
        const o = interpolate(f, [delay + i * 9, delay + i * 9 + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
        return (
          <div key={i} style={{ display: 'flex', gap: 18, alignItems: 'baseline', opacity: o, transform: `translateY(${(1 - o) * 18}px)` }}>
            <span style={{ width: 10, height: 10, flex: 'none', borderRadius: 3, background: color, boxShadow: `0 0 18px ${color}`, transform: 'translateY(-3px) rotate(45deg)' }} />
            <span style={{ fontFamily: BODY, fontWeight: 500, fontSize: 30, lineHeight: 1.35, color: 'rgba(241,245,251,.86)' }}>{b}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---------- scenes ----------
const Feature = ({ s, n }: { s: Scene; n: number }) => {
  const f = useCurrentFrame();
  const left = s.side === 'left';
  const out = interpolate(f, [SCENE - T - 6, SCENE], [1, 0.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Backdrop tint={s.accent} />
      <Stage>
        <AbsoluteFill style={{ flexDirection: left ? 'row' : 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 150, padding: '0 150px' }}>
          <div style={{ width: 720, opacity: 0.25 + out * 0.75 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: '0.2em', color: 'rgba(255,255,255,.35)', marginBottom: 26 }}>
              {String(n).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}
            </div>
            <Kicker text={s.kicker} color={s.accent} delay={6} />
            <div style={{ height: 26 }} />
            <Title text={s.title} delay={10} />
            <Bullets items={s.bullets} color={s.accent} delay={26} />
          </div>
          <Phone clip={s.clip} rate={s.rate} start={s.start} tilt={left ? -14 : 14} enter={2}>
            {!s.clip && <SyncDemo />}
          </Phone>
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};

/** No recording for clipboard sync: an animated card flies Mac → phone and an image flies back. */
const SyncDemo = () => {
  const f = useCurrentFrame();
  const t = (f % 90) / 90;
  const card = (label: string, sub: string, y: number, o: number): CSSProperties => ({
    position: 'absolute', left: 24, right: 24, top: y, padding: '18px 20px', borderRadius: 20, opacity: o,
    background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#fff', fontFamily: BODY,
  });
  const yIn = interpolate(t, [0, 0.35], [-140, 120], { extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.4)) });
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #0b1222, #05070E)' }}>
      <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', fontFamily: DISPLAY, letterSpacing: '0.2em', fontSize: 14, color: GOLD }}>KORO · CLIPBOARD</div>
      <div style={card('', '', yIn, 1)}>
        <div style={{ fontSize: 13, color: SKY, fontWeight: 600, letterSpacing: '0.08em' }}>COPIED FROM YOUR MAC</div>
        <div style={{ fontSize: 19, fontWeight: 600, marginTop: 6 }}>Meeting at 4:30 · Room 2B</div>
      </div>
      <div style={{ ...card('', '', 290, interpolate(t, [0.3, 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) }}>
        <div style={{ fontSize: 13, color: VIOLET, fontWeight: 600, letterSpacing: '0.08em' }}>IMAGE FROM YOUR MAC</div>
        <div style={{ height: 150, marginTop: 10, borderRadius: 14, background: `linear-gradient(135deg, ${GOLD}, ${VIOLET} 60%, ${SKY})`, opacity: 0.85 }} />
      </div>
      <div style={{ position: 'absolute', bottom: 46, left: 24, right: 24, height: 64, borderRadius: 999, display: 'grid', placeItems: 'center',
        background: GOLD, color: '#1F1500', fontFamily: DISPLAY, fontWeight: 700, fontSize: 20,
        transform: `scale(${1 + Math.max(0, Math.sin(f / 7)) * 0.03})` }}>Share → ⌘V on Mac</div>
    </AbsoluteFill>
  );
};

const Intro = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 14 } });
  const sweep = interpolate(f, [0, INTRO], [-40, 140]);
  const tag = interpolate(f, [34, 52], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Backdrop />
      <Stage>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 300, letterSpacing: '-0.06em', lineHeight: 1,
            background: `linear-gradient(110deg, #fff 0%, #fff ${sweep - 20}%, ${GOLD} ${sweep - 8}%, ${SKY} ${sweep}%, ${VIOLET} ${sweep + 8}%, #fff ${sweep + 20}%, #fff 100%)`,
            WebkitBackgroundClip: 'text', color: 'transparent', transform: `scale(${0.85 + s * 0.15})`, opacity: s, filter: `blur(${(1 - s) * 12}px)` }}>
            koro
          </div>
          <div style={{ marginTop: 26, fontFamily: BODY, fontSize: 38, color: 'rgba(241,245,251,.8)', opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
            Your day, your Mac, your cricket. One holographic app.
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 40, opacity: interpolate(f, [56, 72], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
            {['Android', 'macOS', 'AI'].map((c) => (
              <span key={c} style={{ fontFamily: DISPLAY, fontSize: 20, letterSpacing: '0.18em', padding: '10px 22px', borderRadius: 999, color: '#fff',
                border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)' }}>{c.toUpperCase()}</span>
            ))}
          </div>
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const f = useCurrentFrame();
  const o = (a: number) => interpolate(f, [a, a + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Backdrop tint={VIOLET} />
      <Stage>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 180, letterSpacing: '-0.05em', background: HOLO, backgroundSize: '200% 100%',
            backgroundPosition: `${f}% 0`, WebkitBackgroundClip: 'text', color: 'transparent', opacity: o(4) }}>koro</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 46, fontWeight: 500, color: '#fff', marginTop: 10, opacity: o(18) }}>Everything that matters, at a glance.</div>
          <div style={{ fontFamily: BODY, fontSize: 24, color: 'rgba(241,245,251,.55)', marginTop: 40, letterSpacing: '0.04em', opacity: o(36) }}>
            Tauri · Svelte · Bun · Postgres · Swift · Claude
          </div>
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};

export const Film = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={INTRO}><Intro /></TransitionSeries.Sequence>
    {SCENES.flatMap((s, i) => [
      <TransitionSeries.Transition key={`t${s.id}`} timing={linearTiming({ durationInFrames: T })}
        presentation={i % 2 ? slide({ direction: 'from-right' }) : fade()} />,
      <TransitionSeries.Sequence key={s.id} durationInFrames={SCENE}><Feature s={s} n={i + 1} /></TransitionSeries.Sequence>,
    ])}
    <TransitionSeries.Transition timing={linearTiming({ durationInFrames: T })} presentation={fade()} />
    <TransitionSeries.Sequence durationInFrames={OUTRO}><Outro /></TransitionSeries.Sequence>
  </TransitionSeries>
);
