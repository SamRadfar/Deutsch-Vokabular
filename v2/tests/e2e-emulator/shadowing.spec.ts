// Shadowing history with the real Firebase SDK (Auth + Firestore emulators, demo project) and the
// browser's real IndexedDB; speech is the deterministic mock (no real voices in headless browsers).

import { expect, test, type Page } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';

const stat = (page: Page, label: string) => page.locator('.rv-stat').filter({ hasText: label }).locator('.rv-stat__n');

async function openShadowing(page: Page) {
  await page.getByRole('tab', { name: '🗣 تلفظ' }).click();
  await expect(page.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' })).toBeVisible();
}

async function practiseFive(page: Page) {
  await page.getByLabel('تعداد واژه در جلسه').selectOption('5');
  await page.getByLabel('تکرار هر واژه').selectOption('1');
  await page.getByLabel('تکرار جملهٔ مثال').selectOption('0');
  await page.getByRole('slider').fill('1');
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await expect(page.getByRole('heading', { name: 'دور تمرین تمام شد!' })).toBeVisible({ timeout: 30_000 });
}

test('practice history is saved per account on this device and survives a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await installSpeechMock(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('shadow'), 'Shadow Practice');
  await openShadowing(page);
  await expect(stat(page, 'جلسهٔ کامل')).toHaveText('0');
  // Learned-state modes are available for a signed-in user.
  await expect(page.getByRole('radio', { name: /یادنگرفته‌ها/ })).toBeEnabled();

  await practiseFive(page);
  await expect(page.getByText('سابقهٔ تمرین روی همین دستگاه ذخیره شد')).toBeVisible();
  await page.getByRole('button', { name: 'تنظیمات تمرین' }).click();
  await expect(stat(page, 'جلسهٔ کامل')).toHaveText('1');
  await expect(stat(page, 'واژهٔ تمرین‌شده')).toHaveText('5');

  await page.reload();
  await expect(page.getByTestId('account-button')).toBeVisible();
  await openShadowing(page);
  await expect(stat(page, 'جلسهٔ کامل')).toHaveText('1', { timeout: 15_000 });
  await expect(stat(page, 'واژهٔ تمرین‌شده')).toHaveText('5');
  // Shadowing does not change learning progress.
  await expect(page.getByTestId('header-progress')).toContainText('0/999');
  expect(errors).toEqual([]);

  // Another account on the same browser starts with an empty history.
  await signOut(page);
  await signIn(page, uniqueEmail('other'), 'Other Account');
  await openShadowing(page);
  await expect(stat(page, 'جلسهٔ کامل')).toHaveText('0');
  await expect(stat(page, 'واژهٔ تمرین‌شده')).toHaveText('0');
});
