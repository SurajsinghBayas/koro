<script lang="ts">
  import { openUrl } from '../lib/open.ts';
  import { app, loadNews } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  const CATS = ['tech', 'india', 'world', 'cricket'] as const;
  let cat = $state<(typeof CATS)[number]>('tech');
  $effect(() => { void loadNews(cat); });
  const items = $derived(app.news[cat] ?? app.home?.news[cat] ?? []);
</script>

<main class="app stack page-enter">
  <header><div class="label">Updated {ago(app.home?.news.updatedAt)}</div><h1>News</h1></header>
  <div class="chips">
    {#each CATS as c}<button class="chip" aria-pressed={cat === c} onclick={() => (cat = c)}>{c[0]!.toUpperCase() + c.slice(1)}</button>{/each}
  </div>
  <section class="card">
    {#each items as n (n.id)}
      <button class="item" onclick={() => openUrl(n.url)}>
        <b>{n.title}</b>
        <span>{n.source} · {ago(n.publishedAt)}</span>
      </button>
    {:else}
      <p class="muted">No headlines yet.</p>
    {/each}
  </section>
</main>

<style>
  .item { display: block; width: 100%; text-align: left; padding: var(--s3) 0; border-bottom: 1px solid var(--line); content-visibility: auto; contain-intrinsic-size: auto 64px; }
  .item:last-child { border-bottom: 0; }
  .item b { display: block; font-weight: 600; line-height: 1.35; }
  .item span { font-size: var(--fs-xs); color: var(--text-3); }
</style>
