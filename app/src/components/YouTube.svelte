<script lang="ts">
  import Icon from './Icon.svelte';
  import ExplainSheet from './ExplainSheet.svelte';
  import { openUrl } from '../lib/open.ts';
  import { addYtChannel, app, loadYt, removeYtChannel, toast, type YtVideo } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  /** New videos from followed channels, each with an AI summary. */
  $effect(() => { void loadYt(); });
  let input = $state('');
  let busy = $state(false);
  let manage = $state(false);
  let expanded = $state<Record<string, boolean>>({});
  let reading = $state<YtVideo | null>(null);
  const yt = $derived(app.yt);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    busy = true;
    try { await addYtChannel(input.trim()); input = ''; } catch (err) { toast((err as Error).message); }
    busy = false;
  }
</script>

<div class="row between">
  <div class="label">{yt?.channels.length ?? 0} channel{yt?.channels.length === 1 ? '' : 's'}{#if yt?.at} · checked {ago(yt.at)}{/if}</div>
  <button class="label linkish" onclick={() => (manage = !manage)}>{manage ? 'Done' : 'Channels ›'}</button>
</div>

{#if manage || !yt?.channels.length}
  <section class="card stack">
    <form class="add" onsubmit={add}>
      <input class="input" bind:value={input} placeholder="@handle or channel link" autocapitalize="off" disabled={busy} />
      <button class="btn" disabled={busy || !input.trim()}>{busy ? '…' : 'Follow'}</button>
    </form>
    {#each yt?.channels ?? [] as c (c.id)}
      <div class="ch"><span>{c.title}{#if c.handle}<span class="muted"> · {c.handle}</span>{/if}</span>
        <button class="del" onclick={() => removeYtChannel(c.id)} aria-label="Unfollow {c.title}"><Icon name="x" size={16} /></button></div>
    {:else}
      <p class="hint">Add the channels you watch, e.g. <b>@mkbhd</b> or a youtube.com link. Koro checks them every 30 min and summarises new videos.</p>
    {/each}
  </section>
{/if}

{#each yt?.videos ?? [] as v (v.id)}
  <article class="card vid">
    <button class="thumb" onclick={() => openUrl(`https://www.youtube.com/watch?v=${v.id}`)} aria-label="Watch {v.title}">
      <img src={v.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="play"><Icon name="play" size={22} /></span>
    </button>
    <div class="body">
      <b>{v.title}</b>
      <span class="meta">{v.channel} · {ago(v.publishedAt)}</span>
      {#if v.summary?.length}
        <ul class:clip={!expanded[v.id]}>{#each v.summary as l}<li>{l}</li>{/each}</ul>
        <div class="row between">
          <span class="label ai"><Icon name="sparkle" size={12} /> AI · from {v.from === 'transcript' ? 'transcript' : 'description'}</span>
          {#if v.summary.length > 2}<button class="label linkish" onclick={() => (expanded[v.id] = !expanded[v.id])}>{expanded[v.id] ? 'Less' : 'More'}</button>{/if}
        </div>
      {:else}
        <span class="meta pend">Summary on the way…</span>
      {/if}
      <button class="explain" onclick={() => (reading = v)}><Icon name="lyrics" size={16} /> {v.hasExplain ? 'Read full explanation' : 'Full explanation'} <span>PDF · Markdown</span></button>
    </div>
  </article>
{:else}
  {#if yt?.channels.length}<p class="muted">No new videos in the last two weeks.</p>{/if}
{/each}

{#if reading}<ExplainSheet v={reading} onClose={() => (reading = null)} />{/if}

<style>
  .linkish { background: none; color: var(--accent-text); }
  .add { display: flex; gap: 8px; }
  .add .input { flex: 1; }
  .add .btn { min-height: 48px; padding: 0 18px; }
  .ch { display: flex; justify-content: space-between; align-items: center; min-height: 40px; border-bottom: 1px solid var(--line); }
  .ch:last-child { border-bottom: 0; }
  .del { width: 36px; height: 36px; display: grid; place-items: center; color: var(--text-3); }
  .hint { font-size: var(--fs-sm); color: var(--text-3); line-height: 1.45; }
  .vid { padding: 0; overflow: hidden; }
  .thumb { position: relative; display: block; width: 100%; padding: 0; }
  .thumb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; background: var(--surface-3); }
  .play { position: absolute; right: 10px; bottom: 10px; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 999px; background: rgba(0,0,0,.65); color: #fff; }
  .body { padding: var(--s3) var(--s4) var(--s4); display: flex; flex-direction: column; gap: 6px; }
  .body b { font-weight: 650; line-height: 1.35; }
  .meta { font-size: var(--fs-xs); color: var(--text-3); }
  .pend { color: var(--gold-text); }
  ul { margin: 2px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: var(--fs-sm); line-height: 1.45; color: var(--text-2); }
  ul.clip li:nth-child(n + 3) { display: none; }
  .explain { margin-top: 6px; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 12px; font-weight: 650; font-size: var(--fs-sm);
             color: var(--text); background: linear-gradient(135deg, rgba(94,200,255,.16), rgba(195,139,255,.14) 50%, rgba(242,193,78,.14)); box-shadow: inset 0 0 0 1px var(--line); }
  .explain span { margin-left: auto; font-size: 11px; color: var(--text-3); font-weight: 600; }
  .ai { display: inline-flex; gap: 4px; align-items: center; color: var(--gold-text); }
</style>
