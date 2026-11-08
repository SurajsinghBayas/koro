/**
 * The vertical reel: "Apple won't do this so I built it". 9:16, laid out on a 1080×1920 stage scaled 2× (2160×3840).
 * Exported silent; the song ("White Keys" from 0:46.7) is added in Instagram so it stays licensed.
 * Footage lives in public/reel/ (recorded with video/rec/take.sh, kept out of git).
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BODY, DISPLAY, GOLD, HOLO, SKY, VIOLET } from './Film';

export const REEL_FPS = 30;
const s = (sec: number) => Math.round(sec * REEL_FPS);
export const REEL_DURATION = s(27.5);

/** clean = no text at all: the building blocks for the edit in Edits, which adds its own titles. */
export const Clean = createContext(false);
const useClean = () => useContext(Clean);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const clip = (name: string) => staticFile(`reel/${name}.mp4`);

/** Phone recordings are 1080×2340; we crop the status bar (top 110px) so no real clock or icons show. */
const PH_W = 1080, PH_H = 2340, BAR = 110;

// ---------------------------------------------------------------- background
const Bg = ({ tint = GOLD }: { tint?: string }) => {
  const f = useCurrentFrame();
  const blob = (c: string, x: number, y: number, r: number, k: number): CSSProperties => ({
    position: 'absolute', width: r, height: r, borderRadius: '50%', background: c, filter: 'blur(140px)', opacity: 0.32,
    left: x + Math.sin(f / (60 + k * 11)) * 90, top: y + Math.cos(f / (80 + k * 7)) * 120,
  });
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <div style={blob(tint, -300, -200, 900, 1)} />
      <div style={blob(SKY, 500, 900, 800, 2)} />
      <div style={blob(VIOLET, -200, 1300, 700, 3)} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.75))' }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- devices
type Vid = { name: string; from?: number; rate?: number };

/** Phone with the status bar cropped off. `h` is the outer height in stage px. */
const Phone = ({ v, h, children, style }: { v?: Vid; h: number; children?: ReactNode; style?: CSSProperties }) => {
  const sh = h - 24, sw = sh * (PH_W / (PH_H - BAR)), k = sw / PH_W;
  return (
    <div style={{ width: sw + 24, height: h, borderRadius: 58, padding: 12, position: 'relative', background: 'linear-gradient(160deg,#1b2236,#05070e)',
      boxShadow: `0 40px 120px rgba(0,0,0,.8), 0 0 0 2px rgba(255,255,255,.07), 0 0 70px ${GOLD}22`, ...style }}>
      <div style={{ position: 'absolute', inset: -2, borderRadius: 60, padding: 2, background: HOLO, opacity: 0.5,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor' }} />
      <div style={{ width: sw, height: sh, borderRadius: 46, overflow: 'hidden', position: 'relative', background: '#000' }}>
        {v && <OffthreadVideo src={clip(v.name)} startFrom={s(v.from ?? 0)} playbackRate={v.rate ?? 1} muted
          style={{ position: 'absolute', left: 0, top: -BAR * k, width: sw, height: PH_H * k }} />}
        {children}
      </div>
    </div>
  );
};

/** A MacBook Air: screen (2940×1912 recordings) in a thin bezel over a base. `w` is the screen width. */
const Mac = ({ v, w, children }: { v?: Vid; w: number; children?: ReactNode }) => {
  const h = w * (1912 / 2940);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ padding: 14, paddingBottom: 18, borderRadius: '26px 26px 8px 8px', background: '#0b0d12',
        boxShadow: '0 0 0 2px #2a2f3a, 0 30px 90px rgba(0,0,0,.8)' }}>
        <div style={{ width: w, height: h, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#000' }}>
          {v && <OffthreadVideo src={clip(v.name)} startFrom={s(v.from ?? 0)} playbackRate={v.rate ?? 1} muted style={{ width: '100%', height: '100%' }} />}
          {children}
        </div>
      </div>
      <div style={{ width: w * 1.16, height: 16, borderRadius: '0 0 18px 18px', background: 'linear-gradient(#c9ccd3,#7c808a)' }} />
    </div>
  );
};

/** A finger tap ripple at (x, y) within its parent, firing at frame `at`. */
const Tap = ({ x, y, at }: { x: number; y: number; at: number }) => {
  const f = useCurrentFrame() - at;
  if (f < -6 || f > 22) return null;
  const press = interpolate(f, [-6, 0, 8], [0, 1, 0.9], clamp);
  const ring = interpolate(f, [0, 20], [0, 1], clamp);
  return (
    <>
      <div style={{ position: 'absolute', left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: '50%', background: 'rgba(255,255,255,.55)',
        opacity: press * interpolate(f, [8, 18], [1, 0], clamp), transform: `scale(${0.6 + press * 0.4})` }} />
      <div style={{ position: 'absolute', left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: '50%', border: '3px solid #fff',
        opacity: (1 - ring) * (f >= 0 ? 1 : 0), transform: `scale(${1 + ring * 1.6})` }} />
    </>
  );
};

// ---------------------------------------------------------------- text
const Pop = ({ children, at = 0, size = 64, style }: { children: ReactNode; at?: number; size?: number; style?: CSSProperties }) => {
  const f = useCurrentFrame();
  if (useClean()) return null;
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 180 } });
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', textAlign: 'center',
      opacity: Math.min(1, k * 1.4), transform: `translateY(${(1 - k) * 40}px) scale(${0.85 + k * 0.15})`, textShadow: '0 4px 30px rgba(0,0,0,.6)', ...style }}>
      {children}
    </div>
  );
};
const Tag = ({ children, at = 0, color = GOLD }: { children: ReactNode; at?: number; color?: string }) => {
  const f = useCurrentFrame();
  if (useClean()) return null;
  const o = interpolate(f - at, [0, 8], [0, 1], clamp);
  return (
    <div style={{ display: 'inline-flex', padding: '14px 30px', borderRadius: 999, fontFamily: DISPLAY, fontWeight: 700, fontSize: 40, color: '#05070E',
      background: color, opacity: o, transform: `scale(${0.7 + o * 0.3})`, boxShadow: `0 0 40px ${color}88` }}>{children}</div>
  );
};

