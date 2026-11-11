import { test, expect, mockSupabase } from './guard.js';

const ADMIN = 'AdminWa11et11111111111111111111111111111';
const LINKED = 'LinkWa11et111111111111111111111111111111';
const EMPTY = 'EmptyWa11et11111111111111111111111111111';
const SCRIPT = 'ScriptWa11et1111111111111111111111111111';
const MARKUP = 'MarkupWa11et1111111111111111111111111111';
const HOLDER = 'HolderWa11et1111111111111111111111111111';
const LOW = 'LowWa11et11111111111111111111111111111111';

function tables(type, config, joins) {
  return {
    projects: [{
      id: 'p1',
      name: 'Demo',
      ticker: 'DEMO',
      mint: 'So11111111111111111111111111111111111111112',
      admin_wallet: ADMIN,
      chain: 'solana',
      fee_paid: true,
      created_at: '2026-01-01T00:00:00.000Z',
      plan: 'starter',
      vault_address: null,
      vault_reserved: 0,
      vault_status: 'none',
    }],
    campaigns: [{
      id: 'c1',
      project_id: 'p1',
      title: type + ' review',
      type,
      rule_text: 'Show the evidence',
      reward: '10',
      reward_unit: 'DEMO',
      status: 'active',
      settled_count: 0,
      fee_paid: true,
      created_at: '2026-01-02T00:00:00.000Z',
      access_mode: 'open',
      reward_mode: 'fixed',
      config: config || {},
    }],
    campaign_joins: joins,
    project_roster: [],
    vault_settlements: [],
    platform_claims: [],
  };
}

function join(id, owner, extra) {
  return Object.assign({
    id,
    project_id: 'p1',
    campaign_id: 'c1',
    wallet: owner,
    x_handle: '@' + id,
    qualified: false,
    status: 'approved',
    progress: 1,
    note: null,
    joined_at: '2026-01-03T00:00:00.000Z',
  }, extra || {});
}

async function openAdmin(page, type, config, joins, queue) {
  await page.addInitScript((session) => {
    sessionStorage.setItem('bard_session', JSON.stringify(session));
  }, { token: 'test-token', wallet: ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 });
  await page.route('**/api/campaigns/*/queue', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(queue),
    });
  });
  await mockSupabase(page, tables(type, config, joins));
  await page.goto('/admin.html');
  await page.locator('[data-open-project]').click();
  await page.locator('[data-open-camp]').click();
  await expect(page.locator('#camp-lb tr').first()).toBeVisible({ timeout: 20000 });
}

test('a raid row opens the post and does not call it proof', async ({ page }) => {
  test.setTimeout(120000);
  const nasty = 'https://example.com/a?q="><img src=x onerror="window.__xss=1">';
  await openAdmin(page, 'raid', {}, [
    join('j-link', LINKED, { x_handle: '@linked' }),
    join('j-empty', EMPTY, { x_handle: '@empty' }),
    join('j-script', SCRIPT, { x_handle: '@script' }),
    join('j-markup', MARKUP, { x_handle: '@markup' }),
  ], {
    decimals: null,
    joins: [
      { wallet: LINKED, x_handle: '@linked', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'raid', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: 'https://example.com/post/1', referral_count: null } },
      { wallet: EMPTY, x_handle: '@empty', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'raid', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: null, referral_count: null } },
      { wallet: SCRIPT, x_handle: '@script', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'raid', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: 'javascript:alert(1)', referral_count: null } },
      { wallet: MARKUP, x_handle: '@markup', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'raid', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: nasty, referral_count: null } },
    ],
  });
  const linked = page.locator('#camp-lb tr', { hasText: '@linked' });
  await expect(linked.locator('a')).toHaveAttribute('href', 'https://example.com/post/1');
  await expect(linked.locator('a')).toHaveText('open post');
  const empty = page.locator('#camp-lb tr', { hasText: '@empty' });
  await expect(empty).toContainText('no link submitted');
  const script = page.locator('#camp-lb tr', { hasText: '@script' });
  await expect(script).toContainText('no link submitted');
  await expect(script.locator('a')).toHaveCount(0);
  const markup = page.locator('#camp-lb tr', { hasText: '@markup' });
  await expect(markup.locator('a')).toHaveCount(1);
  const href = await markup.locator('a').getAttribute('href');
  expect(href).not.toContain('<');
  expect(href).not.toContain('>');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  for (const row of [linked, empty, script, markup]) {
    const html = (await row.innerHTML()).toLowerCase();
    expect(html).not.toContain('met');
    expect(html).not.toContain('verified');
    expect(html).not.toContain('proof');
  }
  await expect(page.locator('#btn-qualify-matching')).toHaveCount(0);
});

