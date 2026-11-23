import { test } from '@playwright/test';
import { login } from './helpers';
import path from 'node:path';

/** Real screenshots of the built app for the hand-off (not concept art). */
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PAGES: [string, string][] = [
  ['home', '/'], ['scout-center', '/scouts'], ['vehicle-hunter', '/scouts/vehicles'], ['weapons-scout', '/scouts/weapons'],
  ['cash-trail', '/scouts/cash'], ['rewards-radar', '/scouts/rewards'], ['intel', '/intel'], ['map-room', '/map'],
  ['playbook', '/playbook'], ['coach', '/assist'], ['brief-archive', '/brief'], ['source-monitor', '/sources'],
  ['settings', '/settings'], ['admin', '/admin'], ['admin-review', '/admin/review'],
];

test('capture', async ({ page }, info) => {
  test.setTimeout(180_000);
  const prefix = info.project.name;
  await page.goto('/login');
  await page.screenshot({ path: path.join(OUT, `${prefix}-login.jpg`), type: 'jpeg', quality: 70 });
  await login(page);
  const list = prefix === 'desktop' ? PAGES.filter(([n]) => ['home', 'scout-center', 'cash-trail', 'admin'].includes(n)) : PAGES;
  for (const [name, p] of list) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    // Full-page capture: park the fixed bottom nav at the end of the document so it doesn't float mid-image.
    await page.addStyleTag({ content: '.nav{position:relative!important;left:auto!important;bottom:auto!important;transform:none!important;margin:0 auto 18px!important}' });
    await page.screenshot({ path: path.join(OUT, `${prefix}-${name}.jpg`), type: 'jpeg', quality: 70, fullPage: true });
  }
  // Detail page via a real link
  await page.goto('/intel');
  await page.getByRole('link', { name: /Official printable Leonida map/ }).first().click();
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: '.nav{position:relative!important;left:auto!important;bottom:auto!important;transform:none!important;margin:0 auto 18px!important}' });
  await page.screenshot({ path: path.join(OUT, `${prefix}-finding-detail.jpg`), type: 'jpeg', quality: 70, fullPage: true });
});
