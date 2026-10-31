import { defineConfig } from '@playwright/test';

/**
 * The core is pure (no DOM, no fetch), so its tests run in Node, once. Browser projects (and a web server)
 * come with the page side (mirror). See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [{ name: 'node' }],
});
