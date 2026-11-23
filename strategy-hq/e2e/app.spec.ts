import { test, expect } from '@playwright/test';
import { login, FOUNDER, CUSTOMER } from './helpers';

test.describe('access', () => {
  test('email deep links survive login', async ({ page }) => {
    await page.goto('/scouts/cash?f=verified');
    await expect(page).toHaveURL(/\/login\?next=%2Fscouts%2Fcash%3Ff%3Dverified/);
    await page.fill('input[name=email]', FOUNDER.email);
    await page.fill('input[name=password]', FOUNDER.password);
    await page.click('button:has-text("Enter HQ")');
    await expect(page).toHaveURL(/\/scouts\/cash\?f=verified/);
  });
  test('bad credentials are refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]', FOUNDER.email);
    await page.fill('input[name=password]', 'definitely-wrong-pass');
    await page.click('button:has-text("Enter HQ")');
    await expect(page.locator('form [role=alert]')).toContainText('did not match');
  });
  test('there is no public sign-up', async ({ page }) => {
    const r = await page.goto('/signup');
    expect(r?.status()).toBe(404);
  });
  test('a customer cannot open the admin console', async ({ page }) => {
    await login(page, CUSTOMER, '/admin');
    await expect(page).not.toHaveURL(/\/admin/);
  });
  test('open-redirect attempts are neutralised', async ({ page }) => {
    await login(page, FOUNDER, '//evil.example.com');
    expect(new URL(page.url()).host).toBe('localhost:3100');
  });
});

test.describe('scouts', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('Scout Center lists all ten scouts with honest states (never "running")', async ({ page }) => {
    await page.goto('/scouts');
    for (const n of ['Vehicle Hunter', 'Weapons Scout', 'Cash Trail Scout', 'Secrets & Collectibles', 'Mission & Tactics Coach', 'Cartographer & Visual', 'Rockstar Free Rewards', 'Community Discovery', 'Verification & Corrections', 'Morning Brief & Ops']) {
      await expect(page.getByRole('heading', { name: new RegExp(n) })).toBeVisible();
    }
    const pills = await page.locator('.pill').allInnerTexts();
    expect(pills.join(' | ')).not.toMatch(/RUNNING|LIVE/i);
    expect(pills.filter((p) => /CONNECTED|PARTIAL|STALE|NOT CONFIGURED|PREVIEW|FAILING/.test(p)).length).toBeGreaterThanOrEqual(10);
  });

  for (const [slug, name] of [['vehicles', 'Vehicle Hunter'], ['weapons', 'Weapons Scout'], ['cash', 'Cash Trail Scout']] as const) {
    test(`${name} workbench: filters, state and honest empty state`, async ({ page }) => {
      await page.goto(`/scouts/${slug}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await expect(page.getByText('Chapter 1 available')).toBeVisible();
      await page.getByRole('link', { name: 'Verified', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/scouts/${slug}\\?f=verified`));
      await expect(page.getByText(/No matching|No .* intel yet/)).toBeVisible();
    });
  }

  test('Cash Trail separates world money from income activities and never guesses rates', async ({ page }) => {
    await page.goto('/scouts/cash');
    await expect(page.getByRole('link', { name: /Lying in the world/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Income activities/ })).toBeVisible();
    await expect(page.getByText(/only when both payout AND time are evidenced/)).toBeVisible();
  });

  test('Rewards radar: the expired purchase promo is never "free today"', async ({ page }) => {
    await page.goto('/scouts/rewards?r=free_today');
    await expect(page.getByText('Vintage Vice City Pack')).toHaveCount(0);
    await page.goto('/scouts/rewards?r=expired');
    await expect(page.getByText(/Vintage Vice City Pack/).first()).toBeVisible();
  });

  test('finding detail shows unknowns explicitly and evidence links out', async ({ page }) => {
    await page.goto('/intel');
    await page.getByRole('link', { name: /Official printable Leonida map/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Evidence + last checked' })).toBeVisible();
    await expect(page.getByText('NOT VERIFIED').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Rockstar Newswire/ }).first()).toHaveAttribute('rel', /noopener/);
    await page.getByRole('button', { name: 'Save to hunt list' }).click();
    await expect(page.getByRole('button', { name: /On hunt list/ })).toBeVisible();
    await page.getByRole('button', { name: /On hunt list/ }).click();
  });
});

test.describe('phone usability', () => {
  test('no horizontal scroll and 44px nav targets at 390px', async ({ page }) => {
    await login(page);
    for (const p of ['/', '/scouts', '/scouts/vehicles', '/map', '/intel', '/playbook', '/assist', '/brief', '/settings', '/sources', '/admin']) {
      await page.goto(p);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, p).toBeLessThanOrEqual(1);
    }
    const sizes = await page.locator('nav.nav a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
  });

  test('offline: cached playbook opens; live areas say they need a connection', async ({ page, context }) => {
    await login(page, FOUNDER, '/playbook');
    await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
    await page.reload();                                   // second load is served/cached through the worker
    await page.waitForTimeout(800);
    await context.setOffline(true);
    await page.goto('/playbook');
    await expect(page.getByText(/playbook/i).first()).toBeVisible();
    await page.goto('/scouts').catch(() => {});
    await expect(page.getByText(/Offline/i).first()).toBeVisible();
    await context.setOffline(false);
  });
});
