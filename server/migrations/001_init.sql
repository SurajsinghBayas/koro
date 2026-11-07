-- Koro schema. Synced tables share: id (client-generated uuid), updated_at (client clock, last-write-wins),
-- deleted_at (tombstone), server_seq (server-assigned, drives the sync cursor).
create sequence if not exists sync_seq;

create table if not exists devices (
  id          uuid primary key,
  name        text not null,
  kind        text not null,              -- phone | mac | other
  token_hash  text not null unique,
  push_token  text,
  battery_pct smallint,
  charging    boolean,
  battery_at  timestamptz,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create table if not exists tasks (
  id uuid primary key,
  title text not null,
  notes text,
  due_on text,                            -- YYYY-MM-DD (local date)
  priority smallint not null default 0,
  done_at timestamptz,
  sort integer not null default 0,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);

create table if not exists grocery_items (
  id uuid primary key,
  name text not null,
  category text,
  bought_at timestamptz,
  sort integer not null default 0,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);

create table if not exists habits (
  id uuid primary key,
  name text not null,
  days_mask smallint not null default 127, -- bit 0 = Monday … bit 6 = Sunday
  sort integer not null default 0,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);

create table if not exists habit_logs (
  id uuid primary key,
  habit_id uuid not null,
  day text not null,                      -- YYYY-MM-DD
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);

create table if not exists reminders (
  id uuid primary key,
  title text not null,
  fire_at timestamptz not null,
  repeat text,                            -- null | daily
  done_at timestamptz,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists inbox (
  id bigserial primary key,
  kind text not null,                     -- match | system
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tasks_seq on tasks (server_seq);
create index if not exists grocery_seq on grocery_items (server_seq);
create index if not exists habits_seq on habits (server_seq);
create index if not exists habit_logs_seq on habit_logs (server_seq);
create index if not exists reminders_seq on reminders (server_seq);
create index if not exists inbox_created on inbox (created_at desc);
