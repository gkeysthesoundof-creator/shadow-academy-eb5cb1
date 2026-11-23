import type { Page } from '@playwright/test';
export const FOUNDER = { email: process.env.E2E_FOUNDER_EMAIL ?? 'founder@local.test', password: process.env.E2E_FOUNDER_PASSWORD ?? 'local-dev-founder-pass' };
export const CUSTOMER = { email: 'e2e-customer@local.test', password: 'e2e-customer-password' };
export async function login(page: Page, who = FOUNDER, path = '/') {
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await page.fill('input[name=email]', who.email);
  await page.fill('input[name=password]', who.password);
  await page.click('button:has-text("Enter HQ")');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
