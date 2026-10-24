import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    headless: true,
  },
  webServer: {
    command: 'npx wrangler dev --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787/',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      CI: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
  },
});
