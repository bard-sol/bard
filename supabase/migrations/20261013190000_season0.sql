-- Season 0 game tables. Apply to a NEW Supabase project only.
-- Do not apply this file to the live project pxdiyukxgnphxlknhmke.

create table if not exists public.season_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.season_config (key, value) values
  ('season_id', '"s0"'),
  ('cluster', '"devnet"'),
  ('eligibility_min_sol', '{"devnet":0,"mainnet":0.05}'),
  ('legacy_early_buy_enabled', 'true'),
  ('comeback_vote_enabled', 'false'),
  ('relic_burn_enabled', 'false'),
  ('preseason_buy_s', '259200'),
  ('predict_lock_s', '129600'),
  ('final_window_s', '43200'),
  ('fallback_slot_offset', '3600'),
  ('weights', '{"M":0.4,"U":0.25,"B":0.15,"P":0.15,"K":0.05}')
on conflict (key) do nothing;

create table if not exists public.characters (
  id text primary key,
  season text not null default 's0',
  name text not null,
  symbol text not null,
  stats jsonb not null,
  base_mint text,
  pool text,
  status text not null default 'alive',
  fallback_line text not null
);

create table if not exists public.chapters (
  season text not null,
  chapter int not null,
  t0 timestamptz not null,
  status text not null default 'scheduled',
  void_reason text,
  rerun_t0 timestamptz,
  snapshot_ts timestamptz,
  snapshot_slot bigint,
  randomness text,
  vrf_request_sig text,
  vrf_fulfil_sig text,
  fallback_path text,
  state_hash text,
  state_memo_sig text,
  primary key (season, chapter)
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  chapter int not null,
  wallet text not null,
  char_id text not null,
  verb text not null,
  signed_at timestamptz,
  received_at timestamptz not null default now(),
  signature text,
  nonce text,
  payload jsonb not null default '{}',
  counts_for_score boolean not null default true
);
create index if not exists actions_chapter_idx on public.actions (season, chapter, verb);

create table if not exists public.train_credits (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  chapter int not null,
  wallet text not null,
  char_id text not null,
  stat text not null,
  paid numeric not null,
  credited numeric not null,
  discounted boolean not null default false,
  tx_sig text unique,
  block_time timestamptz
);

create table if not exists public.stakes (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  chapter int not null,
  wallet text not null,
  char_id text not null,
  amount numeric not null,
  tx_sig text unique,
  returned_tx_sig text,
  status text not null default 'staked'
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  chapter int not null,
  wallet text not null,
  char_id text not null,
  signed_at timestamptz not null,
  received_at timestamptz not null,
  counts boolean not null,
  voided boolean not null default false,
  unique (season, chapter, wallet)
);

create table if not exists public.squads (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  char_id text not null,
  number int not null,
  unique (season, char_id, number)
);

create table if not exists public.squad_members (
  squad_id uuid not null references public.squads(id) on delete cascade,
  wallet text not null,
  joined_at timestamptz not null default now(),
  consecutive_ineligible int not null default 0,
  primary key (squad_id, wallet)
);

create table if not exists public.last_words (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  chapter int not null,
  char_id text not null,
  wallet text not null,
  text text not null,
  votes int not null default 0,
  filter_result jsonb,
  review_category text,
  chosen boolean not null default false
);

create table if not exists public.revivals (
  season text not null,
  chapter int not null,
  char_id text not null,
  target numeric not null,
  filled numeric not null default 0,
  deadline timestamptz not null,
  status text not null default 'open',
  primary key (season, chapter, char_id)
);

create table if not exists public.eligibility_snapshots (
  season text not null,
  chapter int not null,
  wallet text not null,
  char_id text not null,
  balance numeric not null,
  value_sol numeric,
  held_since timestamptz,
  eligible boolean not null,
  primary key (season, chapter, wallet, char_id)
);

create table if not exists public.swaps (
  id bigserial primary key,
  pool text not null,
  slot bigint not null,
  block_time bigint not null,
  price numeric not null,
  signature text
);

create table if not exists public.chapter_state (
  season text not null,
  chapter int not null,
  status text not null,
  body jsonb not null,
  hash text not null,
  supabase_path text,
  github_path text,
  primary key (season, chapter, status)
);

create table if not exists public.legacy_points (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  wallet text not null,
  source text not null,
  chapter int,
  points int not null
);

create table if not exists public.season_spend_nonces (
  nonce text primary key,
  payload jsonb not null,
  used boolean not null default false,
  used_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.handlers (
  wallet text primary key,
  first_action_at timestamptz,
  faucet_claimed boolean not null default false,
  streak int not null default 0,
  shields int not null default 0,
  last_cheer_day int
);

alter table public.season_config enable row level security;
alter table public.characters enable row level security;
alter table public.chapters enable row level security;
alter table public.actions enable row level security;
alter table public.chapter_state enable row level security;
alter table public.revivals enable row level security;

drop policy if exists season_config_read on public.season_config;
create policy season_config_read on public.season_config for select using (true);
drop policy if exists characters_read on public.characters;
create policy characters_read on public.characters for select using (true);
drop policy if exists chapters_read on public.chapters;
create policy chapters_read on public.chapters for select using (true);
drop policy if exists actions_read on public.actions;
create policy actions_read on public.actions for select using (true);
drop policy if exists chapter_state_read on public.chapter_state;
create policy chapter_state_read on public.chapter_state for select using (true);
drop policy if exists revivals_read on public.revivals;
create policy revivals_read on public.revivals for select using (true);

create or replace view public.v_handler_wallets as
  select a.season, a.chapter, a.wallet
  from public.actions a
  join public.eligibility_snapshots e
    on e.season = a.season and e.chapter = a.chapter and e.wallet = a.wallet and e.char_id = a.char_id
  join public.chapters c on c.season = a.season and c.chapter = a.chapter
  where a.verb in ('strike', 'train', 'decide')
    and e.eligible
    and (c.snapshot_ts is null or a.received_at <= c.snapshot_ts)
    and c.status is distinct from 'void'
  group by a.season, a.chapter, a.wallet;

create or replace view public.v_turnout_median as
  select season, chapter, percentile_cont(0.5) within group (order by u) as median_u
  from (
    select (body #>> '{components,u}')::numeric as u, season, chapter
    from public.chapter_state
    where status = 'final'
  ) s
  group by season, chapter;

insert into storage.buckets (id, name, public)
values ('season-state', 'season-state', true)
on conflict (id) do nothing;
