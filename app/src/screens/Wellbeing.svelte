<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { native } from '../lib/native.ts';
  import { addWater, app, focusToday, loadApps, savePrefs, scheduleWater, toast, undoWater, waterToday, waterWeek } from '../lib/store.svelte.ts';

  $effect(() => { void loadApps(); });

  const drunk = $derived(waterToday());
  const goal = $derived(app.prefs.waterGoal);
  const pct = $derived(Math.min(1, drunk / goal));
  const glasses = $derived(Math.round(drunk / app.prefs.waterGlass));
  const week = $derived(waterWeek());
  const weekMax = $derived(Math.max(goal, ...week.map((d) => d.ml)));
  const R = 54, C = 2 * Math.PI * R;

  const xMin = $derived(app.screenTime);
  const xOver = $derived(xMin !== null && xMin > app.prefs.xLimit);
  const apps = $derived(app.apps?.apps ?? []);
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
    {#if xMin !== null}
      <div class="xrow">
        <div class="row between"><span><b>X</b> limit</span><span class="num" style:color={xOver ? 'var(--danger)' : 'var(--text-2)'}>{xMin} / {app.prefs.xLimit} min</span></div>
        <div class="meter" class:meter--low={xOver}><span style="--value:{Math.min(1, xMin / app.prefs.xLimit)}"></span></div>
        <label class="kv"><span class="hint">Daily X limit (min)</span><input class="input small" type="number" min="5" max="600" bind:value={app.prefs.xLimit} onchange={savePrefs} /></label>
      </div>
    {/if}
    {#if app.apps}
      <div class="apps">
        {#each apps as a (a.pkg)}
          <div class="app-row"><span class="nm">{a.label}</span><i style:width="{(a.min / appMax) * 100}%"></i><span class="num">{fmtMin(a.min)}</span></div>
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
  .xrow { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--s3); }
  .apps { display: flex; flex-direction: column; gap: 8px; }
  .app-row { display: grid; grid-template-columns: 96px 1fr auto; gap: var(--s2); align-items: center; font-size: var(--fs-sm); }
  .app-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .app-row i { height: 8px; border-radius: 4px; background: var(--gold); min-width: 4px; }
  .app-row .num { color: var(--text-3); font-size: var(--fs-xs); }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  .stats b { font-size: 1.4rem; }
  .stats span { font-size: var(--fs-xs); color: var(--text-3); }
  .linkish { background: none; color: var(--accent-text); }
  .btn.small { min-height: 36px; padding: 0 14px; font-size: var(--fs-sm); }
</style>
