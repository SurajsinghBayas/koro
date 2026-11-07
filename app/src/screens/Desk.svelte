<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import MacControls from '../components/MacControls.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import Weather from '../components/Weather.svelte';
  import { addWater, app, extendTimer, paired, startFocus, startSleep, stopFocus, stopSleep, upcomingReminders } from '../lib/store.svelte.ts';
  import { dayKey, fmtTime } from '../lib/util.ts';

  let { onExit }: { onExit: () => void } = $props();
  let now = $state(new Date());
  let flip = $state<boolean[]>([false, false, false, false]);
  let shift = $state({ x: 0, y: 0 });
  let dim = $state(false);

  // Repaint once per minute, aligned to the minute boundary (no per-second work).
  $effect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const prev = digits(now);
      now = new Date();
      const next = digits(now);
      flip = next.map((d, i) => d !== prev[i]);
      shift = { x: Math.round(Math.random() * 4 - 2), y: Math.round(Math.random() * 4 - 2) }; // burn-in guard
      const h = now.getHours();
      dim = h >= 23 || h < 6;
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(t);
  });

  function digits(d: Date) { return [...`${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`]; }

  // 1 s ticks only while a timer runs
  let tnow = $state(Date.now());
  $effect(() => {
    if (app.focus.endsAt <= tnow && app.sleep.endsAt <= tnow) return;
    const t = setInterval(() => (tnow = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const focusLeft = $derived(app.focus.endsAt - tnow);
  const sleepLeft = $derived(app.sleep.endsAt - tnow);

  const agenda = $derived([
    ...app.events.filter((e) => e.end > now.getTime()).map((e) => ({ at: new Date(e.begin).toISOString(), title: e.title, gold: false, allDay: e.allDay })),
    ...upcomingReminders().filter((r) => dayKey(new Date(r.fire_at)) === dayKey(now)).map((r) => ({ at: r.fire_at, title: r.title, gold: false })),
    ...[...(app.home?.matches.upcoming ?? []), ...(app.home?.matches.live ?? [])]
      .filter((m) => m.startsAt && dayKey(new Date(m.startsAt)) === dayKey(now))
      .map((m) => ({ at: m.startsAt!, title: `${m.short?.[0] ?? m.teams[0]} vs ${m.short?.[1] ?? m.teams[1]}`, gold: true })),
  ].map((a) => ({ allDay: false, ...a })).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5));
  const live = $derived(app.home?.matches.live[0]);
</script>

<div class="desk" class:desk--dim={dim} style="--dx:{shift.x}px; --dy:{shift.y}px">
  <div>
    <div class="flaps">
      {#each digits(now) as d, i}
        {#if i === 2}<span class="colon">:</span>{/if}
        {#key d}<div class="flap" class:flip={flip[i]}>{d}</div>{/key}
      {/each}
    </div>
    <div class="desk__date">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    {#if app.battery}<div class="batt">Phone {app.battery.pct}%{app.battery.charging ? ' · charging' : ''}</div>{/if}
    <div class="wx"><Weather compact /></div>
  </div>
  <div class="desk__agenda list">
    {#if app.media?.active}<div class="np"><NowPlaying compact /></div>{/if}
    {#if live?.summary}<div class="list-row live"><span class="badge badge--live">Live</span>&nbsp;{live.summary.body}</div>{/if}
    {#each agenda as a}
      <div class="list-row"><span class="num" class:gold-text={a.gold} class:sky-text={!a.gold}>{a.allDay ? 'All day' : fmtTime(a.at)}</span>&nbsp; {a.title}</div>
    {:else}
      <div class="list-row muted">Nothing else today</div>
    {/each}
    <div class="ctrls">
      <div class="trow">
        <button class="t" class:on={focusLeft > 0} onclick={() => (focusLeft > 0 ? stopFocus() : startFocus())}>
          <Icon name="focus" size={16} /> {focusLeft > 0 ? `Focus ${mmss(focusLeft)}` : `Focus ${app.prefs.focusMin}m`}
        </button>
        {#if focusLeft > 0}<button class="t sm" onclick={() => extendTimer('focus', 5)}>+5</button>{/if}
        <button class="t" class:on={sleepLeft > 0} onclick={() => (sleepLeft > 0 ? stopSleep() : startSleep())}>
          <Icon name="moon" size={16} /> {sleepLeft > 0 ? `Sleep ${mmss(sleepLeft)}` : `Sleep ${app.prefs.sleepMin}m`}
        </button>
        {#if sleepLeft > 0}<button class="t sm" onclick={() => extendTimer('sleep', 15)}>+15</button>{/if}
        <button class="t sm" onclick={() => addWater()} aria-label="Log a glass of water"><Icon name="drop" size={16} /></button>
      </div>
      {#if paired()}<MacControls compact />{/if}
    </div>
    <button class="exit" onclick={onExit}>Exit desk mode</button>
  </div>
</div>

<style>
  .desk { text-align: left; width: 100%; border: 0; z-index: 50; }
  .wx { margin-top: var(--s4); }
  .ctrls { margin-top: var(--s4); display: flex; flex-direction: column; gap: var(--s2); }
  .trow { display: flex; flex-wrap: wrap; gap: 6px; }
  .t { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border-radius: 999px;
       box-shadow: inset 0 0 0 1px var(--line); color: var(--text-2); font-size: var(--fs-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
  .t.sm { padding: 0 12px; }
  .t.on { box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent-text); }
  .flaps { display: flex; gap: 8px; align-items: center; }
  .flap { position: relative; width: 1.15ch; height: 1.4em; font: 700 clamp(3rem, min(11vw, 22vh), 7rem)/1.4 var(--font-body);
          font-variant-numeric: tabular-nums; background: var(--desk-flap); color: var(--desk-num); text-align: center;
          border-radius: 6px; box-shadow: 0 2px 10px var(--elev), inset 0 0 0 1px var(--line); }
  .flap::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--desk-line); }
  .flap.flip { animation: flip 420ms steps(6) 1; }
  @keyframes flip { 50% { transform: rotateX(-90deg); } }
  .colon { font: 700 clamp(2.5rem, min(9vw, 18vh), 5.5rem) var(--font-body); color: var(--gold); }
  .batt { margin-top: 8px; color: var(--text-3); font-size: var(--fs-sm); }
  .live { color: var(--text); }
  .np { margin-bottom: var(--s3); }
  .exit { margin-top: var(--s4); padding: var(--s2) 0; font-size: var(--fs-xs); color: var(--desk-dim); }
</style>
