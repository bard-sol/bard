-- Season 0 loop tables (trials, streaks, chests, crowd votes, push).
-- Apply to a NEW Supabase project only.
-- Do not apply this file to the live project pxdiyukxgnphxlknhmke.

create table if not exists public.season_trials (
  season text not null,
  wallet text not null,
  day date not null,
  seed text not null,
  accuracy numeric not null,
  damage int not null,
  counted boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (season, wallet, day)
);

create table if not exists public.season_streaks (
  season text not null,
  wallet text not null,
  streak int not null default 0,
  shields int not null default 0,
  last_day int,
  legacy_crowd int not null default 0,
  primary key (season, wallet)
);

create table if not exists public.season_letters (
  season text not null,
  wallet text not null,
  day date not null,
  choice text not null,
  primary key (season, wallet, day)
);

create table if not exists public.season_chests (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  wallet text not null,
  item text not null,
  rarity text not null,
  transferable boolean not null default false,
  nft boolean not null default false,
  opened_at timestamptz not null default now(),
  constraint season_chests_cosmetic check (transferable = false and nft = false)
);

create table if not exists public.season_crowd_votes (
  season text not null,
  wallet text not null,
  chapter int not null,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (season, wallet, chapter)
);

create table if not exists public.season_push_log (
  season text not null,
  wallet text not null,
  day date not null,
  sent int not null default 0,
  primary key (season, wallet, day),
  constraint season_push_cap check (sent <= 3)
);

create table if not exists public.season_turnstile (
  season text not null,
  wallet text not null,
  passed_at timestamptz not null default now(),
  primary key (season, wallet)
);
