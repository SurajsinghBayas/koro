<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import MacControls from '../components/MacControls.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import { addWater, app, extendTimer, paired, startFocus, startSleep, stopFocus, stopSleep, upcomingReminders } from '../lib/store.svelte.ts';
  import { dayKey, fmtTime } from '../lib/util.ts';
  import { wx } from '../lib/weather.ts';

  let { onExit }: { onExit: () => void } = $props();
  let now = $state(new Date());
  let flip = $state<boolean[]>([false, false, false, false]);
  let shift = $state({ x: 0, y: 0 });
  let showMac = $state(false);

  // Clock: repaint once per minute, aligned to the minute (no per-second work).
  $effect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const prev = digits(now);
      now = new Date();
      flip = digits(now).map((d, i) => d !== prev[i]);
      shift = { x: Math.round(Math.random() * 4 - 2), y: Math.round(Math.random() * 4 - 2) }; // burn-in guard
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(t);
  });
  function digits(d: Date) { return [...`${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`]; }

  // Dim after 90 s without a touch (20 s at night). The first tap only wakes the screen.
  let dim = $state(false);
  let idle: ReturnType<typeof setTimeout>;
  function arm() {
    clearTimeout(idle);
    const h = new Date().getHours();
    idle = setTimeout(() => (dim = true), h >= 23 || h < 6 ? 20_000 : 90_000);
  }
  $effect(() => { arm(); return () => clearTimeout(idle); });
  function wake(e: Event) {
    if (dim) { e.stopPropagation(); e.preventDefault(); dim = false; }
    arm();
  }

  // Timers tick each second only while running
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
    ...upcomingReminders().filter((r) => dayKey(new Date(r.fire_at)) === dayKey(now)).map((r) => ({ at: r.fire_at, title: r.title, gold: false, allDay: false })),
    ...[...(app.home?.matches.upcoming ?? []), ...(app.home?.matches.live ?? [])]
      .filter((m) => m.startsAt && dayKey(new Date(m.startsAt)) === dayKey(now))
      .map((m) => ({ at: m.startsAt!, title: `${m.short?.[0] ?? m.teams[0]} vs ${m.short?.[1] ?? m.teams[1]}`, gold: true, allDay: false })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 3));
  const live = $derived(app.home?.matches.live[0]);
  const w = $derived(app.weather);
  const music = $derived((!!app.media?.active && !!app.media.title) || !!app.mac?.media?.title);
</script>

