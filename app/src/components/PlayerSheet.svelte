<script lang="ts">
  import Icon from './Icon.svelte';
  import { native, type MediaQueue } from '../lib/native.ts';
  import { request } from '../lib/api.ts';
  import { app, mediaControl, paired, toast } from '../lib/store.svelte.ts';

  /** Full player for YT Music / YouTube / Spotify: synced lyrics, up next, the app's own buttons, play anything by name. */
  let { onClose, start = 'lyrics' }: { onClose: () => void; start?: 'lyrics' | 'queue' | 'play' } = $props();
  type Lyr = { synced: { t: number; x: string }[] | null; plain: string | null } | null;
  // svelte-ignore state_referenced_locally
  let tab = $state<'lyrics' | 'queue' | 'play'>(start);
  let lyrics = $state<Lyr | 'loading'>('loading');
  let queue = $state<MediaQueue>({ items: [], customs: [] });
  let q = $state('');
  let target = $state<'music' | 'yt'>('music');
  const PKG = { music: 'com.google.android.apps.youtube.music', yt: 'com.google.android.youtube' };
  const MIXES = ['My Supermix', 'Liked music', 'Discover Mix', 'New Release Mix', 'Arijit Singh radio', 'Workout'];

  const m = $derived(app.media);
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 250); return () => clearInterval(t); });
  const pos = $derived(m ? Math.min(m.duration || Infinity, (m.position ?? 0) + (m.playing ? Math.max(0, now - m.at) : 0)) : 0);
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function portal(node: HTMLElement) { document.body.appendChild(node); return { destroy: () => node.remove() }; }

  // Lyrics + queue reload when the track changes
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

  const lines = $derived(lyrics && lyrics !== 'loading' ? lyrics.synced : null);
  const cur = $derived.by(() => { if (!lines) return -1; let i = 0; for (let k = 0; k < lines.length; k++) if (lines[k]!.t <= pos + 300) i = k; return i; });
  let box: HTMLElement | undefined = $state();
  $effect(() => {
    if (cur < 0 || !box || tab !== 'lyrics') return;
    box.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  async function play(query: string) {
    if (!query.trim()) return;
    const r = await native.mediaAction({ type: 'search', query: query.trim(), pkg: PKG[target] });
    toast(r.ok ? `Playing “${query.trim()}” in ${target === 'music' ? 'YT Music' : 'YouTube'}` : 'Could not start playback');
    if (r.ok) { q = ''; setTimeout(loadQueue, 3000); }
  }
  async function custom(action: string, name: string) {
    native.vibrate(8);
    await native.mediaAction({ type: 'custom', action });
    toast(name);
    setTimeout(loadQueue, 800);
  }
  async function jump(id: number) { await native.mediaAction({ type: 'queue', id }); setTimeout(loadQueue, 800); }
  const seek = (e: Event) => mediaControl('seek', +(e.currentTarget as HTMLInputElement).value);
</script>

<div class="player" use:portal role="dialog" aria-modal="true" aria-label="Player">
  <header class="bar">
    <button class="icon-btn" onclick={onClose} aria-label="Close"><Icon name="back" /></button>
    <div class="np">
      {#if m?.art}<img src={m.art} alt="" />{/if}
      <div class="t"><b>{m?.title ?? 'Nothing playing'}</b><span>{m?.artist ?? ''}{m?.app ? ` · ${m.app}` : ''}</span></div>
    </div>
  </header>

  {#if m?.active}
    <div class="ctrl">
      <span class="num">{fmt(pos)}</span>
      <input type="range" min="0" max={m.duration || 1} value={pos} onchange={seek} disabled={!m.canSeek} aria-label="Seek" />
      <span class="num">{fmt(m.duration ?? 0)}</span>
    </div>
    <div class="btns">
      <button onclick={() => mediaControl('prev')} aria-label="Previous"><Icon name="prev" /></button>
      <button class="main" onclick={() => mediaControl('toggle')} aria-label="Play or pause"><Icon name={m.playing ? 'pause' : 'play'} size={26} /></button>
      <button onclick={() => mediaControl('next')} aria-label="Next"><Icon name="next" /></button>
    </div>
    {#if queue.customs.length}
      <div class="chips cust">{#each queue.customs as c (c.action)}<button class="chip" onclick={() => custom(c.action, c.name)}>{c.name}</button>{/each}</div>
    {/if}
  {/if}

  <div class="tabs">
    <button aria-pressed={tab === 'lyrics'} onclick={() => (tab = 'lyrics')}><Icon name="lyrics" size={16} /> Lyrics</button>
    <button aria-pressed={tab === 'queue'} onclick={() => { tab = 'queue'; void loadQueue(); }}><Icon name="queue" size={16} /> Up next</button>
    <button aria-pressed={tab === 'play'} onclick={() => (tab = 'play')}><Icon name="search" size={16} /> Play</button>
  </div>

  <div class="body" bind:this={box}>
    {#if tab === 'lyrics'}
      {#if !m?.title}<p class="muted pad">Play something in YT Music to see lyrics.</p>
      {:else if lyrics === 'loading'}<p class="muted pad">Finding lyrics…</p>
      {:else if lines?.length}
        <div class="lyr">{#each lines as l, i (i)}<button data-i={i} class:on={i === cur} class:past={i < cur} onclick={() => m?.canSeek && mediaControl('seek', l.t)}>{l.x || '♪'}</button>{/each}</div>
      {:else if lyrics?.plain}<pre class="plain">{lyrics.plain}</pre>
      {:else}<p class="muted pad">No lyrics found for this song.</p>{/if}
    {:else if tab === 'queue'}
      {#each queue.items as it (it.id)}
        <button class="qi" class:on={it.active} onclick={() => jump(it.id)}><b>{it.title}</b><span>{it.subtitle}</span>{#if it.active}<i class="eq">♪</i>{/if}</button>
      {:else}<p class="muted pad">{m?.active ? `${m.app ?? 'This app'} isn't sharing its queue right now. Start a playlist or radio and it shows up here.` : 'Nothing playing.'}</p>{/each}
    {:else}
      <div class="seg">
        <button class:on={target === 'music'} onclick={() => (target = 'music')}>YT Music</button>
        <button class:on={target === 'yt'} onclick={() => (target = 'yt')}>YouTube</button>
      </div>
      <form class="find" onsubmit={(e) => { e.preventDefault(); void play(q); }}>
        <input class="input" bind:value={q} placeholder={target === 'music' ? 'Song, artist, album or playlist' : 'Video or channel'} enterkeyhint="go" />
        <button class="btn" disabled={!q.trim()}>Play</button>
      </form>
      {#if target === 'music'}
        <div class="label">Quick picks</div>
        <div class="chips wrap">{#each MIXES as x}<button class="chip" onclick={() => play(x)}>{x}</button>{/each}</div>
      {/if}
      <p class="hint">Koro asks {target === 'music' ? 'YT Music' : 'YouTube'} to play the best match, the same way “Hey Google, play …” does. Your Premium account, downloads and background play all keep working.</p>
    {/if}
  </div>
</div>

<style>
  .player { position: fixed; inset: 0; z-index: 55; background: var(--bg); display: flex; flex-direction: column; animation: up var(--t-med) var(--ease-out); }
  @keyframes up { from { transform: translateY(24px); opacity: 0; } }
  .bar { display: flex; align-items: center; gap: 10px; padding: calc(var(--safe-top) + 8px) 14px 8px; }
  .np { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
  .np img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; }
  .np .t { display: flex; flex-direction: column; min-width: 0; }
  .np b, .np span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .np span { font-size: var(--fs-xs); color: var(--text-3); }
  .ctrl { display: flex; align-items: center; gap: 10px; padding: 4px 18px; font-size: var(--fs-xs); color: var(--text-3); }
  .ctrl input { flex: 1; accent-color: var(--gold); }
  .btns { display: flex; justify-content: center; align-items: center; gap: 18px; padding: 4px 0 8px; }
  .btns button { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 999px; color: var(--text); }
  .btns .main { width: 60px; height: 60px; background: var(--gold); color: var(--gold-ink); }
  .cust { justify-content: center; padding: 0 16px 6px; flex-wrap: wrap; }
  .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 4px 16px; background: var(--surface-2); border-radius: 12px; padding: 4px; }
  .tabs button { display: inline-flex; gap: 6px; justify-content: center; align-items: center; height: 36px; border-radius: 9px; font-weight: 600; font-size: var(--fs-sm); color: var(--text-2); }
  .tabs button[aria-pressed="true"] { background: var(--surface-1); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
  .body { flex: 1; overflow-y: auto; padding: 8px 16px calc(var(--safe-bottom) + 24px); overscroll-behavior: contain; }
  .pad { padding: 24px 4px; }
  .lyr { display: flex; flex-direction: column; gap: 4px; padding: 30vh 0; }
  .lyr button { text-align: left; font-size: 1.35rem; font-weight: 700; line-height: 1.3; color: var(--text-3); opacity: .55; padding: 4px 0; transition: color .25s, opacity .25s, transform .25s; transform-origin: left center; }
  .lyr button.past { opacity: .35; }
  .lyr button.on { color: var(--text); opacity: 1; transform: scale(1.03); }
  .plain { white-space: pre-wrap; font: 600 1.05rem/1.6 var(--font-body); color: var(--text-2); }
  .qi { display: grid; grid-template-columns: 1fr auto; text-align: left; width: 100%; padding: 10px 4px; border-bottom: 1px solid var(--line); }
  .qi b { font-weight: 600; grid-column: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qi span { grid-column: 1; font-size: var(--fs-xs); color: var(--text-3); }
  .qi .eq { grid-column: 2; grid-row: 1 / 3; align-self: center; color: var(--gold-text); font-style: normal; }
  .qi.on b { color: var(--gold-text); }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: var(--surface-2); border-radius: 12px; padding: 4px; margin: 8px 0 12px; }
  .seg button { height: 36px; border-radius: 9px; font-weight: 600; color: var(--text-2); }
  .seg button.on { background: var(--surface-1); color: var(--text); }
  .find { display: flex; gap: 8px; margin-bottom: 14px; }
  .find .input { flex: 1; }
  .find .btn { min-height: 48px; padding: 0 18px; }
  .chips.wrap { flex-wrap: wrap; margin: 6px 0 14px; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); line-height: 1.45; }
</style>
