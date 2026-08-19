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
    stake: 0.05
  };

  var TEAM_KEY = 'bard_team_v1';
  var HOLDER_KEY = 'bard_holder_v1';
  var RPC = 'https://solana-rpc.publicnode.com';

  var sb = null;
  var mode = 'local';
  var ready = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function init() {
    if (ready) return ready;
    ready = (async function () {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
        if (!global.supabase) throw new Error('supabase missing');
        sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
        var probe = await sb.from('projects').select('id').limit(1);
        if (probe.error) { console.warn('[Bard] localStorage', probe.error.message); mode = 'local'; }
        else { mode = 'supabase'; console.info('[Bard] Connected to Supabase'); }
      } catch (e) { console.warn('[Bard] localStorage', e); mode = 'local'; sb = null; }
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
      vaultMultisig: r.vault_multisig || r.vaultMultisig || ''
    };
  }
  function mapCampaignRow(c) {
    var camp = {
      id: c.id, title: c.title, type: c.type, rule: c.rule_text || '', reward: c.reward || '',
      unit: c.reward_unit || 'SOL', pool: c.pool_size || '', days: c.duration_days || 7,
      status: c.status || 'active', settled: c.settled_count || 0, feePaid: !!c.fee_paid, feeTx: c.fee_tx || null,
      createdAt: c.created_at, accessMode: c.access_mode || 'open', raidMode: c.raid_mode || null,
      rewardMode: c.reward_mode || 'fixed', postUrl: c.post_url || '', targets: c.targets || '',
      bonusHandle: c.bonus_handle || '', config: c.config || {},
      vaultReserved: Number(c.vault_reserved || 0)
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
    var paid = !FEES_ENABLED;
    var payload = { name: input.name, ticker: input.ticker, mint: input.mint, chain: input.chain || 'solana', admin_wallet: input.admin || null, created_by: input.createdBy || input.admin || null, fee_paid: paid, fee_amount_sol: FEES.onboard };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('projects').insert(payload).select('*').single();
      if (res.error) throw res.error;
      return mapProjectRow(res.data, []);
    }
    var state = localTeam();
    var project = { id: 'id_' + Math.random().toString(36).slice(2, 10), name: payload.name, ticker: payload.ticker, mint: payload.mint, admin: payload.admin_wallet || '', chain: payload.chain, feePaid: paid, createdAt: new Date().toISOString(), campaigns: [] };
    state.projects.push(project); saveLocalTeam(state); return project;
  }

  async function createCampaign(projectId, input) {
    await init();
    if (FEES_ENABLED) {
      if (mode === 'supabase' && sb) {
        var proj = await sb.from('projects').select('id, fee_paid').eq('id', projectId).maybeSingle();
        if (proj.error) throw proj.error;
        if (!proj.data) throw new Error('Project not found');
        if (!proj.data.fee_paid) throw new Error('Pay the 0.25 SOL onboard fee before creating campaigns');
      } else {
        var stateCheck = localTeam();
        var pCheck = stateCheck.projects.find(function (x) { return x.id === projectId; });
        if (!pCheck) throw new Error('Project not found');
        if (!pCheck.feePaid) throw new Error('Pay the 0.25 SOL onboard fee before creating campaigns');
      }
    }
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaigns').insert({
        project_id: projectId, title: input.title, type: input.type, rule_text: input.rule,
        reward: input.reward || null, reward_unit: input.unit || 'SOL', pool_size: input.pool || null,
        duration_days: input.days || 7, status: 'active', fee_paid: !FEES_ENABLED, fee_amount_sol: FEES.campaign,
        access_mode: input.accessMode || 'open', raid_mode: input.raidMode || null, reward_mode: input.rewardMode || 'fixed',
        post_url: input.postUrl || null, targets: input.targets || null, bonus_handle: input.bonusHandle || null, config: input.config || {}
      }).select('*').single();
      if (res.error) throw res.error;
      return mapCampaignRow(res.data);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    var camp = { id: 'id_' + Math.random().toString(36).slice(2, 10), title: input.title, type: input.type, rule: input.rule, reward: input.reward || '', unit: input.unit || 'SOL', pool: input.pool || '', days: input.days || 7, status: 'active', settled: 0, feePaid: !FEES_ENABLED, createdAt: new Date().toISOString(), accessMode: input.accessMode || 'open', raidMode: input.raidMode || null, rewardMode: input.rewardMode || 'fixed', postUrl: input.postUrl || '', targets: input.targets || '', bonusHandle: input.bonusHandle || '', config: input.config || {} };
    p.campaigns = p.campaigns || []; p.campaigns.push(camp); saveLocalTeam(state); return camp;
  }

  async function updateProjectVault(projectId, input) {
    await init();
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
      var parts = [0.5, 0.3, 0.2];
      if (!(pool > 0)) throw new Error('Top N needs a pool size');
      payouts = top.map(function (j, i) { return { wallet: j.wallet, amount: roundAmt(pool * (parts[i] || 0)), progress: j.progress || 0 }; });
    } else if (mode === 'growing') {
      if (!(pool > 0)) throw new Error('Growing pool needs a reserved amount');
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
    var built = computePayouts(campaign, joins);
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
            var cur = Number((proj.data && proj.data.vault_reserved) || 0);
            await sb.from('projects').update({ vault_reserved: Math.max(0, cur - Number(s.total)) }).eq('id', projectId);
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
    var amount = FEES[kind];
    if (amount == null) throw new Error('Unknown fee kind');
    var row = { kind: kind, amount_sol: amount, payer_wallet: payerWallet, status: 'pending', project_id: (refs && refs.projectId) || null, campaign_id: (refs && refs.campaignId) || null, claim_id: (refs && refs.claimId) || null, meta: refs && refs.meta ? refs.meta : {} };
    if (mode === 'supabase' && sb) { var res = await sb.from('fee_payments').insert(row).select('*').single(); if (res.error) throw res.error; return res.data; }
    return Object.assign({ id: 'local_fee_' + Date.now() }, row);
  }

  async function markFeeConfirmed(feeId, txSignature, kind, refs) {
    await init();
    if (mode === 'supabase' && sb) {
      await sb.from('fee_payments').update({ status: 'confirmed', tx_signature: txSignature, confirmed_at: new Date().toISOString() }).eq('id', feeId);
      if (kind === 'onboard' && refs && refs.projectId) await sb.from('projects').update({ fee_paid: true, fee_tx: txSignature }).eq('id', refs.projectId);
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
    if (mode === 'supabase' && sb && feeId) {
      try { await sb.from('fee_payments').update({ status: 'failed', meta: { error: String(reason || 'failed') } }).eq('id', feeId); } catch (e) { console.warn('[Bard] markFeeFailed', e); }
    }
  }

  async function payFee(kind, payerWallet, provider, refs) {
    await init();
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
    if (mode === 'supabase' && sb) {
      var campRes = await sb.from('campaigns').select('id, access_mode, type').eq('id', campaignId).maybeSingle();
      if (campRes.error) throw campRes.error;
      if (!campRes.data) throw new Error('Campaign not found');
      var needsApproval = (campRes.data.access_mode || 'open') === 'approval';
      var joinStatus = needsApproval ? 'pending' : 'approved';
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
    if (!status || ['pending', 'approved', 'rejected'].indexOf(status) < 0) throw new Error('Invalid join status');
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaign_joins').update({ status: status }).eq('campaign_id', campaignId).eq('wallet', wallet).select('*').single();
      if (res.error) throw res.error; return mapJoinRow(res.data);
    }
    return { campaign_id: campaignId, wallet: wallet, status: status };
  }

  async function setJoinProgress(campaignId, wallet, progress, note) {
    await init();
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
    getFeeTreasury: function () { return FEE_TREASURY; },
    setFeeTreasury: function (addr) { FEE_TREASURY = addr || ''; },
    getMode: function () { return mode; },
    listProjects: listProjects, createProject: createProject, createCampaign: createCampaign,
    updateCampaignStatus: updateCampaignStatus, listLiveCampaigns: listLiveCampaigns,
    recordFee: recordFee, payFee: payFee, markFeeConfirmed: markFeeConfirmed,
    upsertHolder: upsertHolder, joinCampaign: joinCampaign,
    listJoinsForCampaign: listJoinsForCampaign, setJoinStatus: setJoinStatus, setJoinProgress: setJoinProgress,
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
    getRpc: getRpc
  };
})(typeof window !== 'undefined' ? window : globalThis);
