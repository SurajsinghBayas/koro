<script lang="ts">
  import { app, upcomingReminders } from '../lib/store.svelte.ts';
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

  const agenda = $derived([
    ...upcomingReminders().filter((r) => dayKey(new Date(r.fire_at)) === dayKey(now)).map((r) => ({ at: r.fire_at, title: r.title, gold: false })),
    ...[...(app.home?.matches.upcoming ?? []), ...(app.home?.matches.live ?? [])]
      .filter((m) => m.startsAt && dayKey(new Date(m.startsAt)) === dayKey(now))
      .map((m) => ({ at: m.startsAt!, title: `${m.short?.[0] ?? m.teams[0]} vs ${m.short?.[1] ?? m.teams[1]}`, gold: true })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5));
  const live = $derived(app.home?.matches.live[0]);
</script>

<button class="desk" class:desk--dim={dim} style="--dx:{shift.x}px; --dy:{shift.y}px" onclick={onExit} aria-label="Exit desk mode">
  <div>
    <div class="flaps">
      {#each digits(now) as d, i}
        {#if i === 2}<span class="colon">:</span>{/if}
        {#key d}<div class="flap" class:flip={flip[i]}>{d}</div>{/key}
      {/each}
    </div>
    <div class="desk__date">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    {#if app.battery}<div class="batt">Phone {app.battery.pct}%{app.battery.charging ? ' · charging' : ''}</div>{/if}
  </div>
  <div class="desk__agenda list">
    {#if live?.summary}<div class="list-row live"><span class="badge badge--live">Live</span>&nbsp;{live.summary.body}</div>{/if}
    {#each agenda as a}
      <div class="list-row"><span class="num" class:gold-text={a.gold} class:sky-text={!a.gold}>{fmtTime(a.at)}</span>&nbsp; {a.title}</div>
    {:else}
      <div class="list-row muted">Nothing else today</div>
    {/each}
    <div class="exit">Tap anywhere to exit</div>
  </div>
</button>

<style>
  .desk { text-align: left; width: 100%; border: 0; z-index: 50; }
  .flaps { display: flex; gap: 8px; align-items: center; }
  .flap { position: relative; width: 1.15ch; height: 1.4em; font: 700 clamp(3.5rem, 15vw, 8rem)/1.4 var(--font-pixel);
          background: #0B0F18; color: var(--silver-100); text-align: center; }
  .flap::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: #000; }
  .flap.flip { animation: flip 420ms steps(6) 1; }
  @keyframes flip { 50% { transform: rotateX(-90deg); } }
  .colon { font: 700 clamp(3rem, 12vw, 6rem) var(--font-pixel); color: var(--gold); }
  .batt { margin-top: 8px; color: var(--silver-500); font-size: var(--fs-sm); }
  .live { color: var(--silver-100); }
  .exit { margin-top: var(--s4); font-size: var(--fs-xs); color: var(--silver-700); }
</style>
