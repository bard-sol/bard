// Throwaway two-wallet check for a Bard Supabase project.
// God runs this after the M2 migration. It creates one project, proves anon
// and a second wallet cannot write it, proves the admin wallet can rename it,
// then deletes the project.
//
// Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
// Refuses a *.supabase.co host unless you pass --confirm-production.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../server/auth.js';

function wallet() {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

function productionHost(url) {
  const host = new URL(url).hostname;
  return host === 'pxdiyukxgnphxlknhmke.supabase.co' || host.endsWith('.supabase.co');
}

async function rest(fetchImpl, { url, key, token, method, path: restPath, body }) {
  const res = await fetchImpl(url + restPath, {
    method,
    headers: {
      apikey: key,
      authorization: 'Bearer ' + (token || key),
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}

export async function runTwoWalletCheck(options) {
  const url = String(options.url || '').replace(/\/$/, '');
  if (!url) throw new Error('SUPABASE_URL is required');
  if (productionHost(url) && !options.confirmProduction) {
    throw new Error('refusing production host ' + new URL(url).hostname + ' without --confirm-production');
  }
  const anonKey = options.anonKey;
  const serviceKey = options.serviceKey;
  const jwtSecret = options.jwtSecret;
  if (!anonKey || !serviceKey || !jwtSecret) {
    throw new Error('SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_JWT_SECRET are required');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const walletA = options.walletA || wallet();
  const walletB = options.walletB || wallet();
  const tokenA = (await signJwt(jwtSecret, walletA)).token;
  const tokenB = (await signJwt(jwtSecret, walletB)).token;
  const mint = 'm2check-' + crypto.randomUUID();
  const original = 'm2-throwaway';
  let projectId = null;

  const service = (method, restPath, body) => rest(fetchImpl, {
    url, key: serviceKey, method, path: restPath, body,
  });
  const asUser = (token, method, restPath, body) => rest(fetchImpl, {
    url, key: anonKey, token, method, path: restPath, body,
  });

  try {
    const created = await service('POST', '/rest/v1/projects', {
      name: original,
      ticker: 'M2CK',
      mint,
      chain: 'solana',
      admin_wallet: walletA,
      created_by: walletA,
    });
    if (created.status >= 300 || !Array.isArray(created.data) || !created.data[0] || !created.data[0].id) {
      throw new Error('service insert failed: ' + created.status);
    }
    projectId = created.data[0].id;
    const projectPath = '/rest/v1/projects?id=eq.' + encodeURIComponent(projectId);

    const anonInsert = await rest(fetchImpl, {
      url,
      key: anonKey,
      method: 'POST',
      path: '/rest/v1/projects',
      body: { name: 'anon', ticker: 'ANON', mint: mint + '-anon', admin_wallet: walletB, created_by: walletB },
    });
    if (anonInsert.status < 400) throw new Error('anon insert was accepted');

    const bPatch = await asUser(tokenB, 'PATCH', projectPath, { name: 'hacked-by-b' });
    if (bPatch.status < 400 && Array.isArray(bPatch.data) && bPatch.data.some((row) => row.name === 'hacked-by-b')) {
      throw new Error('wallet B changed the project');
    }
    const afterB = await service('GET', projectPath + '&select=id,name,admin_wallet');
    const afterBRow = Array.isArray(afterB.data) ? afterB.data[0] : null;
    if (!afterBRow || afterBRow.name !== original) throw new Error('wallet B changed the project name');

    const aPatch = await asUser(tokenA, 'PATCH', projectPath, { name: 'm2-throwaway-ok' });
    if (aPatch.status >= 300 || !Array.isArray(aPatch.data) || !aPatch.data.some((row) => row.name === 'm2-throwaway-ok')) {
      throw new Error('admin wallet could not rename the project: ' + aPatch.status);
    }

    const bCampaign = await asUser(tokenB, 'POST', '/rest/v1/campaigns', {
      project_id: projectId,
      title: 'stolen',
      rule_text: 'no',
      type: 'raid',
    });
    if (bCampaign.status < 400 && Array.isArray(bCampaign.data) && bCampaign.data.length) {
      throw new Error('wallet B inserted a campaign');
    }
    const campaigns = await service('GET', '/rest/v1/campaigns?project_id=eq.' + encodeURIComponent(projectId) + '&select=id');
    if (Array.isArray(campaigns.data) && campaigns.data.length) throw new Error('a campaign row was left behind');

    return { projectId, walletA, walletB, renamed: true };
  } finally {
    if (projectId) {
      await service('DELETE', '/rest/v1/projects?id=eq.' + encodeURIComponent(projectId));
    }
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href
    || fileURLToPath(import.meta.url) === path.resolve(entry);
}

if (invokedDirectly()) {
  runTwoWalletCheck({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
    confirmProduction: process.argv.includes('--confirm-production'),
  }).then((result) => {
    console.log('ok ' + result.projectId + ' cleaned up');
  }).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
