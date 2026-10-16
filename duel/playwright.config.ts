import { defineConfig } from '@playwright/test';

const live = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests/guide',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: live ?? 'http://127.0.0.1:5199',
  },
  projects: [
    { name: 'desktop', testIgnore: /touch\.spec\.ts|friend\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', testIgnore: /touch\.spec\.ts|friend\.spec\.ts/, use: { viewport: { width: 390, height: 844 } } },
    {
      name: 'paced',
      testIgnore: /touch\.spec\.ts|friend\.spec\.ts/,
      timeout: 180_000,
      use: { viewport: { width: 1440, height: 900 }, baseURL: live ?? 'http://127.0.0.1:5200' },
    },
    {
      name: 'friend',
      testMatch: /friend\.spec\.ts/,
      timeout: 180_000,
      use: { viewport: { width: 1440, height: 900 }, baseURL: live ?? 'http://127.0.0.1:5201' },
    },
    {
      name: 'touch',
      testMatch: /touch\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        baseURL: live ?? 'http://127.0.0.1:5199',
      },
    },
  ],
  webServer: live
    ? undefined
    : [
        {
          command: 'PORT=5199 DUEL_AI_TURN_MS=0 PASSCODE= npm run dev',
          url: 'http://127.0.0.1:5199',
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: 'PORT=5200 DUEL_AI_TURN_MS=5000 PASSCODE= npm run dev',
          url: 'http://127.0.0.1:5200',
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: 'PORT=5201 PASSCODE=bard-friend-test DUEL_AI_TURN_MS=0 DUEL_FRIEND_TURN_MS=4000 npm run dev',
          url: 'http://127.0.0.1:5201',
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
