<script lang="ts">
  import type { Match } from '../lib/store.svelte.ts';
  import { fmtWhen } from '../lib/util.ts';
  import Odo from './Odo.svelte';

  let { m }: { m: Match } = $props();
  const short = (t: string) => {
    const i = m.teams.indexOf(t);
    return (i >= 0 && m.short?.[i]) || t;
  };
  const cur = $derived(m.innings[m.innings.length - 1]);
  const fmtO = (o: number) => (Number.isInteger(o) ? String(o) : o.toFixed(1));
  const label = $derived(
    m.rule === 'ipl_mi' ? 'IPL' : m.format === 'test' ? 'Test' : m.format === 'odi' ? 'ODI' : m.format === 't20i' ? 'T20I' : 'T20',
  );
</script>

<div class="match">
  <div class="left">
    <div class="teams">{short(m.teams[0])} <span class="muted">vs</span> {short(m.teams[1])}</div>
    <div class="meta">
      {#if m.state === 'live'}<span class="badge badge--live">Live</span>&nbsp;{/if}
      {label}{#if m.state === 'live' && cur && cur.overs} · {fmtO(cur.overs)} ov{/if}
      {#if m.state !== 'upcoming' && m.status} · <span class="status">{m.status}</span>{/if}
      {#if m.state === 'upcoming' && m.venue} · {m.venue.split(',')[0]}{/if}
    </div>
  </div>
  <div class="right">
    {#if m.state === 'live' && cur}
      <div class="score display-pixel"><Odo value={cur.runs} />/<Odo value={cur.wkts} /></div>
      <div class="sub">{short(cur.team)}</div>
    {:else if m.state === 'upcoming' && m.startsAt}
      <div class="sub">{fmtWhen(m.startsAt).replace(/ \d\d:\d\d$/, '') || 'Today'}</div>
      <b class="sky-text num">{new Date(m.startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</b>
    {:else if m.state === 'done'}
      <b class="gold-text sub">Result</b>
    {/if}
  </div>
</div>

<style>
  .match { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--s3); padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
  .match:last-child { border-bottom: 0; padding-bottom: 0; }
  .teams { font-weight: 650; }
  .meta { font-size: var(--fs-sm); color: var(--text-3); line-height: 1.4; }
  .status { color: var(--text-2); }
  .right { text-align: right; align-self: center; }
  .score { font-size: 1.6rem; line-height: 1; }
  .sub { font-size: var(--fs-sm); color: var(--text-2); }
</style>
