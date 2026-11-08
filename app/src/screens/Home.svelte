<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ItemSheet, { type SheetItem } from '../components/ItemSheet.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import Events from '../components/Events.svelte';
  import MacControls from '../components/MacControls.svelte';
  import Timers from '../components/Timers.svelte';
  import Weather from '../components/Weather.svelte';
  import MatchRow from '../components/MatchRow.svelte';
  import Odo from '../components/Odo.svelte';
  import { openUrl } from '../lib/open.ts';
  import { native } from '../lib/native.ts';
  import {
    addWater, app, doneReminder, refreshDevices, groceryOpen, habits, quickAdd, refreshAll, saveForLater, waterToday,
    streak, toast, todayTasks, toggleGrocery, toggleHabit, toggleTask, doneOn, upcomingReminders, paired,
  } from '../lib/store.svelte.ts';
  import { ago, dueInfo, fmtWhen, greeting } from '../lib/util.ts';

  let sheet = $state<SheetItem | null>(null);

  let { onDesk }: { onDesk: () => void } = $props();

  let text = $state('');
  let busy = $state(false);
  let newsCat = $state<'world' | 'india' | 'ai' | 'startups'>('world');
  const NEWS_NAMES = { world: 'World', india: 'India', ai: 'AI & Tech', startups: 'AI Startups' } as const;
  let now = $state(Date.now());

  // one ticker for the whole screen: 1 s only while a timer is running, else once a minute
  $effect(() => {
    const fast = app.focus.endsAt > now || app.sleep.endsAt > now;
    const t = setTimeout(() => (now = Date.now()), fast ? 1000 : 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(t);
  });


  async function add(hint?: 'task' | 'reminder' | 'grocery' | 'habit') {
    if (!text.trim() || busy) return;
    busy = true;
    const msg = await quickAdd(text, hint);
    busy = false;
    text = '';
    if (msg) toast(msg, msg.includes('\n') ? 5000 : 2500);
  }

  const tasks = $derived(todayTasks());
  const doneCount = $derived(tasks.filter((t) => t.done_at).length);
  const reminders = $derived(upcomingReminders().slice(0, 3));
  const matches = $derived(app.home?.matches);
  const matchList = $derived(matches ? [...matches.live, ...matches.upcoming.slice(0, 2), ...matches.recent.slice(0, 1)].slice(0, 4) : []);
  const water = $derived(waterToday());
  let refreshing = $state(false);
  async function refreshDev() { refreshing = true; await refreshDevices(); setTimeout(() => (refreshing = false), 2800); }
  async function speak() {
    const r = await native.listen();
    if (r.error) return toast(r.error);
    if (!r.text.trim()) return;
    text = r.text;
    await add();
  }
  const date = $derived(new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }));
</script>

