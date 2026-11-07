<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, macSend, sendClipboardToMac } from '../lib/store.svelte.ts';

  /** Remote for the paired Mac (via the Koro agent). `compact` = desk mode row. */
  let { compact = false }: { compact?: boolean } = $props();
  const mac = $derived(app.mac ?? app.home?.mac ?? null);
  let vol = $state<number | null>(null);
  $effect(() => { if (mac?.volume !== null && mac?.volume !== undefined) vol = mac.volume; });
  let t: ReturnType<typeof setTimeout>;
  function setVol(v: number) { vol = v; clearTimeout(t); t = setTimeout(() => macSend({ type: 'cmd', cmd: 'volume', value: v }), 250); }
  const cmd = (c: string) => (e: Event) => { e.stopPropagation(); void macSend({ type: 'cmd', cmd: c }); };
  let confirmSleep = $state(false);
</script>

{#if compact}
  <div class="mc-row">
    <span class="lab"><Icon name="laptop" size={16} /> Mac</span>
    <button class="b" onclick={cmd('prev')} aria-label="Previous on Mac"><Icon name="prev" size={18} /></button>
    <button class="b" onclick={cmd('toggle')} aria-label="Play/pause on Mac"><Icon name="play" size={18} /></button>
    <button class="b" onclick={cmd('next')} aria-label="Next on Mac"><Icon name="next" size={18} /></button>
    <button class="b" onclick={cmd('voldown')} aria-label="Mac volume down"><Icon name="minus" size={18} /></button>
    <button class="b" onclick={cmd('volup')} aria-label="Mac volume up"><Icon name="plus" size={18} /></button>
    <button class="b" onclick={cmd('lock')} aria-label="Lock Mac"><Icon name="lock" size={18} /></button>
  </div>
{:else}
  <section class="card">
    <div class="card__title">
      <h3>Mac</h3>
      <span class="label" class:on={mac?.online}>{mac?.online ? '● Online' : 'Offline'}</span>
    </div>
    <div class="grid">
      <button class="k" onclick={cmd('prev')}><Icon name="prev" /><span>Prev</span></button>
      <button class="k k--main" onclick={cmd('toggle')}><Icon name="play" /><span>Play/Pause</span></button>
      <button class="k" onclick={cmd('next')}><Icon name="next" /><span>Next</span></button>
      <button class="k" onclick={cmd('lock')}><Icon name="lock" /><span>Lock</span></button>
      <button class="k" class:warn={confirmSleep} onclick={(e) => { if (confirmSleep) { cmd('sleep')(e); confirmSleep = false; } else { confirmSleep = true; setTimeout(() => (confirmSleep = false), 3000); } }}>
        <Icon name="moon" /><span>{confirmSleep ? 'Tap again' : 'Sleep'}</span>
      </button>
      <button class="k" onclick={() => sendClipboardToMac()}><Icon name="copy" /><span>Send clip</span></button>
    </div>
    <div class="vol">
      <button class="icon-btn sm" onclick={cmd('mute')} aria-label="Mute Mac"><Icon name={mac?.muted ? 'mute' : 'vol'} size={18} /></button>
      <input type="range" min="0" max="100" step="5" value={vol ?? 50} oninput={(e) => setVol(+(e.currentTarget as HTMLInputElement).value)} aria-label="Mac volume" />
      <span class="num">{vol ?? '–'}</span>
    </div>
    {#if mac && !mac.online}<p class="hint">Commands wait up to a minute for the Mac to come online. Run <code>koro-mac.sh install</code> on the Mac if it never does.</p>{/if}
  </section>
{/if}

<style>
  .label.on { color: var(--success, #3c9d5d); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .k { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 12px;
       background: var(--surface-2); font-size: var(--fs-xs); font-weight: 600; color: var(--text-2); }
  .k:active { transform: scale(.96); }
  .k--main { background: var(--gold); color: var(--gold-ink); }
  .k.warn { background: var(--danger); color: #fff; }
  .vol { display: flex; align-items: center; gap: var(--s3); margin-top: var(--s3); }
  .vol input { flex: 1; accent-color: var(--accent); }
  .vol .num { min-width: 28px; text-align: right; font-size: var(--fs-sm); color: var(--text-2); }
  .sm { width: 36px; height: 36px; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); margin-top: var(--s2); }
  code { font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .mc-row { display: flex; align-items: center; gap: 2px; }
  .mc-row .lab { display: inline-flex; gap: 6px; align-items: center; font-size: var(--fs-xs); color: var(--text-3); margin-right: auto; }
  .mc-row .b { width: 40px; height: 40px; display: grid; place-items: center; color: var(--text-2); border-radius: 999px; }
  .mc-row .b:active { background: var(--surface-2); }
</style>
