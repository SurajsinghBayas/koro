<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { native } from '../lib/native.ts';
  import { addWater, app, focusToday, loadApps, savePrefs, scheduleWater, setAppLimit, toast, undoWater, waterToday, waterWeek } from '../lib/store.svelte.ts';

  $effect(() => { void loadApps(); });

  const drunk = $derived(waterToday());
  const goal = $derived(app.prefs.waterGoal);
  const pct = $derived(Math.min(1, drunk / goal));
  const glasses = $derived(Math.round(drunk / app.prefs.waterGlass));
  const week = $derived(waterWeek());
  const weekMax = $derived(Math.max(goal, ...week.map((d) => d.ml)));
  const R = 54, C = 2 * Math.PI * R;

  const apps = $derived(app.apps?.apps ?? []);
  let editing = $state<string | null>(null);
  const LIMITS = [15, 30, 45, 60, 90, 120];
  const lim = (pkg: string) => app.prefs.appLimits?.[pkg]?.min ?? 0;
  const appMax = $derived(Math.max(1, ...apps.map((a) => a.min)));
  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  const focusWeek = $derived(app.focusLog.filter((f) => Date.now() - Date.parse(f.day) < 7 * 864e5).reduce((n, f) => n + f.min, 0));

  async function saveWater() {
    await savePrefs();
    await scheduleWater();
    toast(app.prefs.waterRemind ? `Water reminders every ${app.prefs.waterEvery}h, ${app.prefs.waterStart}–${app.prefs.waterEnd}` : 'Water reminders off');
  }
</script>