<div class="desk" class:desk--dim={dim} style="--dx:{shift.x}px; --dy:{shift.y}px" onpointerdowncapture={wake} onclickcapture={(e) => { if (dim) e.stopPropagation(); }} role="presentation">
  <button class="exit" onclick={onExit} aria-label="Exit desk mode"><Icon name="x" size={16} /> Exit</button>

  <div class="left">
    <div class="flaps">
      {#each digits(now) as d, i}
        {#if i === 2}<span class="colon">:</span>{/if}
        {#key d}<div class="flap" class:flip={flip[i]}>{d}</div>{/key}
      {/each}
    </div>
    <div class="desk__date">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <div class="facts">
      {#if w}<span><Icon name={wx(w.now.code, w.now.isDay).icon} size={16} /> {Math.round(w.now.temp)}° {w.place ?? ''}</span>{/if}
      {#if app.battery}<span><Icon name="bolt" size={14} /> {app.battery.pct}%{app.battery.charging ? ' ⚡' : ''}</span>{/if}
    </div>
  </div>

  <div class="right">
    {#if music}<NowPlaying compact />{/if}
    {#if live?.summary}<div class="row-live"><span class="badge badge--live">Live</span> {live.summary.body}</div>{/if}
    {#if agenda.length}
      <div class="agenda">
        {#each agenda as a}
          <div class="ag"><span class="num" class:gold-text={a.gold}>{a.allDay ? 'All day' : fmtTime(a.at)}</span><span class="tt">{a.title}</span></div>
        {/each}
      </div>
    {:else if !music}
      <div class="agenda"><div class="ag muted">Nothing else today</div></div>
    {/if}

    <div class="dock">
      <button class:on={focusLeft > 0} onclick={() => (focusLeft > 0 ? stopFocus() : startFocus())}><Icon name="focus" size={18} /><span>{focusLeft > 0 ? mmss(focusLeft) : 'Focus'}</span></button>
      {#if focusLeft > 0}<button class="sq" onclick={() => extendTimer('focus', 5)} aria-label="Add 5 minutes">+5</button>{/if}
      <button class:on={sleepLeft > 0} onclick={() => (sleepLeft > 0 ? stopSleep() : startSleep())}><Icon name="moon" size={18} /><span>{sleepLeft > 0 ? mmss(sleepLeft) : 'Sleep'}</span></button>
      {#if sleepLeft > 0}<button class="sq" onclick={() => extendTimer('sleep', 15)} aria-label="Add 15 minutes">+15</button>{/if}
      <button class="sq" onclick={() => addWater()} aria-label="Log a glass of water"><Icon name="drop" size={18} /></button>
      {#if paired()}<button class="sq" class:on={showMac} onclick={() => (showMac = !showMac)} aria-label="Mac controls"><Icon name="laptop" size={18} /></button>{/if}
    </div>
    {#if showMac}<div class="macrow"><MacControls compact /></div>{/if}
  </div>
</div>

<style>
  .desk { text-align: left; width: 100%; border: 0; z-index: 50; transition: opacity .6s ease, transform 2s linear; }
  .exit { position: absolute; top: calc(var(--safe-top) + 12px); right: 16px; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
          border-radius: 999px; color: var(--desk-dim); font-size: var(--fs-xs); font-weight: 650; box-shadow: inset 0 0 0 1px var(--line); z-index: 2; }
  .left { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; }
  .flaps { display: flex; gap: 8px; align-items: center; }
  .flap { position: relative; width: 1.15ch; height: 1.4em; font: 700 clamp(3rem, min(11vw, 22vh), 7rem)/1.4 var(--font-body);
          font-variant-numeric: tabular-nums; background: var(--desk-flap); color: var(--desk-num); text-align: center;
          border-radius: 6px; box-shadow: 0 2px 10px var(--elev), inset 0 0 0 1px var(--line); }
  .flap::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--desk-line); }
  .flap.flip { animation: flip 420ms steps(6) 1; }
  @keyframes flip { 50% { transform: rotateX(-90deg); } }
  .colon { font: 700 clamp(2.5rem, min(9vw, 18vh), 5.5rem) var(--font-body); color: var(--gold); }
  .facts { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-3); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .facts span { display: inline-flex; align-items: center; gap: 6px; }

  .right { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 520px; width: 100%; justify-self: end; }
  .row-live { color: var(--text); font-size: var(--fs-sm); display: flex; gap: 8px; align-items: center; }
  .agenda { display: flex; flex-direction: column; }
  .ag { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: var(--fs-sm); }
  .ag:last-child { border-bottom: 0; }
  .ag .num { color: var(--accent-text); font-weight: 650; }
  .ag .tt { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dock { display: flex; gap: 8px; flex-wrap: wrap; }
  .dock button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 44px; padding: 0 16px; border-radius: 14px;
                 color: var(--text-2); font-size: var(--fs-sm); font-weight: 650; font-variant-numeric: tabular-nums; box-shadow: inset 0 0 0 1px var(--line); }
  .dock .sq { width: 44px; padding: 0; }
  .dock button.on { color: var(--accent-text); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .macrow { padding: 4px 6px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line); }
  :global(.desk.desk--dim) { opacity: .25 !important; }
  @media (orientation: portrait) {
    .right { justify-self: center; }
    .facts, .dock { justify-content: center; }
  }
</style>
