<script lang="ts">
  import { openUrl } from '../lib/open.ts';
  import type { XPost } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  /** One post from X: text, photos (tap to open), videos (tap to play inline), counts. */
  let { p, compact = false }: { p: XPost; compact?: boolean } = $props();
  const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
  const photos = $derived(p.media.filter((m) => m.type === 'photo'));
  const video = $derived(p.media.find((m) => m.type === 'video'));
  const hide = (e: Event) => ((e.currentTarget as HTMLElement).style.display = 'none');
</script>

<article class="post" class:compact>
  <button class="post__head" onclick={() => openUrl(p.url)}>
    <span class="avatar">{p.author[0]?.toUpperCase()}</span>
    <b>@{p.author}</b>
    <span class="meta">· {ago(p.createdAt)}</span>
  </button>
  {#if p.text}<button class="post__text" onclick={() => openUrl(p.url)}>{p.text}</button>{/if}
  {#if p.quoted}<div class="quote"><b>@{p.quoted.author}</b> {p.quoted.text}</div>{/if}
  {#if video && !compact}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video class="media" src={video.url} poster={video.poster} controls preload="none" playsinline></video>
  {:else if video && compact && video.poster}
    <button class="media-btn" onclick={() => openUrl(p.url)} aria-label="Play video on X">
      <img class="media" src={video.poster} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={hide} /><span class="play">▶</span>
    </button>
  {/if}
  {#if photos.length && !(video && compact)}
    <div class="photos" class:grid={photos.length > 1}>
      {#each photos.slice(0, compact ? 1 : 4) as m}
        <button class="media-btn" onclick={() => openUrl(p.url)} aria-label="Open photo on X">
          <img class="media" src={m.url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hide} />
        </button>
      {/each}
    </div>
  {/if}
  {#if !compact}
    <div class="counts"><span>♥ {k(p.likes)}</span><span>⟲ {k(p.retweets)}</span><span>💬 {k(p.replies)}</span>{#if p.views}<span>👁 {k(p.views)}</span>{/if}</div>
  {/if}
</article>

<style>
  .post { display: flex; flex-direction: column; gap: 8px; padding: var(--s3) 0; border-bottom: 1px solid var(--line); content-visibility: auto; contain-intrinsic-size: auto 160px; }
  .post button { padding: 0; }
  .post:first-child { padding-top: 0; } .post:last-child { border-bottom: 0; padding-bottom: 0; }
  .post__head { display: flex; align-items: center; gap: 8px; text-align: left; }
  .avatar { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-text); font-weight: 700; font-size: 13px; flex: none; }
  .post__head b { font-size: var(--fs-sm); }
  .meta { font-size: var(--fs-xs); color: var(--text-3); }
  .post__text { text-align: left; white-space: pre-line; line-height: 1.45; user-select: text; }
  .compact .post__text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
  .quote { font-size: var(--fs-sm); color: var(--text-2); padding: 8px 10px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line); }
  .photos { display: grid; gap: 4px; }
  .photos.grid { grid-template-columns: 1fr 1fr; }
  .media-btn { position: relative; display: block; width: 100%; }
  .media { width: 100%; max-height: 420px; object-fit: cover; border-radius: 12px; background: var(--surface-3); }
  .photos.grid .media { aspect-ratio: 1; }
  .play { position: absolute; inset: 0; display: grid; place-items: center; font-size: 32px; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
  .counts { display: flex; gap: var(--s4); font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
</style>
