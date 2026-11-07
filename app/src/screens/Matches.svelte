<script lang="ts">
  import MatchRow from '../components/MatchRow.svelte';
  import { app, loadMatches } from '../lib/store.svelte.ts';
  import { ago } from '../lib/util.ts';

  // Poll only while this screen is visible: every 30 s during a live match, else every 5 min.
  $effect(() => {
    void loadMatches();
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const liveNow = (app.matchesFull?.live.length ?? 0) > 0;
      t = setTimeout(async () => { if (!document.hidden) await loadMatches(); loop(); }, liveNow ? 30_000 : 300_000);
    };
    loop();
    return () => clearTimeout(t);
  });

  const m = $derived(app.matchesFull ?? (app.home ? { ...app.home.matches, sources: {}, rules: {} } : null));
  const src = (v: unknown) => {
    if (v === 'not configured') return 'not configured';
    const s = v as { ok?: boolean; at?: string; error?: string; hitsToday?: number; hitsLimit?: number } | null;
    if (!s) return '—';
    return `${s.ok ? 'ok' : 'error'} · ${ago(s.at)}${s.hitsToday !== undefined ? ` · ${s.hitsToday}/${s.hitsLimit} calls today` : ''}${s.error ? ` · ${s.error}` : ''}`;
  };
</script>

<main class="app stack page-enter">
  <header><div class="label">Mumbai Indians · India</div><h1>Matches</h1></header>

  {#if !m}
    <p class="muted">Pair with your server in Settings to see matches.</p>
  {:else}
    <section class="card">
      <div class="card__title"><h3>Live</h3>{#if m.live.length}<span class="badge badge--live">{m.live.length}</span>{/if}</div>
      {#each m.live as x (x.id)}
        <MatchRow m={x} />
        {#if x.summary}<p class="summary">{x.summary.body}</p>{/if}
      {:else}<p class="muted">No MI or India match live right now.</p>{/each}
    </section>

    <section class="card">
      <div class="card__title"><h3>Upcoming</h3></div>
      {#each m.upcoming as x (x.id)}<MatchRow m={x} />{:else}<p class="muted">No fixtures loaded{app.home?.features.cricketDetail ? '' : ' (add a CricketData.org key on the server for fixtures)'}.</p>{/each}
    </section>

    <section class="card">
      <div class="card__title"><h3>Recent results</h3></div>
      {#each m.recent as x (x.id)}
        <MatchRow m={x} />
      {:else}<p class="muted">Results appear here after tracked matches finish.</p>{/each}
    </section>

    <section class="card stack">
      <h3>Your alerts</h3>
      <ul class="rules">
        <li><b>IPL · MI</b> every over + result</li>
        <li><b>India T20I</b> after overs 5, 10, 15, 20 + result</li>
        <li><b>India ODI</b> after overs 10, 20, 30, 40, 50 + result</li>
        <li><b>India Test</b> Lunch, Tea, Stumps each day + result</li>
      </ul>
      {#if app.matchesFull}
        <div class="sources">
          <div><span class="label">Cricinfo RSS</span> {src(app.matchesFull.sources.cricinfo)}</div>
          <div><span class="label">CricketData</span> {src(app.matchesFull.sources.cricketdata)}</div>
          <div><span class="label">Sportmonks</span> {src(app.matchesFull.sources.sportmonks)}</div>
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  .summary { font-size: var(--fs-sm); color: var(--text-2); margin-top: -4px; padding-bottom: var(--s2); }
  .rules { padding-left: 1.1em; color: var(--text-2); display: grid; gap: 4px; }
  .sources { display: grid; gap: 4px; font-size: var(--fs-xs); color: var(--text-3); }
</style>
