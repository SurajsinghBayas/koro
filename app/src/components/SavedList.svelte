<script lang="ts">
  import Icon from './Icon.svelte';
  import { openUrl } from '../lib/open.ts';
  import { app, blocks, markRead, remove, saveForLater, savedList, sync, type Saved } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  /** Read later: list + offline reader (full text and AI summary are stored in the synced row). */
  let open = $state<Saved | null>(null);
  let url = $state('');
  const list = $derived(savedList());
  const pending = $derived(list.some((x) => x.status === 'pending' || !x.status));
  const cur = $derived(open ? (app.saved.find((x) => x.id === open!.id) ?? open) : null);
  /** Render at <body> level so page transforms and the tab bar can't cover the reader. */
  function portal(node: HTMLElement) { document.body.appendChild(node); return { destroy: () => node.remove() }; }
  const mins = (w?: number | null) => (w ? `${Math.max(1, Math.round(w / 220))} min read` : '');

  // While articles are being fetched on the server, pull the result every 8 s.
  $effect(() => {
    if (!pending) return;
    const t = setInterval(() => void sync(), 8000);
    return () => clearInterval(t);
  });

  function add(e: SubmitEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return;
    saveForLater(u);
    url = '';
  }
  function close() { if (cur && !cur.read_at) markRead(cur); open = null; }
</script>

<form class="add" onsubmit={add}>
  <input class="input" bind:value={url} placeholder="Paste a link to read later" inputmode="url" autocapitalize="off" />
  <button class="btn" disabled={!url.trim()}>Save</button>
</form>
<p class="hint">Tip: in any app, Share → Koro → Read later.</p>

<section class="card">
  {#each list as x (x.id)}
    <div class="sv" class:read={!!x.read_at}>
      <button class="main" onclick={() => (open = x)}>
        <div class="tx">
          <b>{x.title || x.url}</b>
          {#if x.status === 'pending' || !x.status}<span class="meta pend">Fetching full article…</span>
          {:else if x.status === 'failed'}<span class="meta">Couldn't fetch the text · tap to open the link</span>
          {:else}<span class="meta">{x.site ?? ''}{x.words ? ` · ${mins(x.words)}` : ''}{x.read_at ? ' · read' : ''}</span>{/if}
        </div>
        {#if x.image}<img src={x.image} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}
      </button>
      <button class="del" onclick={() => remove('saved', x.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
    </div>
  {:else}
    <p class="muted">Nothing saved yet. Articles you save are kept in full on your phone, so they work offline.</p>
  {/each}
</section>

{#if cur}
  <div class="reader" use:portal role="dialog" aria-modal="true" aria-label={cur.title ?? 'Article'}>
    <header class="rbar">
      <button class="icon-btn" onclick={close} aria-label="Back"><Icon name="back" /></button>
      <span class="site">{cur.site ?? ''}</span>
      <button class="icon-btn" onclick={() => openUrl(cur.url)} aria-label="Open original"><Icon name="link" /></button>
    </header>
    <article>
      {#if cur.image}<img class="hero" src={cur.image} alt="" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}
      <h1>{cur.title || cur.url}</h1>
      <div class="meta">{mins(cur.words)}{cur.read_at ? ` · read ${ago(cur.read_at)}` : ''}</div>
      {#if cur.summary}
        <div class="sum"><div class="label"><Icon name="sparkle" size={12} /> Summary</div>
          <ul>{#each cur.summary.split('\n') as l}<li>{l.replace(/^[-•]\s*/, '')}</li>{/each}</ul></div>
      {/if}
      {#each blocks(cur) as b, i (i)}
        {#if b.t === 'h'}<h2>{b.x}</h2>
        {:else if b.t === 'li'}<p class="li">• {b.x}</p>
        {:else if b.t === 'q'}<blockquote>{b.x}</blockquote>
        {:else}<p>{b.x}</p>{/if}
      {:else}
        <p class="muted">{cur.status === 'failed' ? "This page couldn't be read offline." : 'The full text is still being fetched.'} <button class="lnk" onclick={() => openUrl(cur.url)}>Open the original</button></p>
      {/each}
      <div class="foot">
        <button class="btn btn--ghost" onclick={() => { markRead(cur, !cur.read_at); }}>{cur.read_at ? 'Mark unread' : 'Mark read'}</button>
        <button class="btn btn--ghost" onclick={() => { remove('saved', cur.id); open = null; }}>Delete</button>
      </div>
    </article>
  </div>
{/if}

<style>
  .add { display: flex; gap: 8px; }
  .add .input { flex: 1; }
  .add .btn { min-height: 48px; padding: 0 18px; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); margin-top: -6px; }
  .sv { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); }
  .sv:last-child { border-bottom: 0; }
  .sv.read { opacity: .6; }
  .main { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr auto; gap: var(--s3); text-align: left; padding: var(--s3) 0; }
  .tx { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .tx b { font-weight: 650; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .main img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; }
  .meta { font-size: var(--fs-xs); color: var(--text-3); }
  .pend { color: var(--gold-text); }
  .del { width: 36px; height: 36px; display: grid; place-items: center; color: var(--text-3); }
  .reader { position: fixed; inset: 0; z-index: 55; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; animation: rin var(--t-med) var(--ease-out); }
  @keyframes rin { from { opacity: 0; transform: translateY(16px); } }
  .rbar { position: sticky; top: 0; display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 8px) 12px 8px; background: var(--chrome); backdrop-filter: blur(12px); z-index: 1; }
  .rbar .site { flex: 1; text-align: center; font-size: var(--fs-sm); color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  article { max-width: 680px; margin: 0 auto; padding: var(--s4) 20px calc(var(--safe-bottom) + 48px); }
  .hero { width: 100%; border-radius: 14px; aspect-ratio: 16/9; object-fit: cover; margin-bottom: var(--s4); }
  article h1 { font-size: 1.5rem; line-height: 1.25; }
  article .meta { margin: 6px 0 var(--s4); }
  .sum { background: var(--surface-1); border-radius: 14px; padding: var(--s3) var(--s4); box-shadow: inset 0 0 0 1px var(--line); margin-bottom: var(--s5, 20px); }
  .sum .label { display: flex; gap: 4px; align-items: center; color: var(--gold-text); }
  .sum ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; line-height: 1.45; color: var(--text-2); font-size: var(--fs-sm); }
  article p { font-size: 1.04rem; line-height: 1.65; margin: 0 0 1em; color: var(--text); }
  article p.li { margin-bottom: .4em; padding-left: .5em; }
  article h2 { font-size: 1.15rem; margin: 1.4em 0 .5em; }
  blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--gold); color: var(--text-2); font-style: italic; line-height: 1.6; }
  .foot { display: flex; gap: 8px; margin-top: var(--s5, 20px); }
  .foot .btn { flex: 1; min-height: 44px; }
  .lnk { color: var(--accent-text); background: none; text-decoration: underline; }
</style>
