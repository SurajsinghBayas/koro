<script lang="ts">
  import Icon from './Icon.svelte';
  import { native } from '../lib/native.ts';
  import { mdToHtml } from '../lib/md.ts';
  import { explainVideo, toast, type Explain, type YtVideo } from '../lib/store.svelte.ts';
  import { openUrl } from '../lib/open.ts';
  import { ago } from '../lib/util.ts';

  /** Full written explanation of a YouTube video: read here, save as PDF / Markdown, share. */
  let { v, onClose }: { v: YtVideo; onClose: () => void } = $props();
  let e = $state<Explain>({ status: 'pending', waiting: 'transcript' });
  let busy = $state('');
  function portal(node: HTMLElement) { document.body.appendChild(node); return { destroy: () => node.remove() }; }

  $effect(() => {
    let stop = false, t: ReturnType<typeof setTimeout>;
    const poll = async (ask: boolean) => {
      try { e = await explainVideo(v.id, ask); } catch (err) { e = { status: 'failed', error: (err as Error).message }; }
      if (!stop && e.status === 'pending') t = setTimeout(() => poll(false), 8000);
    };
    void poll(true);
    return () => { stop = true; clearTimeout(t); };
  });

  const file = $derived(`${v.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80).trim()} - Koro`);
  const words = $derived(e.md ? e.md.split(/\s+/).length : 0);
  async function save(kind: 'pdf' | 'md' | 'txt') {
    if (!e.md) return;
    busy = kind;
    const text = kind === 'txt' ? e.md.replace(/^#+\s*/gm, '').replace(/\*\*/g, '') : e.md;
    const r = await native.saveFile(kind === 'pdf' ? { name: `${file}.pdf`, md: e.md, pdf: true } : { name: `${file}.${kind}`, text, mime: kind === 'md' ? 'text/markdown' : 'text/plain' });
    busy = '';
    if (r.error) return toast(r.error);
    toast(`Saved to Downloads/Koro as ${kind.toUpperCase()}`);
    if (r.uri && r.uri !== 'print' && kind === 'pdf') void native.openUri(r.uri, 'application/pdf');
  }
  async function copy() { if (e.md) { await navigator.clipboard?.writeText(e.md).catch(() => {}); toast('Copied'); } }
</script>

<div class="ex" use:portal role="dialog" aria-modal="true" aria-label="Video explanation">
  <header class="bar">
    <button class="icon-btn" onclick={onClose} aria-label="Back"><Icon name="back" /></button>
    <span class="t">Full explanation</span>
    <button class="icon-btn" onclick={() => openUrl(`https://www.youtube.com/watch?v=${v.id}`)} aria-label="Watch on YouTube"><Icon name="play" /></button>
  </header>

  <div class="scroll">
    <div class="hero">
      <img src={v.thumb} alt="" referrerpolicy="no-referrer" />
      <div class="shine" aria-hidden="true"></div>
    </div>
    <div class="head">
      <h1>{v.title}</h1>
      <div class="meta">{v.channel} · {ago(v.publishedAt)}{#if e.status === 'ready'} · {Math.max(1, Math.round(words / 220))} min read · from {e.from === 'transcript' ? 'full transcript' : 'description'}{/if}</div>
    </div>

    {#if e.status === 'ready' && e.md}
      <div class="actions">
        <button class="act gold" onclick={() => save('pdf')} disabled={!!busy}><Icon name="bookmark" size={18} /><span>{busy === 'pdf' ? 'Saving…' : 'PDF'}</span></button>
        <button class="act" onclick={() => save('md')} disabled={!!busy}><Icon name="news" size={18} /><span>Markdown</span></button>
        <button class="act" onclick={() => save('txt')} disabled={!!busy}><Icon name="list" size={18} /><span>Text</span></button>
        <button class="act" onclick={() => native.shareText(e.md!, v.title)}><Icon name="link" size={18} /><span>Share</span></button>
        <button class="act" onclick={copy}><Icon name="copy" size={18} /><span>Copy</span></button>
      </div>
      <article class="md">{@html mdToHtml(e.md)}</article>
    {:else if e.status === 'pending'}
      <div class="wait">
        <div class="orb" aria-hidden="true"></div>
        <b>{e.waiting === 'writing' ? 'Writing the full explanation…' : 'Getting the transcript from your Mac…'}</b>
        <p>{e.waiting === 'writing' ? 'This takes about a minute for a long video.' : 'Your Mac fetches it within a few minutes. If there are no subtitles, Koro explains it from the description.'} You can leave this screen. It keeps going.</p>
      </div>
    {:else}
      <div class="wait"><b>Couldn't explain this video</b><p>{e.error ?? 'Try again in a few minutes.'}</p></div>
    {/if}
  </div>
</div>

<style>
  .ex { position: fixed; inset: 0; z-index: 56; background: var(--bg); display: flex; flex-direction: column; animation: rin var(--t-med) var(--ease-out); }
  @keyframes rin { from { opacity: 0; transform: translateY(16px); } }
  .bar { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 8px) 14px 8px; background: var(--chrome); }
  .bar .t { text-align: center; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-3); }
  .scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding-bottom: calc(var(--safe-bottom) + 40px); }
  .hero { position: relative; margin: 8px 16px 0; border-radius: 16px; overflow: hidden; aspect-ratio: 16 / 9; box-shadow: 0 10px 30px var(--elev), inset 0 0 0 1px var(--line); }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .shine { position: absolute; inset: 0; mix-blend-mode: color-dodge; opacity: .22; pointer-events: none;
           background: repeating-linear-gradient(115deg, #F2C14E 0 6%, #5EC8FF 12%, #C38BFF 18%, #F2C14E 24%); background-size: 300% 300%; animation: sheen 12s linear infinite; }
  @keyframes sheen { to { background-position: 300% 0; } }
  .head { padding: 16px 20px 4px; }
  .head h1 { font-size: 1.35rem; line-height: 1.3; }
  .meta { margin-top: 6px; font-size: var(--fs-xs); color: var(--text-3); }
  .actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 12px 16px 4px; }
  .act { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0; border-radius: 12px; font-size: 11px; font-weight: 650; color: var(--text-2); background: var(--surface-2); min-width: 0; }
  .act.gold { background: var(--gold); color: var(--gold-ink); }
  .act:disabled { opacity: .6; }
  .md { padding: 8px 20px; color: var(--text); font-size: 1.02rem; line-height: 1.65; }
  .md :global(h2) { font-size: 1.35rem; margin: 0 0 .4em; display: none; }
  .md :global(h3) { font-size: 1.12rem; margin: 1.5em 0 .5em; color: var(--accent-text); }
  .md :global(h4) { font-size: 1rem; margin: 1.2em 0 .4em; }
  .md :global(p) { margin: 0 0 .9em; }
  .md :global(ul), .md :global(ol) { margin: 0 0 1em; padding-left: 1.25em; display: grid; gap: .35em; }
  .md :global(blockquote) { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--gold); color: var(--text-2); font-style: italic; }
  .md :global(code) { font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .md :global(hr) { border: 0; border-top: 1px solid var(--line); margin: 1.4em 0; }
  .wait { margin: 40px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .wait p { color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5; }
  .orb { width: 64px; height: 64px; border-radius: 999px; background: conic-gradient(#5EC8FF, #C38BFF, #FF8FC7, #F2C14E, #5EC8FF); animation: spin 2.4s linear infinite; filter: blur(1px);
         mask: radial-gradient(circle, transparent 52%, #000 54%); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
