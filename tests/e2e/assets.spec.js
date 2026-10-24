import { test, expect } from '@playwright/test';

test('dev files and private paths 404 while the site stays public', async ({ request }) => {
  const blocked = [
    '/index_preview.html',
    '/.github/workflows/x.yml',
    '/package.json',
    '/tests/',
    '/tests/e2e/xss.spec.js',
    '/node_modules/',
    '/node_modules/wrangler/package.json',
  ];
  for (const path of blocked) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
  for (const path of ['/', '/admin.html', '/dashboard.html', '/explore.html', '/platform.js']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
});
