import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTwoWalletCheck } from '../../scripts/m2-two-wallet-check.mjs';

function payload(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString());
}

function mockFetch() {
  const projects = [];
  const campaigns = [];
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ host: u.hostname, path: u.pathname, method: opts.method });
    if (/supabase\.co$|mainnet|publicnode/i.test(u.hostname) && !u.hostname.endsWith('.supabase.co')) {
      throw new Error('unexpected host ' + u.hostname);
    }
    const headers = new Headers(opts.headers);
    const bearer = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const apikey = headers.get('apikey') || '';
    const service = apikey === 'service-key';
    const claims = bearer.includes('.') ? payload(bearer) : null;
    const body = opts.body ? JSON.parse(opts.body) : null;
    const id = u.searchParams.get('id') ? u.searchParams.get('id').replace(/^eq\./, '') : '';
    const projectId = u.searchParams.get('project_id') ? u.searchParams.get('project_id').replace(/^eq\./, '') : '';

    if (u.pathname === '/rest/v1/projects' && opts.method === 'POST') {
      if (!service) return Response.json({ message: 'permission denied' }, { status: 401 });
      const row = { id: crypto.randomUUID(), ...body };
      projects.push(row);
      return Response.json([row], { status: 201 });
    }
    if (u.pathname === '/rest/v1/projects' && opts.method === 'PATCH') {
      const row = projects.find((item) => item.id === id);
      if (!row || !claims || claims.wallet !== row.admin_wallet) return Response.json([]);
      Object.assign(row, body);
      return Response.json([row]);
    }
    if (u.pathname === '/rest/v1/projects' && opts.method === 'GET') {
      if (!service) return Response.json({ message: 'permission denied' }, { status: 401 });
      return Response.json(projects.filter((item) => !id || item.id === id));
    }
    if (u.pathname === '/rest/v1/projects' && opts.method === 'DELETE') {
      if (!service) return Response.json({ message: 'permission denied' }, { status: 401 });
      for (let i = projects.length - 1; i >= 0; i--) if (projects[i].id === id) projects.splice(i, 1);
      for (let i = campaigns.length - 1; i >= 0; i--) if (campaigns[i].project_id === id) campaigns.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    if (u.pathname === '/rest/v1/campaigns' && opts.method === 'POST') {
      const project = projects.find((item) => item.id === (body && body.project_id));
      if (!claims || !project || claims.wallet !== project.admin_wallet) {
        return Response.json({ message: 'permission denied' }, { status: 401 });
      }
      const row = { id: crypto.randomUUID(), ...body };
      campaigns.push(row);
      return Response.json([row], { status: 201 });
    }
    if (u.pathname === '/rest/v1/campaigns' && opts.method === 'GET') {
      if (!service) return Response.json({ message: 'permission denied' }, { status: 401 });
      return Response.json(campaigns.filter((item) => !projectId || item.project_id === projectId));
    }
    return Response.json({ message: 'not found' }, { status: 404 });
  };
  return { fetchImpl, projects, campaigns, calls };
}

test('two-wallet check refuses production and cleans up a local project', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error('live network blocked: ' + url); };
  try {
    let called = false;
    await assert.rejects(
      () => runTwoWalletCheck({
        url: 'https://pxdiyukxgnphxlknhmke.supabase.co',
        confirmProduction: false,
        fetchImpl: async () => { called = true; throw new Error('should not fetch'); },
      }),
      /without --confirm-production/
    );
    assert.equal(called, false);

    const mock = mockFetch();
    const result = await runTwoWalletCheck({
      url: 'https://pxdiyukxgnphxlknhmke.supabase.co',
      confirmProduction: true,
      anonKey: 'anon-key',
      serviceKey: 'service-key',
      jwtSecret: 'test-secret-test-secret-test-secret',
      fetchImpl: mock.fetchImpl,
    });
    assert.equal(result.renamed, true);
    assert.equal(mock.projects.length, 0);
    assert.equal(mock.campaigns.length, 0);
    assert.ok(mock.calls.some((call) => call.method === 'DELETE' && call.path === '/rest/v1/projects'));
    assert.ok(mock.calls.some((call) => call.host === 'pxdiyukxgnphxlknhmke.supabase.co'));
  } finally {
    globalThis.fetch = orig;
  }
});
