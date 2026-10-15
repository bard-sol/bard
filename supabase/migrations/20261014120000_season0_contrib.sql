-- Contribution weights and the tBard-only reward mode.
-- Apply to a NEW Supabase project only.
-- Do not apply this file to the live project pxdiyukxgnphxlknhmke.
-- There is no mainnet or real-money reward mode in this migration.

insert into public.season_config (key, value) values
  ('weights', '{"M":0.3,"U":0.3,"B":0.15,"P":0.15,"K":0.1}'),
  ('contrib_reward_mode', '"tbard"'),
  ('reward_unlock_days', '14'),
  ('contrib_pool_chapter', '2142857'),
  ('mainnet_rewards_enabled', 'false')
on conflict (key) do update set value = excluded.value, updated_at = now();
