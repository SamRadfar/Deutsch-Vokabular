// "My words" in the production build without Firebase (browse-only): the section explains that
// personal words need an account; the signed-in workflow runs in tests/e2e-emulator/personal.spec.ts.

import { expect, test } from '@playwright/test';

test('my words: signed out shows a clear explanation and fits the viewport', async ({ page }) => {
  await page.goto('./#/mine');
  await expect(page.getByRole('heading', { name: 'واژه‌های من' })).toBeVisible();
  await expect(page.getByText('برای ساختن فهرست واژه‌های خودتان وارد حساب شوید')).toBeVisible();
  await expect(page.getByRole('button', { name: 'افزودن واژه' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'بخش‌های اصلی' }).getByRole('link', { name: 'واژه‌های من' })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
