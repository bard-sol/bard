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

  var FEES = {
    onboard: 0.25,
    campaign: 0.25,
    claim: 0.1,
    stake: 0.05
  };

  var TEAM_KEY = 'bard_team_v1';
  var HOLDER_KEY = 'bard_holder_v1';
  var RPC = 'https://api.mainnet-beta.solana.com';

  var sb = null;
  var mode = 'local';
  var ready = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
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
        if (probe.error) {
          console.warn('[Bard] Supabase projects table not ready — using localStorage.', probe.error.message);
          mode = 'local';
        } else {
          mode = 'supabase';
          console.info('[Bard] Connected to Supabase');
        }
      } catch (e) {
        console.warn('[Bard] Supabase init failed — localStorage.', e);
        mode = 'local';
        sb = null;
      }
      return { mode: mode, sb: sb };
    })();
    return ready;
  }

  function localTeam() {
    try {
      var raw = localStorage.getItem(TEAM_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { projects: [] };
  }
  function saveLocalTeam(state) {
    localStorage.setItem(TEAM_KEY, JSON.stringify(state));
  }
  function localHolder() {
    try {
      var raw = localStorage.getItem(HOLDER_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { joined: {}, claims: {}, xHandle: null };
  }
  function saveLocalHolder(h) {
    localStorage.setItem(HOLDER_KEY, JSON.stringify(h));
  }

  function mapProjectRow(r, campaigns) {
    return {
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      mint: r.mint,
      admin: r.admin_wallet || '',
      chain: r.chain || 'solana',
      feePaid: !!r.fee_paid,
      feeTx: r.fee_tx || null,
      createdAt: r.created_at,
      campaigns: campaigns || []
    };
  }
  function mapCampaignRow(c) {
    return {
      id: c.id,
      title: c.title,
      type: c.type,
      rule: c.rule_text || '',
      reward: c.reward || '',
      unit: c.reward_unit || 'SOL',
      pool: c.pool_size || '',
      days: c.duration_days || 7,
      status: c.status || 'active',
      settled: c.settled_count || 0,
      feePaid: !!c.fee_paid,
      feeTx: c.fee_tx || null,
      createdAt: c.created_at
    };
  }

  async function listProjects() {
    await init();
    if (mode === 'supabase' && sb) {
      var pr = await sb.from('projects').select('*').order('created_at', { ascending: false });
      if (pr.error) throw pr.error;
      var cr = await sb.from('campaigns').select('*').order('created_at', { ascending: false });
      if (cr.error) throw cr.error;
      var byProject = {};
      (cr.data || []).forEach(function (c) {
        if (!byProject[c.project_id]) byProject[c.project_id] = [];
        byProject[c.project_id].push(mapCampaignRow(c));
      });
      return (pr.data || []).map(function (p) {
        return mapProjectRow(p, byProject[p.id] || []);
      });
    }
    return localTeam().projects || [];
  }

  async function createProject(input) {
    await init();
    var payload = {
      name: input.name,
      ticker: input.ticker,
      mint: input.mint,
      chain: input.chain || 'solana',
      admin_wallet: input.admin || null,
      created_by: input.createdBy || input.admin || null,
      fee_paid: false,
      fee_amount_sol: FEES.onboard
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('projects').insert(payload).select('*').single();
      if (res.error) throw res.error;
      return mapProjectRow(res.data, []);
    }
    var state = localTeam();
    var project = {
      id: 'id_' + Math.random().toString(36).slice(2, 10),
      name: payload.name,
      ticker: payload.ticker,
      mint: payload.mint,
      admin: payload.admin_wallet || '',
      chain: payload.chain,
      feePaid: false,
      createdAt: new Date().toISOString(),
      campaigns: []
    };
    state.projects.push(project);
    saveLocalTeam(state);
    return project;
  }

  async function createCampaign(projectId, input) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb
        .from('campaigns')
        .insert({
          project_id: projectId,
          title: input.title,
          type: input.type,
          rule_text: input.rule,
          reward: input.reward || null,
          reward_unit: input.unit || 'SOL',
          pool_size: input.pool || null,
          duration_days: input.days || 7,
          status: 'active',
          fee_paid: false,
          fee_amount_sol: FEES.campaign
        })
        .select('*')
        .single();
      if (res.error) throw res.error;
      return mapCampaignRow(res.data);
    }
    var state = localTeam();
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) throw new Error('Project not found');
    var camp = {
      id: 'id_' + Math.random().toString(36).slice(2, 10),
      title: input.title,
      type: input.type,
      rule: input.rule,
      reward: input.reward || '',
      unit: input.unit || 'SOL',
      pool: input.pool || '',
      days: input.days || 7,
      status: 'active',
      settled: 0,
      feePaid: false,
      createdAt: new Date().toISOString()
    };
    p.campaigns = p.campaigns || [];
    p.campaigns.push(camp);
    saveLocalTeam(state);
    return camp;
  }

  async function updateCampaignStatus(campaignId, status) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaigns').update({ status: status }).eq('id', campaignId).select('*').single();
      if (res.error) throw res.error;
      return mapCampaignRow(res.data);
    }
    var state = localTeam();
    state.projects.forEach(function (p) {
      (p.campaigns || []).forEach(function (c) {
        if (c.id === campaignId) c.status = status;
      });
    });
    saveLocalTeam(state);
  }

  async function listLiveCampaigns() {
    var projects = await listProjects();
    var out = [];
    projects.forEach(function (p) {
      (p.campaigns || []).forEach(function (c) {
        if (c.status === 'active') {
          out.push({
            projectId: p.id,
            projectName: p.name,
            ticker: p.ticker,
            mint: p.mint,
            campaign: c
          });
        }
      });
    });
    out.sort(function (a, b) {
      return String(b.campaign.createdAt || '').localeCompare(String(a.campaign.createdAt || ''));
    });
    return out;
  }

  async function recordFee(kind, payerWallet, refs) {
    await init();
    var amount = FEES[kind];
    if (amount == null) throw new Error('Unknown fee kind');
    var row = {
      kind: kind,
      amount_sol: amount,
      payer_wallet: payerWallet,
      status: 'pending',
      project_id: (refs && refs.projectId) || null,
      campaign_id: (refs && refs.campaignId) || null,
      claim_id: (refs && refs.claimId) || null,
      meta: refs && refs.meta ? refs.meta : {}
    };
    if (mode === 'supabase' && sb) {
      var res = await sb.from('fee_payments').insert(row).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    return Object.assign({ id: 'local_fee_' + Date.now() }, row);
  }

  async function markFeeConfirmed(feeId, txSignature, kind, refs) {
    await init();
    if (mode === 'supabase' && sb) {
      await sb.from('fee_payments').update({
        status: 'confirmed',
        tx_signature: txSignature,
        confirmed_at: new Date().toISOString()
      }).eq('id', feeId);
      if (kind === 'onboard' && refs && refs.projectId) {
        await sb.from('projects').update({ fee_paid: true, fee_tx: txSignature }).eq('id', refs.projectId);
      }
      if (kind === 'campaign' && refs && refs.campaignId) {
        await sb.from('campaigns').update({ fee_paid: true, fee_tx: txSignature }).eq('id', refs.campaignId);
      }
      if (kind === 'claim' && refs && refs.claimId) {
        await sb.from('platform_claims').update({
          fee_paid: true, fee_tx: txSignature, settled: true, settled_at: new Date().toISOString()
        }).eq('id', refs.claimId);
      }
    }
  }

  async function payFee(kind, payerWallet, provider, refs) {
    await init();
    if (!FEE_TREASURY) {
      var pending = await recordFee(kind, payerWallet, refs);
      return {
        ok: false,
        pending: true,
        fee: pending,
        message: 'Fee treasury not configured yet — recorded as pending.'
      };
    }
    if (!global.solanaWeb3) {
      throw new Error('Solana web3 not loaded');
    }
    if (typeof global.Buffer === 'undefined') {
      throw new Error('Buffer not defined — hard refresh the page (polyfill missing)');
    }
    var amount = FEES[kind];
    if (amount == null) throw new Error('Unknown fee kind: ' + kind);
    var feeRow = await recordFee(kind, payerWallet, refs);
    var Connection = global.solanaWeb3.Connection;
    var PublicKey = global.solanaWeb3.PublicKey;
    var SystemProgram = global.solanaWeb3.SystemProgram;
    var Transaction = global.solanaWeb3.Transaction;
    var lamports = Math.round(amount * 1e9);
    var connection = new Connection(RPC, 'confirmed');
    var from = new PublicKey(payerWallet);
    var to = new PublicKey(FEE_TREASURY);
    var tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports })
    );
    tx.feePayer = from;
    var latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    if (latest.lastValidBlockHeight) {
      tx.lastValidBlockHeight = latest.lastValidBlockHeight;
    }

    var sig;
    if (provider && typeof provider.signAndSendTransaction === 'function') {
      var sent = await provider.signAndSendTransaction(tx);
      sig = typeof sent === 'string' ? sent : (sent && (sent.signature || sent));
    } else if (provider && typeof provider.signTransaction === 'function') {
      var signedTx = await provider.signTransaction(tx);
      sig = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
    } else {
      throw new Error('Wallet does not support signing');
    }
    if (!sig) throw new Error('No transaction signature returned');

    try {
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight
        },
        'confirmed'
      );
    } catch (confirmErr) {
      console.warn('[Bard] confirmTransaction warning', confirmErr);
    }

    await markFeeConfirmed(feeRow.id, sig, kind, refs);
    return { ok: true, signature: sig, fee: feeRow, amount: amount };
  }

  async function upsertHolder(wallet, xHandle, xVia) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var existing = await sb.from('holders').select('*').eq('wallet', wallet).maybeSingle();
      var row = {
        wallet: wallet,
        x_handle: xHandle || null,
        x_linked_at: xHandle ? new Date().toISOString() : null,
        x_via: xVia || null
      };
      if (existing.data) await sb.from('holders').update(row).eq('wallet', wallet);
      else await sb.from('holders').insert(row);
    }
    var h = localHolder();
    if (xHandle) h.xHandle = xHandle;
    saveLocalHolder(h);
  }

  async function joinCampaign(projectId, campaignId, wallet, xHandle) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaign_joins').upsert({
        project_id: projectId,
        campaign_id: campaignId,
        wallet: wallet,
        x_handle: xHandle || null,
        qualified: false,
        joined_at: new Date().toISOString()
      }, { onConflict: 'campaign_id,wallet' }).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    var h = localHolder();
    var key = projectId + '::' + campaignId;
    h.joined[key] = { at: new Date().toISOString(), qualified: false, wallet: wallet, xHandle: xHandle || null };
    saveLocalHolder(h);
    return h.joined[key];
  }

  async function markQualified(projectId, campaignId, wallet) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('campaign_joins').update({
        qualified: true, qualified_at: new Date().toISOString()
      }).eq('campaign_id', campaignId).eq('wallet', wallet).select('*').single();
      if (res.error) throw res.error;
      return res.data;
    }
    var h = localHolder();
    var key = projectId + '::' + campaignId;
    if (h.joined[key]) { h.joined[key].qualified = true; saveLocalHolder(h); }
  }

  async function settleClaim(projectId, campaignId, wallet, xHandle, amount, unit) {
    await init();
    if (mode === 'supabase' && sb) {
      var res = await sb.from('platform_claims').upsert({
        project_id: projectId,
        campaign_id: campaignId,
        wallet: wallet,
        x_handle: xHandle || null,
        amount: amount || null,
        unit: unit || 'SOL',
        settled: true,
        settled_at: new Date().toISOString(),
        fee_paid: false,
        fee_amount_sol: FEES.claim
      }, { onConflict: 'campaign_id,wallet' }).select('*').single();
      if (res.error) throw res.error;
      var camp = await sb.from('campaigns').select('settled_count').eq('id', campaignId).single();
      var n = (camp.data && camp.data.settled_count) || 0;
      await sb.from('campaigns').update({ settled_count: n + 1 }).eq('id', campaignId);
      return res.data;
    }
    var h = localHolder();
    var key = projectId + '::' + campaignId;
    h.claims[key] = { settled: true, at: new Date().toISOString(), wallet: wallet, xHandle: xHandle };
    saveLocalHolder(h);
    return h.claims[key];
  }

  async function listJoinsForWallet(wallet) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var res = await sb.from('campaign_joins').select('*').eq('wallet', wallet);
      if (res.error) throw res.error;
      return res.data || [];
    }
    var h = localHolder();
    var out = [];
    Object.keys(h.joined || {}).forEach(function (k) {
      var parts = k.split('::');
      out.push({
        project_id: parts[0], campaign_id: parts[1], wallet: wallet,
        qualified: !!(h.joined[k] && h.joined[k].qualified),
        x_handle: h.joined[k] && h.joined[k].xHandle
      });
    });
    return out;
  }

  async function listClaimsForWallet(wallet) {
    await init();
    if (mode === 'supabase' && sb && wallet) {
      var res = await sb.from('platform_claims').select('*').eq('wallet', wallet);
      if (res.error) throw res.error;
      return res.data || [];
    }
    var h = localHolder();
    var out = [];
    Object.keys(h.claims || {}).forEach(function (k) {
      if (h.claims[k] && h.claims[k].settled) {
        var parts = k.split('::');
        out.push({ project_id: parts[0], campaign_id: parts[1], wallet: wallet, settled: true });
      }
    });
    return out;
  }

  global.BardPlatform = {
    init: init,
    FEES: FEES,
    getFeeTreasury: function () { return FEE_TREASURY; },
    setFeeTreasury: function (addr) { FEE_TREASURY = addr || ''; },
    getMode: function () { return mode; },
    listProjects: listProjects,
    createProject: createProject,
    createCampaign: createCampaign,
    updateCampaignStatus: updateCampaignStatus,
    listLiveCampaigns: listLiveCampaigns,
    recordFee: recordFee,
    payFee: payFee,
    markFeeConfirmed: markFeeConfirmed,
    upsertHolder: upsertHolder,
    joinCampaign: joinCampaign,
    markQualified: markQualified,
    settleClaim: settleClaim,
    listJoinsForWallet: listJoinsForWallet,
    listClaimsForWallet: listClaimsForWallet,
    localHolder: localHolder,
    saveLocalHolder: saveLocalHolder
  };
})(typeof window !== 'undefined' ? window : globalThis);
