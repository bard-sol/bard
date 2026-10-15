import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/guide',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:5199',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'PORT=5199 DUEL_AI_TURN_MS=0 npm run dev',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
