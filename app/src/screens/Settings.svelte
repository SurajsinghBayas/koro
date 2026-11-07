<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { request } from '../lib/api.ts';
  import { isNative, native, type PermKind, type Perms } from '../lib/native.ts';
  import { app, loadCalendar, loadWeather, pair, paired, refreshAll, savePrefs, setupPush, toast, unpair } from '../lib/store.svelte.ts';
  import { ago, dissolve } from '../lib/util.ts';

  let server = $state(app.cfg.server || '');
  let code = $state('');
  let name = $state('Galaxy S25');
  let busy = $state(false);
  let error = $state('');
  let perms = $state<Perms | null>(null);
  let pushMsg = $state('');

  async function loadPerms() { perms = await native.permissions(); }
  $effect(() => {
    void loadPerms();
    const onVis = () => { if (!document.hidden) void loadPerms(); };   // back from Android settings
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  async function doPair(e: SubmitEvent) {
    e.preventDefault();
    busy = true; error = '';
    try { await pair(server, code, name); code = ''; toast('Paired ✓'); }
    catch (err) { error = (err as Error).message; }
    busy = false;
  }

  function setTheme(t: 'auto' | 'light' | 'dark') {
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    dissolve(() => { app.prefs.theme = t; void savePrefs(); }, dark ? '#000' : '#F3F6FA');
  }

  async function testPush() {
    pushMsg = await setupPush();
    if (pushMsg === 'Push ready' || pushMsg.startsWith('Push not configured')) {
      await request(app.cfg.server, '/v1/push/test', { token: app.cfg.token, body: {} }).catch(() => {});
      pushMsg += ' · test sent';
    }
  }

  const PERMS: { key: keyof Perms; kind: PermKind; label: string; why: string }[] = [
    { key: 'notifications', kind: 'notifications', label: 'Notifications', why: 'Reminders and match updates' },
    { key: 'exactAlarm', kind: 'exactAlarm', label: 'Alarms & reminders', why: 'Reminders fire on the exact minute' },
    { key: 'batteryUnrestricted', kind: 'battery', label: 'Battery: Unrestricted', why: 'Samsung can otherwise delay match alerts' },
    { key: 'dnd', kind: 'dnd', label: 'Do Not Disturb access', why: 'Focus mode silences calls/notifications' },
    { key: 'usage', kind: 'usage', label: 'Usage access', why: 'Shows your X screen time' },
    { key: 'media', kind: 'media', label: 'Notification access', why: 'Shows what Spotify / YT Music is playing, with controls' },
  ];
  const RUNTIME: { key: 'calendar' | 'location'; label: string; why: string; go: () => Promise<void> }[] = [
    { key: 'calendar', label: 'Calendar', why: "Today's Google Calendar events on Home and desk mode (read only)", go: () => loadCalendar(true) },
    { key: 'location', label: 'Location (approximate)', why: 'Weather for where you are', go: () => loadWeather(true) },
  ];
</script>

<main class="app stack page-enter">
  <header class="row" style="gap:8px">
    <button class="icon-btn" onclick={() => (app.tab = 'home')} aria-label="Back"><Icon name="back" /></button>
    <h1>Settings</h1>
  </header>

  <section class="card stack">
    <h3>Server</h3>
    {#if paired()}
      <div class="kv"><span class="label">URL</span><span class="mono">{app.cfg.server}</span></div>
      <div class="kv"><span class="label">Device</span><span>{app.cfg.name}</span></div>
      <div class="kv"><span class="label">Last sync</span><span>{ago(app.status.lastSync || null)}{app.status.error ? ` · ${app.status.error}` : ''}</span></div>
      {#if app.home?.features}
        <div class="kv"><span class="label">Features</span><span>
          AI {app.home.features.ai ? '✓' : '✗'} · Push {app.home.features.push ? '✓' : 'inbox'} · Fixtures {app.home.features.cricketDetail ? '✓' : '✗'} · T20I {app.home.features.sportmonks ? '✓' : '✗'}
        </span></div>
      {/if}
      <div class="row wrap">
        <button class="btn btn--ghost" onclick={() => refreshAll()}>Sync now</button>
        <button class="btn btn--ghost" onclick={testPush}>Test push</button>
        <button class="btn btn--ghost" onclick={() => unpair()}>Unpair</button>
      </div>
      {#if pushMsg}<p class="hint">{pushMsg}</p>{/if}
    {:else}
      <form class="stack" onsubmit={doPair}>
        <input class="input" bind:value={server} placeholder="https://api.example.com or 192.168.1.20:8787" autocapitalize="off" autocomplete="off" inputmode="url" required />
        <input class="input" bind:value={code} placeholder="Pairing code (SETUP_CODE)" autocapitalize="characters" autocomplete="off" required />
        <input class="input" bind:value={name} placeholder="Device name" />
        <button class="btn" disabled={busy}>{busy ? 'Pairing…' : 'Pair this phone'}</button>
        {#if error}<p class="err">{error}</p>{/if}
      </form>
    {/if}
  </section>

  <section class="card stack">
    <h3>Theme</h3>
    <div class="seg3">
      {#each ['auto', 'light', 'dark'] as const as t}
        <button class:on={app.prefs.theme === t} onclick={() => setTheme(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
      {/each}
    </div>
    <p class="hint">Auto follows the phone's dark-mode schedule. Dark is true black (saves AMOLED battery).</p>
  </section>

  <section class="card stack">
    <h3>Timers & limits</h3>
    <label class="kv"><span>Focus length (min)</span><input class="input small" type="number" min="5" max="180" bind:value={app.prefs.focusMin} onchange={savePrefs} /></label>
    <label class="kv"><span>Sleep timer (min)</span><input class="input small" type="number" min="5" max="180" bind:value={app.prefs.sleepMin} onchange={savePrefs} /></label>
  </section>

  <section class="card stack">
    <h3>Mac</h3>
    <p class="hint">With the Koro agent on your Mac (<code>koro-mac.sh install</code>): text you copy on the Mac appears on the phone's clipboard, Share → Koro sends links and text the other way, and Home has a Mac remote (lock, sleep, media, volume). Passwords copied from password managers are never sent. Pause clipboard sync on the Mac with <code>koro-mac.sh clip off</code>.</p>
  </section>

  {#if isNative}
    <section class="card stack">
      <h3>Permissions</h3>
      {#each PERMS as p}
        <div class="perm">
          <div><b>{p.label}</b><div class="hint">{p.why}</div></div>
          {#if perms?.[p.key]}<span class="badge">On</span>
          {:else}<button class="btn btn--gold small" onclick={() => (p.kind === 'notifications' ? native.requestNotifications().then(loadPerms) : native.openSettings(p.kind))}>Allow</button>{/if}
        </div>
      {/each}
      {#each RUNTIME as p}
        <div class="perm">
          <div><b>{p.label}</b><div class="hint">{p.why}</div></div>
          {#if perms?.[p.key]}<span class="badge">On</span>
          {:else}<button class="btn btn--gold small" onclick={() => p.go().then(loadPerms)}>Allow</button>{/if}
        </div>
      {/each}
    </section>
  {/if}

  <p class="hint center">Koro · {isNative ? 'Android' : 'browser preview'}</p>
</main>

<style>
  .kv { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); }
  .kv > :last-child { text-align: right; color: var(--text-2); min-width: 0; overflow-wrap: anywhere; }
  code { font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .mono { font-family: ui-monospace, monospace; font-size: var(--fs-sm); }
  .row.wrap { flex-wrap: wrap; }
  .row.wrap .btn { min-height: 40px; padding: 0 14px; font-size: var(--fs-sm); }
  .hint { font-size: var(--fs-xs); color: var(--text-3); }
  .center { text-align: center; }
  .err { color: var(--danger); font-size: var(--fs-sm); }
  .seg3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: var(--surface-2); border-radius: 12px; padding: 4px; }
  .seg3 button { height: 38px; border-radius: 9px; font-weight: 600; color: var(--text-2); }
  .seg3 button.on { background: var(--surface-1); color: var(--text); box-shadow: inset 0 0 0 1px var(--line), 0 1px 3px var(--elev); }
  .input.small { width: 90px; height: 40px; text-align: center; }
  .perm { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s2) 0; border-bottom: 1px solid var(--line); }
  .perm:last-child { border-bottom: 0; }
  .btn.small { min-height: 36px; padding: 0 14px; font-size: var(--fs-sm); }
</style>
