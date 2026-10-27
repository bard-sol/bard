import { sha256Hex } from '../../server/settlement.js';
import { expect, test } from './guard.js';

const ID = '11111111-1111-4111-8111-111111111111';
const WALLET = 'HolderWa11et11111111111111111111111111111';
const HASH = sha256Hex(WALLET);

function receiptBody() {
  return {
    campaign: {
      id: ID,
      title: 'Hold the line',
      project: { name: 'Demo', ticker: 'DEMO' },
    },
    settlement: {
      tx_signature: '5'.repeat(88),
      explorer_url: 'https://solscan.io/tx/' + '5'.repeat(88),
      executed_at: '2026-10-25T12:00:00.000Z',
      slot: 123,
      block_time: '2023-11-14T22:13:20.000Z',
      payout_hash: 'abc',
      hash_recomputed_ok: true,
    },
    unit: 'DEMO',
    decimals: 6,
    total_raw: '600000000',
    rows: [
      {
        rank: 1,
        wallet_short: 'Hold…1111',
        wallet_hash: HASH,
        handle: 'ada',
        amount: '300',
        amount_raw: '300000000',
        is_platform_cut: false,
      },
      {
        rank: 2,
        wallet_short: 'Cuts…2222',
        wallet_hash: sha256Hex('cut-wallet'),
        handle: null,
        amount: '120',
        amount_raw: '120000000',
        is_platform_cut: true,
      },
    ],
    platform_cut: { bps: 500, amount_raw: '120000000', waived: false },
    draw: {
      slot: 1150,
      seed: 'SeedHashFromTheDraw',
      seed_slot: 1000,
      winners: ['Hold…1111'],
    },
  };
}

test('an unverified payout shows no rows', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/campaigns/' + ID + '/receipt*', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'unverified', reason: 'no_chain_signature' }),
    });
  });
  await page.goto('/c/' + ID + '/receipt');
  await expect(page.locator('#unverified')).toHaveText('This payout could not be verified on chain', { timeout: 20000 });
  await expect(page.locator('#receipt-rows tr')).toHaveCount(0);
  await expect(page.locator('#table-card')).toBeHidden();
  await expect(page.locator('input, button, textarea')).toHaveCount(0);
});

test('a verified receipt shows the frozen payout and highlights the connected holder', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript((wallet) => {
    window.solana = {
      publicKey: { toString: () => wallet },
      connect: () => {
        window.__connectCalled = true;
        return Promise.reject(new Error('connect'));
      },
    };
  }, WALLET);
  await page.route('**/api/campaigns/' + ID + '/receipt*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
      body: JSON.stringify(receiptBody()),
    });
  });
  await page.goto('/c/' + ID + '/receipt');
  await expect(page.locator('#title')).toHaveText('Hold the line', { timeout: 20000 });
  await expect(page.locator('#paid-on')).toHaveText('Paid on 25 Oct 2026');
  await expect(page.locator('#tx-link')).toHaveAttribute('href', 'https://solscan.io/tx/' + '5'.repeat(88));
  await expect(page.locator('#tx-link')).toHaveText('view on explorer');
  await expect(page.locator('#receipt-rows tr')).toHaveCount(2);
  await expect(page.locator('#receipt-rows tr').nth(0)).toContainText('ada');
  await expect(page.locator('#receipt-rows tr').nth(0)).toContainText('300 DEMO');
  await expect(page.locator('#receipt-rows tr').nth(0)).toHaveClass(/is-you/);
  await expect(page.locator('#receipt-rows tr[data-cut="1"]')).toContainText('Bard cut');
  await expect(page.locator('#receipt-rows tr[data-cut="1"]')).toContainText('120 DEMO');
  await expect(page.locator('#receipt-total')).toHaveText('Total 600 DEMO');
  await expect(page.locator('#draw-block')).toBeVisible();
  await expect(page.locator('#draw-slot')).toHaveText('Slot 1150');
  await expect(page.locator('#draw-seed')).toHaveText('Seed SeedHashFromTheDraw');
  await expect(page.locator('#draw-seed-slot')).toHaveText('Seed slot 1000');
  await expect(page.locator('#draw-winners li')).toHaveText('Hold…1111');
  await expect(page.locator('input, button, textarea')).toHaveCount(0);
  expect(await page.evaluate(() => window.__connectCalled)).toBeFalsy();
  const html = await page.content();
  expect(html.toLowerCase()).not.toContain('essay');
  expect(html.toLowerCase()).not.toContain('explanation');
});

