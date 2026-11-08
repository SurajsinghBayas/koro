<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, macSend, sendClipboardToMac } from '../lib/store.svelte.ts';

  /** Remote for the paired Mac (via the Koro agent). `compact` = desk mode row. */
  let { compact = false }: { compact?: boolean } = $props();
  const mac = $derived(app.mac ?? app.home?.mac ?? null);
  // app-wide startMacLoop keeps app.mac live (media, volume, brightness)
  const np = $derived(mac?.media ?? null);
  let vol = $state<number | null>(null);
  let bri = $state<number | null>(null);
  // follow the Mac live, except right after you moved the slider yourself
  let touched = { volume: 0, brightness: 0 };
  $effect(() => { const v = mac?.volume; if (v !== null && v !== undefined && Date.now() - touched.volume > 2500) vol = v; });
  $effect(() => { const v = mac?.brightness; if (v !== null && v !== undefined && Date.now() - touched.brightness > 2500) bri = v; });
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  function slide(kind: 'volume' | 'brightness', v: number) {
    touched[kind] = Date.now();
    if (kind === 'volume') vol = v; else bri = v;
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(() => macSend({ type: 'cmd', cmd: kind, value: v }), 220);
  }
  const cmd = (c: string, extra: { app?: string } = {}) => (e: Event) => { e.stopPropagation(); void macSend({ type: 'cmd', cmd: c, ...extra }); };
  let confirmSleep = $state(false);
  const APPS = ['Finder', 'WhatsApp', 'Cursor', 'Terminal', 'Antigravity IDE', 'Microsoft Word'];
  const short = (a: string) => a.replace('Microsoft ', '').replace(' IDE', '');
</script>

