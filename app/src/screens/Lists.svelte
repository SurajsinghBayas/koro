<script lang="ts">
  import { parseQuick } from '../../../shared/quickadd.ts';
  import Icon from '../components/Icon.svelte';
  import {
    addGrocery, addHabit, addReminder, addTask, allTasks, app, doneOn, doneReminder, groceryBought, groceryOpen,
    grocerySuggestions, habits, remove, streak, toast, toggleGrocery, toggleHabit, toggleTask, upcomingReminders, week,
  } from '../lib/store.svelte.ts';
  import { fmtWhen } from '../lib/util.ts';

  type Seg = 'tasks' | 'grocery' | 'habits' | 'reminders';
  let seg = $state<Seg>('tasks');
  let text = $state('');

  function add(e: SubmitEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    if (seg === 'tasks') addTask(v);
    if (seg === 'grocery') addGrocery(v.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean).map((x) => x[0]!.toUpperCase() + x.slice(1)));
    if (seg === 'habits') addHabit(v);
    if (seg === 'reminders') {
      const q = parseQuick(v, new Date(), 'reminder');
      const at = q.at ? new Date(q.at) : new Date(Date.now() + 3_600_000);
      addReminder(q.title || v, at, q.repeat ?? null);
      toast(`Reminder set for ${fmtWhen(at)}`);
    }
    text = '';
  }
  const placeholder = $derived(
    { tasks: 'New task', grocery: 'Milk, eggs, bread', habits: 'New habit (e.g. Read 20 pages)', reminders: 'Call mom 6pm · stretch in 30 min' }[seg],
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
    <button class="btn btn--icon" aria-label="Add"><Icon name="plus" /></button>
  </form>

  <section class="card">
    {#if seg === 'tasks'}
      {#each allTasks() as t (t.id)}
        <div class="list-row" class:is-done={!!t.done_at}>
          <input type="checkbox" class="check" checked={!!t.done_at} onchange={() => toggleTask(t)} aria-label="Done" />
          <span class="list-row__text grow">{t.title}{#if t.due_on}<span class="muted"> · {t.due_on}</span>{/if}</span>
          <button class="mini" onclick={() => remove('tasks', t.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No tasks.</p>{/each}
    {:else if seg === 'grocery'}
      {#each groceryOpen() as g (g.id)}
        <div class="list-row">
          <input type="checkbox" class="check" checked={false} onchange={() => toggleGrocery(g)} aria-label="Bought" />
          <span class="grow">{g.name}</span>
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
          <div class="grow">
            <div>{h.name}</div>
            <div class="week">{#each week(h) as on}<i class:on></i>{/each}<span class="streak">{streak(h)}d streak</span></div>
          </div>
          <button class="mini" onclick={() => remove('habits', h.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No habits yet.</p>{/each}
    {:else}
      {#each upcomingReminders() as r (r.id)}
        <div class="list-row">
          <span class="num sky-text when">{fmtWhen(r.fire_at)}</span>
          <span class="grow">{r.title}{#if r.repeat === 'daily'}<span class="muted"> · daily</span>{/if}</span>
          <button class="mini" onclick={() => doneReminder(r)} aria-label="Done"><Icon name="x" size={16} /></button>
          <button class="mini" onclick={() => remove('reminders', r.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      {:else}<p class="muted">No reminders.</p>{/each}
    {/if}
  </section>
  <p class="hint">{app.status.syncing ? 'Syncing…' : 'Saved on this phone · syncs to your server'}</p>
</main>

<style>
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--surface-2); border-radius: 12px; padding: 4px; box-shadow: inset 0 0 0 1px var(--line); }
  .seg button { height: 36px; border-radius: 9px; font-weight: 600; font-size: var(--fs-sm); color: var(--text-2); transition: background var(--t-fast); }
  .seg button.on { background: var(--surface-1); color: var(--text); box-shadow: 0 1px 3px var(--elev), inset 0 0 0 1px var(--line); }
  .grow { flex: 1; min-width: 0; }
  .mini { width: 34px; height: 34px; display: grid; place-items: center; color: var(--text-3); flex: none; }
  .when { min-width: 64px; font-size: var(--fs-sm); }
  .week { display: flex; gap: 3px; align-items: center; margin-top: 4px; }
  .week i { width: 8px; height: 8px; background: var(--surface-3); }
  .week i.on { background: var(--accent); }
  .streak { margin-left: 8px; font-size: var(--fs-xs); color: var(--gold-text); font-weight: 650; }
  .chips.wrap { flex-wrap: wrap; }
  .hint { font-size: var(--fs-xs); color: var(--text-3); text-align: center; }
  form .input { flex: 1; }
</style>
