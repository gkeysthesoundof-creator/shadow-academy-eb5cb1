import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100', trace: 'off' },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run start', url: 'http://localhost:3100/api/health', reuseExistingServer: true, timeout: 120_000,
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },     // iPhone 13 viewport/touch/DPR; WebKit not installed in CI container
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } }, testMatch: /screenshots\.spec\.ts/ },
  ],
});