test('the dashboard links a paid holder to the receipt', async ({ page }) => {
  test.setTimeout(120000);
  const team = {
    projects: [{
      id: 'proj-local',
      name: 'Demo',
      ticker: 'DEMO',
      mint: 'mint',
      campaigns: [{
        id: ID,
        title: 'Hold the line',
        type: 'hold',
        rule: 'Hold',
        status: 'active',
        createdAt: '2026-01-02T00:00:00.000Z',
      }],
    }],
    settlements: [{
      id: 'set-1',
      project_id: 'proj-local',
      campaign_id: ID,
      status: 'executed',
      payouts: [{ wallet: WALLET, amount: '300', amountRaw: '300000000' }],
    }],
  };
  const holder = {
    joined: {},
    claims: { ['proj-local::' + ID]: { settled: true } },
  };
  await page.addInitScript(({ savedTeam, savedHolder, wallet }) => {
    localStorage.setItem('bard_team_v1', JSON.stringify(savedTeam));
    localStorage.setItem('bard_holder_v1', JSON.stringify(savedHolder));
    localStorage.setItem('bard_holder_wallet', wallet);
  }, { savedTeam: team, savedHolder: holder, wallet: WALLET });
  await page.route('**/api/campaigns/' + ID + '/state*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ links: { receipt: '/c/' + ID + '/receipt' } }),
    });
  });
  await page.goto('/dashboard.html');
  const pill = page.locator('a.pill', { hasText: 'Paid · receipt' }).first();
  await expect(pill).toBeVisible({ timeout: 20000 });
  await expect(pill).toHaveAttribute('href', '/c/' + ID + '/receipt');
  await page.locator('#ov-list .item__title').click();
  await expect(page.locator('#detail-join-hint a')).toHaveAttribute('href', '/c/' + ID + '/receipt');
  await expect(page.locator('#detail-join-hint a')).toHaveText('receipt');
  await expect(page.locator('#detail-join')).toBeHidden();
  await page.locator('button[data-page="claims"]').click();
  const proof = page.locator('#claims-list a.pill', { hasText: 'Paid · receipt' });
  await expect(proof).toBeVisible();
  await expect(proof).toHaveAttribute('href', '/c/' + ID + '/receipt');
});

test('the paid clock line links to the receipt', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/campaigns/' + ID + '/state*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        as_of: '2026-10-25T00:00:00.000Z',
        campaign: {
          id: ID,
          title: 'Public raid',
          type: 'hold',
          rule_text: 'Show up',
          reward_mode: 'fixed',
          access_mode: 'open',
          status: 'paid',
          project: { id: 'proj-local', name: 'Demo', ticker: 'DEMO' },
        },
        clock: { state: 'paid', ends_at: null, no_end: true, starts_at: null },
        prize: { symbol: 'DEMO', decimals: 6, locked: false, mint: null, who_gets_paid_text: 'every qualified holder is paid' },
        vault: { address: null, balance_raw: null, explorer_url: null, below_locked: null },
        counts: { joined: 0, qualified: 0, paid: 1 },
        board: [],
        settlement: null,
        links: { page: '/c/' + ID, receipt: '/c/' + ID + '/receipt' },
      }),
    });
  });
  await page.goto('/c/' + ID);
  const clock = page.locator('#clock-line');
  await expect(clock).toContainText('paid', { timeout: 20000 });
  await expect(clock.locator('a')).toHaveText('receipt');
  await expect(clock.locator('a')).toHaveAttribute('href', '/c/' + ID + '/receipt');
});
