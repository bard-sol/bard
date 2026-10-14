-- Annotation fields on the Season 0 chapter snapshot.
-- Apply to a NEW Supabase project only.
-- Do not apply this file to the live project pxdiyukxgnphxlknhmke.
--
-- holders stays null until a hero mint exists and the snapshot job writes the
-- count. eligibility_snapshots is not a full token census, and devnet has no
-- hero mints deployed yet.
-- revival_bar_pct is not an on-chain field. Write a tick when each revive burn
-- is indexed. A missed burn cannot be rebuilt as a series. One closing tick
-- (filled / target) is enough for A1, because the bar only rises.

alter table public.chapter_state
  add column if not exists owed boolean not null default false,
  add column if not exists champion_id text,
  add column if not exists revival_burn numeric not null default 0;

create table if not exists public.chapter_hero_snapshot (
  season text not null,
  chapter int not null,
  char_id text not null,
  train_spend numeric not null default 0,
  train_credited numeric not null default 0,
  holders integer,
  status text not null check (status in ('alive', 'eliminated')),
  in_snapshot boolean not null default false,
  s numeric,
  u numeric,
  marked boolean not null default false,
  primary key (season, chapter, char_id)
);

create table if not exists public.revival_bar_ticks (
  id bigserial primary key,
  season text not null,
  chapter int not null,
  char_id text not null,
  paid numeric not null,
  pct numeric not null,
  recorded_at timestamptz not null default now()
);

create index if not exists revival_bar_ticks_chapter_idx
  on public.revival_bar_ticks (season, chapter, id);

alter table public.chapter_hero_snapshot enable row level security;
alter table public.revival_bar_ticks enable row level security;

drop policy if exists chapter_hero_snapshot_read on public.chapter_hero_snapshot;
create policy chapter_hero_snapshot_read on public.chapter_hero_snapshot for select using (true);

drop policy if exists revival_bar_ticks_read on public.revival_bar_ticks;
create policy revival_bar_ticks_read on public.revival_bar_ticks for select using (true);
