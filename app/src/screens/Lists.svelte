<script lang="ts">
  import { extractTime, parseQuick } from '../../../shared/quickadd.ts';
  import Icon from '../components/Icon.svelte';
  import ItemSheet, { type SheetItem } from '../components/ItemSheet.svelte';
  import {
    addGrocery, addHabit, addReminder, addTask, allTasks, app, doneOn, doneReminder, groceryBought, groceryOpen,
    grocerySuggestions, habits, remove, streak, taskDue, toast, toggleGrocery, toggleHabit, toggleTask, upcomingReminders, week,
  } from '../lib/store.svelte.ts';
  import { dayKey, dueInfo, fmtDay, fmtWhen, hhmm } from '../lib/util.ts';

  let sheet = $state<SheetItem | null>(null);
  const TABLE = { tasks: 'tasks', grocery: 'grocery_items', habits: 'habits', reminders: 'reminders' } as const;
  function details() { sheet = { table: TABLE[seg], row: seg === 'grocery' || seg === 'habits' ? { name: text.trim() } : { title: text.trim() } } as SheetItem; text = ''; }
  // tasks: overdue and dated first (by time), then undated, done last
  const tasksSorted = $derived(allTasks().slice().sort((a, b) =>
    Number(!!a.done_at) - Number(!!b.done_at) || (taskDue(a)?.getTime() ?? 9e15) - (taskDue(b)?.getTime() ?? 9e15)));

  type Seg = 'tasks' | 'grocery' | 'habits' | 'reminders';
  let seg = $state<Seg>('tasks');
  let text = $state('');

  function add(e: SubmitEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    if (seg === 'tasks') {
      // "finish deck tomorrow 5pm" → due tomorrow at 17:00
      const { date, rest } = extractTime(v);
      const hasTime = /\d\s*(:|\.\d|am|pm)|\b(tonight|morning|afternoon|evening|noon|night)\b|\bin\s+\d/i.test(v);
      if (date && rest) {
        addTask(rest[0]!.toUpperCase() + rest.slice(1), dayKey(date), hasTime ? hhmm(date) : null);
        toast(`Task due ${dueInfo(dayKey(date), hasTime ? hhmm(date) : null)!.label}`);
      } else addTask(v);
    }
    if (seg === 'grocery') addGrocery(v.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean).map((x) => x[0]!.toUpperCase() + x.slice(1)));
    if (seg === 'habits') {
      const { date, rest } = extractTime(v.replace(/\b(daily|every ?day)\b/i, ''));
      const name = (rest || v).replace(/^\w/, (c) => c.toUpperCase());
      addHabit(name, date ? hhmm(date) : null);
      if (date) toast(`Daily nudge at ${hhmm(date)}`);
    }
    if (seg === 'reminders') {
      const q = parseQuick(v, new Date(), 'reminder');
      const at = q.at ? new Date(q.at) : new Date(Date.now() + 3_600_000);
      addReminder(q.title || v, at, q.repeat ?? null);
      toast(`Reminder set for ${fmtWhen(at)}`);
    }
    text = '';
  }
  const placeholder = $derived(
    { tasks: 'Finish deck tomorrow 5pm', grocery: 'Milk, eggs, bread', habits: 'Read 20 pages 9pm', reminders: 'Call mom 6pm · stretch in 30 min' }[seg],
  );
</script>

