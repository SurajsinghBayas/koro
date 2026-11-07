-- Water intake (one row per glass/sip logged) and read-later articles. Both sync like the other lists.
create table if not exists water_logs (
  id uuid primary key,
  day text not null,                      -- YYYY-MM-DD (local)
  ml integer not null default 250,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);
create index if not exists water_logs_day on water_logs (day);

create table if not exists saved (
  id uuid primary key,
  url text not null,
  title text,
  site text,
  image text,
  excerpt text,
  summary text,                           -- AI: short TL;DR lines
  content text,                           -- JSON blocks [{t:'p'|'h'|'li'|'q', x:'…'}] (plain text, safe to render)
  words integer,
  status text not null default 'pending', -- pending | ready | failed
  read_at timestamptz,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_seq bigint not null
);
