-- Date & time for every list: task due time, grocery "need by", habit daily nudge time.
alter table tasks add column if not exists due_time text;            -- HH:mm (local), with due_on
alter table grocery_items add column if not exists need_by text;     -- YYYY-MM-DD (local)
alter table habits add column if not exists remind_time text;        -- HH:mm (local), daily nudge