<main class="app stack page-enter">
  <header><h1>Lists</h1></header>
  <div class="seg">
    {#each [['tasks', 'Tasks'], ['grocery', 'Grocery'], ['habits', 'Habits'], ['reminders', 'Reminders']] as [k, l]}
      <button class:on={seg === k} onclick={() => (seg = k as Seg)}>{l}</button>
    {/each}
  </div>

  <form onsubmit={add} class="row">
    <input class="input" bind:value={text} {placeholder} enterkeyhint="done" />
    <button type="button" class="btn btn--ghost btn--icon" onclick={details} aria-label="Add with date and time"><Icon name="cal" /></button>
    <button class="btn btn--icon" aria-label="Add"><Icon name="plus" /></button>
  </form>

  <section class="card">
    {#if seg === 'tasks'}
      {#each tasksSorted as t (t.id)}
        {@const due = dueInfo(t.due_on, t.due_time)}
        <div class="list-row" class:is-done={!!t.done_at}>
          <input type="checkbox" class="check" checked={!!t.done_at} onchange={() => toggleTask(t)} aria-label="Done" />
          <button class="grow edit" onclick={() => (sheet = { table: 'tasks', row: t })}>
            <span class="list-row__text">{t.title}</span>
            {#if due && !t.done_at}<span class="due" class:overdue={due.overdue} class:soon={due.soon}>{due.overdue ? 'Overdue · ' : ''}{due.label}</span>{/if}
          </button>
          <button class="mini" onclick={() => remove('tasks', t.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No tasks.</p>{/each}
    {:else if seg === 'grocery'}
      {#each groceryOpen() as g (g.id)}
        <div class="list-row">
          <input type="checkbox" class="check" checked={false} onchange={() => toggleGrocery(g)} aria-label="Bought" />
          <button class="grow edit" onclick={() => (sheet = { table: 'grocery_items', row: g })}>
            <span>{g.name}</span>
            {#if g.need_by}{@const d = dueInfo(g.need_by)}<span class="due" class:overdue={d?.overdue}>by {fmtDay(g.need_by)}</span>{/if}
          </button>
          <button class="mini" onclick={() => remove('grocery_items', g.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">Nothing to buy.</p>{/each}
      {#if groceryBought().length}
        <div class="label mt-4">Bought recently</div>
        {#each groceryBought() as g (g.id)}
          <div class="list-row is-done">
            <input type="checkbox" class="check" checked onchange={() => toggleGrocery(g)} aria-label="Not bought" />
            <span class="list-row__text grow">{g.name}</span>
          </div>
        {/each}
      {/if}
      {#if grocerySuggestions().length}
        <div class="label mt-4">Add again</div>
        <div class="chips wrap mt-2">
          {#each grocerySuggestions() as s}<button class="chip" onclick={() => addGrocery([s])}>+ {s}</button>{/each}
        </div>
      {/if}
    {:else if seg === 'habits'}
      {#each habits() as h (h.id)}
        <div class="list-row">
          <input type="checkbox" class="check" checked={doneOn(h)} onchange={() => toggleHabit(h)} aria-label="Done today" />
          <button class="grow edit" onclick={() => (sheet = { table: 'habits', row: h })}>
            <span>{h.name}</span>
            <span class="week">{#each week(h) as on}<i class:on></i>{/each}<span class="streak">{streak(h)}d streak</span>
              {#if h.remind_time}<span class="due">· nudge {h.remind_time}</span>{/if}</span>
          </button>
          <button class="mini" onclick={() => remove('habits', h.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No habits yet.</p>{/each}
    {:else}
      {#each upcomingReminders() as r (r.id)}
        <div class="list-row">
          <button class="grow edit" onclick={() => (sheet = { table: 'reminders', row: r })}>
            <span>{r.title}</span>
            <span class="due" class:soon={Date.parse(r.fire_at) - Date.now() < 3 * 3_600_000}>{fmtWhen(r.fire_at)}{r.repeat === 'daily' ? ' · every day' : ''}</span>
          </button>
          <button class="mini" onclick={() => doneReminder(r)} aria-label="Done"><Icon name="x" size={16} /></button>
          <button class="mini" onclick={() => remove('reminders', r.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No reminders.</p>{/each}
    {/if}
  </section>
  <p class="hint">Tap an item to change its date or time · {app.status.syncing ? 'Syncing…' : 'saved on this phone'}</p>
</main>

{#if sheet}<ItemSheet item={sheet} onClose={() => (sheet = null)} />{/if}

<style>
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--surface-2); border-radius: 12px; padding: 4px; box-shadow: inset 0 0 0 1px var(--line); }
  .seg button { height: 36px; border-radius: 9px; font-weight: 600; font-size: var(--fs-sm); color: var(--text-2); transition: background var(--t-fast); }
  .seg button.on { background: var(--surface-1); color: var(--text); box-shadow: 0 1px 3px var(--elev), inset 0 0 0 1px var(--line); }
  .grow { flex: 1; min-width: 0; }
  .mini { width: 34px; height: 34px; display: grid; place-items: center; color: var(--text-3); flex: none; }
  .edit { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 4px 0; }
  .due { font-size: var(--fs-xs); color: var(--accent-text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .due.soon { color: var(--gold-text); }
  .due.overdue { color: var(--danger); }
  .week { display: flex; gap: 3px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
  .week .due { margin-left: 6px; }
  .week i { width: 8px; height: 8px; background: var(--surface-3); }
  .week i.on { background: var(--accent); }
  .streak { margin-left: 8px; font-size: var(--fs-xs); color: var(--gold-text); font-weight: 650; }
  .chips.wrap { flex-wrap: wrap; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); text-align: center; }
  form .input { flex: 1; }
</style>
