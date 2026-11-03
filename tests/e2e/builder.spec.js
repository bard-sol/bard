import { test, expect, mockSupabase } from './guard.js';

const ADMIN = 'AdminWa11et11111111111111111111111111111';

function tables() {
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
      plan: 'free',
      vault_address: null,
      vault_reserved: 0,
      vault_status: 'none',
    }],
    campaigns: [],
    campaign_joins: [],
    project_roster: [],
    vault_settlements: [],
    platform_claims: [],
  };
}

async function signIn(page, data) {
  await page.addInitScript((session) => {
    sessionStorage.setItem('bard_session', JSON.stringify(session));
  }, { token: 'test-token', wallet: ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 });
  await mockSupabase(page, data);
}

async function openProject(page) {
  await page.goto('/admin.html');
  await page.locator('[data-open-project]').click();
  await expect(page.locator('#btn-new-campaign')).toBeVisible({ timeout: 20000 });
}

async function openBuilder(page) {
  await openProject(page);
  await page.locator('#btn-new-campaign').click();
  await expect(page.locator('#c-title')).toBeVisible();
}

test('the builder offers hold, refer and custom only, with no X-posting controls', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await signIn(page, tables());
  await openBuilder(page);

  const types = await page.locator('#c-type option').evaluateAll((opts) => opts.map((o) => o.value));
  expect(types).toEqual(['hold', 'refer', 'custom']);
  for (const id of ['mod-raid', 'mod-post-url', 'mod-targets', 'c-raid-mode', 'c-post-url', 'c-targets', 'c-bonus']) {
    await expect(page.locator('#' + id), id).toHaveCount(0);
  }
  await expect(page.locator('[data-raid]')).toHaveCount(0);

  const builder = await page.locator('#form-campaign').textContent();
  expect(builder).not.toMatch(/raid|kol|bonus handle|smash/i);
  expect(builder).not.toContain('SOL');
  expect(builder).not.toMatch(/Starter can run this/i);

  const units = await page.locator('#c-unit option').evaluateAll((opts) => opts.map((o) => o.value));
  expect(units).toEqual(['TOKEN']);
  expect(await page.locator('#p-plan').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('only a hold campaign tells the owner the team decides who qualifies', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await signIn(page, tables());
  await openBuilder(page);

  await expect(page.locator('#c-type')).toHaveValue('hold');
  await expect(page.locator('#hold-team-hint')).toBeVisible();
  await expect(page.locator('#hold-team-hint')).toContainText('decides who qualifies');
  await expect(page.locator('#hold-team-hint')).toContainText('Bard does not do it for you');
  await expect(page.locator('#rule-qualify-hint')).toBeVisible();
  await expect(page.locator('#rule-qualify-hint')).toContainText('The team checks balances and decides who qualifies.');

  for (const type of ['refer', 'custom']) {
    await page.locator('#c-type').selectOption(type);
    await expect(page.locator('#hold-team-hint'), type).toBeHidden();
    await expect(page.locator('#rule-qualify-hint'), type).toBeHidden();
  }
  await page.locator('#c-type').selectOption('hold');
  await expect(page.locator('#hold-team-hint')).toBeVisible();

  for (const reward of ['top3', 'pool', 'growing', 'fixed']) await page.locator('[data-reward="' + reward + '"]').click();
  for (const access of ['approval', 'open']) await page.locator('[data-access="' + access + '"]').click();
  expect(errors).toEqual([]);
});

test('hold, refer and custom campaigns are sent with no X-posting fields', async ({ page }) => {
  test.setTimeout(180000);
  const data = tables();
  await signIn(page, data);
  const sent = [];
  await page.route('**/api/campaigns', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const row = {
      id: 'c-' + sent.length,
      project_id: body.projectId,
      title: body.title,
      type: body.type,
      rule_text: body.rule,
      reward: body.reward,
      reward_unit: 'TOKEN',
      status: 'active',
      settled_count: 0,
      fee_paid: true,
      created_at: '2026-01-02T00:00:00.000Z',
      access_mode: 'open',
      reward_mode: body.rewardMode,
      config: body.config,
    };
    data.campaigns.push(row);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaign: row }) });
  });

  for (const type of ['hold', 'refer', 'custom']) {
    await openBuilder(page);
    await page.locator('#c-title').fill('Week of ' + type);
    await page.locator('#c-type').selectOption(type);
    await page.locator('#c-rule').fill('Rule for ' + type);
    await page.locator('#c-reward').fill('1');
    await page.locator('#c-holder-count').fill('10');
    await page.locator('#btn-submit-campaign').click();
    await expect.poll(() => sent.length, { timeout: 20000 }).toBe(['hold', 'refer', 'custom'].indexOf(type) + 1);
  }

  expect(sent.map((b) => b.type)).toEqual(['hold', 'refer', 'custom']);
  for (const body of sent) {
    expect(body.unit).toBe('TOKEN');
    expect(body.raidMode).toBeNull();
    expect(body.postUrl).toBeNull();
    expect(body.targets).toBeNull();
    expect(body.bonusHandle).toBeNull();
    expect(body.config.targetList).toBeUndefined();
  }
  expect(Object.prototype.hasOwnProperty.call(sent[0], 'plan')).toBe(false);
});

test('the browser refuses a raid campaign and sends nothing', async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, tables());
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/campaigns$/.test(req.url())) posts.push(req.url());
  });
  await openProject(page);
  const outcome = await page.evaluate(async () => {
    const results = {};
    for (const type of ['raid', 'post', 'reply', 'social']) {
      try {
        await BardPlatform.createCampaign('p1', { type, title: 'x', rule: 'y' });
        results[type] = 'sent';
      } catch (err) {
        results[type] = err.message;
      }
    }
    return results;
  });
  expect(outcome).toEqual({
    raid: 'That campaign type is not offered.',
    post: 'That campaign type is not offered.',
    reply: 'That campaign type is not offered.',
    social: 'That campaign type is not offered.',
  });
  expect(posts).toEqual([]);
});

test('the vault panel says Bard signs by a manual check for now', async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, tables());
  await openProject(page);
  await page.locator('[data-tab="vault"]').click();
  const panel = page.locator('#proj-vault');
  await expect(panel).toContainText('For now Bard’s signature is a manual check by a person, not an automatic one.', { timeout: 20000 });
  await expect(panel).not.toContainText('You sign. Bard signs.');
});

test('the home page uses true wording for setup and the prize', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('h2', { hasText: 'Set up in a few steps' })).toBeVisible({ timeout: 20000 });
  const text = await page.locator('body').textContent();
  expect(text).toContain('The prize is locked before holders join.');
  expect(text).not.toMatch(/in minutes/i);
  expect(text).not.toMatch(/no complicated setup/i);
});

test('the dashboard says linking X is optional and has no vested option', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/dashboard.html');
  await expect(page.locator('body')).toContainText('Linking X is optional.', { timeout: 20000 });
  const text = await page.locator('body').textContent();
  expect(text).toContain('Hold, refer, and custom campaigns work with your wallet alone.');
  expect(text).not.toMatch(/vested/i);
});
