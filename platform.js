/**
 * Bard platform shared client
 * - Supabase when tables exist
 * - localStorage fallback otherwise
 *
 * FEE_TREASURY: set your private collection wallet (base58).
 * It is used for transfers only — never shown as a marketing address.
 */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://pxdiyukxgnphxlknhmke.supabase.co';
  var SUPABASE_ANON =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4ZGl5dWt4Z25waHhsa25obWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTg2NDAsImV4cCI6MjA4OTQzNDY0MH0.eOJ8I7UBCywHDMWdPbcWFURbfoDgMUHFD_cSAZA8Hk4';

  /** @type {string} Set to your fee collection wallet (not displayed in UI) */
  var FEE_TREASURY = 'JB9uSThPHadHPpyed7E2rvpYubGHBA8evZqQgNQZZFAd';

  /** Flip to true when ready to collect real SOL again. */
  var FEES_ENABLED = false;

  var FEES = {
    onboard: 0.25,
    campaign: 0.25,
    claim: 0.1,
    stake: 0.05,
    starter: 1,
    pro: 4
  };

  var PREMIUM_TYPES = { hold: true, refer: true, custom: true, board: true, pool: true, airdrop: true };
  var PREMIUM_REWARDS = { top3: true, pool: true, growing: true };

  var TEAM_KEY = 'bard_team_v1';
  var HOLDER_KEY = 'bard_holder_v1';
  var RPC = 'https://api.devnet.solana.com';
  var SUPABASE_SCRIPT = '/vendor/supabase/supabase.js';
  var LOCAL_MODE_MSG = 'NOT SAVED — local demo mode. Nothing you do here is stored on Bard.';

  var sb = null;
  var mode = 'local';
  var ready = null;

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHttpUrl(url) {
    if (url == null) return '';
    var raw = String(url).trim();
    if (!raw) return '';
    try {
      var parsed = new URL(raw);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    } catch (e) {}
    return '';
  }

  function showLocalBanner() {
    if (typeof document === 'undefined' || mode !== 'local') return;
    if (document.getElementById('bard-local-banner')) return;
    var bar = document.createElement('div');
    bar.id = 'bard-local-banner';
    bar.setAttribute('role', 'status');
    bar.textContent = LOCAL_MODE_MSG;
    bar.style.cssText = 'box-sizing:border-box;display:block;width:100%;margin:0;padding:12px 16px;background:#6b1d1d;color:#fff;text-align:center;font:600 15px/1.35 system-ui,Segoe UI,sans-serif;position:relative;z-index:100000;';
    var mount = function () {
      if (!document.body || document.getElementById('bard-local-banner')) return;
      document.body.insertBefore(bar, document.body.firstChild);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  function refuseLocalTeamWrite() {
    if (mode === 'supabase' && sb) return;
    throw new Error(LOCAL_MODE_MSG);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (ready) return ready;
    ready = (async function () {
      try {
        await loadScript(SUPABASE_SCRIPT);
        if (!global.supabase || !global.supabase.createClient) throw new Error('supabase missing');
        sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
        var probe = await sb.from('projects').select('id').limit(1);
        if (probe.error) { console.warn('[Bard] localStorage', probe.error.message); mode = 'local'; sb = null; }
        else { mode = 'supabase'; console.info('[Bard] Connected to Supabase'); }
      } catch (e) { console.warn('[Bard] localStorage', e); mode = 'local'; sb = null; }
      if (mode === 'local') showLocalBanner();
      return { mode: mode, sb: sb };
    })();
    return ready;
  }

  function localTeam() {
    try { var raw = localStorage.getItem(TEAM_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return { projects: [] };
  }
  function saveLocalTeam(state) { localStorage.setItem(TEAM_KEY, JSON.stringify(state)); }
  function localHolder() {
    try { var raw = localStorage.getItem(HOLDER_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return { joined: {}, claims: {}, xHandle: null };
  }
  function saveLocalHolder(h) { localStorage.setItem(HOLDER_KEY, JSON.stringify(h)); }

  /** Bard's member of every Phase-1 Squads 2-of-2. Same key as fee treasury for now. */
  function getVaultBardMember() { return FEE_TREASURY; }

  function parseTweetId(url) {
    if (!url) return null;
    var m = String(url).match(/(?:status|statuses)\/(\d{2,30})/i);
    if (m) return m[1];
    if (/^\d{2,30}$/.test(String(url).trim())) return String(url).trim();
    return null;
  }
  function xIntentUrls(postUrl, quoteText) {
    var id = parseTweetId(postUrl);
    if (!id) return null;
    var tweetUrl = 'https://x.com/i/status/' + id;
    var quote = quoteText ? String(quoteText) : '';
    return {
      tweetId: id,
      tweetUrl: tweetUrl,
      like: 'https://x.com/intent/like?tweet_id=' + encodeURIComponent(id),
      rt: 'https://x.com/intent/retweet?tweet_id=' + encodeURIComponent(id),
      quote: 'https://x.com/intent/post?url=' + encodeURIComponent(tweetUrl) + (quote ? '&text=' + encodeURIComponent(quote) : '')
    };
  }

  function isBase58Addr(s) {
    return typeof s === 'string' && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
  }

  async function fetchVaultOnchain(address, mint) {
    if (!isBase58Addr(address)) throw new Error('Invalid vault address');
    if (!global.solanaWeb3) throw new Error('Solana web3 not loaded');
    var Connection = global.solanaWeb3.Connection;
    var PublicKey = global.solanaWeb3.PublicKey;
    var conn = new Connection(RPC, 'confirmed');
    var owner = new PublicKey(address);
    var TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    var uiAmount = 0;
    var raw = '0';
    var decimals = 0;
    var source = 'empty';
    try {
      var info = await conn.getParsedAccountInfo(owner, 'confirmed');
      var parsed = info && info.value && info.value.data && info.value.data.parsed;
      if (parsed && parsed.type === 'account' && parsed.info && parsed.info.tokenAmount) {
        uiAmount = Number(parsed.info.tokenAmount.uiAmount || 0);
        raw = String(parsed.info.tokenAmount.amount || '0');
        decimals = parsed.info.tokenAmount.decimals || 0;
        source = 'token-account';
        return { address: address, mint: parsed.info.mint || mint || null, uiAmount: uiAmount, raw: raw, decimals: decimals, source: source, solscan: 'https://solscan.io/account/' + address + '?cluster=devnet' };
      }
    } catch (e) {}
    var filter = mint && isBase58Addr(mint) ? { mint: new PublicKey(mint) } : { programId: TOKEN_PROGRAM };
    try {
      var accs = await conn.getParsedTokenAccountsByOwner(owner, filter, 'confirmed');
      (accs.value || []).forEach(function (a) {
        var ta = a.account.data.parsed && a.account.data.parsed.info && a.account.data.parsed.info.tokenAmount;
        if (!ta) return;
        uiAmount += Number(ta.uiAmount || 0);
        raw = String(Number(raw) + Number(ta.amount || 0));
        decimals = ta.decimals || decimals;
        source = 'owner-atas';
      });
    } catch (e2) {}
    if (uiAmount === 0 && (!mint || mint === 'SOL')) {
      try {
        var lamports = await conn.getBalance(owner, 'confirmed');
        uiAmount = lamports / 1e9;
        raw = String(lamports);
        decimals = 9;
        source = 'sol';
      } catch (e3) {}
    }
    return { address: address, mint: mint || null, uiAmount: uiAmount, raw: String(raw), decimals: decimals, source: source, solscan: 'https://solscan.io/account/' + address + '?cluster=devnet' };
  }


  function mapProjectRow(r, campaigns) {
    return {
      id: r.id, name: r.name, ticker: r.ticker, mint: r.mint, admin: r.admin_wallet || '', chain: r.chain || 'solana',
      feePaid: !!r.fee_paid, feeTx: r.fee_tx || null, createdAt: r.created_at, campaigns: campaigns || [],
      vaultAddress: r.vault_address || r.vaultAddress || '',
      vaultMint: r.vault_mint || r.vaultMint || r.mint || '',
      vaultReserved: Number(r.vault_reserved != null ? r.vault_reserved : (r.vaultReserved || 0)),
      vaultStatus: r.vault_status || r.vaultStatus || 'none',
      vaultLinkedAt: r.vault_linked_at || r.vaultLinkedAt || null,
      vaultMultisig: r.vault_multisig || r.vaultMultisig || '',
      plan: r.plan || r.plan || 'free',
      planTx: r.plan_tx || r.planTx || null,
      planPaidAt: r.plan_paid_at || r.planPaidAt || null
    };
  }
  function mapCampaignRow(c) {
    var camp = {
      id: c.id, title: c.title, type: c.type, rule: c.rule_text || '', reward: c.reward || '',
      unit: c.reward_unit || 'SOL', pool: c.pool_size || '', days: (c.duration_days == null ? 7 : c.duration_days),
      status: c.status || 'active', settled: c.settled_count || 0, feePaid: !!c.fee_paid, feeTx: c.fee_tx || null,
      createdAt: c.created_at, accessMode: c.access_mode || 'open', raidMode: c.raid_mode || null,
      rewardMode: c.reward_mode || 'fixed', postUrl: c.post_url || '', targets: c.targets || '',
      bonusHandle: c.bonus_handle || '', config: (function(cfg){ if (!cfg) return {}; if (typeof cfg === 'string') { try { return JSON.parse(cfg); } catch (e) { return {}; } } return cfg; })(c.config),
      vaultReserved: c.vault_reserved != null ? c.vault_reserved : (c.vaultReserved || 0),
      drawSeed: c.draw_seed || c.drawSeed || null,
      drawAt: c.draw_at || c.drawAt || null,
      drawWinners: c.draw_winners || c.drawWinners || null,
      drawSlot: c.draw_slot || c.drawSlot || null,
      drawSeedSlot: c.draw_seed_slot || c.drawSeedSlot || null,
      drawCount: c.draw_count != null ? c.draw_count : (c.drawCount != null ? c.drawCount : 0),
      drawCommittedAt: c.draw_committed_at || c.drawCommittedAt || null
    };
    return camp;
  }
  function mapJoinRow(j) {
    return { id: j.id, project_id: j.project_id, campaign_id: j.campaign_id, wallet: j.wallet, x_handle: j.x_handle || null, qualified: !!j.qualified, qualified_at: j.qualified_at || null, joined_at: j.joined_at, status: j.status || 'approved', progress: j.progress || 0, note: j.note || null };
  }

  async function listProjects() {
    await init();
    if (mode === 'supabase' && sb) {
      var pr = await sb.from('projects').select('*').order('created_at', { ascending: false });
      if (pr.error) throw pr.error;
      var cr = await sb.from('campaigns').select('*').order('created_at', { ascending: false });
      if (cr.error) throw cr.error;
      var byProject = {};
      (cr.data || []).forEach(function (c) { if (!byProject[c.project_id]) byProject[c.project_id] = []; byProject[c.project_id].push(mapCampaignRow(c)); });
      return (pr.data || []).map(function (p) { return mapProjectRow(p, byProject[p.id] || []); });
    }
    return localTeam().projects || [];
  }

  async function createProject(input) {
    await init();
    refuseLocalTeamWrite();
    var paid = !FEES_ENABLED;
    var payload = { name: input.name, ticker: input.ticker, mint: input.mint, chain: input.chain || 'solana', admin_wallet: input.admin || null, created_by: input.createdBy || input.admin || null, fee_paid: paid, fee_amount_sol: FEES.onboard, plan: input.plan || 'starter' };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('projects').insert(payload).select('*').single();
      if (res.error) throw res.error;
      return mapProjectRow(res.data, []);
    }
    var state = localTeam();
    var project = { id: 'id_' + Math.random().toString(36).slice(2, 10), name: payload.name, ticker: payload.ticker, mint: payload.mint, admin: payload.admin_wallet || '', chain: payload.chain, feePaid: paid, createdAt: new Date().toISOString(), campaigns: [], plan: payload.plan || 'starter' };
    state.projects.push(project); saveLocalTeam(state); return project;
  }

  async function createCampaign(projectId, input) {
    await init();
    refuseLocalTeamWrite();
    var plan = 'free';
    if (mode === 'supabase' && sb) {
      var proj = await sb.from('projects').select('id, fee_paid, plan').eq('id', projectId).maybeSingle();
      if (proj.error) throw proj.error;
      if (!proj.data) throw new Error('Project not found');
      plan = proj.data.plan || 'free';
    } else {
      var stateCheck = localTeam();
      var pCheck = stateCheck.projects.find(function (x) { return x.id === projectId; });
      if (!pCheck) throw new Error('Project not found');
      plan = pCheck.plan || 'free';
    }
    if (!isPremiumPlan(plan) && (PREMIUM_TYPES[input.type] || PREMIUM_REWARDS[input.rewardMode])) {
      throw new Error('Premium (4 SOL) unlocks holds, boards, growing pools, and airdrops. Starter is raids with a fixed payout.');
    }
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaigns').insert({
        project_id: projectId, title: input.title, type: input.type, rule_text: input.rule,
        reward: input.reward || null, reward_unit: input.unit || 'SOL', pool_size: input.pool || null,
        duration_days: (input.days === 0 || input.days === '0') ? 0 : (parseInt(input.days, 10) || 7), status: 'active', fee_paid: !FEES_ENABLED, fee_amount_sol: FEES.campaign,
        access_mode: input.accessMode || 'open', raid_mode: input.raidMode || null, reward_mode: input.rewardMode || 'fixed',
        post_url: input.postUrl || null, targets: input.targets || null, bonus_handle: input.bonusHandle || null, config: input.config || {}
      }).select('*').single();
      if (res.error) throw res.error;
      return mapCampaignRow(res.data);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    var camp = { id: 'id_' + Math.random().toString(36).slice(2, 10), title: input.title, type: input.type, rule: input.rule, reward: input.reward || '', unit: input.unit || 'SOL', pool: input.pool || '', days: (input.days === 0 || input.days === '0') ? 0 : (parseInt(input.days, 10) || 7), status: 'active', settled: 0, feePaid: !FEES_ENABLED, createdAt: new Date().toISOString(), accessMode: input.accessMode || 'open', raidMode: input.raidMode || null, rewardMode: input.rewardMode || 'fixed', postUrl: input.postUrl || '', targets: input.targets || '', bonusHandle: input.bonusHandle || '', config: input.config || {} };
    p.campaigns = p.campaigns || []; p.campaigns.push(camp); saveLocalTeam(state); return camp;
  }

  async function updateProjectVault(projectId, input) {
    await init();
    refuseLocalTeamWrite();
    var addr = (input && input.address) ? String(input.address).trim() : '';
    if (addr && !isBase58Addr(addr)) throw new Error('Vault address looks invalid');
    var mint = (input && input.mint) ? String(input.mint).trim() : null;
    var status = addr ? 'linked' : 'none';
    var payload = {
      vault_address: addr || null,
      vault_mint: mint || null,
      vault_status: status,
      vault_linked_at: addr ? new Date().toISOString() : null,
      vault_multisig: (input && input.multisig) ? String(input.multisig).trim() : null
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('projects').update(payload).eq('id', projectId).select('*').single();
      if (res.error) throw res.error;
      return mapProjectRow(res.data, []);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    p.vaultAddress = addr;
    p.vaultMint = mint || p.mint;
    p.vaultStatus = status;
    p.vaultLinkedAt = payload.vault_linked_at;
    p.vaultMultisig = payload.vault_multisig || '';
    saveLocalTeam(state);
    return p;
  }

  async function reserveVault(projectId, campaignId, amount) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      var proj = await sb.from('projects').select('*').eq('id', projectId).maybeSingle();
      if (proj.error) throw proj.error;
      if (!proj.data) throw new Error('Project not found');
      if (!proj.data.vault_address) throw new Error('Link a vault first');
      var mint = proj.data.vault_mint || proj.data.mint;
      if (!mint) throw new Error('Vault mint is missing');
      var campReserved = 0;
      if (campaignId) {
        var camp = await sb.from('campaigns').select('vault_reserved').eq('id', campaignId).maybeSingle();
        if (camp.error) throw camp.error;
        campReserved = camp.data && camp.data.vault_reserved != null ? camp.data.vault_reserved : 0;
      }
      var bal = await readVaultTokenRaw(proj.data.vault_address, mint);
      var plan = planReservation(proj.data.vault_reserved || 0, campReserved, amount, bal.raw, bal.decimals);
      var up = await sb.from('projects').update({ vault_reserved: plan.projectReserved }).eq('id', projectId).select('*').single();
      if (up.error) throw up.error;
      if (campaignId) {
        await sb.from('campaigns').update({ vault_reserved: plan.campaignReserved }).eq('id', campaignId);
        await sb.from('vault_reservations').insert({
          project_id: projectId, campaign_id: campaignId, amount: plan.added, status: 'reserved'
        });
      }
      return { reserved: plan.projectReserved, added: plan.added, campaignReserved: plan.campaignReserved };
    }
    throw new Error(LOCAL_MODE_MSG);
  }

  async function setProjectPlan(projectId, plan) {
    await init();
    refuseLocalTeamWrite();
    if (plan !== 'free' && plan !== 'starter' && plan !== 'pro') throw new Error('Unknown plan');
    var payload = { plan: plan };
    if (plan !== 'free') payload.plan_paid_at = new Date().toISOString();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('projects').update(payload).eq('id', projectId).select('*').single();
      if (res.error) throw res.error;
      return mapProjectRow(res.data, []);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    p.plan = plan;
    saveLocalTeam(state);
    return p;
  }

  function isPremiumType(type) { return !!PREMIUM_TYPES[String(type || '').toLowerCase()]; }
  function isPremiumReward(mode) { return !!PREMIUM_REWARDS[String(mode || '').toLowerCase()]; }
  function isPremiumPlan(plan) { return String(plan || '') === 'pro'; }
  function planLabel(plan) { return isPremiumPlan(plan) ? 'Premium' : 'Starter'; }
  function normalizePlan(plan) { return isPremiumPlan(plan) ? 'pro' : 'starter'; }

  function growingNow(campaign) {
    var cfg = campaign && campaign.config ? campaign.config : {};
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
    var start = Number(cfg.growStart != null ? cfg.growStart : (campaign && (campaign.pool || campaign.reward)) || 0);
    var add = Number(cfg.growAdd || 0);
    var every = cfg.growEvery || 'week';
    var cap = Number(cfg.growCap || 0);
    var created = campaign && campaign.createdAt ? new Date(campaign.createdAt).getTime() : Date.now();
    var ms = every === 'day' ? 86400000 : 7 * 86400000;
    var periods = Math.max(0, Math.floor((Date.now() - created) / ms));
    var now = start + add * periods;
    if (cap > 0) now = Math.min(now, cap);
    return now;
  }
  function growingMeta(campaign) {
    var cfg = campaign && campaign.config ? campaign.config : {};
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
    var every = cfg.growEvery || 'week';
    var add = Number(cfg.growAdd || 0);
    var start = Number(cfg.growStart != null ? cfg.growStart : (campaign && (campaign.pool || campaign.reward)) || 0);
    var cap = Number(cfg.growCap || 0);
    var now = growingNow(campaign);
    var unit = (campaign && campaign.unit) || '';
    return {
      start: start, add: add, every: every, cap: cap, now: now, unit: unit,
      line: 'Started at ' + start + (add ? (', adds ' + add + ' every ' + every) : '') + (cap ? (', caps at ' + cap) : ', no cap') + '. Now ' + now + (unit ? (' ' + unit) : '') + '.'
    };
  }

  var SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr32(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(str) {
    var bytes = new TextEncoder().encode(String(str));
    var bitLen = bytes.length * 8;
    var withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[bytes.length] = 0x80;
    var view = new DataView(withPad.buffer);
    view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(withPad.length - 4, bitLen >>> 0);
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Uint32Array(64);
    for (var off = 0; off < withPad.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (var j = 16; j < 64; j++) {
        var s0 = rotr32(w[j - 15], 7) ^ rotr32(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rotr32(w[j - 2], 17) ^ rotr32(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var k = 0; k < 64; k++) {
        var S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[k] + w[k]) >>> 0;
        var S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (var n = 0; n < 8; n++) hex += ('00000000' + H[n].toString(16)).slice(-8);
    return hex;
  }

  function decimalToRaw(value, decimals) {
    var d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error('Bad mint decimals');
    var s;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.floor(value) !== value) throw new Error('Fractional amounts must be decimal strings');
      s = String(value);
    } else {
      s = String(value == null ? '' : value).trim();
    }
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Bad amount');
    var parts = s.split('.');
    var frac = parts[1] || '';
    if (frac.length > d) throw new Error('Amount has more decimals than the mint');
    while (frac.length < d) frac += '0';
    return BigInt(d === 0 ? parts[0] : parts[0] + frac);
  }

  function rawToDecimal(raw, decimals) {
    var d = Number(decimals);
    var neg = raw < 0n;
    var v = neg ? -raw : raw;
    var s = v.toString();
    if (d === 0) return (neg ? '-' : '') + s;
    while (s.length <= d) s = '0' + s;
    var whole = s.slice(0, s.length - d);
    var frac = s.slice(s.length - d).replace(/0+$/, '');
    return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
  }

  function scaledParts(value) {
    var s = String(value == null ? '0' : value).trim();
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Bad amount');
    var parts = s.split('.');
    var whole = parts[0].replace(/^0+(?=\d)/, '');
    var frac = parts[1] || '';
    return { neg: neg, scale: frac.length, n: BigInt((whole + frac) || '0') };
  }

  function formatScaled(n, scale) {
    var neg = n < 0n;
    var v = neg ? -n : n;
    var s = v.toString();
    if (scale === 0) return (neg ? '-' : '') + s;
    while (s.length <= scale) s = '0' + s;
    var whole = s.slice(0, s.length - scale) || '0';
    var frac = s.slice(s.length - scale).replace(/0+$/, '');
    return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
  }

  function alignDecimals(a, b) {
    var A = scaledParts(a);
    var B = scaledParts(b);
    var scale = A.scale > B.scale ? A.scale : B.scale;
    var na = A.n * (10n ** BigInt(scale - A.scale));
    var nb = B.n * (10n ** BigInt(scale - B.scale));
    if (A.neg) na = -na;
    if (B.neg) nb = -nb;
    return { na: na, nb: nb, scale: scale };
  }

  function subDecimal(a, b) {
    var x = alignDecimals(a, b);
    var n = x.na - x.nb;
    if (n < 0n) n = 0n;
    return formatScaled(n, x.scale);
  }

  function wholeNumber(value, fallback) {
    var s = String(value == null || value === '' ? fallback : value).trim();
    if (!/^\d+$/.test(s)) throw new Error('Expected a whole number');
    return BigInt(s);
  }

  function canonicalPayoutText(payouts) {
    return (payouts || []).slice().sort(function (a, b) {
      if (a.wallet < b.wallet) return -1;
      if (a.wallet > b.wallet) return 1;
      return 0;
    }).map(function (p) {
      return String(p.wallet) + ':' + String(p.amountRaw);
    }).join('\n');
  }

  function payoutHash(payouts) {
    return sha256Hex(canonicalPayoutText(payouts));
  }

  function planReservation(projectReserved, campaignReserved, addAmount, balanceRaw, decimals) {
    var addRaw = decimalToRaw(addAmount, decimals);
    if (addRaw <= 0n) throw new Error('Reserve amount must be greater than 0');
    var projRaw = decimalToRaw(projectReserved || 0, decimals);
    var campRaw = decimalToRaw(campaignReserved || 0, decimals);
    var balance = BigInt(String(balanceRaw));
    if (projRaw + addRaw > balance) throw new Error('Reservation exceeds vault token balance');
    return {
      projectReserved: rawToDecimal(projRaw + addRaw, decimals),
      campaignReserved: rawToDecimal(campRaw + addRaw, decimals),
      added: rawToDecimal(addRaw, decimals)
    };
  }

  function campaignConfig(campaign) {
    var cfg = campaign && campaign.config ? campaign.config : {};
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
    return cfg;
  }

  function growingRaw(campaign, decimals) {
    var cfg = campaignConfig(campaign);
    var start = decimalToRaw(cfg.growStart != null && cfg.growStart !== '' ? cfg.growStart : (campaign && (campaign.pool || campaign.reward)) || 0, decimals);
    var add = decimalToRaw(cfg.growAdd || 0, decimals);
    var cap = cfg.growCap ? decimalToRaw(cfg.growCap, decimals) : 0n;
    var created = campaign && campaign.createdAt ? new Date(campaign.createdAt).getTime() : Date.now();
    var ms = cfg.growEvery === 'day' ? 86400000 : 7 * 86400000;
    var periods = BigInt(Math.max(0, Math.floor((Date.now() - created) / ms)));
    var now = start + add * periods;
    if (cap > 0n && now > cap) now = cap;
    return now;
  }

  function payoutRow(wallet, raw, decimals, progress) {
    return { wallet: wallet, amount: rawToDecimal(raw, decimals), amountRaw: raw.toString(), progress: progress || 0 };
  }

  function computePayouts(campaign, joins, decimals) {
    var d = decimals == null ? 0 : decimals;
    var rows = (joins || []).filter(function (j) {
      if (j.status === 'rejected') return false;
      return !!(j.qualified || (j.status === 'approved' && (j.progress || 0) > 0));
    }).slice().sort(function (a, b) {
      if (!!b.qualified !== !!a.qualified) return b.qualified ? 1 : -1;
      var progress = (b.progress || 0) - (a.progress || 0);
      if (progress) return progress;
      if (a.wallet < b.wallet) return -1;
      if (a.wallet > b.wallet) return 1;
      return 0;
    });
    if (!rows.length) throw new Error('No qualified or scored holders to pay');
    var rewardMode = campaign.rewardMode || campaign.reward_mode || 'fixed';
    var unit = campaign.unit || 'TOKEN';
    var poolSource = campaign.vaultReserved || campaign.pool || campaign.reward || 0;
    var payouts = [];
    if (rewardMode === 'fixed') {
      var fixedRaw = 0n;
      if (campaign.reward != null && String(campaign.reward).trim() !== '') fixedRaw = decimalToRaw(campaign.reward, d);
      if (fixedRaw <= 0n) {
        var poolRawFixed = decimalToRaw(poolSource || 0, d);
        if (poolRawFixed <= 0n) throw new Error('Set a reward amount or pool first');
        fixedRaw = poolRawFixed / BigInt(rows.length);
      }
      if (fixedRaw <= 0n) throw new Error('Set a reward amount or pool first');
      payouts = rows.map(function (j) { return payoutRow(j.wallet, fixedRaw, d, j.progress); });
    } else if (rewardMode === 'top3' || rewardMode === 'topn') {
      var poolRawTop = decimalToRaw(campaign.pool || campaign.vaultReserved || 0, d);
      if (poolRawTop <= 0n) throw new Error('Top N needs a pool size');
      var top = rows.slice(0, 3);
      var cfg = campaignConfig(campaign);
      var parts = [
        wholeNumber(cfg.top3First != null ? cfg.top3First : 50, 50),
        wholeNumber(cfg.top3Second != null ? cfg.top3Second : 30, 30),
        wholeNumber(cfg.top3Third != null ? cfg.top3Third : 20, 20)
      ];
      payouts = top.map(function (j, i) {
        return payoutRow(j.wallet, poolRawTop * parts[i] / 100n, d, j.progress);
      });
    } else if (rewardMode === 'growing') {
      var grow = growingRaw(campaign, d);
      if (grow <= 0n) throw new Error('Growing pool needs a starting size');
      payouts = [payoutRow(rows[0].wallet, grow, d, rows[0].progress)];
    } else {
      var poolRaw = decimalToRaw(campaign.pool || campaign.vaultReserved || campaign.reward || 0, d);
      if (poolRaw <= 0n) throw new Error('Shared pool needs a pool size');
      var each = poolRaw / BigInt(rows.length);
      var rem = poolRaw % BigInt(rows.length);
      payouts = rows.map(function (j, i) {
        return payoutRow(j.wallet, each + (BigInt(i) < rem ? 1n : 0n), d, j.progress);
      });
    }
    payouts = payouts.filter(function (x) { return x.amountRaw !== '0' && x.wallet; });
    var totalRaw = payouts.reduce(function (s, x) { return s + BigInt(x.amountRaw); }, 0n);
    return { payouts: payouts, total: rawToDecimal(totalRaw, d), totalRaw: totalRaw.toString(), unit: unit, hash: payoutHash(payouts) };
  }

  var TOKEN_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  async function readVaultTokenRaw(address, mint) {
    if (!isBase58Addr(address) || !isBase58Addr(mint)) throw new Error('Vault address or mint looks invalid');
    if (!global.solanaWeb3) throw new Error('Solana web3 not loaded');
    var Connection = global.solanaWeb3.Connection;
    var PublicKey = global.solanaWeb3.PublicKey;
    var conn = new Connection(RPC, 'confirmed');
    var mintPk = new PublicKey(mint);
    var info = await conn.getAccountInfo(mintPk, 'confirmed');
    if (!info) throw new Error('Mint account not found');
    var owner = info.owner.toBase58();
    if (owner !== TOKEN_CLASSIC && owner !== TOKEN_2022) throw new Error('Mint owner is not SPL Token or Token-2022');
    var data = info.data;
    var decimals = typeof data.readUInt8 === 'function' ? data.readUInt8(44) : data[44];
    var raw = 0n;
    var accs = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), { programId: new PublicKey(owner) }, 'confirmed');
    (accs.value || []).forEach(function (a) {
      var parsed = a.account.data.parsed && a.account.data.parsed.info;
      if (!parsed || parsed.mint !== mint || !parsed.tokenAmount) return;
      raw += BigInt(parsed.tokenAmount.amount || '0');
      if (parsed.tokenAmount.decimals != null) decimals = parsed.tokenAmount.decimals;
    });
    return { raw: raw.toString(), decimals: decimals, tokenProgram: owner };
  }

  async function loadCampaignRow(campaignId) {
    if (!(mode === 'supabase' && sb)) throw new Error('Campaign storage is unavailable');
    var res = await sb.from('campaigns').select('*').eq('id', campaignId).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) throw new Error('Campaign not found');
    var camp = mapCampaignRow(res.data);
    camp.projectId = res.data.project_id;
    var proj = await sb.from('projects').select('mint,vault_mint,vault_address,vault_multisig').eq('id', res.data.project_id).maybeSingle();
    if (proj.error) throw proj.error;
    if (proj.data) {
      camp.mint = proj.data.vault_mint || proj.data.mint || '';
      camp.vaultAddress = proj.data.vault_address || '';
      if (!camp.vaultMultisig) camp.vaultMultisig = proj.data.vault_multisig || '';
    }
    return camp;
  }

  async function proposeSettlement(projectId, campaignId, campaign, joins) {
    await init();
    refuseLocalTeamWrite();
    void joins;
    var stored = await loadCampaignRow(campaignId);
    if (campaign && campaign.vaultMultisig) stored.vaultMultisig = campaign.vaultMultisig;
    var joinsFromDb = await listJoinsForCampaign(campaignId);
    var decimals = 0;
    if (stored.mint) {
      var bal = await readVaultTokenRaw(stored.vaultAddress, stored.mint);
      decimals = bal.decimals;
    } else if (String(stored.unit || '').toUpperCase() === 'SOL') {
      decimals = 9;
    }
    var built = computePayouts(stored, joinsFromDb, decimals);
    var row = {
      project_id: projectId,
      campaign_id: campaignId,
      payouts: built.payouts,
      total: built.total,
      unit: built.unit,
      payout_hash: built.hash,
      status: 'proposed',
      team_signed: false,
      bard_signed: false,
      vault_multisig: (campaign && (campaign.vaultMultisig || '')) || null
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').insert(row).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    row.id = 'set_' + Date.now();
    row.proposed_at = new Date().toISOString();
    var state = localTeam();
    state.settlements = state.settlements || [];
    state.settlements.push(row);
    saveLocalTeam(state);
    return row;
  }

  async function listOpenSettlements() {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').select('*').in('status', ['proposed', 'awaiting_bard', 'awaiting_team', 'both_signed', 'cosigned']).order('proposed_at', { ascending: false });
      if (res.error) throw res.error;
      return res.data || [];
    }
    return (localTeam().settlements || []).filter(function (s) { return s.status !== 'executed' && s.status !== 'cancelled'; });
  }

  async function signSettlement(settlementId, who, extra) {
    await init();
    refuseLocalTeamWrite();
    var payload = {};
    if (who === 'team') {
      payload.team_signed = true;
      payload.team_signed_at = new Date().toISOString();
      payload.cosigned_wallet = extra && extra.wallet;
      payload.cosign_sig = extra && extra.sig;
    }
    if (who === 'bard') {
      payload.bard_signed = true;
      payload.bard_signed_at = new Date().toISOString();
    }
    if (extra && extra.txIndex) payload.tx_index = extra.txIndex;
    if (extra && extra.multisig) payload.vault_multisig = extra.multisig;
    if (mode === 'supabase' && sb) {
      var cur = await sb.from('vault_settlements').select('*').eq('id', settlementId).maybeSingle();
      if (cur.error) throw cur.error;
      var row = Object.assign({}, cur.data || {}, payload);
      var team = !!(row.team_signed);
      var bard = !!(row.bard_signed);
      payload.status = team && bard ? 'both_signed' : (team ? 'awaiting_bard' : (bard ? 'awaiting_team' : 'proposed'));
      var res = await sb.from('vault_settlements').update(payload).eq('id', settlementId).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    var state = localTeam();
    (state.settlements || []).forEach(function (s) {
      if (s.id !== settlementId) return;
      Object.assign(s, payload);
      s.status = (s.team_signed && s.bard_signed) ? 'both_signed' : (s.team_signed ? 'awaiting_bard' : (s.bard_signed ? 'awaiting_team' : 'proposed'));
    });
    saveLocalTeam(state);
    return (state.settlements || []).find(function (s) { return s.id === settlementId; });
  }

  function getRpc() { return RPC; }

  async function listSettlements(campaignId) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').select('*').eq('campaign_id', campaignId).order('proposed_at', { ascending: false });
      if (res.error) throw res.error;
      return res.data || [];
    }
    return (localTeam().settlements || []).filter(function (s) { return s.campaign_id === campaignId; });
  }

  async function cosignSettlement(settlementId, wallet, sig) {
    await init();
    refuseLocalTeamWrite();
    var payload = {
      status: 'cosigned',
      cosigned_wallet: wallet,
      cosigned_at: new Date().toISOString(),
      cosign_sig: sig || null
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').update(payload).eq('id', settlementId).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    var state = localTeam();
    (state.settlements || []).forEach(function (s) { if (s.id === settlementId) Object.assign(s, payload); });
    saveLocalTeam(state);
    return Object.assign({ id: settlementId }, payload);
  }

  async function executeSettlement(settlementId, txSignature, projectId) {
    await init();
    refuseLocalTeamWrite();
    var payload = {
      status: 'executed',
      tx_signature: txSignature || null,
      executed_at: new Date().toISOString()
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').update(payload).eq('id', settlementId).select('*').single();
      if (res.error) throw res.error;
      var s = res.data;
      if (s && s.campaign_id && Array.isArray(s.payouts)) {
        for (var i = 0; i < s.payouts.length; i++) {
          var w = s.payouts[i];
          try {
            await sb.from('campaign_joins').update({ qualified: true, qualified_at: new Date().toISOString() })
              .eq('campaign_id', s.campaign_id).eq('wallet', w.wallet);
            await sb.from('platform_claims').upsert({
              project_id: s.project_id, campaign_id: s.campaign_id, wallet: w.wallet,
              amount: String(w.amount), unit: s.unit, settled: true, settled_at: new Date().toISOString(),
              fee_paid: !FEES_ENABLED, fee_amount_sol: FEES.claim
            }, { onConflict: 'campaign_id,wallet' });
          } catch (e) { console.warn('[Bard] settle winner', e); }
        }
        try {
          await sb.from('vault_reservations').update({ status: 'settled' }).eq('campaign_id', s.campaign_id).eq('status', 'reserved');
          if (projectId && s.total) {
            var proj = await sb.from('projects').select('vault_reserved').eq('id', projectId).maybeSingle();
            var cur = (proj.data && proj.data.vault_reserved) || 0;
            await sb.from('projects').update({ vault_reserved: subDecimal(cur, s.total) }).eq('id', projectId);
          }
        } catch (e2) { console.warn('[Bard] release reserve', e2); }
      }
      return s;
    }
    var state = localTeam();
    (state.settlements || []).forEach(function (x) { if (x.id === settlementId) Object.assign(x, payload); });
    saveLocalTeam(state);
    return Object.assign({ id: settlementId }, payload);
  }

  async function updateCampaignStatus(campaignId, status) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaigns').update({ status: status }).eq('id', campaignId).select('*').single();
      if (res.error) throw res.error; return mapCampaignRow(res.data);
    }
    var state = localTeam();
    state.projects.forEach(function (p) { (p.campaigns || []).forEach(function (c) { if (c.id === campaignId) c.status = status; }); });
    saveLocalTeam(state);
  }

  async function listLiveCampaigns() {
    var projects = await listProjects(); var out = [];
    projects.forEach(function (p) { (p.campaigns || []).forEach(function (c) {
      if (c.status === 'active') out.push({
        projectId: p.id, projectName: p.name, ticker: p.ticker, mint: p.mint, campaign: c,
        vault: { address: p.vaultAddress || '', status: p.vaultStatus || 'none', reserved: p.vaultReserved || 0, mint: p.vaultMint || p.mint }
      });
    }); });
    out.sort(function (a, b) { return String(b.campaign.createdAt || '').localeCompare(String(a.campaign.createdAt || '')); });
    return out;
  }

  async function recordFee(kind, payerWallet, refs) {
    await init();
    refuseLocalTeamWrite();
    var amount = FEES[kind];
    if (amount == null) throw new Error('Unknown fee kind');
    var row = { kind: kind, amount_sol: amount, payer_wallet: payerWallet, status: 'pending', project_id: (refs && refs.projectId) || null, campaign_id: (refs && refs.campaignId) || null, claim_id: (refs && refs.claimId) || null, meta: refs && refs.meta ? refs.meta : {} };
    if (mode === 'supabase' && sb) { var res = await sb.from('fee_payments').insert(row).select('*').single(); if (res.error) throw res.error; return res.data; }
    return Object.assign({ id: 'local_fee_' + Date.now() }, row);
  }

  async function markFeeConfirmed(feeId, txSignature, kind, refs) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      await sb.from('fee_payments').update({ status: 'confirmed', tx_signature: txSignature, confirmed_at: new Date().toISOString() }).eq('id', feeId);
      if (kind === 'onboard' && refs && refs.projectId) await sb.from('projects').update({ fee_paid: true, fee_tx: txSignature }).eq('id', refs.projectId);
      if ((kind === 'starter' || kind === 'pro') && refs && refs.projectId) {
        await sb.from('projects').update({
          fee_paid: true, fee_tx: txSignature, plan: kind, plan_tx: txSignature, plan_paid_at: new Date().toISOString()
        }).eq('id', refs.projectId);
      }
      if (kind === 'campaign' && refs && refs.campaignId) await sb.from('campaigns').update({ fee_paid: true, fee_tx: txSignature }).eq('id', refs.campaignId);
      if (kind === 'claim' && refs && refs.claimId) await sb.from('platform_claims').update({ fee_paid: true, fee_tx: txSignature, settled: true, settled_at: new Date().toISOString() }).eq('id', refs.claimId);
    } else if (kind === 'onboard' && refs && refs.projectId) {
      var state = localTeam(); state.projects.forEach(function (p) { if (p.id === refs.projectId) { p.feePaid = true; p.feeTx = txSignature; } }); saveLocalTeam(state);
    } else if (kind === 'campaign' && refs && refs.campaignId) {
      var state2 = localTeam(); state2.projects.forEach(function (p) { (p.campaigns || []).forEach(function (c) { if (c.id === refs.campaignId) { c.feePaid = true; c.feeTx = txSignature; } }); }); saveLocalTeam(state2);
    }
  }

  async function markFeeFailed(feeId, reason) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb && feeId) {
      try { await sb.from('fee_payments').update({ status: 'failed', meta: { error: String(reason || 'failed') } }).eq('id', feeId); } catch (e) { console.warn('[Bard] markFeeFailed', e); }
    }
  }

  async function payFee(kind, payerWallet, provider, refs) {
    await init();
    refuseLocalTeamWrite();
    if (!FEES_ENABLED) {
      var freeRow = await recordFee(kind, payerWallet, refs || {});
      await markFeeConfirmed(freeRow && freeRow.id, 'fees-disabled', kind, refs || {});
      return { ok: true, signature: 'fees-disabled', fee: freeRow, amount: 0, message: 'Fees temporarily disabled for testing' };
    }
    if (!FEE_TREASURY) {
      var pending = await recordFee(kind, payerWallet, refs);
      return { ok: false, pending: true, fee: pending, message: 'Fee treasury not configured yet — recorded as pending.' };
    }
    if (!global.solanaWeb3) throw new Error('Solana web3 not loaded');
    if (typeof global.Buffer === 'undefined' || typeof global.Buffer.from !== 'function') throw new Error('Buffer not ready — hard refresh the page');
    var amount = FEES[kind];
    if (amount == null) throw new Error('Unknown fee kind: ' + kind);
    var Connection = global.solanaWeb3.Connection;
    var PublicKey = global.solanaWeb3.PublicKey;
    var SystemProgram = global.solanaWeb3.SystemProgram;
    var Transaction = global.solanaWeb3.Transaction;
    var lamports = Math.round(amount * 1e9);
    var minNeeded = lamports + 10000;
    var connection = new Connection(RPC, 'confirmed');
    var from = new PublicKey(payerWallet);
    var to = new PublicKey(FEE_TREASURY);
    var bal = await connection.getBalance(from, 'confirmed');
    if (bal < minNeeded) throw new Error('Insufficient SOL: need ' + amount + ' SOL + fees, wallet has ~' + (bal / 1e9).toFixed(4) + ' SOL');
    var feeRow = await recordFee(kind, payerWallet, refs);
    var tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports }));
    tx.feePayer = from;
    var latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    if (latest.lastValidBlockHeight) tx.lastValidBlockHeight = latest.lastValidBlockHeight;
    var sig;
    try {
      if (provider && typeof provider.signAndSendTransaction === 'function') {
        var sent = await provider.signAndSendTransaction(tx);
        sig = typeof sent === 'string' ? sent : (sent && (sent.signature || sent));
      } else if (provider && typeof provider.signTransaction === 'function') {
        var signedTx = await provider.signTransaction(tx);
        sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
      } else throw new Error('Wallet does not support signing');
    } catch (signErr) { await markFeeFailed(feeRow && feeRow.id, signErr && signErr.message); throw signErr; }
    if (!sig) { await markFeeFailed(feeRow && feeRow.id, 'no signature'); throw new Error('No transaction signature returned'); }
    var confirmed = false;
    try {
      var conf = await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
      if (conf && conf.value && conf.value.err) { await markFeeFailed(feeRow.id, JSON.stringify(conf.value.err)); throw new Error('Transaction failed on-chain'); }
      confirmed = true;
    } catch (confirmErr) {
      try {
        var st = await connection.getSignatureStatuses([sig]);
        var v = st && st.value && st.value[0];
        if (v && !v.err && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) confirmed = true;
        else if (v && v.err) { await markFeeFailed(feeRow.id, JSON.stringify(v.err)); throw new Error('Transaction failed on-chain'); }
        else { await markFeeFailed(feeRow.id, confirmErr && confirmErr.message); throw new Error('Could not confirm payment on-chain. Sig: ' + sig); }
      } catch (statusErr) {
        if (statusErr && /on-chain|failed/.test(statusErr.message)) throw statusErr;
        await markFeeFailed(feeRow.id, statusErr && statusErr.message);
        throw new Error('Could not confirm payment on-chain. Sig: ' + sig);
      }
    }
    if (!confirmed) { await markFeeFailed(feeRow.id, 'not confirmed'); throw new Error('Payment not confirmed'); }
    await markFeeConfirmed(feeRow.id, sig, kind, refs);
    return { ok: true, signature: sig, fee: feeRow, amount: amount };
  }

  async function upsertHolder(wallet, xHandle, xVia) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var existing = await sb.from('holders').select('*').eq('wallet', wallet).maybeSingle();
      var row = { wallet: wallet, x_handle: xHandle || null, x_linked_at: xHandle ? new Date().toISOString() : null, x_via: xVia || null };
      if (existing.data) await sb.from('holders').update(row).eq('wallet', wallet); else await sb.from('holders').insert(row);
    }
    var h = localHolder(); if (xHandle) h.xHandle = xHandle; saveLocalHolder(h);
  }

  async function joinCampaign(projectId, campaignId, wallet, xHandle) {
    await init();
    var rosterRole = null;
    if (mode === 'supabase' && sb) {
      try {
        var rr = await sb.from('project_roster').select('role').eq('project_id', projectId).eq('wallet', wallet).maybeSingle();
        if (rr.data) rosterRole = rr.data.role;
      } catch (e) {}
      if (rosterRole === 'blocked') throw new Error('This wallet is blocked from this project');
      var campRes = await sb.from('campaigns').select('id, access_mode, type').eq('id', campaignId).maybeSingle();
      if (campRes.error) throw campRes.error;
      if (!campRes.data) throw new Error('Campaign not found');
      var needsApproval = (campRes.data.access_mode || 'open') === 'approval';
      var auto = rosterRole === 'trusted' || rosterRole === 'whale';
      var joinStatus = auto ? 'approved' : (needsApproval ? 'pending' : 'approved');
      var res = await sb.from('campaign_joins').upsert({ project_id: projectId, campaign_id: campaignId, wallet: wallet, x_handle: xHandle || null, qualified: false, joined_at: new Date().toISOString(), status: joinStatus, progress: 0 }, { onConflict: 'campaign_id,wallet' }).select('*').single();
      if (res.error) throw res.error; return mapJoinRow(res.data);
    }
    var h = localHolder(); var key = projectId + '::' + campaignId; var localCamp = null;
    (localTeam().projects || []).forEach(function (pr) { (pr.campaigns || []).forEach(function (c) { if (c.id === campaignId) localCamp = c; }); });
    var st = (localCamp && localCamp.accessMode === 'approval') ? 'pending' : 'approved';
    h.joined[key] = { at: new Date().toISOString(), qualified: false, wallet: wallet, xHandle: xHandle || null, status: st, progress: 0 };
    saveLocalHolder(h);
    return { project_id: projectId, campaign_id: campaignId, wallet: wallet, x_handle: xHandle || null, qualified: false, status: st, progress: 0 };
  }

  async function listJoinsForCampaign(campaignId) {
    await init();
    if (mode === 'supabase' && sb && campaignId) {
      var res = await sb.from('campaign_joins').select('*').eq('campaign_id', campaignId).order('joined_at', { ascending: false });
      if (res.error) throw res.error; return (res.data || []).map(mapJoinRow);
    }
    return [];
  }

  async function setJoinStatus(campaignId, wallet, status) {
    await init();
    refuseLocalTeamWrite();
    if (!status || ['pending', 'approved', 'rejected'].indexOf(status) < 0) throw new Error('Invalid join status');
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaign_joins').update({ status: status }).eq('campaign_id', campaignId).eq('wallet', wallet).select('*').single();
      if (res.error) throw res.error; return mapJoinRow(res.data);
    }
    return { campaign_id: campaignId, wallet: wallet, status: status };
  }

  async function setJoinProgress(campaignId, wallet, progress, note) {
    await init();
    refuseLocalTeamWrite();
    var n = Math.max(0, parseInt(progress, 10) || 0);
    if (mode === 'supabase' && sb) {
      var payload = { progress: n }; if (note != null) payload.note = String(note);
      var res = await sb.from('campaign_joins').update(payload).eq('campaign_id', campaignId).eq('wallet', wallet).select('*').single();
      if (res.error) throw res.error; return mapJoinRow(res.data);
    }
    return { campaign_id: campaignId, wallet: wallet, progress: n, note: note || null };
  }

  async function markQualified(projectId, campaignId, wallet) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaign_joins').update({ qualified: true, qualified_at: new Date().toISOString() }).eq('campaign_id', campaignId).eq('wallet', wallet).select('*').single();
      if (res.error) throw res.error; return res.data;
    }
    var h = localHolder(); var key = projectId + '::' + campaignId;
    if (h.joined[key]) { h.joined[key].qualified = true; saveLocalHolder(h); }
  }

  async function settleClaim(projectId, campaignId, wallet, xHandle, amount, unit) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('platform_claims').upsert({ project_id: projectId, campaign_id: campaignId, wallet: wallet, x_handle: xHandle || null, amount: amount || null, unit: unit || 'SOL', settled: true, settled_at: new Date().toISOString(), fee_paid: !FEES_ENABLED, fee_amount_sol: FEES.claim }, { onConflict: 'campaign_id,wallet' }).select('*').single();
      if (res.error) throw res.error;
      var camp = await sb.from('campaigns').select('settled_count').eq('id', campaignId).single();
      var n = (camp.data && camp.data.settled_count) || 0;
      await sb.from('campaigns').update({ settled_count: n + 1 }).eq('id', campaignId);
      return res.data;
    }
    var h = localHolder(); var key = projectId + '::' + campaignId;
    h.claims[key] = { settled: true, at: new Date().toISOString(), wallet: wallet, xHandle: xHandle };
    saveLocalHolder(h); return h.claims[key];
  }

  function mapRosterRow(r) {
    return { id: r.id, projectId: r.project_id, wallet: r.wallet, role: r.role, note: r.note || '', createdAt: r.created_at };
  }

  async function listRoster(projectId) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('project_roster').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
      if (res.error) throw res.error;
      return (res.data || []).map(mapRosterRow);
    }
    var p = (localTeam().projects || []).find(function (x) { return x.id === projectId; });
    return (p && p.roster) || [];
  }

  async function upsertRoster(projectId, wallet, role, note) {
    await init();
    refuseLocalTeamWrite();
    if (!wallet) throw new Error('Wallet required');
    if (['trusted', 'whale', 'blocked'].indexOf(role) < 0) throw new Error('Role must be trusted, whale, or blocked');
    if (mode === 'supabase' && sb) {
      var res = await sb.from('project_roster').upsert({
        project_id: projectId, wallet: wallet, role: role, note: note || null
      }, { onConflict: 'project_id,wallet' }).select('*').single();
      if (res.error) throw res.error;
      return mapRosterRow(res.data);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    p.roster = (p.roster || []).filter(function (r) { return r.wallet !== wallet; });
    p.roster.unshift({ projectId: projectId, wallet: wallet, role: role, note: note || '', createdAt: new Date().toISOString() });
    saveLocalTeam(state);
    return p.roster[0];
  }

  async function removeRoster(projectId, wallet) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('project_roster').delete().eq('project_id', projectId).eq('wallet', wallet);
      if (res.error) throw res.error;
      return true;
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (p) p.roster = (p.roster || []).filter(function (r) { return r.wallet !== wallet; });
    saveLocalTeam(state);
    return true;
  }

  var DRAW_SLOT_OFFSET = 150;

  function eligibleDrawRows(joins) {
    return (joins || []).filter(function (j) {
      return j && j.status !== 'rejected' && (j.qualified || j.status === 'approved');
    }).map(function (j) {
      return { wallet: String(j.wallet), x_handle: j.x_handle || null };
    }).sort(function (a, b) {
      if (a.wallet < b.wallet) return -1;
      if (a.wallet > b.wallet) return 1;
      return 0;
    });
  }

  /**
   * Draw rule:
   * Step 1 stores a future slot S = finalized slot + 150.
   * Step 2 runs only after S is final. The seed is the blockhash of S.
   * If S was skipped, the seed is the blockhash of the smallest later slot
   * that produced a block (walk at most 512 slots). That slot is stored as
   * draw_seed_slot. Eligible wallets are qualified, or approved and not
   * rejected, sorted by wallet, then shuffled with Fisher-Yates. For i from
   * n-1 down to 1, j is the first 4 bytes of SHA-256(seed + ':' + i) as a
   * big-endian uint32, modulo (i+1). draw_count 0 keeps the full order.
   * A second commit or a second finalize is refused here and by the
   * campaigns_draw_once trigger.
   */
  function shuffleSeeded(list, seed) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var hex = sha256Hex(String(seed) + ':' + String(i));
      var j = parseInt(hex.slice(0, 8), 16) % (i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function deriveWinners(joins, seed, topN) {
    var rows = eligibleDrawRows(joins);
    var shuffled = shuffleSeeded(rows, seed);
    var n = parseInt(topN, 10);
    if (isNaN(n) || n <= 0 || n > shuffled.length) n = shuffled.length;
    return shuffled.slice(0, n);
  }

  function verifyDraw(campaign, joins) {
    var rows = joins || (campaign && campaign.joins) || [];
    if (!campaign || !campaign.drawSeed) return { ok: false, reason: 'no seed', winners: [], seed: null };
    var winners = deriveWinners(rows, campaign.drawSeed, campaign.drawCount || 0);
    var actual = campaign.drawWinners || [];
    var ok = winners.length === actual.length && winners.every(function (w, i) {
      var got = actual[i] && (actual[i].wallet || actual[i]);
      return w.wallet === got;
    });
    return {
      ok: ok,
      winners: winners,
      seed: campaign.drawSeed,
      slot: campaign.drawSlot || null,
      seedSlot: campaign.drawSeedSlot || null
    };
  }

  function assertDrawStep(campaign, step) {
    var winners = campaign && campaign.drawWinners;
    if ((winners && winners.length) || (campaign && campaign.drawSeed)) throw new Error('Draw already finalized');
    if (step === 'commit' && campaign && campaign.drawSlot) throw new Error('Draw slot already committed');
    if (step === 'finalize' && !(campaign && campaign.drawSlot)) throw new Error('Commit a future slot first');
  }

  function isSkippedSlot(err) {
    var msg = String(err && (err.message || err) || '');
    return /skipped/i.test(msg) || /32007/.test(msg) || /32009/.test(msg);
  }

  async function blockhashAtOrAfter(conn, slot) {
    for (var i = 0; i < 512; i++) {
      var target = slot + i;
      try {
        var block = await conn.getBlock(target, {
          commitment: 'finalized',
          transactionDetails: 'none',
          rewards: false,
          maxSupportedTransactionVersion: 0
        });
        if (block && block.blockhash) return { slot: target, blockhash: block.blockhash };
      } catch (e) {
        if (isSkippedSlot(e)) continue;
        throw e;
      }
    }
    throw new Error('No block found at or after slot ' + slot);
  }

  async function commitDraw(campaignId, topN) {
    await init();
    refuseLocalTeamWrite();
    var camp = await loadCampaignRow(campaignId);
    assertDrawStep(camp, 'commit');
    if (!global.solanaWeb3) throw new Error('Solana web3 not loaded');
    var conn = new global.solanaWeb3.Connection(RPC, 'finalized');
    var current = await conn.getSlot('finalized');
    var slot = current + DRAW_SLOT_OFFSET;
    var count = parseInt(topN, 10);
    if (isNaN(count) || count < 0) count = 0;
    var payload = { draw_slot: slot, draw_count: count, draw_committed_at: new Date().toISOString() };
    var res = await sb.from('campaigns').update(payload).eq('id', campaignId).select('*').single();
    if (res.error) throw res.error;
    return mapCampaignRow(res.data);
  }

  async function finalizeDraw(campaignId) {
    await init();
    refuseLocalTeamWrite();
    var camp = await loadCampaignRow(campaignId);
    assertDrawStep(camp, 'finalize');
    if (!global.solanaWeb3) throw new Error('Solana web3 not loaded');
    var conn = new global.solanaWeb3.Connection(RPC, 'finalized');
    var slot = Number(camp.drawSlot);
    var current = await conn.getSlot('finalized');
    if (!(current >= slot)) throw new Error('Slot ' + slot + ' is not final yet');
    var found = await blockhashAtOrAfter(conn, slot);
    var joins = await listJoinsForCampaign(campaignId);
    var winners = deriveWinners(joins, found.blockhash, camp.drawCount || 0);
    var payload = {
      draw_seed: found.blockhash,
      draw_seed_slot: found.slot,
      draw_at: new Date().toISOString(),
      draw_winners: winners
    };
    var res = await sb.from('campaigns').update(payload).eq('id', campaignId).select('*').single();
    if (res.error) throw res.error;
    return mapCampaignRow(res.data);
  }

  async function drawAirdrop(campaignId, topN) {
    await init();
    refuseLocalTeamWrite();
    return commitDraw(campaignId, topN);
  }

  async function listJoinsForWallet(wallet) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var res = await sb.from('campaign_joins').select('*').eq('wallet', wallet);
      if (res.error) throw res.error; return (res.data || []).map(mapJoinRow);
    }
    var h = localHolder(); var out = [];
    Object.keys(h.joined || {}).forEach(function (k) {
      var parts = k.split('::'); var j = h.joined[k] || {};
      out.push({ project_id: parts[0], campaign_id: parts[1], wallet: wallet, qualified: !!j.qualified, x_handle: j.xHandle || null, status: j.status || 'approved', progress: j.progress || 0 });
    });
    return out;
  }

  async function listClaimsForWallet(wallet) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var res = await sb.from('platform_claims').select('*').eq('wallet', wallet);
      if (res.error) throw res.error; return res.data || [];
    }
    var h = localHolder(); var out = [];
    Object.keys(h.claims || {}).forEach(function (k) {
      if (h.claims[k] && h.claims[k].settled) {
        var parts = k.split('::');
        out.push({ project_id: parts[0], campaign_id: parts[1], wallet: wallet, settled: true });
      }
    });
    return out;
  }

  global.BardPlatform = {
    init: init, FEES: FEES,
    feesEnabled: function () { return FEES_ENABLED; },
    setFeesEnabled: function (on) { FEES_ENABLED = !!on; },
    isPremiumType: isPremiumType,
    isPremiumReward: isPremiumReward,
    isPremiumPlan: isPremiumPlan,
    planLabel: planLabel,
    growingNow: growingNow,
    growingMeta: growingMeta,
    setProjectPlan: setProjectPlan,
    getFeeTreasury: function () { return FEE_TREASURY; },
    setFeeTreasury: function (addr) { FEE_TREASURY = addr || ''; },
    getMode: function () { return mode; },
    listProjects: listProjects, createProject: createProject, createCampaign: createCampaign,
    updateCampaignStatus: updateCampaignStatus, listLiveCampaigns: listLiveCampaigns,
    recordFee: recordFee, payFee: payFee, markFeeConfirmed: markFeeConfirmed,
    upsertHolder: upsertHolder, joinCampaign: joinCampaign,
    listJoinsForCampaign: listJoinsForCampaign, setJoinStatus: setJoinStatus, setJoinProgress: setJoinProgress,
    listRoster: listRoster, upsertRoster: upsertRoster, removeRoster: removeRoster,
    drawAirdrop: drawAirdrop,
    commitDraw: commitDraw,
    finalizeDraw: finalizeDraw,
    deriveWinners: deriveWinners,
    verifyDraw: verifyDraw,
    assertDrawStep: assertDrawStep,
    canonicalPayoutText: canonicalPayoutText,
    payoutHash: payoutHash,
    planReservation: planReservation,
    markQualified: markQualified, settleClaim: settleClaim,
    listJoinsForWallet: listJoinsForWallet, listClaimsForWallet: listClaimsForWallet,
    localHolder: localHolder, saveLocalHolder: saveLocalHolder,
    parseTweetId: parseTweetId, xIntentUrls: xIntentUrls,
    getVaultBardMember: getVaultBardMember,
    fetchVaultOnchain: fetchVaultOnchain,
    updateProjectVault: updateProjectVault,
    reserveVault: reserveVault,
    computePayouts: computePayouts,
    proposeSettlement: proposeSettlement,
    listSettlements: listSettlements,
    listOpenSettlements: listOpenSettlements,
    signSettlement: signSettlement,
    cosignSettlement: cosignSettlement,
    executeSettlement: executeSettlement,
    getRpc: getRpc,
    escapeHtml: escapeHtml,
    safeHttpUrl: safeHttpUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