<main class="app stack page-enter">
  <header><div class="label">Water · screen time · focus</div><h1>Wellbeing</h1></header>

  <section class="card water">
    <div class="card__title"><h3>Water</h3><span class="label">{glasses} glass{glasses === 1 ? '' : 'es'}</span></div>
    <div class="wrow">
      <svg viewBox="0 0 128 128" class="ring" aria-hidden="true">
        <circle cx="64" cy="64" r={R} class="bg" />
        <circle cx="64" cy="64" r={R} class="fg" style:stroke-dasharray={C} style:stroke-dashoffset={C * (1 - pct)} />
      </svg>
      <div class="ring-text"><b class="num">{(drunk / 1000).toFixed(drunk % 1000 ? 2 : 1)}</b><span>of {(goal / 1000).toFixed(1)} L</span></div>
      <div class="wbtns">
        <button class="btn" onclick={() => addWater()}><Icon name="drop" size={18} /> +{app.prefs.waterGlass} ml</button>
        <button class="btn btn--ghost" onclick={() => addWater(500)}>+500 ml</button>
        <button class="btn btn--ghost" onclick={undoWater} disabled={drunk === 0}>Undo</button>
      </div>
    </div>
    <div class="week">
      {#each week as d (d.day)}
        <div class="bar"><i style:height="{Math.round((d.ml / weekMax) * 100)}%" class:hit={d.ml >= goal}></i><span>{new Date(`${d.day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'narrow' })}</span></div>
      {/each}
    </div>
    <details class="settings">
      <summary>Goal & reminders</summary>
      <label class="kv"><span>Daily goal (ml)</span><input class="input small" type="number" min="500" max="6000" step="250" bind:value={app.prefs.waterGoal} onchange={savePrefs} /></label>
      <label class="kv"><span>Glass size (ml)</span><input class="input small" type="number" min="100" max="1000" step="50" bind:value={app.prefs.waterGlass} onchange={savePrefs} /></label>
      <label class="kv"><span>Remind me</span><input type="checkbox" class="check" bind:checked={app.prefs.waterRemind} onchange={saveWater} /></label>
      {#if app.prefs.waterRemind}
        <label class="kv"><span>From</span><input class="input small" type="time" bind:value={app.prefs.waterStart} onchange={saveWater} /></label>
        <label class="kv"><span>Until</span><input class="input small" type="time" bind:value={app.prefs.waterEnd} onchange={saveWater} /></label>
        <label class="kv"><span>Every (hours)</span><input class="input small" type="number" min="1" max="6" bind:value={app.prefs.waterEvery} onchange={saveWater} /></label>
        <p class="hint">Each reminder has a “+1 glass” button, so you can log without opening Koro.</p>
      {/if}
    </details>
  </section>

  <section class="card">
    <div class="card__title"><h3>Screen time today</h3>{#if app.apps}<span class="label">{fmtMin(app.apps.totalMin)}</span>{/if}</div>
    {#if app.apps}
      <p class="hint tip">Tap an app to set a daily limit. Koro checks every 15 min and nudges you once when you go over.</p>
      <div class="apps">
        {#each apps as a (a.pkg)}
          {@const l = lim(a.pkg)}
          {@const over = l > 0 && a.min >= l}
          <button class="app-row" class:open={editing === a.pkg} onclick={() => (editing = editing === a.pkg ? null : a.pkg)}>
            <span class="nm">{a.label}</span>
            <span class="track"><i style:width="{Math.min(100, (a.min / (l || appMax)) * 100)}%" class:over class:lim={l > 0}></i></span>
            <span class="num" class:over>{fmtMin(a.min)}{#if l}<span class="of"> / {fmtMin(l)}</span>{/if}</span>
          </button>
          {#if editing === a.pkg}
            <div class="limits">
              {#each LIMITS as m}<button class:on={l === m} onclick={() => setAppLimit(a.pkg, a.label, m)}>{fmtMin(m)}</button>{/each}
              <button class:on={!l} onclick={() => setAppLimit(a.pkg, a.label, 0)}>Off</button>
            </div>
          {/if}
        {:else}<p class="muted">No app use yet today.</p>{/each}
      </div>
    {:else}
      <button class="btn btn--gold small" onclick={() => native.openSettings('usage')}>Allow usage access</button>
      <p class="hint">Koro reads today's totals only. Nothing leaves your phone.</p>
    {/if}
  </section>

  <section class="card">
    <div class="card__title"><h3>Focus</h3><button class="label linkish" onclick={() => (app.tab = 'home')}>Start ›</button></div>
    <div class="stats">
      <div><b class="num">{fmtMin(focusToday())}</b><span>today</span></div>
      <div><b class="num">{fmtMin(focusWeek)}</b><span>last 7 days</span></div>
    </div>
  </section>
</main>

<style>
  .wrow { display: grid; grid-template-columns: 128px 1fr; align-items: center; gap: var(--s4); position: relative; }
  .ring { width: 128px; height: 128px; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 12; }
  .ring .bg { stroke: var(--surface-2); }
  .ring .fg { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset var(--t-med) var(--ease-out); }
  .ring-text { position: absolute; left: 0; width: 128px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; }
  .ring-text b { font-size: 1.6rem; }
  .ring-text span { font-size: var(--fs-xs); color: var(--text-3); }
  .wbtns { display: flex; flex-direction: column; gap: 6px; }
  .wbtns .btn { min-height: 40px; font-size: var(--fs-sm); display: inline-flex; gap: 6px; justify-content: center; align-items: center; }
  .week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; height: 72px; margin-top: var(--s4); }
  .bar { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
  .bar i { width: 100%; max-width: 22px; min-height: 2px; background: var(--surface-3); border-radius: 4px 4px 2px 2px; }
  .bar i.hit { background: var(--accent); }
  .bar span { font-size: 10px; color: var(--text-3); }
  .settings { margin-top: var(--s3); }
  .settings summary { font-size: var(--fs-sm); color: var(--accent-text); font-weight: 600; padding: var(--s2) 0; }
  .settings[open] { display: flex; flex-direction: column; gap: 8px; }
  .kv { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); }
  .input.small { width: 110px; height: 38px; text-align: center; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); }
  .tip { margin: -4px 0 var(--s3); }
  .apps { display: flex; flex-direction: column; gap: 2px; }
  .app-row { display: grid; grid-template-columns: minmax(0, 92px) 1fr auto; gap: var(--s3); align-items: center; font-size: var(--fs-sm); text-align: left; padding: 8px 6px; margin: 0 -6px; border-radius: 10px; }
  .app-row.open { background: var(--surface-2); }
  .app-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
  .app-row.open .track { background: var(--surface-3); }
  .track i { display: block; height: 100%; border-radius: 4px; background: var(--gold); min-width: 4px; }
  .track i.lim { background: var(--accent); }
  .track i.over { background: var(--danger); }
  .app-row .num { color: var(--text-2); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .app-row .num.over { color: var(--danger); font-weight: 650; }
  .of { color: var(--text-3); }
  .limits { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; padding: 4px 0 10px; }
  .limits button { height: 32px; border-radius: 8px; font-size: 11px; font-weight: 650; color: var(--text-2); background: var(--surface-2); }
  .limits button.on { background: var(--accent); color: var(--accent-ink); }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  .stats b { font-size: 1.4rem; }
  .stats span { font-size: var(--fs-xs); color: var(--text-3); }
  .linkish { background: none; color: var(--accent-text); }
  .btn.small { min-height: 36px; padding: 0 14px; font-size: var(--fs-sm); }
</style>
