<script lang="ts">
  import Icon from './Icon.svelte';
  import { native, type MediaQueue } from '../lib/native.ts';
  import { request } from '../lib/api.ts';
  import { app, mediaControl, paired, toast } from '../lib/store.svelte.ts';

  /** Full-screen holographic player: synced lyrics, up next, the app's own buttons, play anything by name. */
  let { onClose, start = 'lyrics' }: { onClose: () => void; start?: 'lyrics' | 'queue' | 'play' } = $props();
  type Lyr = { synced: { t: number; x: string }[] | null; plain: string | null } | null;
  // svelte-ignore state_referenced_locally
  let tab = $state<'lyrics' | 'queue' | 'play'>(start);
  let lyrics = $state<Lyr | 'loading'>('loading');
  let queue = $state<MediaQueue>({ items: [], customs: [] });
  let q = $state('');
  let target = $state<'music' | 'yt'>('music');
  const PKG = { music: 'com.google.android.apps.youtube.music', yt: 'com.google.android.youtube' };
  // Liked music opens your own list; the rest start a radio from the best matching song
  const MIXES: { label: string; q?: string; uri?: string }[] = [
    { label: 'Liked music', uri: 'https://music.youtube.com/watch?list=LM' },
    { label: 'Arijit Singh radio', q: 'Arijit Singh' }, { label: 'Punjabi hits', q: 'Punjabi hits 2024' },
    { label: 'Lofi chill', q: 'lofi chill hindi' }, { label: 'Workout', q: 'workout gym motivation songs' },
    { label: 'Romantic', q: 'bollywood romantic songs' },
  ];
  let busy = $state(false);

  const m = $derived(app.media);
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 250); return () => clearInterval(t); });
  const pos = $derived(m ? Math.min(m.duration || Infinity, (m.position ?? 0) + (m.playing ? Math.max(0, now - m.at) : 0)) : 0);
  const pct = $derived(m?.duration ? Math.min(1, pos / m.duration) : 0);
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function portal(node: HTMLElement) { document.body.appendChild(node); return { destroy: () => node.remove() }; }

  let lastKey = '';
  $effect(() => {
    const key = `${m?.title}|${m?.artist}`;
    if (!m?.title || key === lastKey) return;
    lastKey = key;
    void loadQueue();
    lyrics = 'loading';
    if (!paired()) { lyrics = null; return; }
    const qs = new URLSearchParams({ title: m.title, artist: m.artist ?? '', album: m.album ?? '', duration: String(m.duration ?? 0) });
    request<{ lyrics: Lyr }>(app.cfg.server, `/v1/lyrics?${qs}`, { token: app.cfg.token, timeoutMs: 20_000 })
      .then((r) => { if (lastKey === key) lyrics = r.data?.lyrics ?? null; })
      .catch(() => { if (lastKey === key) lyrics = null; });
  });
  async function loadQueue() { queue = await native.mediaQueue(); }
  // keep custom-action state (Like / Shuffle on…) fresh while open
  $effect(() => { const t = setInterval(loadQueue, 5000); return () => clearInterval(t); });

  const lines = $derived(lyrics && lyrics !== 'loading' ? lyrics.synced : null);
  const cur = $derived.by(() => { if (!lines) return -1; let i = 0; for (let k = 0; k < lines.length; k++) if (lines[k]!.t <= pos + 300) i = k; return i; });
  let box: HTMLElement | undefined = $state();
  $effect(() => {
    if (cur < 0 || !box || tab !== 'lyrics') return;
    // scroll ONLY the lyrics box (scrollIntoView also scrolled the fixed player and pushed the header off-screen)
    const el = box.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.4 + el.offsetHeight / 2), behavior: 'smooth' });
  });

  const iconFor = (name: string) => /dislike/i.test(name) ? 'thumbdown' : /like/i.test(name) ? 'heart' : /shuffle/i.test(name) ? 'shuffle' : /repeat/i.test(name) ? 'repeat' : 'sparkle';
  const isOn = (name: string) => /\b(on|all|one|liked|remove|undo)\b/i.test(name) && !/\boff\b/i.test(name);
  const label = (name: string) => name.replace(/\s+(on|off)$/i, '');

  async function play(query: string) {
    query = query.trim();
    if (!query || busy) return;
    busy = true;
    const music = target === 'music';
    try {
      // YT Music ignores "play from search" from other apps, but a watch link plays at once (+ a radio of similar songs)
      const r = paired() ? await request<{ found: { id: string; title: string; artist: string } | null }>(app.cfg.server,
        `/v1/music/find?${new URLSearchParams({ q: query, target })}`, { token: app.cfg.token, timeoutMs: 15_000 }).catch(() => null) : null;
      const f = r?.data?.found;
      const uri = f ? (music ? `https://music.youtube.com/watch?v=${f.id}&list=RDAMVM${f.id}` : `https://www.youtube.com/watch?v=${f.id}`)
        : (music ? 'https://music.youtube.com/search?q=' : 'https://www.youtube.com/results?search_query=') + encodeURIComponent(query);
      const ok = (await native.mediaAction({ type: 'open', uri, pkg: PKG[target] })).ok;
      toast(!ok ? 'Could not open ' + (music ? 'YT Music' : 'YouTube') : f ? `▶ ${f.title}${f.artist ? ' · ' + f.artist : ''}` : `Showing results for “${query}”`);
      if (ok) { q = ''; setTimeout(loadQueue, 4000); }
    } finally { busy = false; }
  }
  async function mix(x: { label: string; q?: string; uri?: string }) {
    if (x.uri) { const ok = (await native.mediaAction({ type: 'open', uri: x.uri, pkg: PKG.music })).ok; toast(ok ? `▶ ${x.label}` : 'Could not open YT Music'); }
    else await play(x.q ?? x.label);
  }
  async function custom(action: string) {
    native.vibrate(8);
    await native.mediaAction({ type: 'custom', action });
    setTimeout(loadQueue, 600);
  }
  async function jump(id: number) { native.vibrate(6); await native.mediaAction({ type: 'queue', id }); setTimeout(loadQueue, 800); }

  let track: HTMLElement | undefined = $state();
  function seekAt(e: PointerEvent) {
    if (!m?.canSeek || !m.duration || !track) return;
    const r = track.getBoundingClientRect();
    mediaControl('seek', Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * m.duration));
  }
