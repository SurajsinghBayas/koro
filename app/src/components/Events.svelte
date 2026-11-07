<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, loadCalendar } from '../lib/store.svelte.ts';
  import { fmtTime } from '../lib/util.ts';

  /** Today's events from the phone's calendars (Google Calendar syncs into them). */
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 60_000); return () => clearInterval(t); });
  const events = $derived(app.events.filter((e) => e.end > now).slice(0, 6));
  const span = (b: number, e: number) => `${fmtTime(b)} – ${fmtTime(e)}`;
</script>

{#if app.eventsAllowed === false}
  <button class="card ask" onclick={() => loadCalendar(true)}>
    <Icon name="cal" />
    <span><b>Show today's Google Calendar</b><span class="muted">Tap to allow calendar access (read only).</span></span>
  </button>
{:else if app.eventsAllowed}
  <section class="card">
    <div class="card__title"><h3>Calendar</h3><span class="label">{events.length ? `${events.length} left today` : 'Today'}</span></div>
    {#each events as e (e.id)}
      {@const nowOn = e.begin <= now && !e.allDay}
      <div class="ev" class:on={nowOn}>
        <i style:background={e.color || 'var(--accent)'}></i>
        <div class="tx">
          <b>{e.title || '(No title)'}</b>
          <span>{e.allDay ? 'All day' : nowOn ? `Now · until ${fmtTime(e.end)}` : span(e.begin, e.end)}{e.location ? ` · ${e.location}` : ''}</span>
        </div>
      </div>
    {:else}
      <p class="muted">No more events today.</p>
    {/each}
  </section>
{/if}

<style>
  .ask { display: flex; gap: var(--s3); align-items: center; text-align: left; }
  .ask > span { display: flex; flex-direction: column; gap: 2px; }
  .ev { display: grid; grid-template-columns: 4px 1fr; gap: var(--s3); padding: var(--s2) 0; }
  .ev i { border-radius: 2px; }
  .ev .tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ev b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ev span { font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
  .ev.on span { color: var(--accent-text); font-weight: 650; }
</style>