test('the bulk button is absent for refer and custom', async ({ page }) => {
  test.setTimeout(120000);
  await openAdmin(page, 'refer', { targets: 2 }, [join('j1', HOLDER)], {
    decimals: null,
    joins: [{ wallet: HOLDER, x_handle: '@j1', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'refer', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: null, referral_count: 2 } }],
  });
  await expect(page.locator('#camp-lb')).toContainText('2 referrals');
  await expect(page.locator('#btn-qualify-matching')).toHaveCount(0);

  await page.route('**/api/campaigns/*/queue', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        decimals: null,
        joins: [{ wallet: HOLDER, x_handle: '@j1', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'custom', balance_raw: null, balance_as_of: null, min_balance_raw: null, meets_min: null, post_url: 'https://example.com/post/1', referral_count: null } }],
      }),
    });
  });
  await mockSupabase(page, tables('custom', {}, [join('j1', HOLDER)]));
  await page.goto('/admin.html');
  await page.locator('[data-open-project]').click();
  await page.locator('[data-open-camp]').click();
  await expect(page.locator('#camp-lb tr').first()).toBeVisible();
  const custom = page.locator('#camp-lb tr', { hasText: '@j1' });
  await expect(custom.locator('a')).toHaveAttribute('href', 'https://example.com/post/1');
  await expect(custom.locator('a')).toHaveText('open post');
  await expect(page.locator('#btn-qualify-matching')).toHaveCount(0);
});

test('hold evidence shows the balance and confirm sends the qualify action', async ({ page }) => {
  test.setTimeout(120000);
  let posts = 0;
  await page.addInitScript((session) => {
    sessionStorage.setItem('bard_session', JSON.stringify(session));
  }, { token: 'test-token', wallet: ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 });
  await page.route('**/api/campaigns/*/queue', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        decimals: 6,
        joins: [
          { wallet: HOLDER, x_handle: '@high', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'hold', balance_raw: '2000000', balance_as_of: '2026-10-27T15:04:00.000Z', min_balance_raw: '1000000', meets_min: true, post_url: null, referral_count: null } },
          { wallet: LOW, x_handle: '@low', status: 'approved', progress: 1, qualified: false, evidence: { kind: 'hold', balance_raw: '500000', balance_as_of: '2026-10-27T15:04:00.000Z', min_balance_raw: '1000000', meets_min: false, post_url: null, referral_count: null } },
        ],
      }),
    });
  });
  await page.route('**/api/campaigns/*/qualify-matching', async (route) => {
    posts += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ qualified: 1, skipped: 1 }),
    });
  });
  await mockSupabase(page, tables('hold', { minBalance: '1' }, [
    join('j-high', HOLDER, { x_handle: '@high' }),
    join('j-low', LOW, { x_handle: '@low' }),
  ]));
  await page.goto('/admin.html');
  await page.locator('[data-open-project]').click();
  await page.locator('[data-open-camp]').click();
  const high = page.locator('#camp-lb tr', { hasText: '@high' });
  await expect(high).toContainText('holds 2 DEMO');
  await expect(high).toContainText('27 Oct 2026 15:04 UTC');
  await expect(high).toContainText('≥ minimum');
  await expect(page.locator('#camp-lb tr', { hasText: '@low' })).toContainText('below minimum');
  await expect(high.locator('[data-js="qual"]')).toHaveText('Qualify');
  const bulk = page.locator('#btn-qualify-matching');
  await expect(bulk).toHaveText('Qualify everyone at or above 1 DEMO');
  await bulk.click();
  expect(posts).toBe(0);
  await expect(page.locator('#qualify-matching-confirm')).toContainText('Qualify 1 holder at or above 1 DEMO.');
  await page.locator('#qualify-matching-confirm button', { hasText: 'Confirm' }).click();
  await expect.poll(() => posts).toBe(1);
});