{#if compact}
  <div class="mc-row">
    <button class="b" onclick={cmd('prev')} aria-label="Previous on Mac"><Icon name="prev" size={18} /></button>
    <button class="b" onclick={cmd('toggle')} aria-label="Play/pause on Mac"><Icon name={np?.playing ? 'pause' : 'play'} size={18} /></button>
    <button class="b" onclick={cmd('next')} aria-label="Next on Mac"><Icon name="next" size={18} /></button>
    <button class="b" onclick={cmd('voldown')} aria-label="Mac volume down"><Icon name="minus" size={18} /></button>
    <button class="b" onclick={cmd('volup')} aria-label="Mac volume up"><Icon name="plus" size={18} /></button>
    <button class="b" onclick={cmd('brightdown')} aria-label="Mac dimmer"><Icon name="moon" size={18} /></button>
    <button class="b" onclick={cmd('brightup')} aria-label="Mac brighter"><Icon name="sun" size={18} /></button>
    <button class="b" onclick={cmd('lock')} aria-label="Lock Mac"><Icon name="lock" size={18} /></button>
  </div>
{:else}
  <section class="card mac">
    <div class="card__title">
      <h3>Mac</h3>
      <span class="label" class:on={mac?.online}>{mac?.online ? '● Online' : 'Offline'}</span>
    </div>

    {#if np}
      <div class="np" class:on={np.playing}>
        <div class="eq" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="np-t">
          <span class="np-l">{np.playing ? 'Playing on your Mac' : 'Paused on your Mac'} · {np.app}</span>
          <b>{np.title}</b>
          {#if np.artist}<span class="np-a">{np.artist}</span>{/if}
        </div>
      </div>
    {/if}
    <div class="transport">
      <button class="t" onclick={cmd('prev')} aria-label="Previous"><Icon name="prev" /></button>
      <button class="t main" onclick={cmd('toggle')} aria-label="Play or pause"><Icon name={np?.playing ? 'pause' : 'play'} size={24} /></button>
      <button class="t" onclick={cmd('next')} aria-label="Next"><Icon name="next" /></button>
    </div>

    <div class="sl">
      <button class="ico" onclick={cmd('mute')} aria-label="Mute Mac"><Icon name={mac?.muted ? 'mute' : 'vol'} size={18} /></button>
      <input type="range" min="0" max="100" step="2" value={vol ?? 50} oninput={(e) => slide('volume', +(e.currentTarget as HTMLInputElement).value)} aria-label="Mac volume" />
      <span class="num">{vol ?? '–'}</span>
    </div>
    <div class="sl">
      <span class="ico"><Icon name="sun" size={18} /></span>
      <input type="range" min="0" max="100" step="2" value={bri ?? 60} oninput={(e) => slide('brightness', +(e.currentTarget as HTMLInputElement).value)} aria-label="Mac brightness" />
      <span class="num">{bri ?? '–'}</span>
    </div>

    <div class="grid">
      <button class="k" onclick={cmd('lock')}><Icon name="lock" /><span>Lock</span></button>
      <button class="k" class:active={mac?.asleep} onclick={cmd('sleeptoggle')}><Icon name="moon" /><span>{mac?.asleep ? 'Sleep: on' : 'Sleep: off'}</span></button>
      <button class="k" class:active={mac?.awake} onclick={cmd('awake')}><Icon name="bolt" /><span>{mac?.awake ? 'Awake: on' : 'Keep awake'}</span></button>
      <button class="k" onclick={cmd('ring')}><Icon name="music" /><span>Find Mac</span></button>
      <button class="k" onclick={() => sendClipboardToMac()}><Icon name="copy" /><span>Send clip</span></button>
      <button class="k" class:warn={confirmSleep} onclick={(e) => { if (confirmSleep) { cmd('sleep')(e); confirmSleep = false; } else { confirmSleep = true; setTimeout(() => (confirmSleep = false), 3000); } }}>
        <Icon name="moon" /><span>{confirmSleep ? 'Tap again' : 'Deep sleep'}</span>
      </button>
    </div>

    <button class="work" onclick={cmd('workmode')}><Icon name="laptop" size={18} /> Work mode <span>WhatsApp · Terminal · Gmail</span></button>
    <div class="label apps-l">Open on Mac</div>
    <div class="apps">{#each APPS as a}<button onclick={cmd('openapp', { app: a })}>{short(a)}</button>{/each}</div>

    {#if mac && !mac.online}<p class="hint">Commands wait up to a minute for the Mac to come online.</p>{:else}<p class="hint">Sleep turns the Mac's screen off and back on. Deep sleep sleeps the whole Mac (wake it from the Mac).</p>{/if}
  </section>
{/if}

<style>
  .label.on { color: var(--success); }
  .np { display: flex; gap: 12px; align-items: center; padding: 12px 14px; margin: 0 0 12px; border-radius: 16px; min-width: 0;
    background: linear-gradient(135deg, rgba(242,193,78,.14), rgba(120,140,255,.10)); border: 1px solid rgba(255,255,255,.08); }
  .np-t { display: grid; gap: 2px; min-width: 0; }
  .np-t b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .np-l, .np-a { font-size: 12px; color: var(--text-2, var(--muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .eq { display: flex; gap: 3px; align-items: flex-end; height: 18px; flex: none; }
  .eq i { width: 3px; height: 30%; border-radius: 2px; background: var(--gold); }
  .np.on .eq i { animation: eq .9s ease-in-out infinite alternate; }
  .np.on .eq i:nth-child(2) { animation-delay: -.3s; } .np.on .eq i:nth-child(3) { animation-delay: -.6s; }
  @keyframes eq { from { height: 25%; } to { height: 100%; } }
  .transport { display: grid; grid-template-columns: repeat(3, 64px); justify-content: center; gap: 20px; margin: 2px 0 10px; }
  .t { width: 52px; height: 52px; justify-self: center; display: grid; place-items: center; border-radius: 999px; color: var(--text); background: var(--surface-2); }
  .t.main { width: 60px; height: 60px; background: var(--gold); color: var(--gold-ink); box-shadow: 0 6px 18px rgba(242,193,78,.3); }
  .t:active { transform: scale(.94); }
  .sl { display: grid; grid-template-columns: 36px minmax(0, 1fr) 32px; align-items: center; gap: 10px; min-height: 40px; }
  .ico { width: 36px; height: 36px; display: grid; place-items: center; color: var(--text-2); border-radius: 10px; }
  .sl input { width: 100%; accent-color: var(--accent); }
  .sl .num { text-align: right; font-size: var(--fs-sm); color: var(--text-2); }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
  .k { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 12px; min-width: 0;
       background: var(--surface-2); font-size: var(--fs-xs); font-weight: 600; color: var(--text-2); }
  .k:active { transform: scale(.96); }
  .k.active { color: var(--accent-text); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .k.warn { background: var(--danger); color: #fff; }
  .work { margin-top: 12px; width: 100%; display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border-radius: 12px; font-weight: 700; color: var(--gold-ink); background: var(--gold); }
  .work span { margin-left: auto; font-size: 11px; font-weight: 600; opacity: .75; }
  .apps-l { margin: 14px 0 6px; }
  .apps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .apps button { height: 36px; border-radius: 10px; font-size: var(--fs-xs); font-weight: 650; color: var(--text-2); box-shadow: inset 0 0 0 1px var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 6px; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); margin-top: var(--s2); }
  .mc-row { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); }
  .mc-row .b { height: 40px; display: grid; place-items: center; color: var(--text-2); border-radius: 999px; }
  .mc-row .b:active { background: var(--surface-2); }
</style>
