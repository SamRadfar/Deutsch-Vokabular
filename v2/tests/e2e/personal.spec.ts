// "My words" without an account: only the welcome screen (the signed-in workflow runs in
// tests/e2e-emulator/personal.spec.ts).

import { expect, test } from './fixtures';

test.use({ owner: false });

test('my words: signed out shows the welcome screen and fits the viewport', async ({ page }) => {
  await page.goto('./#/mine');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'افزودن واژه' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'بخش‌های اصلی' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