const CAMP = '22222222-2222-4222-8222-222222222222';
const WALLET = 'TestWa11et111111111111111111111111111111';

function liveState(type) {
  return {
    as_of: '2026-10-25T00:00:00.000Z',
    campaign: {
      id: CAMP,
      title: 'Public ' + type,
      type,
      rule_text: 'Show up',
      reward_mode: 'fixed',
      access_mode: 'open',
      status: 'active',
      project: { id: 'proj-local', name: 'Demo', ticker: 'DEMO' },
    },
    clock: { state: 'live', ends_at: null, no_end: true, starts_at: null },
    prize: { symbol: 'DEMO', decimals: 6, locked: false, mint: null, who_gets_paid_text: 'holders who qualify are paid' },
    vault: { address: null, balance_raw: null, explorer_url: null, below_locked: null },
    counts: { joined: 0, qualified: 0, paid: 0 },
    board: [],
    settlement: null,
    links: { page: '/c/' + CAMP, receipt: null },
  };
}

async function openCampaign(page, type) {
  await page.addInitScript(({ wallet, holder }) => {
    window.solana = {
      connect: async () => ({ publicKey: { toString: () => wallet } }),
      publicKey: { toString: () => wallet },
    };
    localStorage.setItem('bard_holder_v1', JSON.stringify(holder));
  }, { wallet: WALLET, holder: { joined: {}, claims: {}, xHandle: '@a' } });
  await page.route('**/api/campaigns/' + CAMP + '/state*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveState(type)) });
  });
  await page.goto('/c/' + CAMP);
  await expect(page.locator('#clock-line')).toHaveText('no end set', { timeout: 20000 });
}

test('the raid join form asks for a post link and keeps it as a url', async ({ page }) => {
  test.setTimeout(120000);
  await openCampaign(page, 'raid');
  await expect(page.locator('#post-link')).toBeVisible();
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-btn')).toHaveText('Join');
  await page.locator('#post-link').fill('<img src=x onerror="window.__xss=1">');
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-reason')).toHaveText('Enter a post link that starts with http:// or https://.');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const nasty = 'https://example.com/a?q="><img src=x onerror=alert(1)>';
  await page.locator('#post-link').fill(nasty);
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-reason')).toHaveText('You already joined.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bard_holder_v1')));
  const row = saved.joined['proj-local::' + CAMP];
  expect(row.evidenceUrl).toBe('https://example.com/a?q=%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E');
  expect(row.evidenceUrl).not.toContain('<');
  expect(saved.joined['proj-local::' + CAMP].referredBy).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  await openCampaign(page, 'hold');
  await expect(page.locator('#post-link')).toBeHidden();

  await openCampaign(page, 'custom');
  await expect(page.locator('#post-link')).toBeVisible();
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-btn')).toHaveText('Join');
  await page.locator('#post-link').fill('https://x.com/holder0/status/1800000000000000001');
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-reason')).toHaveText('You already joined.');
  const customSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('bard_holder_v1')));
  expect(customSaved.joined['proj-local::' + CAMP].evidenceUrl).toBe('https://x.com/holder0/status/1800000000000000001');

  await openCampaign(page, 'refer');
  await expect(page.locator('#post-link')).toBeHidden();
});
