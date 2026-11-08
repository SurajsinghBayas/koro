<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MatchRow from '../components/MatchRow.svelte';
  import XPostView from '../components/XPost.svelte';
  import { app, loadMatches, loadX, onPull, type Match } from '../lib/store.svelte.ts';
  import { ago, fmtDay } from '../lib/util.ts';

  // Poll only while this screen is visible: every 30 s during a live match, else every 5 min.
  // untrack: reading matchesFull here must not re-run the effect each time loadMatches replaces it (an endless reload loop)
  $effect(() => untrack(() => {
    void loadMatches(); void loadX();
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const liveNow = (app.matchesFull?.live.length ?? 0) > 0;
      t = setTimeout(async () => { if (!document.hidden) await Promise.all([loadMatches(), loadX()]); loop(); }, liveNow ? 30_000 : 300_000);
    };
    loop();
    return () => clearTimeout(t);
  }));

  type Who = 'all' | 'india' | 'mi';
  let who = $state<Who>('all');
  const m = $derived(app.matchesFull ?? (app.home ? { ...app.home.matches } : null));
  const teamOf = (x: Match): Who => (x.team ?? (x.rule === 'ipl_mi' || x.teams.some((t) => /mumbai indians/i.test(t)) ? 'mi' : 'india'));
  const pick = (list: Match[] = []) => (who === 'all' ? list : list.filter((x) => teamOf(x) === who));
  const recent = $derived(pick(m?.recent).slice(0, 8));
  const upcoming = $derived(pick(m?.upcoming).slice(0, 8));
  const story = $derived(app.matchesFull?.story);
  const form = $derived(app.matchesFull?.form);
  const table = $derived(app.matchesFull?.tables?.[0]);
  const buzz = $derived((app.x ?? app.home?.x)?.cricket ?? []);
  let buzzAll = $state(false);

  const short = (x: Match, t: string) => { const i = x.teams.indexOf(t); return (i >= 0 && x.short?.[i]) || t; };
  const ours = (t?: string) => !!t && (/^india$/i.test(t) || /mumbai indians/i.test(t));
  const fmtO = (o: number) => (Number.isInteger(o) ? String(o) : o.toFixed(1));
  const when = (iso?: string) => (iso ? `${fmtDay(new Date(iso).toLocaleDateString('en-CA'))} · ${new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '');
  const fmtLabel = (x: Match) => (x.rule === 'ipl_mi' || teamOf(x) === 'mi' ? 'IPL' : x.format === 'test' ? 'Test' : x.format === 'odi' ? 'ODI' : 'T20I');
  $effect(() => onPull('matches', async () => { await Promise.all([loadMatches(), loadX()]); return 'Scores updated'; }));
</script>

<main class="app stack page-enter">
  <header><div class="label">Mumbai Indians · India</div><h1>Matches</h1></header>

  <div class="chips">
    <button class="chip" aria-pressed={who === 'all'} onclick={() => (who = 'all')}>All</button>
    <button class="chip" aria-pressed={who === 'india'} onclick={() => (who = 'india')}>India</button>
    <button class="chip" aria-pressed={who === 'mi'} onclick={() => (who = 'mi')}>Mumbai Indians</button>
  </div>

  {#if !m}
    <p class="muted">Pair with your server in Settings to see matches.</p>
  {:else}
    {#if pick(m.live).length}
      <section class="card card--hero">
        <div class="card__title"><h3>Live</h3><span class="badge badge--live">{pick(m.live).length}</span></div>
        {#each pick(m.live) as x (x.id)}
          <MatchRow m={x} />
          {#if x.summary}<p class="summary">{x.summary.body}</p>{/if}
        {/each}
      </section>
    {/if}

    {#if (who !== 'mi' && story?.india) || (who !== 'india' && story?.mi)}
      <section class="card story">
        <div class="card__title"><h3>Story so far</h3><span class="label ai"><Icon name="sparkle" size={12} /> AI</span></div>
        {#if who !== 'mi' && story?.india}
          <div class="team-line">
            <b>India</b>
            {#if form?.india?.length}<span class="form">{#each form.india as r}<i class={r}>{r}</i>{/each}</span>{/if}
          </div>
          <p>{story.india}</p>
        {/if}
        {#if who !== 'india' && story?.mi}
          <div class="team-line">
            <b>Mumbai Indians</b>
            {#if form?.mi?.length}<span class="form">{#each form.mi as r}<i class={r}>{r}</i>{/each}</span>{/if}
          </div>
          <p>{story.mi}</p>
        {/if}
      </section>
    {/if}

    {#if buzz.length}
      <section class="card">
        <div class="card__title"><h3>Cricket buzz</h3><span class="label">from X · {ago(buzz[0]!.createdAt)}</span></div>
        {#each buzz.slice(0, buzzAll ? 30 : 4) as p (p.id)}<XPostView {p} />{/each}
        {#if buzz.length > 4}<button class="label linkish more" onclick={() => (buzzAll = !buzzAll)}>{buzzAll ? 'Show less' : `Show ${Math.min(buzz.length, 30) - 4} more`}</button>{/if}
      </section>
    {/if}

    <section class="card">
      <div class="card__title"><h3>Recent results</h3></div>
      {#each recent as x (x.id)}
        <article class="result">
          <div class="result__head">
            <span class="label">{fmtLabel(x)}{x.series ? ` · ${x.series}` : ''}</span>
            {#if x.startsAt}<span class="label">{fmtDay(new Date(x.startsAt).toLocaleDateString('en-CA'))}</span>{/if}
          </div>
          {#if x.innings.length}
            <div class="innings">
              {#each x.innings as inn}
                <div class="inn" class:win={x.winner === inn.team}>
                  <span>{short(x, inn.team)}</span>
                  <span class="num">{inn.runs}/{inn.wkts} <small>({fmtO(inn.overs)})</small></span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="teams">{short(x, x.teams[0])} <span class="muted">vs</span> {short(x, x.teams[1])}</div>
          {/if}
          <div class="outcome" class:good={ours(x.winner)} class:bad={x.winner && !ours(x.winner)}>{x.status}</div>
          {#if x.recap}<p class="recap"><Icon name="sparkle" size={12} /> {x.recap}</p>{/if}
          {#if x.venue}<div class="hint">{x.venue}</div>{/if}
        </article>
      {:else}
        <p class="muted">{app.home?.features.cricketDetail ? 'No recent results yet.' : 'Results show up after a match finishes. Add a CricketData key on the server for full history and scorecards.'}</p>
      {/each}
    </section>

    <section class="card">
      <div class="card__title"><h3>Coming up</h3></div>
      {#each upcoming as x (x.id)}
        <div class="up">
          <div>
            <div class="teams">{short(x, x.teams[0])} <span class="muted">vs</span> {short(x, x.teams[1])}</div>
            <div class="hint">{fmtLabel(x)}{x.series ? ` · ${x.series}` : ''}{x.venue ? ` · ${x.venue.split(',')[0]}` : ''}</div>
          </div>
          <div class="up__when">{when(x.startsAt)}</div>
        </div>
      {:else}
        <p class="muted">{app.home?.features.cricketDetail ? 'No fixtures announced yet.' : 'Add a CricketData key on the server to see the schedule.'}</p>
      {/each}
    </section>

    {#if table && who !== 'india'}
      <section class="card">
        <div class="card__title"><h3>Points table</h3><span class="label">{table.series}</span></div>
        <table class="pts">
          <thead><tr><th>#</th><th class="t">Team</th><th>P</th><th>W</th><th>L</th><th>NR</th><th>Pts</th></tr></thead>
          <tbody>
            {#each table.rows as r, i}
              <tr class:mi={/mumbai indians/i.test(r.team)} class:top={i < 4}>
                <td>{i + 1}</td><td class="t">{r.short ?? r.team}</td><td>{r.p}</td><td>{r.w}</td><td>{r.l}</td><td>{r.nr}</td><td><b>{r.pts}</b></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="hint mt-2">Top 4 reach the playoffs</p>
      </section>
    {/if}
  {/if}
</main>

<style>
  .more { display: block; margin: var(--s3) auto 0; color: var(--accent-text); }
  .summary { font-size: var(--fs-sm); color: var(--text-2); margin-top: -4px; padding-bottom: var(--s2); }
  .ai { display: inline-flex; gap: 4px; align-items: center; color: var(--gold-text); }
  .story p { color: var(--text-2); line-height: 1.5; margin: 4px 0 var(--s3); }
  .story p:last-child { margin-bottom: 0; }
  .team-line { display: flex; justify-content: space-between; align-items: center; }
  .form { display: flex; gap: 4px; }
  .form i { width: 22px; height: 22px; display: grid; place-items: center; font: 700 11px var(--font-body); font-style: normal; border-radius: 6px; }
  .form .W { background: var(--success); color: #fff; } .form .L { background: var(--danger); color: #fff; } .form .D { background: var(--surface-3); color: var(--text-2); }

  .result { padding: var(--s3) 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  .result:last-child { border-bottom: 0; padding-bottom: 0; }
  .result__head { display: flex; justify-content: space-between; gap: 8px; }
  .innings { display: grid; gap: 2px; }
  .inn { display: flex; justify-content: space-between; font-weight: 600; color: var(--text-2); }
  .inn.win { color: var(--text); }
  .inn .num { font-size: var(--fs-lg); font-weight: 700; }
  .inn small { font-size: var(--fs-xs); color: var(--text-3); font-weight: 500; }
  .teams { font-weight: 650; }
  .outcome { font-size: var(--fs-sm); font-weight: 650; color: var(--text-2); }
  .outcome.good { color: var(--success); } .outcome.bad { color: var(--danger); }
  .recap { font-size: var(--fs-sm); line-height: 1.45; color: var(--text-2); background: var(--surface-2); padding: 8px 10px; border-radius: 10px; }
  .recap :global(svg) { display: inline; vertical-align: -1px; color: var(--gold-text); }
  .hint { font-size: var(--fs-xs); color: var(--text-3); }

  .up { display: flex; justify-content: space-between; gap: var(--s3); padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
  .up:last-child { border-bottom: 0; padding-bottom: 0; }
  .up__when { text-align: right; font-size: var(--fs-sm); font-weight: 650; color: var(--accent-text); white-space: nowrap; font-variant-numeric: tabular-nums; }

  .pts { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .pts th { font-size: var(--fs-xs); color: var(--text-3); font-weight: 600; text-align: center; padding: 4px 2px; }
  .pts td { text-align: center; padding: 8px 2px; border-top: 1px solid var(--line); color: var(--text-2); }
  .pts .t { text-align: left; }
  .pts tr.top td:first-child { color: var(--accent-text); font-weight: 700; }
  .pts tr.mi td { background: var(--gold-soft); color: var(--text); font-weight: 650; }
</style>
