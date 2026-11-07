<script lang="ts" module>
  import type { Grocery, Habit, Reminder, Task } from '../lib/store.svelte.ts';
  export type SheetItem =
    | { table: 'tasks'; row: Partial<Task> }
    | { table: 'reminders'; row: Partial<Reminder> }
    | { table: 'grocery_items'; row: Partial<Grocery> }
    | { table: 'habits'; row: Partial<Habit> };
</script>

<script lang="ts">
  import { addGrocery, addHabit, addReminder, addTask, remove, toast, update } from '../lib/store.svelte.ts';
  import { addDays, dayKey, fmtWhen, hhmm } from '../lib/util.ts';
  import Icon from './Icon.svelte';

  /** Add or edit any list item with the right date/time fields. */
  let { item, onClose }: { item: SheetItem; onClose: () => void } = $props();

  // The sheet is opened fresh for each item, so capturing the initial values is intended.
  const init = (() => item)();
  const isNew = !init.row.id;
  const r = init.row as any;
  const fire = init.table === 'reminders' && r.fire_at ? new Date(r.fire_at) : addDays(0, new Date(Date.now() + 3_600_000));
  let title = $state<string>(r.title ?? r.name ?? '');
  let date = $state<string>(init.table === 'tasks' ? r.due_on ?? '' : init.table === 'grocery_items' ? r.need_by ?? '' : init.table === 'reminders' ? dayKey(fire) : '');
  let time = $state<string>(init.table === 'tasks' ? r.due_time ?? '' : init.table === 'habits' ? r.remind_time ?? '' : init.table === 'reminders' ? hhmm(fire) : '');
  let repeat = $state<string>(r.repeat ?? '');

  const heading = { tasks: 'Task', reminders: 'Reminder', grocery_items: 'Grocery item', habits: 'Habit' }[init.table];
  const dateLabel = { tasks: 'Due date', reminders: 'Date', grocery_items: 'Need it by', habits: '' }[init.table];
  const timeLabel = { tasks: 'Time (alerts you)', reminders: 'Time', grocery_items: '', habits: 'Daily nudge at' }[init.table];

  const quick = [
    { l: 'Today', d: () => dayKey() },
    { l: 'Tomorrow', d: () => dayKey(addDays(1)) },
    { l: 'Weekend', d: () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return dayKey(d); } },
    { l: 'Next week', d: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return dayKey(d); } },
  ];
  const times = ['09:00', '13:00', '18:00', '21:00'];

  function save(e: SubmitEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (init.table === 'tasks') {
      if (isNew) addTask(t, date || null, date || time ? time || null : null);
      else update('tasks', { ...(r as Task), title: t, due_on: date || (time ? dayKey() : null), due_time: time || null });
      if (time) toast(`You'll get an alert at ${time}`);
    } else if (init.table === 'reminders') {
      const at = new Date(`${date || dayKey()}T${time || '09:00'}:00`);
      if (at.getTime() < Date.now() - 60_000 && repeat !== 'daily') { toast('That time has already passed'); return; }
      if (isNew) addReminder(t, at, repeat === 'daily' ? 'daily' : null);
      else update('reminders', { ...(r as Reminder), title: t, fire_at: at.toISOString(), repeat: repeat || null, done_at: null });
      toast(`Reminder · ${fmtWhen(at)}`);
    } else if (init.table === 'grocery_items') {
      if (isNew) addGrocery(t.split(/\s*,\s*/).filter(Boolean).map((x) => x[0]!.toUpperCase() + x.slice(1)), date || null);
      else update('grocery_items', { ...(r as Grocery), name: t, need_by: date || null });
    } else {
      if (isNew) addHabit(t, time || null);
      else update('habits', { ...(r as Habit), name: t, remind_time: time || null });
    }
    onClose();
  }
  function del() { if (r.id) remove(init.table, r.id); onClose(); }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<form class="sheet-panel stack" onsubmit={save}>
  <div class="row between"><h3>{isNew ? `New ${heading.toLowerCase()}` : heading}</h3>
    <button type="button" class="icon-btn" onclick={onClose} aria-label="Close"><Icon name="x" /></button></div>

  <input class="input" bind:value={title} placeholder={init.table === 'grocery_items' ? 'Milk, eggs' : 'Title'} enterkeyhint="done" />

  {#if dateLabel}
    <div class="field">
      <span class="label"><Icon name="cal" size={14} /> {dateLabel}</span>
      <div class="chips wrap">
        {#each quick as q}<button type="button" class="chip" aria-pressed={date === q.d()} onclick={() => (date = date === q.d() ? '' : q.d())}>{q.l}</button>{/each}
        <input type="date" class="input input--sm" bind:value={date} aria-label="Pick a date" />
        {#if date && init.table !== 'reminders'}<button type="button" class="chip" onclick={() => (date = '')}>No date</button>{/if}
      </div>
    </div>
  {/if}

  {#if timeLabel}
    <div class="field">
      <span class="label"><Icon name="clock" size={14} /> {timeLabel}</span>
      <div class="chips wrap">
        {#each times as t}<button type="button" class="chip" aria-pressed={time === t} onclick={() => (time = time === t ? '' : t)}>{t}</button>{/each}
        <input type="time" class="input input--sm" bind:value={time} aria-label="Pick a time" />
        {#if time && init.table !== 'reminders'}<button type="button" class="chip" onclick={() => (time = '')}>No time</button>{/if}
      </div>
    </div>
  {/if}

  {#if init.table === 'reminders'}
    <div class="field">
      <span class="label">Repeat</span>
      <div class="chips">
        <button type="button" class="chip" aria-pressed={!repeat} onclick={() => (repeat = '')}>Once</button>
        <button type="button" class="chip" aria-pressed={repeat === 'daily'} onclick={() => (repeat = 'daily')}>Every day</button>
      </div>
    </div>
  {/if}

  <div class="row" style="gap:8px">
    {#if !isNew}<button type="button" class="btn btn--ghost" onclick={del}><Icon name="trash" size={16} /> Delete</button>{/if}
    <button class="btn btn--primary grow">{isNew ? 'Add' : 'Save'}</button>
  </div>
</form>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 70; animation: fade var(--t-med) var(--ease-out); }
  .sheet-panel { position: fixed; left: 0; right: 0; bottom: 0; z-index: 71; max-width: 560px; margin: 0 auto;
    padding: var(--s5) var(--s4) calc(var(--s5) + var(--safe-bottom)); background: var(--surface-1);
    border-radius: 20px 20px 0 0; box-shadow: 0 -8px 30px var(--elev), inset 0 1px 0 var(--line-strong);
    animation: up var(--t-slow) var(--ease-out); }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .field { display: flex; flex-direction: column; gap: 8px; }
  .field .label { display: flex; gap: 6px; align-items: center; }
  .chips.wrap { flex-wrap: wrap; }
  .input--sm { width: auto; height: 36px; padding: 0 10px; font-size: var(--fs-sm); }
  .grow { flex: 1; }
</style>
