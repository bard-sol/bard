import { test, expect, mockSupabase } from './guard.js';

test('four pages load with the real local scripts and no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon\.ico/i.test(text)) return;
    errors.push('console: ' + text);
  });
  await mockSupabase(page, {});

  const ready = [
    ['/', 'body'],
    ['/admin.html', '#project-list'],
    ['/dashboard.html', '#btn-connect'],
    ['/explore.html', '#list'],
  ];
  for (const [path, sel] of ready) {
    errors.length = 0;
    await page.goto(path);
    await expect(page.locator(sel).first()).toBeVisible();
    await expect(page.locator('#bard-local-banner')).toHaveCount(0);
    if (path === '/admin.html') {
      await page.waitForFunction(() => window.solanaWeb3 && typeof window.solanaWeb3.Connection === 'function');
      await expect(page.locator('#project-list')).toContainText('No projects yet');
      const srcs = await page.locator('script[src]').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
      expect(srcs.some((src) => /bundle\.run|unpkg\.com|jsdelivr/.test(src || ''))).toBe(false);
      expect(srcs).toContain('/vendor/solana-web3/index.iife.min.js');
      await page.waitForFunction(() => !!document.querySelector('script[src="/vendor/supabase/supabase.js"]'));
    }
    if (path === '/explore.html') {
      await expect(page.locator('#list')).toContainText('No live campaigns');
    }
    await page.waitForTimeout(400);
    expect(errors, path + '\n' + errors.join('\n')).toEqual([]);
  }
});
