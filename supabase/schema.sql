-- Glimpse schema. Paste into Supabase → SQL Editor and run once.
-- All app reads/writes go through Next.js API routes using the service role key,
-- so RLS is enabled with no policies: the anon key can't touch these tables directly.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  cycle_length_days int not null default 7 check (cycle_length_days between 1 and 7),
  next_cycle_length_days int check (next_cycle_length_days between 1 and 7),
  created_by uuid references profiles,
  created_at timestamptz default now()
);

create table if not exists group_members (
  group_id uuid references groups on delete cascade,
  user_id uuid references profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

create table if not exists cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  prompt text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'finalizing', 'revealed', 'empty')),
  vibe_label text,
  palette jsonb,
  board_url text,
  board_url_landscape text,
  theme text check (theme in ('scrapbook', 'film')),
  photo_count int,
  created_at timestamptz default now()
);

-- At most one live cycle per group.
create unique index if not exists cycles_one_active_per_group
  on cycles (group_id) where status in ('active', 'finalizing');
create index if not exists cycles_group_ends on cycles (group_id, ends_at desc);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  storage_path text not null,
  created_at timestamptz default now()
);
create index if not exists photos_cycle on photos (cycle_id);

create table if not exists prompt_reports (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  reason text,
  created_at timestamptz default now()
);

-- Hand-drawn stickers/stamps that members place on a revealed board.
-- x/y are the sticker's center as a fraction of board width/height; scale is relative to board width.
create table if not exists board_stickers (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  sticker_id text not null,
  x real not null default 0.5,
  y real not null default 0.5,
  scale real not null default 0.22,
  rotation real not null default 0,
  orientation text not null default 'portrait' check (orientation in ('portrait', 'landscape')),
  created_at timestamptz default now()
);
create index if not exists board_stickers_cycle on board_stickers (cycle_id);

-- For databases created before these columns existed:
alter table cycles add column if not exists board_url_landscape text;
alter table cycles add column if not exists theme text;
alter table board_stickers add column if not exists orientation text not null default 'portrait';

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table cycles enable row level security;
alter table photos enable row level security;
alter table prompt_reports enable row level security;
alter table board_stickers enable row level security;

-- Storage: photos are private (served only via the finished board); boards are public so they can be shared.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('boards', 'boards', true)
  on conflict (id) do nothing;

-- ─── Optional: auto-finalize expired cycles every 5 minutes ───────────────────
-- The app also finalizes lazily whenever someone opens a group after its end time,
-- so this is only needed for "everyone sees it at once" without anyone opening the app.
-- Requires a deployed URL. Enable the pg_cron and pg_net extensions first
-- (Database → Extensions), then replace the URL and secret and run:
--
-- select cron.schedule(
--   'glimpse-finalize-expired',
--   '*/5 * * * *',
--   $$ select net.http_post(
--        url := 'https://YOUR-APP.vercel.app/api/cron/finalize-expired',
--        headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')
--      ); $$
-- );
