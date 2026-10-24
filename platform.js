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
  var RPC = 'https://solana-rpc.publicnode.com';
  var SUPABASE_SCRIPT = '/vendor/supabase/supabase.js';
  var LOCAL_MODE_MSG = 'NOT SAVED — local demo mode. Nothing you do here is stored on Bard.';

  var sb = null;
  var mode = 'local';
  var ready = null;
  var sessionToken = null;
  var sessionWallet = null;
  var bardSignerPubkey = '';
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

  function b58encode(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var digits = [0];
    for (var i = 0; i < u8.length; i++) {
      var carry = u8[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = '';
    for (var z = 0; z < u8.length && u8[z] === 0; z++) out += '1';
    for (var k = digits.length - 1; k >= 0; k--) out += B58[digits[k]];
    return out;
  }

  function restoreSession() {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var raw = sessionStorage.getItem('bard_session');
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.token || !saved.wallet) return;
      if (saved.exp && Number(saved.exp) <= Math.floor(Date.now() / 1000)) {
        sessionStorage.removeItem('bard_session');
        return;
      }
      sessionToken = saved.token;
      sessionWallet = saved.wallet;
    } catch (e) {}
  }

  function apiHeaders() {
    var headers = { 'content-type': 'application/json' };
    if (sessionToken) headers.authorization = 'Bearer ' + sessionToken;
    return headers;
  }

  async function apiPost(path, body) {
    var res = await fetch(path, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body || {}) });
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw new Error((data && data.error) || 'request failed');
    return data;
  }

  function authedFetch(input, options) {
    if (!sessionToken) return fetch(input, options);
    var headers = new Headers((options && options.headers) || {});
    headers.set('Authorization', 'Bearer ' + sessionToken);
    var opts = Object.assign({}, options || {}, { headers: headers });
    return fetch(input, opts);
  }

  async function signIn(provider) {
    await init();
    if (!provider || typeof provider.signMessage !== 'function') throw new Error('Wallet cannot sign');
    var pk = provider.publicKey;
    if (!pk && typeof provider.connect === 'function') {
      var resp = await provider.connect();
      pk = (resp && resp.publicKey) || provider.publicKey;
    }
    if (!pk) throw new Error('Could not read wallet address');
    var wallet = pk.toString();
    var issued = await apiPost('/api/auth/nonce', { wallet: wallet });
    var signed = await provider.signMessage(new TextEncoder().encode(issued.message), 'utf8');
    var sigBytes = signed && signed.signature ? signed.signature : signed;
    var verified = await apiPost('/api/auth/verify', {
      wallet: wallet,
      nonce: issued.nonce,
      issuedAt: issued.issuedAt,
      signature: b58encode(sigBytes),
      domain: issued.domain
    });
    sessionToken = verified.token;
    sessionWallet = verified.wallet || wallet;
    try {
      sessionStorage.setItem('bard_session', JSON.stringify({
        token: sessionToken, wallet: sessionWallet, exp: verified.expiresAt
      }));
    } catch (e) {}
    return { wallet: sessionWallet, token: sessionToken };
  }

  function signOut() {
    sessionToken = null;
    sessionWallet = null;
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('bard_session'); } catch (e) {}
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
      restoreSession();
      try {
        await loadScript(SUPABASE_SCRIPT);
        if (!global.supabase || !global.supabase.createClient) throw new Error('supabase missing');
        sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
          global: { fetch: authedFetch }
        });
        var probe = await sb.from('projects').select('id').limit(1);
        if (probe.error) { console.warn('[Bard] localStorage', probe.error.message); mode = 'local'; sb = null; }
        else { mode = 'supabase'; console.info('[Bard] Connected to Supabase'); }
      } catch (e) { console.warn('[Bard] localStorage', e); mode = 'local'; sb = null; }
      try {
        var cfgRes = await fetch('/api/config');
        if (cfgRes && cfgRes.ok) {
          var cfg = await cfgRes.json();
          bardSignerPubkey = (cfg && cfg.bardSignerPubkey) || '';
        }
      } catch (cfgErr) {}
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

  /** Bard's Squads signer. Loaded from GET /api/config, never the fee treasury. */
  function getVaultBardMember() { return bardSignerPubkey; }

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
        return { address: address, mint: parsed.info.mint || mint || null, uiAmount: uiAmount, raw: raw, decimals: decimals, source: source, solscan: 'https://solscan.io/account/' + address };
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
    return { address: address, mint: mint || null, uiAmount: uiAmount, raw: String(raw), decimals: decimals, source: source, solscan: 'https://solscan.io/account/' + address };
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
      vaultReserved: Number(c.vault_reserved || 0),
      drawSeed: c.draw_seed || c.drawSeed || null,
      drawAt: c.draw_at || c.drawAt || null,
      drawWinners: c.draw_winners || c.drawWinners || null
    };
    return camp;
  }
  function mapJoinRow(j) {
    return { id: j.id, project_id: j.project_id, campaign_id: j.campaign_id, wallet: j.wallet, x_handle: j.x_handle || null, qualified: !!j.qualified, qualified_at: j.qualified_at || null, joined_at: j.joined_at, status: j.status || 'approved', progress: j.progress || 0, note: j.note || null };
  }

  async function listProjects(opts) {
    await init();
    opts = opts || {};
    if (mode === 'supabase' && sb) {
      var prQuery = sb.from('projects').select('*').order('created_at', { ascending: false });
      if (opts.admin) prQuery = prQuery.eq('admin_wallet', sessionWallet || '1');
      var pr = await prQuery;
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
      if (!sessionToken) throw new Error('Sign in with your wallet first');
      var created = await apiPost('/api/projects', {
        name: input.name, ticker: input.ticker, mint: input.mint, chain: input.chain || 'solana', plan: input.plan || 'starter'
      });
      return mapProjectRow(created.project, []);
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
      if (!sessionToken) throw new Error('Sign in with your wallet first');
      var createdCamp = await apiPost('/api/campaigns', {
        projectId: projectId, title: input.title, type: input.type, rule: input.rule,
        reward: input.reward || null, unit: input.unit || 'SOL', pool: input.pool || null,
        days: (input.days === 0 || input.days === '0') ? 0 : (parseInt(input.days, 10) || 7),
        accessMode: input.accessMode || 'open', raidMode: input.raidMode || null, rewardMode: input.rewardMode || 'fixed',
        postUrl: input.postUrl || null, targets: input.targets || null, bonusHandle: input.bonusHandle || null, config: input.config || {}
      });
      return mapCampaignRow(createdCamp.campaign);
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
      var linked = await apiPost('/api/projects/' + encodeURIComponent(projectId) + '/vault', {
        address: addr, mint: mint, multisig: payload.vault_multisig
      });
      return mapProjectRow(linked.project, []);
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
    var n = Number(amount);
    if (!(n > 0)) throw new Error('Reserve amount must be greater than 0');
    if (mode === 'supabase' && sb) {
      var proj = await sb.from('projects').select('*').eq('id', projectId).maybeSingle();
      if (proj.error) throw proj.error;
      if (!proj.data) throw new Error('Project not found');
      if (!proj.data.vault_address) throw new Error('Link a vault first');
      var current = Number(proj.data.vault_reserved || 0);
      var next = current + n;
      var up = await sb.from('projects').update({ vault_reserved: next }).eq('id', projectId).select('*').single();
      if (up.error) throw up.error;
      if (campaignId) {
        await sb.from('campaigns').update({ vault_reserved: n }).eq('id', campaignId);
        await sb.from('vault_reservations').insert({
          project_id: projectId, campaign_id: campaignId, amount: n, status: 'reserved'
        });
      }
      return { reserved: next, added: n };
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    if (!p.vaultAddress) throw new Error('Link a vault first');
    p.vaultReserved = Number(p.vaultReserved || 0) + n;
    (p.campaigns || []).forEach(function (c) { if (c.id === campaignId) c.vaultReserved = n; });
    saveLocalTeam(state);
    return { reserved: p.vaultReserved, added: n };
  }

  async function setProjectPlan(projectId, plan) {
    await init();
    refuseLocalTeamWrite();
    if (plan !== 'free' && plan !== 'starter' && plan !== 'pro') throw new Error('Unknown plan');
    var payload = { plan: plan };
    if (plan !== 'free') payload.plan_paid_at = new Date().toISOString();
    if (mode === 'supabase' && sb) {
      var planned = await apiPost('/api/projects/' + encodeURIComponent(projectId) + '/plan', { plan: plan });
      return mapProjectRow(planned.project, []);
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

  function roundAmt(n) {
    return Math.round(Number(n) * 1e6) / 1e6;
  }

  function payoutHash(payouts) {
    var s = (payouts || []).map(function (x) { return String(x.wallet) + ':' + String(x.amount); }).join('|');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'b' + (h >>> 0).toString(16);
  }

  function computePayouts(campaign, joins) {
    var rows = (joins || []).filter(function (j) {
      if (j.status === 'rejected') return false;
      return !!(j.qualified || (j.status === 'approved' && (j.progress || 0) > 0));
    }).slice().sort(function (a, b) {
      if (!!b.qualified !== !!a.qualified) return b.qualified ? 1 : -1;
      return (b.progress || 0) - (a.progress || 0);
    });
    if (!rows.length) throw new Error('No qualified or scored holders to pay');
    var mode = campaign.rewardMode || campaign.reward_mode || 'fixed';
    var unit = campaign.unit || 'TOKEN';
    var pool = Number(campaign.vaultReserved || campaign.pool || campaign.reward || 0);
    var fixed = Number(campaign.reward || 0);
    var payouts = [];
    if (mode === 'fixed') {
      var each = fixed > 0 ? fixed : (pool > 0 ? roundAmt(pool / rows.length) : 0);
      if (!(each > 0)) throw new Error('Set a reward amount or pool first');
      payouts = rows.map(function (j) { return { wallet: j.wallet, amount: each, progress: j.progress || 0 }; });
    } else if (mode === 'top3' || mode === 'topn') {
      var top = rows.slice(0, 3);
      var cfg = campaign.config || {};
      var parts = [
        Number(cfg.top3First != null ? cfg.top3First : 50) / 100,
        Number(cfg.top3Second != null ? cfg.top3Second : 30) / 100,
        Number(cfg.top3Third != null ? cfg.top3Third : 20) / 100
      ];
      if (!(pool > 0)) throw new Error('Top N needs a pool size');
      payouts = top.map(function (j, i) { return { wallet: j.wallet, amount: roundAmt(pool * (parts[i] || 0)), progress: j.progress || 0 }; });
    } else if (mode === 'growing') {
      pool = Number(growingNow(campaign) || pool);
      if (!(pool > 0)) throw new Error('Growing pool needs a starting size');
      payouts = [{ wallet: rows[0].wallet, amount: pool, progress: rows[0].progress || 0 }];
    } else {
      if (!(pool > 0)) throw new Error('Shared pool needs a pool size');
      var slice = roundAmt(pool / rows.length);
      payouts = rows.map(function (j) { return { wallet: j.wallet, amount: slice, progress: j.progress || 0 }; });
    }
    payouts = payouts.filter(function (x) { return x.amount > 0 && x.wallet; });
    var total = roundAmt(payouts.reduce(function (s, x) { return s + Number(x.amount); }, 0));
    return { payouts: payouts, total: total, unit: unit, hash: payoutHash(payouts) };
  }

  async function proposeSettlement(projectId, campaignId, campaign, joins) {
    await init();
    refuseLocalTeamWrite();
    var built = computePayouts(campaign, joins);
    var row = {
      project_id: projectId,
      campaign_id: campaignId,
      payouts: built.payouts,
      total: built.total,
      unit: built.unit
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('vault_settlements').insert(row).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    row.payout_hash = built.hash;
    row.vault_multisig = (campaign && (campaign.vaultMultisig || '')) || null;
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
    if (who === 'bard') {
      return apiPost('/api/vault/bard-sign', { settlementId: settlementId });
    }
    var signed = await apiPost('/api/settlements/' + encodeURIComponent(settlementId) + '/team-sign', {
      sig: extra && extra.sig,
      txIndex: extra && extra.txIndex,
      wallet: extra && extra.wallet
    });
    return signed.settlement;
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
    return signSettlement(settlementId, 'team', { wallet: wallet, sig: sig || null });
  }

  async function executeSettlement(settlementId, txSignature, projectId) {
    await init();
    refuseLocalTeamWrite();
    throw new Error('Release payment without an on-chain transaction is not available');
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
    if (mode === 'supabase' && sb) return Object.assign({ id: null, skipped: true }, row);
    return Object.assign({ id: 'local_fee_' + Date.now() }, row);
  }

  async function markFeeConfirmed(feeId, txSignature, kind, refs) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      if (txSignature && txSignature !== 'fees-disabled') {
        await apiPost('/api/fees/confirm', {
          kind: kind, signature: txSignature,
          projectId: refs && refs.projectId, campaignId: refs && refs.campaignId, claimId: refs && refs.claimId
        });
      } else if ((kind === 'starter' || kind === 'pro' || kind === 'onboard') && refs && refs.projectId) {
        await apiPost('/api/projects/' + encodeURIComponent(refs.projectId) + '/plan', { plan: kind === 'pro' ? 'pro' : 'starter' });
      }
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
      console.warn('[Bard] markFeeFailed', reason || 'failed');
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
      var row = { x_handle: xHandle || null, x_linked_at: xHandle ? new Date().toISOString() : null, x_via: xVia || null };
      if (existing.data) await sb.from('holders').update(row).eq('wallet', wallet);
      else await sb.from('holders').insert(Object.assign({ wallet: wallet }, row));
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
      var existingJoin = await sb.from('campaign_joins').select('id').eq('campaign_id', campaignId).eq('wallet', wallet).maybeSingle();
      if (existingJoin.error) throw existingJoin.error;
      var write = existingJoin.data
        ? sb.from('campaign_joins').update({ x_handle: xHandle || null }).eq('campaign_id', campaignId).eq('wallet', wallet)
        : sb.from('campaign_joins').insert({ project_id: projectId, campaign_id: campaignId, wallet: wallet, x_handle: xHandle || null, joined_at: new Date().toISOString() });
      var res = await write.select('id, project_id, campaign_id, wallet, qualified, qualified_at, joined_at, status, progress, note').single();
      if (res.error) throw res.error;
      var joined = mapJoinRow(res.data);
      if (!joined.x_handle) joined.x_handle = xHandle || null;
      return joined;
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
      var res = await sb.from('campaign_join_feed').select('*').eq('campaign_id', campaignId).order('joined_at', { ascending: false });
      if (res.error) throw res.error; return (res.data || []).map(mapJoinRow);
    }
    return [];
  }

  async function setJoinStatus(campaignId, wallet, status) {
    await init();
    refuseLocalTeamWrite();
    if (!status || ['pending', 'approved', 'rejected'].indexOf(status) < 0) throw new Error('Invalid join status');
    if (mode === 'supabase' && sb) {
      var updated = await apiPost('/api/joins/status', { campaignId: campaignId, wallet: wallet, status: status });
      return mapJoinRow(updated.join);
    }
    return { campaign_id: campaignId, wallet: wallet, status: status };
  }

  async function setJoinProgress(campaignId, wallet, progress, note) {
    await init();
    refuseLocalTeamWrite();
    var n = Math.max(0, parseInt(progress, 10) || 0);
    if (mode === 'supabase' && sb) {
      var progressed = await apiPost('/api/joins/progress', { campaignId: campaignId, wallet: wallet, progress: n, note: note });
      return mapJoinRow(progressed.join);
    }
    return { campaign_id: campaignId, wallet: wallet, progress: n, note: note || null };
  }

  async function markQualified(projectId, campaignId, wallet) {
    await init();
    refuseLocalTeamWrite();
    if (mode === 'supabase' && sb) {
      var qualified = await apiPost('/api/joins/qualify', { campaignId: campaignId, wallet: wallet });
      return qualified.join;
    }
    var h = localHolder(); var key = projectId + '::' + campaignId;
    if (h.joined[key]) { h.joined[key].qualified = true; saveLocalHolder(h); }
  }

  async function settleClaim(projectId, campaignId, wallet, xHandle, amount, unit) {
    await init();
    if (mode === 'supabase' && sb) {
      var claimed = await apiPost('/api/claims', {
        projectId: projectId, campaignId: campaignId, wallet: wallet, xHandle: xHandle || null, amount: amount, unit: unit || 'SOL'
      });
      return claimed.claim;
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
      var existingRoster = await sb.from('project_roster').select('id').eq('project_id', projectId).eq('wallet', wallet).maybeSingle();
      if (existingRoster.error) throw existingRoster.error;
      var res = existingRoster.data
        ? await sb.from('project_roster').update({ role: role, note: note || null }).eq('project_id', projectId).eq('wallet', wallet).select('*').single()
        : await sb.from('project_roster').insert({ project_id: projectId, wallet: wallet, role: role, note: note || null }).select('*').single();
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

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seedToInt(s) {
    var h = 2166136261;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function shuffleSeeded(list, seed) {
    var rng = mulberry32(seedToInt(seed));
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  async function drawAirdrop(campaignId, topN) {
    await init();
    refuseLocalTeamWrite();
    var joins = await listJoinsForCampaign(campaignId);
    var pool = joins.filter(function (j) { return j.status !== 'rejected' && (j.qualified || j.status === 'approved'); });
    if (!pool.length) throw new Error('No eligible holders to draw');
    var entropy = String(Date.now());
    try {
      if (global.solanaWeb3) {
        var conn = new global.solanaWeb3.Connection(RPC, 'confirmed');
        var bh = await conn.getLatestBlockhash('finalized');
        if (bh && bh.blockhash) entropy = bh.blockhash;
      }
    } catch (e) {}
    var seed = String(campaignId) + '::' + entropy;
    var shuffled = shuffleSeeded(pool.map(function (j) { return { wallet: j.wallet, x_handle: j.x_handle, progress: j.progress || 0 }; }), seed);
    var n = Math.max(1, parseInt(topN, 10) || shuffled.length);
    var winners = shuffled.slice(0, n);
    var payload = { draw_seed: seed, draw_at: new Date().toISOString(), draw_winners: winners };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaigns').update(payload).eq('id', campaignId).select('*').single();
      if (res.error) throw res.error;
      return mapCampaignRow(res.data);
    }
    var state = localTeam();
    state.projects.forEach(function (p) {
      (p.campaigns || []).forEach(function (c) {
        if (c.id === campaignId) { c.drawSeed = seed; c.drawAt = payload.draw_at; c.drawWinners = winners; }
      });
    });
    saveLocalTeam(state);
    return { id: campaignId, drawSeed: seed, drawAt: payload.draw_at, drawWinners: winners };
  }

  async function listJoinsForWallet(wallet) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var res = await sb.from('campaign_join_feed').select('*').eq('wallet', wallet);
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
    signIn: signIn,
    signOut: signOut,
    getSessionWallet: function () { return sessionWallet; },
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
