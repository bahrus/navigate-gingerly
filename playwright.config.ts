import { defineConfig, devices } from '@playwright/test';

/**
 * The core is pure (no DOM, no fetch), so its tests run in Node, once. mirror's run in each browser, against a
 * stand-in app server and worker (Playwright's request routing), so no server is needed.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'node', testMatch: 'core.spec.ts' },
    { name: 'chromium', testMatch: 'mirror.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: 'mirror.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: 'mirror.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
});
