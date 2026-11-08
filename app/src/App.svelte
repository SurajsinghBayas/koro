<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './components/Icon.svelte';
  import { native } from './lib/native.ts';
  import { app, init, loadHome, refreshAll, rescheduleAll, startMacLoop, startMediaLoop, sync, type Tab } from './lib/store.svelte.ts';
  import { dissolve } from './lib/util.ts';
  import Desk from './screens/Desk.svelte';
  import Home from './screens/Home.svelte';
  import Lists from './screens/Lists.svelte';
  import Matches from './screens/Matches.svelte';
  import News from './screens/News.svelte';
  import Settings from './screens/Settings.svelte';
  import Wellbeing from './screens/Wellbeing.svelte';
  import PullRefresh from './components/PullRefresh.svelte';

  void init().then(rescheduleAll);

  // Foreground only: refresh on return, live score every 30 s while a tracked match is live, else every 5 min.
  $effect(() => {
    const onVis = () => { if (!document.hidden) void refreshAll(); };
    document.addEventListener('visibilitychange', onVis);
    const online = () => void sync();
    window.addEventListener('online', online);
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const liveNow = (app.home?.matches.live.length ?? 0) > 0;
      t = setTimeout(async () => { if (!document.hidden && app.tab === 'home') await loadHome(); loop(); }, liveNow ? 30_000 : 300_000);
    };
    loop();
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', online); clearTimeout(t); };
  });

  // Now playing: polled only while Home or desk mode is on screen
  $effect(() => {
    if (!app.ready || !(app.tab === 'home' || app.desk)) return;
    const stopMac = untrack(startMacLoop);
    const stopMedia = untrack(startMediaLoop); // the loops read app state; don't let that re-trigger this effect
    return () => { stopMac(); stopMedia(); };
  });

  // Battery saver hint → disable animations
  $effect(() => {
    const b = app.battery;
    if (b && b.pct < 20 && !b.charging) document.documentElement.dataset.power = 'save';
    else delete document.documentElement.dataset.power;
  });

  function enterDesk() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const t = document.documentElement.dataset.theme;
    dissolve(() => { app.desk = true; void native.desk(true); }, (t ? t === 'dark' : dark) ? '#000' : '#F3F6FA');
  }
  function exitDesk() {
    const bg = getComputedStyle(document.body).backgroundColor;
    dissolve(() => { app.desk = false; void native.desk(false); }, bg);
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'matches', label: 'Matches', icon: 'ball' },
    { id: 'news', label: 'News', icon: 'news' },
    { id: 'well', label: 'Wellbeing', icon: 'heart' },
    { id: 'lists', label: 'Lists', icon: 'list' },
  ];
  function go(t: Tab) {
    if (app.tab === t) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
    native.vibrate(6);
    const swap = () => { app.tab = t; scrollTo({ top: 0 }); };
    // View Transitions where supported (Chromium WebView), plain swap otherwise
    (document as any).startViewTransition ? (document as any).startViewTransition(swap) : swap();
  }
  const live = $derived(app.home?.matches.live[0]);
</script>

{#if !app.ready}
  <div class="splash"><span class="logo">KORO</span></div>
{:else if app.desk}
  <Desk onExit={exitDesk} />
{:else}
  {#if live?.summary && app.tab === 'home'}
    <button class="pill" onclick={() => go('matches')}><span class="dot"></span>{live.summary.body.split(' · ')[0]}</button>
  {/if}

  {#if app.tab === 'home'}<Home onDesk={enterDesk} />
  {:else if app.tab === 'matches'}<Matches />
  {:else if app.tab === 'news'}<News />
  {:else if app.tab === 'well'}<Wellbeing />
  {:else if app.tab === 'lists'}<Lists />
  {:else}<Settings />{/if}

  <nav class="tabbar">
    {#each TABS as t}
      <button class="tab" aria-current={app.tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
        <Icon name={t.icon} size={24} />{t.label}
      </button>
    {/each}
  </nav>
{/if}

<PullRefresh />
{#if app.toast}<div class="toast" role="status">{app.toast}</div>{/if}

<style>
  .splash { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg); color: var(--text-3); letter-spacing: .4em; font-size: 14px; }
  .pill { position: fixed; top: calc(var(--safe-top) + 10px); left: 50%; z-index: 30; display: flex; align-items: center; gap: 8px;
          height: 36px; padding: 0 14px 0 12px; background: var(--chrome); color: var(--text); border-radius: 999px;
          box-shadow: inset 0 0 0 1px var(--line-strong), 0 4px 14px var(--elev); font: 700 13px var(--font-body);
          font-variant-numeric: tabular-nums; transform: translate(-50%, -80px); }
  .pill .dot { width: 8px; height: 8px; background: var(--danger); }
  @supports (animation-timeline: scroll()) {
    .pill { animation: pill-in linear both; animation-timeline: scroll(root); animation-range: 380px 440px; }
    @keyframes pill-in { to { transform: translate(-50%, 0); } }
  }
  .toast { position: fixed; left: 50%; bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 14px); transform: translateX(-50%);
           max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 12px; z-index: 60;
           background: var(--text); color: var(--bg); font-size: var(--fs-sm); font-weight: 600; white-space: pre-line; box-shadow: 0 6px 24px var(--elev);
           animation: toast-in var(--t-med) var(--ease-out); }
  @keyframes toast-in { from { opacity: 0; transform: translate(-50%, 10px); } }
</style>
