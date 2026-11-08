<script lang="ts">
  import { app, extendTimer, setTimerMin, startFocus, startSleep, stopFocus, stopSleep } from '../lib/store.svelte.ts';

  /** Focus + sleep timers with adjustable length (presets, ±5) and ±5 while running. */
  let { now, dark = false }: { now: number; dark?: boolean } = $props();
  const PRESETS = { focus: [15, 25, 45, 60, 90], sleep: [15, 30, 45, 60, 90] } as const;
  const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const timers = $derived([
    { kind: 'focus' as const, label: 'Focus', left: app.focus.endsAt - now, min: app.prefs.focusMin, start: startFocus, stop: stopFocus, hint: 'DND on while running' },
    { kind: 'sleep' as const, label: 'Sleep timer', left: app.sleep.endsAt - now, min: app.prefs.sleepMin, start: startSleep, stop: stopSleep, hint: 'Music stops at 0' },
  ]);
</script>

<div class="grid-2">
  {#each timers as t (t.kind)}
    <section class="card tile" class:is-running={t.left > 0} class:dark>
      <span class="label">{t.label}</span>
      <button class="time display-pixel" onclick={() => (t.left > 0 ? t.stop() : t.start())}>{t.left > 0 ? mmss(t.left) : `${t.min}m`}</button>
      <div class="adj">
        <button onclick={() => (t.left > 0 ? extendTimer(t.kind, -5) : setTimerMin(t.kind, t.min - 5))} aria-label="5 minutes less">−5</button>
        <button class="go" onclick={() => (t.left > 0 ? t.stop() : t.start())}>{t.left > 0 ? 'Stop' : 'Start'}</button>
        <button onclick={() => (t.left > 0 ? extendTimer(t.kind, 5) : setTimerMin(t.kind, t.min + 5))} aria-label="5 minutes more">+5</button>
      </div>
      {#if t.left <= 0}
        <div class="pre">{#each PRESETS[t.kind] as p}<button class:on={p === t.min} onclick={() => setTimerMin(t.kind, p)}>{p}</button>{/each}</div>
      {:else}<span class="hint">{t.hint}</span>{/if}
    </section>
  {/each}
</div>

<style>
  .tile { display: flex; flex-direction: column; gap: var(--s2); text-align: left; min-width: 0; padding: var(--s3); }
  .tile.is-running { box-shadow: inset 0 0 0 var(--px) var(--accent); }
  .tile.dark { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
  .time { font-size: 1.75rem; line-height: 1; text-align: left; color: var(--text); }
  .adj { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr); gap: 4px; }
  .adj button { min-width: 0; height: 34px; border-radius: 9px; background: var(--surface-2); font-weight: 650; font-size: var(--fs-sm); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .adj .go { background: var(--accent); color: var(--accent-ink, #fff); }
  .is-running .adj .go { background: var(--surface-3); color: var(--text); }
  .pre { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; }
  .pre button { min-width: 0; height: 26px; border-radius: 7px; font-size: 11px; font-weight: 600; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .pre button.on { background: var(--surface-2); color: var(--text); }
  .hint { font-size: var(--fs-xs); color: var(--text-3); }
</style>
