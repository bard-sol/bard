/** Season 0 constants. Weights freeze at season open. Devnet only at runtime. */

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const LIVE_SUPABASE_REF = 'pxdiyukxgnphxlknhmke';

export const PROGRAMS = {
  oraoVrf: 'VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y',
  oraoCallback: 'VRFCBePmGTpZ234BhbzNNzmyg39Rgdd6VgdfhHwKypU',
  squads: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
  dbc: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  dammV2: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  wsol: 'So11111111111111111111111111111111111111112',
  system: '11111111111111111111111111111111'
};

export const HOUR = 3600;

export function defaultConfig() {
  return {
    season_id: 's0',
    cluster: 'devnet',
    season_start_utc: '2026-10-16T10:00:00.000Z',
    cast_size: 8,
    chapters: 7,
    chapter_len_s: 72 * HOUR,
    final_window_s: 12 * HOUR,
    decide_open_s: 0,
    decide_close_s: 48 * HOUR,
    shortlist_s: 36 * HOUR,
    predict_open_s: 0,
    predict_lock_s: 36 * HOUR,
    last_words_s: 6 * HOUR,
    cosmetic_vote_s: 12 * HOUR,
    chapter_night_s: 8 * HOUR,
    revival_s: 24 * HOUR,
    preseason_buy_s: 72 * HOUR,
    vrf_fallback_timeout_s: 30 * 60,
    fallback_slot_offset: 3600,
    weights: { M: 0.3, U: 0.3, B: 0.15, P: 0.15, K: 0.1 },
    contrib_reward_mode: 'tbard',
    reward_unlock_days: 14,
    contrib_pool_chapter: 2142857,
    mainnet_rewards_enabled: false,
    eligibility_min_sol: { devnet: 0, mainnet: 0.05 },
    elig_hold_s: 24 * HOUR,
    vote_cap: 0.02,
    vote_cap_relax_under: 50,
    squad_size: 25,
    squad_top_min_members: 5,
    discount_slots: 100,
    discount_multiplier: 1.5,
    discount_hold_s: 120,
    train_min: 10,
    train_max: 5000,
    revival_min: 10,
    revival_factor: 0.35,
    revival_min_target: 5000,
    revival_max_target: 60000,
    prediction_points: 10,
    prediction_cap: 50,
    legacy_cap: 50,
    trial_turns: 8,
    trial_moves: 30,
    trial_seconds: 60,
    trial_energy: 3,
    trial_base_hp: 115,
    trial_combo_bonus: 4,
    trial_finisher_pct: 30,
    push_per_day: 3,
    chest_pity: 10,
    card_upgrades_enabled: false,
    raid_boss_enabled: false,
    legacy_early_buy_enabled: true,
    comeback_vote_enabled: false,
    relic_burn_enabled: false,
    faucet_first_tbard: 1000,
    faucet_cheer_tbard: 100,
    faucet_first_sol: 0.05,
    drip_sol_per_day: 0.5,
    spend_nonce_ttl_s: 120,
    action_nonce_ttl_s: 600,
    supply: 1000000000,
    decimals: 6,
    migration_quote_threshold_sol: 85,
    fee_bps: 200,
    state_storage: 'supabase+github',
    irys_on_devnet: false
  };
}

export function eligibilityMinSol(config, cluster) {
  const table = (config || defaultConfig()).eligibility_min_sol;
  if (cluster === 'mainnet' || cluster === 'mainnet-beta') return Number(table.mainnet);
  return Number(table.devnet);
}

export function seasonStartMs(config) {
  return Date.parse((config || defaultConfig()).season_start_utc);
}
