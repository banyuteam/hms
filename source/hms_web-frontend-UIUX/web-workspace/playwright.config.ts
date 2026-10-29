import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome (`channel: 'chrome'`) so no browser download is needed;
// in CI install Chromium instead (`playwright install chromium`) and drop `channel`.
export default defineConfig({
  testDir: './e2e',
  // Real Chrome per test: allow for a busy developer machine; CI can raise workers.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: process.env.CI ? undefined : 2,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    locale: 'en-US',
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx --no-install vite build --mode e2e && npx --no-install vite preview --mode e2e',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