<main class="app stack page-enter">
  <header class="head">
    <div>
      <div class="label">{date}</div>
      <h1>{greeting(new Date(now).getHours())}</h1>
    </div>
    <div class="row" style="gap:8px">
      <button class="icon-btn" onclick={onDesk} aria-label="Desk mode"><Icon name="desk" /></button>
      <button class="icon-btn" onclick={() => (app.tab = 'settings')} aria-label="Settings"><Icon name="gear" /></button>
    </div>
  </header>

  {#if !paired()}
    <button class="card banner" onclick={() => (app.tab = 'settings')}>
      <b>Connect to your Koro server</b>
      <span class="muted">Lists work offline now. Pair in Settings to get matches, news, sync and alerts.</span>
    </button>
  {:else if app.status.error && !app.status.online}
    <div class="card banner warn"><b>Offline</b><span class="muted">{app.status.error} · showing saved data</span></div>
  {/if}

  {#if app.home?.brief}
    <section class="card card--hero brief">
      <div class="card__title"><span class="label">Today's brief</span><span class="label">AI · {ago(app.home.brief.at)}</span></div>
      {#each app.home.brief.text.split('\n') as line}<p>{line}</p>{/each}
    </section>
  {/if}

  <form class="stack" style="gap:8px" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <div class="qa">
      <input class="input" bind:value={text} placeholder={busy ? 'AI is sorting that out…' : 'milk eggs, call bank tomorrow 10am, gym Mon Wed Fri 7am'} enterkeyhint="done" disabled={busy} />
      <button type="button" class="mic" onclick={speak} disabled={busy} aria-label="Say it"><Icon name="mic" size={20} /></button>
    </div>
    <div class="chips">
      <button type="button" class="chip" onclick={() => add('task')}>Task</button>
      <button type="button" class="chip" onclick={() => add('reminder')}>Reminder</button>
      <button type="button" class="chip" onclick={() => add('grocery')}>Grocery</button>
      <button type="button" class="chip" onclick={() => { text = text ? `${text} in 30 min` : ''; add('reminder'); }}>In 30 min</button>
      <button type="button" class="chip" onclick={() => { text = text ? `${text} tonight` : ''; add('reminder'); }}>Tonight</button>
    </div>
  </form>

  <Weather />

  <Events />

  <NowPlaying />

  {#if matchList.length}
    <section class="card" id="matchCard">
      <div class="card__title"><h3>Matches</h3><button class="label linkish" onclick={() => (app.tab = 'matches')}>MI · India ›</button></div>
      {#each matchList as m (m.id)}<MatchRow {m} />{/each}
    </section>
  {/if}

  <section class="card">
    <div class="card__title"><h3>Today</h3><span class="label">{doneCount} / {tasks.length}</span></div>
    {#if tasks.length === 0}<p class="muted">Nothing due. Add something above.</p>{/if}
    <div class="list">
      {#each tasks.slice(0, 6) as t (t.id)}
        {@const due = dueInfo(t.due_on, t.due_time)}
        <div class="list-row" class:is-done={!!t.done_at}>
          <input type="checkbox" class="check" checked={!!t.done_at} onchange={() => toggleTask(t)} aria-label="Done" />
          <button class="edit" onclick={() => (sheet = { table: 'tasks', row: t })}>
            <span class="list-row__text">{t.title}</span>
            {#if due && !t.done_at && (t.due_time || due.overdue)}<span class="due" class:overdue={due.overdue} class:soon={due.soon}>{due.overdue ? 'Overdue · ' : ''}{due.label}</span>{/if}
          </button>
        </div>
      {/each}
    </div>
    {#if tasks.length > 6}<button class="label linkish mt-2" onclick={() => (app.tab = 'lists')}>{tasks.length - 6} more ›</button>{/if}
  </section>

  {#if reminders.length}
    <section class="card">
      <div class="card__title"><h3>Reminders</h3></div>
      <div class="list">
        {#each reminders as r (r.id)}
          <div class="list-row">
            <span class="num sky-text when">{fmtWhen(r.fire_at)}</span>
            <button class="grow edit" onclick={() => (sheet = { table: 'reminders', row: r })}><span>{r.title}{#if r.repeat === 'daily'} <span class="muted">· daily</span>{/if}</span></button>
            <button class="mini" onclick={() => doneReminder(r)} aria-label="Done"><Icon name="x" size={16} /></button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <Timers {now} />

  <button class="card water" onclick={() => addWater()}>
    <Icon name="drop" />
    <span class="grow"><b>Water</b><span class="hint">{(water / 1000).toFixed(2)} / {(app.prefs.waterGoal / 1000).toFixed(1)} L · tap for +{app.prefs.waterGlass} ml</span></span>
    <span class="meter wmeter"><span style="--value:{Math.min(1, water / app.prefs.waterGoal)}"></span></span>
  </button>

  <section class="card">
    <div class="card__title"><h3>Habits</h3><button class="label linkish" onclick={() => (app.tab = 'lists')}>Edit ›</button></div>
    {#each habits() as h (h.id)}
      <label class="habit">
        <input type="checkbox" class="check" checked={doneOn(h)} onchange={() => toggleHabit(h)} />
        <span>{h.name}{#if h.remind_time}<span class="muted small"> · {h.remind_time}</span>{/if}</span>
        <span class="streak">{streak(h)} {streak(h) === 1 ? 'day' : 'days'}</span>
      </label>
    {:else}
      <p class="muted">No habits yet. Try “read 20 pages daily”.</p>
    {/each}
  </section>

  {#if paired()}<MacControls />{/if}

  {#if app.home?.devices?.length || app.battery}
    <section class="card stack">
      <div class="card__title" style="margin:0"><h3>Devices</h3>
        <button class="icon-btn sm" class:spin={refreshing} onclick={refreshDev} aria-label="Refresh battery"><Icon name="refresh" size={16} /></button></div>
      {#each app.home?.devices ?? [] as d (d.id)}
        {@const mine = d.id === app.cfg.deviceId}
        {@const pct = mine && app.battery ? app.battery.pct : d.battery_pct}
        {@const chg = mine && app.battery ? app.battery.charging : d.charging}
        <div>
          <div class="row between"><span>{d.name}</span>{#if pct !== null}<span class="num"><Odo value={pct} />%{chg ? ' · charging' : ''}</span>{/if}</div>
          {#if pct !== null}<div class="meter mt-2" class:meter--gold={d.kind === 'mac'} class:meter--low={pct < 20 && !chg}><span style="--value:{pct / 100}"></span></div>{/if}
          <div class="hint">{pct === null ? 'No battery data yet' : mine && app.battery ? 'Updated just now' : `Updated ${ago(d.battery_at ?? d.last_seen)}`}</div>
        </div>
      {/each}
    </section>
  {/if}

  {#if app.home?.news}
    <section class="card">
      <div class="card__title"><h3>Headlines</h3><button class="label linkish" onclick={() => (app.tab = 'news')}>More ›</button></div>
      <div class="chips">
        {#each ['world', 'india', 'ai', 'startups'] as const as c}
          <button class="chip" aria-pressed={newsCat === c} onclick={() => (newsCat = c)}>{NEWS_NAMES[c]}</button>
        {/each}
      </div>
      <div class="mt-2">
        {#if app.home.news.digest?.[newsCat]?.length}
          {#each app.home.news.digest[newsCat]!.slice(0, 3) as s (s.url)}
            <button class="news-item" onclick={() => openUrl(s.url)} oncontextmenu={(e) => { e.preventDefault(); saveForLater(s.url, s.title); }}>
              <div class="news-text"><b>{s.title}</b>{#if s.summary}<p>{s.summary}</p>{/if}<span>{s.sources[0]?.source}{s.sources.length > 1 ? ` +${s.sources.length - 1}` : ''} · {ago(s.publishedAt)}</span></div>
              {#if s.image}<img src={s.image} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />{/if}
            </button>
          {/each}
        {:else}
          {#each (app.home.news[newsCat] ?? []).slice(0, 4) as n (n.id)}
            <button class="news-item" onclick={() => openUrl(n.url)}><div class="news-text"><b>{n.title}</b><span>{n.source} · {ago(n.publishedAt)}</span></div></button>
          {/each}
        {/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <div class="card__title"><h3>Grocery</h3><span class="label">{groceryOpen().length} items</span></div>
    <div class="chips wrap">
      {#each groceryOpen() as g (g.id)}
        <button class="chip" onclick={() => toggleGrocery(g)}>{g.name}</button>
      {:else}
        <span class="muted">List is empty. Type “milk, eggs” above.</span>
      {/each}
    </div>
  </section>

  {#if paired()}
    <button class="sync-line" onclick={() => refreshAll()}>
      <Icon name="refresh" size={14} /> {app.status.syncing ? 'Syncing…' : `Synced ${ago(app.status.lastSync || null)}`}
    </button>
  {/if}
</main>

{#if sheet}<ItemSheet item={sheet} onClose={() => (sheet = null)} />{/if}

<style>
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-top: var(--s2); }
  .banner { display: flex; flex-direction: column; gap: 4px; text-align: left; }
  .banner.warn { box-shadow: inset 0 0 0 1px var(--gold-soft); }
  .brief p { line-height: 1.45; }
  .brief p + p { margin-top: 6px; }
  .linkish { background: none; color: var(--accent-text); }
  .when { min-width: 64px; font-size: var(--fs-sm); }
  .grow { flex: 1; }
  .mini { width: 32px; height: 32px; display: grid; place-items: center; color: var(--text-3); }
  .water { display: flex; align-items: center; gap: var(--s3); text-align: left; color: var(--accent-text); }
  .water .grow { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
  .wmeter { width: 64px; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); }
  .habit { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--s3); min-height: 48px; }
  .streak { font-size: var(--fs-sm); font-weight: 650; color: var(--gold-text); }
  .news-item { display: grid; grid-template-columns: 1fr auto; gap: var(--s3); width: 100%; text-align: left; padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
  .news-item:last-child { border-bottom: 0; padding-bottom: 0; }
  .news-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .news-item b { display: block; font-weight: 600; line-height: 1.35; }
  .news-item p { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .news-item span { font-size: var(--fs-xs); color: var(--text-3); }
  .news-item img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; }
  .edit { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; }
  .due { font-size: var(--fs-xs); color: var(--accent-text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .due.soon { color: var(--gold-text); } .due.overdue { color: var(--danger); }
  .small { font-size: var(--fs-xs); }
  .chips.wrap { flex-wrap: wrap; }
  .qa { position: relative; }
  .qa .input { padding-right: 52px; }
  .mic { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; display: grid; place-items: center; color: var(--accent-text); border-radius: 999px; }
  .mic:active { background: var(--surface-2); }
  .icon-btn.sm { width: 36px; height: 36px; }
  .spin :global(svg) { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sync-line { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-3); padding: var(--s2); }
</style>
