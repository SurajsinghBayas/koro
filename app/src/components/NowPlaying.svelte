<script lang="ts">
  import { native } from '../lib/native.ts';
  import { app, mediaControl } from '../lib/store.svelte.ts';
  import Icon from './Icon.svelte';
  import PlayerSheet from './PlayerSheet.svelte';

  /** Holo trading card for whatever is playing on the phone. `compact` = one-line version for desk mode. */
  let { compact = false }: { compact?: boolean } = $props();

  const m = $derived(app.media);
  let now = $state(Date.now());
  $effect(() => {
    if (!m?.playing) return;
    const iv = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(iv);
  });
  const pos = $derived(m ? Math.min(m.duration || Infinity, (m.position ?? 0) + (m.playing ? Math.max(0, now - m.at) : 0)) : 0);
  const pct = $derived(m?.duration ? Math.min(1, pos / m.duration) : 0);
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Tint the card with the artwork's colour (16×16 average, saturated a little).
  let sheet = $state<null | 'lyrics' | 'queue' | 'play'>(null);
  let tint = $state('');
  $effect(() => {
    const src = m?.art;
    if (!src) { tint = ''; return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i]!, d[i + 1]!, d[i + 2]!), mn = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
          const w = 1 + (mx - mn) / 32; // favour colourful pixels over greys
          r += d[i]! * w; g += d[i + 1]! * w; b += d[i + 2]! * w; n += w;
        }
        tint = `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
      } catch { tint = ''; }
    };
    img.src = src;
  });

  // Foil + tilt follow the finger; nothing animates at rest.
  let card: HTMLElement | undefined = $state();
  let active = $state(false);
  function move(e: PointerEvent) {
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
    card.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
    card.style.setProperty('--o', '.6');
    active = true;
  }
  function leave() {
    active = false;
    card?.style.setProperty('--rx', '0deg'); card?.style.setProperty('--ry', '0deg'); card?.style.setProperty('--o', '.3');
  }
</script>

{#if m && m.access === false}
  {#if !compact}
    <button class="card ask" onclick={() => native.openSettings('media')}>
      <Icon name="music" />
      <span><b>Show what's playing</b><span class="muted">Allow Koro in Notification access to see Spotify, YT Music and more here.</span></span>
    </button>
  {/if}
{:else if !compact && m?.access && !m.active}
  <button class="card ask" onclick={() => (sheet = 'play')}>
    <Icon name="music" />
    <span><b>Play something</b><span class="muted">Pick a song, artist or mix in YT Music or YouTube.</span></span>
  </button>
{:else if m?.active && m.title}
  {#if compact}
    <section role="group" aria-label="Now playing" class="holo holo--mini" class:is-active={active} bind:this={card} style:--tint={tint || 'var(--sky-500)'}
      onpointermove={move} onpointerleave={leave} onpointerup={leave} onpointercancel={leave}>
      <button class="m-art" onclick={(e) => { e.stopPropagation(); sheet = 'lyrics'; }} aria-label="Open player">
        {#if m.art}<img src={m.art} alt="" />{:else}<div class="ph"><Icon name="music" /></div>{/if}
        {#if m.playing}<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
      </button>
      <div class="m-text">
        <span class="label">{m.app}</span>
        <b>{m.title}</b>
        <span class="sub">{m.artist}</span>
        <i class="bar"><i style="transform: scaleX({pct})"></i></i>
      </div>
      <div class="m-ctl">
        <button class="ctl ctl--sm" onclick={(e) => { e.stopPropagation(); mediaControl('prev'); }} aria-label="Previous"><Icon name="prev" size={18} /></button>
        <button class="ctl ctl--main ctl--mid" onclick={(e) => { e.stopPropagation(); mediaControl('toggle'); }} aria-label={m.playing ? 'Pause' : 'Play'}><Icon name={m.playing ? 'pause' : 'play'} size={22} /></button>
        <button class="ctl ctl--sm" onclick={(e) => { e.stopPropagation(); mediaControl('next'); }} aria-label="Next"><Icon name="next" size={18} /></button>
      </div>
    </section>
  {:else}
    <section role="group" aria-label="Now playing" class="holo" class:is-active={active} bind:this={card} style:--tint={tint || 'var(--sky-500)'}
      onpointermove={move} onpointerleave={leave} onpointerup={leave} onpointercancel={leave}>
      <div class="art">
        {#if m.art}<img src={m.art} alt="" />{:else}<div class="ph"><Icon name="music" size={48} /></div>{/if}
        <span class="app-chip">{m.app}</span>
        {#if m.playing}<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
      </div>
      <div class="info">
        <div class="label">Now playing</div>
        <h2 class="title">{m.title}</h2>
        <div class="artist">{m.artist}{m.album && m.album !== m.title ? ` · ${m.album}` : ''}</div>
        {#if m.duration}
          <div class="progress">
            <span class="num">{fmt(pos)}</span>
            <i class="bar"><i style="transform: scaleX({pct})"></i></i>
            <span class="num">{fmt(m.duration)}</span>
          </div>
        {/if}
        <div class="controls">
          <button class="ctl" disabled={m.canPrev === false} onclick={() => mediaControl('prev')} aria-label="Previous"><Icon name="prev" /></button>
          <button class="ctl ctl--main" onclick={() => mediaControl('toggle')} aria-label={m.playing ? 'Pause' : 'Play'}>
            <Icon name={m.playing ? 'pause' : 'play'} size={28} />
          </button>
          <button class="ctl" disabled={m.canNext === false} onclick={() => mediaControl('next')} aria-label="Next"><Icon name="next" /></button>
        </div>
        <div class="more">
          <button onclick={() => (sheet = 'lyrics')}><Icon name="lyrics" size={16} /> Lyrics</button>
          <button onclick={() => (sheet = 'queue')}><Icon name="queue" size={16} /> Up next</button>
          <button onclick={() => (sheet = 'play')}><Icon name="search" size={16} /> Play…</button>
        </div>
      </div>
    </section>
  {/if}
{/if}

{#if sheet}<PlayerSheet start={sheet} onClose={() => (sheet = null)} />{/if}

<style>
  .ask { display: flex; gap: var(--s3); align-items: center; text-align: left; }
  .more { display: flex; gap: 6px; margin-top: 10px; position: relative; z-index: 3; }
  .more button { flex: 1; display: inline-flex; gap: 5px; justify-content: center; align-items: center; height: 34px; border-radius: 999px;
                 font-size: var(--fs-xs); font-weight: 650; color: var(--text-2); background: color-mix(in oklab, var(--surface-2) 70%, transparent); }
  .ask > span { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-sm); }

  /* ---- holo card ---- */
  .holo {
    position: relative; overflow: hidden; touch-action: pan-y; padding: 12px;
    background:
      linear-gradient(160deg, color-mix(in oklab, var(--tint) 26%, transparent), transparent 70%),
      linear-gradient(160deg, light-dark(#FFFFFF, #0B2550), light-dark(#EEF3F9, #04102A) 60%, light-dark(#DFE7F1, #000));
    box-shadow: 0 10px 30px var(--elev), inset 0 0 0 1px var(--line);
    transform: perspective(800px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    transition: transform 500ms var(--ease-spring);
  }
  .holo.is-active { transition: none; }
  .holo::before { /* gold foil that shifts under the finger */
    content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
    mix-blend-mode: color-dodge; opacity: var(--o, .3);
    background:
      radial-gradient(farthest-corner circle at var(--mx, 50%) var(--my, 30%), rgba(255,255,255,.5), transparent 45%),
      repeating-linear-gradient(115deg, #F2C14E 0 6%, #5EC8FF 12%, #C9D1DC 18%, #F2C14E 24%);
    background-size: 100% 100%, 300% 300%;
    background-position: center, var(--mx, 50%) var(--my, 50%);
  }
  :global(:root[data-theme="light"]) .holo::before { mix-blend-mode: multiply; opacity: calc(var(--o, .3) * .5); }
  @media (prefers-color-scheme: light) { :global(:root:not([data-theme="dark"])) .holo::before { mix-blend-mode: multiply; opacity: calc(var(--o, .3) * .5); } }
  .holo::after { content: ""; position: absolute; inset: 6px; box-shadow: inset 0 0 0 2px rgba(242,193,78,.65); pointer-events: none; z-index: 3; }

  .art { position: relative; aspect-ratio: 1; overflow: hidden; background: var(--surface-3); }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  .ph { width: 100%; height: 100%; display: grid; place-items: center; color: var(--text-3); }
  .app-chip { position: absolute; left: 10px; top: 10px; z-index: 1; padding: 4px 10px; border-radius: 999px;
              background: rgba(0,0,0,.62); color: #fff; font-size: var(--fs-xs); font-weight: 650; letter-spacing: .04em; }
  .eq { position: absolute; right: 12px; top: 12px; display: flex; gap: 3px; align-items: flex-end; height: 16px; z-index: 1; }
  .eq i { width: 4px; background: var(--gold); height: 40%; animation: eq 900ms ease-in-out 6 alternate; }
  .eq i:nth-child(2) { animation-delay: -300ms; height: 90%; } .eq i:nth-child(3) { animation-delay: -600ms; height: 60%; }
  @keyframes eq { to { transform: scaleY(.4); } }
  .eq i { transform-origin: bottom; }

  .info { position: relative; z-index: 1; padding: var(--s4) var(--s2) var(--s2); }
  .title { margin-top: 2px; font-size: var(--fs-xl); line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .artist { color: var(--text-2); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--s2); margin-top: var(--s3); font-size: var(--fs-xs); color: var(--text-3); }
  .bar { display: block; height: 4px; background: var(--track); overflow: hidden; border-radius: 2px; }
  .bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold), var(--accent)); transform-origin: left; transition: transform 1s linear; }
  .controls { position: relative; z-index: 4; display: flex; justify-content: center; align-items: center; gap: var(--s5); margin-top: var(--s3); }
  .ctl { width: 48px; height: 48px; display: grid; place-items: center; color: var(--text); border-radius: 999px; }
  .ctl:disabled { opacity: .35; }
  .ctl--main { width: 64px; height: 64px; background: var(--gold); color: var(--gold-ink); box-shadow: 0 6px 18px rgba(242,193,78,.35); }
  .ctl:active { transform: scale(.94); }

  /* ---- compact holo (desk mode) ---- */
  .holo--mini { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 10px 14px 10px 10px; border-radius: 4px; }
  .holo--mini::after { inset: 4px; }
  .m-art { position: relative; z-index: 4; width: 76px; height: 76px; overflow: hidden; padding: 0; background: var(--surface-3); }
  .m-art img, .m-art .ph { width: 100%; height: 100%; object-fit: cover; }
  .m-art .eq { right: 6px; top: auto; bottom: 6px; height: 12px; }
  .m-text { position: relative; z-index: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; text-align: left; }
  .m-text .label { font-size: 10px; }
  .m-text b { color: var(--text); font-size: 1.02rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-text .sub { font-size: var(--fs-xs); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-text .bar { margin-top: 6px; }
  .m-ctl { position: relative; z-index: 4; display: flex; align-items: center; gap: 2px; }
  .ctl--sm { width: 40px; height: 40px; }
  .ctl--mid { width: 52px; height: 52px; }
</style>