</script>

<div class="player" use:portal role="dialog" aria-modal="true" aria-label="Player">
  <div class="backdrop" aria-hidden="true">{#if m?.art}<img src={m.art} alt="" />{/if}</div>
  <div class="foil" aria-hidden="true"></div>

  <header class="top">
    <button class="round" onclick={onClose} aria-label="Close"><Icon name="chevdown" /></button>
    <span class="src">{m?.app ?? 'Player'}</span>
    <span class="round ghost"></span>
  </header>

  <section class="hero">
    <div class="art">{#if m?.art}<img src={m.art} alt="" />{:else}<Icon name="music" size={32} />{/if}</div>
    <div class="meta">
      <b>{m?.title ?? 'Nothing playing'}</b>
      <span>{m?.artist ?? 'Start a song in YT Music'}</span>
    </div>
  </section>

  {#if m?.active}
    <div class="seek">
      <span class="num">{fmt(pos)}</span>
      <div class="track" bind:this={track} onpointerdown={seekAt} role="slider" tabindex="0" aria-label="Seek" aria-valuemin={0} aria-valuemax={m.duration ?? 0} aria-valuenow={pos}>
        <i style="transform: scaleX({pct})"></i><b style="left: {pct * 100}%"></b>
      </div>
      <span class="num">{fmt(m.duration ?? 0)}</span>
    </div>
    <div class="transport">
      <button class="t" onclick={() => mediaControl('prev')} aria-label="Previous"><Icon name="prev" size={22} /></button>
      <button class="t main" onclick={() => mediaControl('toggle')} aria-label="Play or pause"><Icon name={m.playing ? 'pause' : 'play'} size={28} /></button>
      <button class="t" onclick={() => mediaControl('next')} aria-label="Next"><Icon name="next" size={22} /></button>
    </div>
    {#if queue.customs.length}
      <div class="acts" style:--n={queue.customs.length}>
        {#each queue.customs as c (c.action)}
          <button class:on={isOn(c.name)} onclick={() => custom(c.action)} aria-label={c.name}><Icon name={iconFor(c.name)} size={18} /><span>{label(c.name)}</span></button>
        {/each}
      </div>
    {/if}
  {/if}

  <nav class="seg3">
    <button class:on={tab === 'lyrics'} onclick={() => (tab = 'lyrics')}>Lyrics</button>
    <button class:on={tab === 'queue'} onclick={() => { tab = 'queue'; void loadQueue(); }}>Up next</button>
    <button class:on={tab === 'play'} onclick={() => (tab = 'play')}>Play</button>
  </nav>

  <div class="body" class:fade={tab === 'lyrics'} bind:this={box}>
    {#if tab === 'lyrics'}
      {#if !m?.title}<p class="empty">Play something to see lyrics.</p>
      {:else if lyrics === 'loading'}<p class="empty">Finding lyrics…</p>
      {:else if lines?.length}
        <div class="lyr">{#each lines as l, i (i)}<button data-i={i} class:on={i === cur} class:past={i < cur} onclick={() => m?.canSeek && mediaControl('seek', l.t)}>{l.x || '♪'}</button>{/each}</div>
      {:else if lyrics?.plain}<pre class="plain">{lyrics.plain}</pre>
      {:else}<p class="empty">No lyrics found for this song.</p>{/if}
    {:else if tab === 'queue'}
      <div class="queue">
        {#each queue.items as it, i (it.id)}
          <button class="qi" class:on={it.active} onclick={() => jump(it.id)}>
            <span class="n num">{it.active ? '♪' : i}</span>
            <span class="qt"><b>{it.title}</b><span>{it.subtitle}</span></span>
          </button>
        {:else}<p class="empty">{m?.active ? `${m.app ?? 'This app'} isn't sharing a queue right now. Start a playlist or radio.` : 'Nothing playing.'}</p>{/each}
      </div>
    {:else}
      <div class="play">
        <div class="seg2">
          <button class:on={target === 'music'} onclick={() => (target = 'music')}>YT Music</button>
          <button class:on={target === 'yt'} onclick={() => (target = 'yt')}>YouTube</button>
        </div>
        <form class="find" onsubmit={(e) => { e.preventDefault(); void play(q); }}>
          <Icon name="search" size={18} />
          <input bind:value={q} placeholder={target === 'music' ? 'Song, artist, album, playlist' : 'Video or channel'} enterkeyhint="go" />
          <button disabled={!q.trim()} aria-label="Play"><Icon name="play" size={18} /></button>
        </form>
        {#if target === 'music'}
          <div class="mixes">{#each MIXES as x}<button disabled={busy} onclick={() => mix(x)}>{x.label}</button>{/each}</div>
        {/if}
        <p class="note">{busy ? 'Finding it…' : `Koro finds the best match and opens it in ${target === 'music' ? 'YT Music with a radio of similar songs' : 'YouTube'}. Your Premium keeps working.`}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .player { --g: 20px; position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; overflow: clip; color: #fff;
            background: #05070E; animation: rise var(--t-med) var(--ease-out); padding-top: var(--safe-top); }
  @keyframes rise { from { transform: translateY(32px); opacity: 0; } }
  .backdrop { position: absolute; inset: -40px; z-index: 0; }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(1.5); opacity: .55; transform: scale(1.2); }
  .backdrop::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,7,14,.35), rgba(5,7,14,.82) 45%, #05070E 85%); }
  .foil { position: absolute; inset: 0; z-index: 0; pointer-events: none; mix-blend-mode: color-dodge;
          background: repeating-linear-gradient(115deg, #F2C14E 0 6%, #5EC8FF 12%, #C38BFF 18%, #F2C14E 24%); background-size: 300% 300%;
          animation: sheen 14s linear infinite; opacity: .1; }
  @keyframes sheen { to { background-position: 300% 0; } }
  .player > :not(.backdrop):not(.foil) { position: relative; z-index: 1; }

  .top { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; padding: 8px var(--g); }
  .round { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 999px; background: rgba(255,255,255,.08); color: #fff; }
  .round.ghost { background: none; }
  .src { text-align: center; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.6); }

  .hero { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 14px; align-items: center; padding: 8px var(--g) 4px; }
  .art { width: 72px; height: 72px; border-radius: 14px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,.08);
         box-shadow: 0 10px 30px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(242,193,78,.7); }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  .meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .meta b { font-size: 1.2rem; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .meta span { color: rgba(255,255,255,.65); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .seek { display: grid; grid-template-columns: 38px minmax(0, 1fr) 38px; gap: 10px; align-items: center; padding: 14px var(--g) 0; font-size: 11px; color: rgba(255,255,255,.6); }
  .seek .num:last-child { text-align: right; }
  .track { position: relative; height: 24px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  .track::before { content: ""; position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: rgba(255,255,255,.16); }
  .track i { position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #F2C14E, #5EC8FF, #C38BFF); transform-origin: left; }
  .track b { position: absolute; width: 12px; height: 12px; margin-left: -6px; border-radius: 999px; background: #fff; box-shadow: 0 0 12px rgba(94,200,255,.8); }

  .transport { display: grid; grid-template-columns: repeat(3, 72px); justify-content: center; align-items: center; gap: 18px; padding: 6px 0 4px; }
  .t { width: 56px; height: 56px; justify-self: center; display: grid; place-items: center; border-radius: 999px; color: #fff; }
  .t:active { transform: scale(.94); }
  .t.main { width: 68px; height: 68px; background: #F2C14E; color: #1F1500; box-shadow: 0 8px 24px rgba(242,193,78,.4); }

  .acts { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 8px; padding: 6px var(--g) 2px; }
  .acts button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; border-radius: 12px; color: rgba(255,255,255,.7); font-size: 11px; font-weight: 600; }
  .acts button.on { color: #F2C14E; background: rgba(242,193,78,.12); }

  .seg3, .seg2 { display: grid; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
  .seg3 { grid-template-columns: repeat(3, 1fr); margin: 12px var(--g) 6px; }
  .seg2 { grid-template-columns: 1fr 1fr; }
  .seg3 button, .seg2 button { height: 36px; border-radius: 10px; font-weight: 650; font-size: var(--fs-sm); color: rgba(255,255,255,.6); }
  .seg3 button.on, .seg2 button.on { color: #fff; background: linear-gradient(135deg, rgba(94,200,255,.28), rgba(195,139,255,.22)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }

  .body { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px var(--g) calc(var(--safe-bottom) + 24px); }
  .body.fade { mask-image: linear-gradient(transparent, #000 10%, #000 78%, transparent); }
  .empty { padding: 40px 0; text-align: center; color: rgba(255,255,255,.55); line-height: 1.5; }

  .lyr { display: flex; flex-direction: column; gap: 10px; padding: 12vh 0 40vh; }
  .lyr button { text-align: left; font-size: 1.3rem; font-weight: 750; line-height: 1.3; letter-spacing: -.01em; color: rgba(255,255,255,.32); padding: 2px 0;
                transition: color .3s, transform .3s, filter .3s; transform-origin: left center; filter: blur(.4px); }
  .lyr button.past { color: rgba(255,255,255,.22); }
  .lyr button.on { color: #fff; transform: scale(1.04); filter: none; text-shadow: 0 0 24px rgba(94,200,255,.5); }
  .plain { white-space: pre-wrap; font: 650 1.1rem/1.65 var(--font-body); color: rgba(255,255,255,.8); padding-top: 8px; }

  .queue { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
  .qi { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: center; text-align: left; padding: 10px 10px; border-radius: 12px; color: #fff; }
  .qi:active { background: rgba(255,255,255,.06); }
  .qi.on { background: rgba(242,193,78,.12); box-shadow: inset 0 0 0 1px rgba(242,193,78,.35); }
  .qi .n { color: rgba(255,255,255,.4); font-size: 12px; text-align: center; }
  .qi.on .n { color: #F2C14E; }
  .qt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .qt b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qi.on .qt b { color: #F2C14E; }
  .qt span { font-size: 12px; color: rgba(255,255,255,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .play { display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }
  .find { display: grid; grid-template-columns: 20px minmax(0, 1fr) 44px; gap: 10px; align-items: center; height: 52px; padding: 0 4px 0 16px;
          border-radius: 16px; background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); color: rgba(255,255,255,.6); }
  .find input { background: none; border: 0; outline: 0; color: #fff; font: 500 1rem var(--font-body); min-width: 0; }
  .find input::placeholder { color: rgba(255,255,255,.4); }
  .find button { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px; background: #F2C14E; color: #1F1500; }
  .find button:disabled { opacity: .35; }
  .mixes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .mixes button:disabled { opacity: .5; }
  .mixes button { height: 52px; border-radius: 14px; font-weight: 650; color: #fff; text-align: left; padding: 0 14px;
                  background: linear-gradient(135deg, rgba(94,200,255,.16), rgba(195,139,255,.14) 50%, rgba(242,193,78,.12)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1); }
  .note { font-size: 12px; color: rgba(255,255,255,.45); line-height: 1.5; }
</style>
