<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { openUrl } from '../lib/open.ts';
  import XPostView from '../components/XPost.svelte';
  import { app, loadNews, loadX, type Story } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  const CATS = ['world', 'india', 'ai', 'startups', 'feed'] as const;
  const NAMES = { world: 'World', india: 'India', ai: 'AI & Tech', startups: 'AI Startups', feed: 'My feed' };
  type Cat = (typeof CATS)[number];
  let cat = $state<Cat>('world');
  $effect(() => { if (cat === 'feed') void loadX(); else void loadNews(cat); });

  const items = $derived(cat === 'feed' ? [] : (app.news[cat] ?? app.home?.news[cat] ?? []));
  const stories = $derived<Story[]>(cat === 'feed' ? [] : (app.digest[cat]?.stories ?? app.home?.news.digest?.[cat] ?? []));
  const x = $derived(app.x ?? app.home?.x ?? null);
  // headlines already covered by a top story aren't repeated below
  const covered = $derived(new Set(stories.flatMap((s) => s.sources.map((x) => x.url))));
  const latest = $derived(items.filter((n) => !covered.has(n.url)));
  const hide = (e: Event) => ((e.currentTarget as HTMLElement).style.display = 'none');
  const srcLine = (s: Story) => `${s.sources[0]?.source ?? ''}${s.sources.length > 1 ? ` +${s.sources.length - 1}` : ''}`;
</script>

<main class="app stack page-enter">
  <header><div class="label">Updated {ago(app.home?.news.updatedAt)}</div><h1>News</h1></header>
  <div class="chips">
    {#each CATS as c}<button class="chip" aria-pressed={cat === c} onclick={() => (cat = c)}>{NAMES[c]}</button>{/each}
  </div>

  {#if cat === 'feed'}
    {#if x?.digest?.lines.length}
      <section class="card">
        <div class="card__title"><h3>What your people are saying</h3><span class="label ai"><Icon name="sparkle" size={12} /> AI</span></div>
        <ul class="digest">{#each x.digest.lines as l}<li>{l}</li>{/each}</ul>
      </section>
    {/if}
    <div class="label row-label">Top posts from people you follow{#if x?.at}&nbsp;· {ago(x.at)}{/if}</div>
    <section class="card">
      {#each x?.feed ?? [] as p (p.id)}
        <XPostView {p} />
      {:else}
        <p class="muted">Nothing yet. Your Mac collects these from X: run <code>agent-reach login twitter</code> once, then <code>sh mac-companion/koro-mac.sh x --force</code>.</p>
      {/each}
    </section>
  {:else}
  {#if stories.length}
    <div class="label row-label"><Icon name="sparkle" size={12} /> Top stories · summarised by AI</div>
    {@const lead = stories[0]!}
    <button class="card lead" onclick={() => openUrl(lead.url)}>
      {#if lead.image}<img class="lead__img" src={lead.image} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hide} />{/if}
      <div class="lead__body">
        <h2>{lead.title}</h2>
        {#if lead.summary}<p>{lead.summary}</p>{/if}
        <span class="meta">{srcLine(lead)} · {ago(lead.publishedAt)}</span>
      </div>
    </button>
    <section class="card">
      {#each stories.slice(1) as s (s.url)}
        <button class="story" onclick={() => openUrl(s.url)}>
          <div class="story__text">
            <b>{s.title}</b>
            {#if s.summary}<p>{s.summary}</p>{/if}
            <span class="meta">{srcLine(s)} · {ago(s.publishedAt)}</span>
          </div>
          {#if s.image}<img src={s.image} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hide} />{/if}
        </button>
      {/each}
    </section>
  {/if}

  <div class="label row-label">Latest</div>
  <section class="card">
    {#each latest as n (n.id)}
      <button class="item" onclick={() => openUrl(n.url)}>
        <div class="item__text">
          <b>{n.title}</b>
          {#if n.desc}<p>{n.desc}</p>{/if}
          <span class="meta"><span class="src">{n.source}</span> · {ago(n.publishedAt)}</span>
        </div>
        {#if n.image}<img src={n.image} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hide} />{/if}
      </button>
    {:else}
      <p class="muted">No headlines yet.</p>
    {/each}
  </section>
  {/if}
</main>

<style>
  .row-label { display: flex; gap: 6px; align-items: center; margin-bottom: -4px; }
  .row-label :global(svg) { color: var(--gold-text); }
  .ai { display: inline-flex; gap: 4px; align-items: center; color: var(--gold-text); }
  .digest { margin: 0; padding-left: 18px; display: grid; gap: 6px; line-height: 1.45; color: var(--text-2); }
  code { font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .meta { font-size: var(--fs-xs); color: var(--text-3); }
  .src { font-weight: 650; color: var(--accent-text); }

  .lead { padding: 0; overflow: hidden; text-align: left; display: block; }
  .lead__img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--surface-3); }
  .lead__body { padding: var(--s4); display: flex; flex-direction: column; gap: 6px; }
  .lead h2 { font-size: var(--fs-lg); line-height: 1.3; }
  .lead p { color: var(--text-2); line-height: 1.45; }

  .story, .item { display: grid; grid-template-columns: 1fr auto; gap: var(--s3); width: 100%; text-align: left; padding: var(--s3) 0;
                  border-bottom: 1px solid var(--line); content-visibility: auto; contain-intrinsic-size: auto 96px; }
  .story:first-child, .item:first-child { padding-top: 0; }
  .story:last-child, .item:last-child { border-bottom: 0; padding-bottom: 0; }
  .story__text, .item__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .story b, .item b { font-weight: 650; line-height: 1.35; }
  .story p, .item p { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.4;
                      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .story img, .item img { width: 76px; height: 76px; object-fit: cover; border-radius: 10px; background: var(--surface-3); }
</style>
