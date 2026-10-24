import { test as base, expect } from '@playwright/test';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-expose-headers': '*',
};

export const PAYLOAD = '<img src=x onerror="window.__xss=1">';
export const BANNER = 'NOT SAVED \u2014 local demo mode. Nothing you do here is stored on Bard.';
export const HOLDER = 'HolderWa11et11111111111111111111111111111';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/*', async (route) => {
      const req = route.request();
      let host = '';
      try { host = new URL(req.url()).hostname; } catch (e) { host = ''; }
      const local = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
      if (local) {
        await route.continue();
        return;
      }
      if (/(^|\.)supabase\.co$/i.test(host)) {
        await route.abort('failed');
        return;
      }
      const type = req.resourceType();
      if (type === 'stylesheet' || type === 'font') {
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        return;
      }
      await route.abort('failed');
    });
    await use(page);
  },
});

export { expect };

export async function mockSupabase(page, tables) {
  const writes = [];
  await page.route(/https?:\/\/([^/]+\.)?supabase\.co\//i, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method())) {
      writes.push({ method: req.method(), url: req.url() });
    }
    if (url.pathname.includes('/auth/')) {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: '{}',
      });
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const table = parts[parts.length - 1];
    const rows = Object.prototype.hasOwnProperty.call(tables, table) ? tables[table] : [];
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(rows),
    });
  });
  return writes;
}

export async function assertPayloadLiteral(page, locator) {
  await expect(locator).toContainText(PAYLOAD);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
}

export function xssTables() {
  const text = PAYLOAD;
  return {
    projects: [{
      id: 'p1',
      name: text,
      ticker: text,
      mint: 'So11111111111111111111111111111111111111112',
      admin_wallet: '',
      chain: 'solana',
      fee_paid: true,
      created_at: '2026-01-01T00:00:00.000Z',
      plan: 'pro',
      vault_address: null,
      vault_reserved: 0,
      vault_status: 'none',
    }],
    campaigns: [{
      id: 'c1',
      project_id: 'p1',
      title: text,
      type: 'raid',
      rule_text: text,
      reward: '10',
      reward_unit: 'SOL',
      status: 'active',
      settled_count: 0,
      fee_paid: true,
      created_at: '2026-01-02T00:00:00.000Z',
      access_mode: 'open',
      raid_mode: 'open',
      reward_mode: 'fixed',
      post_url: null,
      config: {},
    }],
    campaign_joins: [{
      id: 'j1',
      project_id: 'p1',
      campaign_id: 'c1',
      wallet: HOLDER,
      x_handle: text,
      qualified: false,
      status: 'approved',
      progress: 1,
      note: text,
      joined_at: '2026-01-03T00:00:00.000Z',
    }],
    project_roster: [{
      id: 'r1',
      project_id: 'p1',
      wallet: HOLDER,
      role: 'trusted',
      note: text,
      created_at: '2026-01-01T00:00:00.000Z',
    }],
    vault_settlements: [],
    platform_claims: [],
  };
}

export function smashTables() {
  return {
    projects: [{
      id: 'p1',
      name: 'Demo',
      ticker: 'DEMO',
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      fee_paid: true,
      created_at: '2026-01-01T00:00:00.000Z',
      plan: 'starter',
      vault_status: 'none',
    }],
    campaigns: [{
      id: 'c1',
      project_id: 'p1',
      title: 'Raid the post',
      type: 'raid',
      rule_text: 'Smash the post',
      reward: '5',
      reward_unit: 'SOL',
      status: 'active',
      created_at: '2026-01-02T00:00:00.000Z',
      access_mode: 'open',
      raid_mode: 'post',
      reward_mode: 'fixed',
      post_url: 'https://x.com/someone/status/1234567890123456789',
      config: {},
    }],
    campaign_joins: [{
      id: 'j1',
      project_id: 'p1',
      campaign_id: 'c1',
      wallet: HOLDER,
      x_handle: '@holder',
      qualified: false,
      status: 'approved',
      progress: 2,
      note: null,
      joined_at: '2026-01-03T00:00:00.000Z',
    }],
    vault_settlements: [],
    platform_claims: [],
    project_roster: [],
  };
}