const Stage = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ width: 1080, height: 1920, transform: 'scale(2)', transformOrigin: '0 0' }}>{children}</AbsoluteFill>
);

// ---------------------------------------------------------------- the Mac + phone shots
const MAC_W = 860, PHONE_H = 1010;
const Duo = ({ mac, phone, top, caption, macFx, phoneFx, tint }: {
  mac: Vid; phone: Vid; top: ReactNode; caption: ReactNode; macFx?: ReactNode; phoneFx?: ReactNode; tint?: string;
}) => (
  <AbsoluteFill>
    <Bg tint={tint} />
    <Stage>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 80 }}>
        <div style={{ height: 180, display: 'flex', alignItems: 'center', padding: '0 60px' }}>{top}</div>
        <Mac v={mac} w={MAC_W}>{macFx}</Mac>
        <div style={{ marginTop: 26 }}><Phone v={phone} h={PHONE_H}>{phoneFx}</Phone></div>
        <div style={{ position: 'absolute', top: 80 + 180 + MAC_W * (1912 / 2940) + 14, zIndex: 2 }}>{caption}</div>
      </AbsoluteFill>
    </Stage>
  </AbsoluteFill>
);

/** Screen-off: the panel really goes dark, but a screen recording keeps the picture, so we draw the blackout. */
const Blackout = ({ from, to }: { from: number; to: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [from, from + 4, to, to + 6], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ background: '#000', opacity: o }} />;
};
const Dim = ({ keys }: { keys: [number, number][] }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, keys.map((k) => k[0]), keys.map((k) => k[1]), clamp);
  return <AbsoluteFill style={{ background: '#000', opacity: o }} />;
};
const Flare = ({ at }: { at: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 3, at + 16], [0, 0.85, 0], clamp);
  return <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, #fff, rgba(255,255,255,.6) 60%, rgba(255,255,255,.3))', opacity: o, mixBlendMode: 'screen' }} />;
};
/** Hides the real windows Work mode opens (Terminal, WhatsApp, the Gmail inbox) from before the first one appears. */
const Blur = ({ from, top = 0.1 }: { from: number; top?: number }) => {
  const f = useCurrentFrame();
  if (f < from) return null;
  return <div style={{ position: 'absolute', left: 0, right: 0, top: `${top * 100}%`, bottom: 0, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', background: 'rgba(10,12,18,.25)' }} />;
};

/** The phone's quiet "Image copied from your Mac" notification (it has no banner, so we draw it as Android does). */
const ClipNote = ({ at }: { at: number }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - at, fps, config: { damping: 15 } });
  if (f < at) return null;
  return (
    <div style={{ position: 'absolute', left: 14, right: 14, top: 18, padding: 16, borderRadius: 26, background: 'rgba(28,32,44,.96)', display: 'flex', gap: 14,
      alignItems: 'center', transform: `translateY(${(1 - k) * -140}px)`, boxShadow: '0 10px 40px rgba(0,0,0,.6)', fontFamily: BODY }}>
      <div style={{ width: 70, height: 70, borderRadius: 14, flex: 'none', backgroundImage: `url(${staticFile('reel/photo.png')})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div>
        <div style={{ color: SKY, fontSize: 15, fontWeight: 600 }}>Koro · now</div>
        <div style={{ color: '#fff', fontSize: 21, fontWeight: 600, marginTop: 2 }}>Image copied from your Mac</div>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 17, marginTop: 2 }}>Long-press any text box to paste it</div>
      </div>
    </div>
  );
};
const KeyCap = ({ at }: { at: number }) => {
  const f = useCurrentFrame();
  if (useClean()) return null;
  const o = interpolate(f, [at, at + 4, at + 22, at + 30], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ padding: '18px 34px', borderRadius: 22, background: 'rgba(20,22,30,.85)', border: '2px solid rgba(255,255,255,.25)', color: '#fff',
        fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, opacity: o, transform: `scale(${0.8 + o * 0.2})` }}>⌘ C</div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- phone-only montage
const Solo = ({ v, label, tint }: { v: Vid; label: string; tint: string }) => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, 42], [1.04, 1], clamp);
  return (
    <AbsoluteFill>
      <Bg tint={tint} />
      <Stage>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 50 }}>
          <Tag at={2} color={tint}>{label}</Tag>
          <div style={{ transform: `scale(${zoom})` }}><Phone v={v} h={1500} /></div>
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- drop + end
const Drop = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - 3, fps, config: { damping: 11 } });
  const flash = interpolate(f, [0, 2, 10], [1, 1, 0], clamp);
  const sweep = interpolate(f, [0, 45], [-30, 140]);
  const glitch = f < 10 ? Math.sin(f * 7) * 14 : 0;
  const logo: CSSProperties = { fontFamily: DISPLAY, fontWeight: 700, fontSize: 330, letterSpacing: '-0.06em', lineHeight: 1 };
  return (
    <AbsoluteFill>
      <Bg tint={VIOLET} />
      <Stage>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          {/* The glitch is two solid copies behind the logo: changing text-shadow on background-clipped text
              makes Chrome drop the clip in a long render (the gradient fills the whole box). */}
          <div style={{ position: 'relative', transform: `translateX(${glitch}px) scale(${0.7 + k * 0.3})`, opacity: k }}>
            {f < 10 && [[-glitch, SKY], [glitch, VIOLET]].map(([dx, c]) => (
              <div key={c} style={{ ...logo, position: 'absolute', inset: 0, color: c as string, transform: `translateX(${dx}px)`, opacity: 0.8 }}>koro</div>
            ))}
            <div style={{ ...logo, position: 'relative', color: 'transparent', WebkitBackgroundClip: 'text', backgroundClip: 'text',
              backgroundImage: `linear-gradient(110deg,#fff 0%,#fff ${sweep - 20}%,${GOLD} ${sweep - 8}%,${SKY} ${sweep}%,${VIOLET} ${sweep + 8}%,#fff ${sweep + 20}%,#fff 100%)` }}>koro</div>
          </div>
          <Pop at={14} size={46} style={{ fontWeight: 500, color: 'rgba(255,255,255,.85)', marginTop: 10 }}>phone ⇄ mac, finally</Pop>
        </AbsoluteFill>
      </Stage>
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  );
};

const End = () => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Bg tint={GOLD} />
      <Stage>
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: 230 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 200, letterSpacing: '-0.05em', background: HOLO, backgroundSize: '200% 100%',
            backgroundPosition: `${f * 2}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', opacity: o }}>koro</div>
          <Pop at={6} size={44} style={{ fontWeight: 500, color: 'rgba(255,255,255,.85)' }}>built with AI · in a weekend</Pop>
          <div style={{ marginTop: 60, transform: 'scale(.82)' }}>
            <Mac v={{ name: 's4_volbright.mac', from: 6.6 }} w={MAC_W} />
          </div>
          <div style={{ position: 'absolute', bottom: 200 }}><Pop at={20} size={64}>comment <span style={{ color: GOLD }}>KORO</span> 👇</Pop></div>
          {!useClean() && <div style={{ position: 'absolute', bottom: 140, fontFamily: BODY, fontSize: 26, color: 'rgba(255,255,255,.5)', opacity: interpolate(f, [30, 40], [0, 1], clamp) }}>
            and I'll send you the link
          </div>}
        </AbsoluteFill>
      </Stage>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- timeline (cuts follow the "White Keys" lyric times)
const HOOK = <Pop size={66}>Apple won't do this<br />so I <span style={{ color: GOLD }}>built it</span></Pop>;
const cap = (t: string, at = 4, color?: string) => <Tag at={at} color={color}>{t}</Tag>;

// Phone tap points in stage px: recording px scaled to the phone screen, minus the cropped status bar
const PK = (PHONE_H - 24) / (PH_H - BAR);
const P = (x: number, y: number) => ({ x: x * PK, y: (y - BAR) * PK });

export const Reel = ({ clean = false }: { clean?: boolean }) => (
  <Clean.Provider value={clean}>
  <AbsoluteFill style={{ background: '#000' }}>
    {/* 1 · "The world is movin'…" Sleep: the Mac goes dark, then wakes */}
    <Sequence durationInFrames={s(2.8)}>
      <Duo top={HOOK} caption={cap('one tap → mac sleeps', 24, SKY)}
        mac={{ name: 's1_sleep.mac', from: 0.5 }} phone={{ name: 's1_sleep.phone', from: 3.2 }}
        macFx={<Blackout from={s(0.85)} to={s(2.3)} />}
        phoneFx={<><Tap {...P(540, 904)} at={s(0.75)} /><Tap {...P(540, 904)} at={s(2.2)} /></>} />
    </Sequence>

    {/* 2 · "…working on the world" Work mode */}
    <Sequence from={s(2.8)} durationInFrames={s(2.8)}>
      <Duo top={<Pop size={60}>one tap <span style={{ color: GOLD }}>work mode</span></Pop>} caption={cap('WhatsApp · Terminal · Gmail', 40)}
        mac={{ name: 's2_work.mac', from: 0.4 }} phone={{ name: 's1_sleep.phone', from: 0.2 }}
        macFx={<Blur from={s(1.0)} top={0.03} />}
        phoneFx={<Tap {...P(540, 1312)} at={s(1.1)} />} />
    </Sequence>

    {/* 3 · "…gave you what I had" copy on Mac, it's on the phone */}
    <Sequence from={s(5.6)} durationInFrames={s(2.9)}>
      <Duo top={<Pop size={60}>copy on mac →<br /><span style={{ color: SKY }}>paste on phone</span></Pop>} caption={null} tint={SKY}
        mac={{ name: 's3_clip.mac', from: 1.2 }} phone={{ name: 's6_today.phone', from: 0.2, rate: 0.25 }}
        macFx={<KeyCap at={s(1.3)} />} phoneFx={<ClipNote at={s(1.8)} />} />
    </Sequence>

    {/* 4 · "…it would work" volume, then brightness down and slammed to full */}
    <Sequence from={s(8.5)} durationInFrames={s(3)}>
      <Duo top={<Pop size={60}>volume · <span style={{ color: GOLD }}>brightness</span></Pop>} caption={null} tint={GOLD}
        mac={{ name: 's4_volbright.mac', from: 1.0, rate: 2 }} phone={{ name: 's4_volbright.phone', from: 1.0, rate: 2 }}
        macFx={<><Dim keys={[[s(1.75), 0], [s(2.2), 0.85], [s(2.85), 0.85], [s(2.9), 0]]} /><Flare at={s(2.9)} /></>} />
    </Sequence>

    {/* DROP · "I never knew" */}
    <Sequence from={s(11.5)} durationInFrames={s(1.5)}><Drop /></Sequence>

    {/* 5–11 · montage, a cut every 2 beats */}
    <Sequence from={s(13.0)} durationInFrames={s(1.4)}><Solo v={{ name: 's5_player.phone', from: 2.4 }} label="synced lyrics" tint={VIOLET} /></Sequence>
    <Sequence from={s(14.4)} durationInFrames={s(1.4)}><Solo v={{ name: 's12_holo.phone', from: 4.0 }} label="holographic now playing" tint={VIOLET} /></Sequence>
    <Sequence from={s(15.8)} durationInFrames={s(1.4)}><Solo v={{ name: 's6_today.phone', from: 0.4 }} label="AI plans my day" tint={GOLD} /></Sequence>
    <Sequence from={s(17.2)} durationInFrames={s(1.4)}><Solo v={{ name: 's7_cricket.phone', from: 1.4 }} label="cricket buzz, live" tint={'#FF6B7A'} /></Sequence>
    <Sequence from={s(18.6)} durationInFrames={s(1.4)}><Solo v={{ name: 's10_feed.phone', from: 1.4 }} label="my X feed, summarised" tint={SKY} /></Sequence>
    <Sequence from={s(20.0)} durationInFrames={s(1.4)}><Solo v={{ name: 's9_news.phone', from: 2.2 }} label="news, summarised by AI" tint={'#7EE0A1'} /></Sequence>
    <Sequence from={s(21.4)} durationInFrames={s(1.4)}><Solo v={{ name: 's11_yt.phone', from: 1.2 }} label="any YouTube video, explained" tint={'#FF6B7A'} /></Sequence>
    <Sequence from={s(22.8)} durationInFrames={s(1.4)}><Solo v={{ name: 's8_well.phone', from: 3.2 }} label="ends my doomscrolling" tint={GOLD} /></Sequence>

    {/* 10 · end card */}
    <Sequence from={s(24.2)} durationInFrames={REEL_DURATION - s(24.2)}><End /></Sequence>
  </AbsoluteFill>
  </Clean.Provider>
);
