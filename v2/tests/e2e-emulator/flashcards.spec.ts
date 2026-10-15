// Flashcard persistence with the real Firebase SDK (Auth + Firestore emulators, demo project) and
// the browser's real IndexedDB. The sign-in popup is the Auth Emulator's stand-in, not Google OAuth.

import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';

const card = (page: Page) => page.getByTestId('flashcard');
const radio = (page: Page, name: RegExp) => page.getByRole('radio', { name });
const synced = (page: Page) => expect(page.getByTestId('sync-status')).toHaveAttribute('class', /sync-pill--ok/, { timeout: 15_000 });

async function openReview(page: Page) {
  await page.getByRole('tab', { name: '🔄 مرور' }).click();
  await expect(page.getByRole('heading', { name: 'مرور با فلش‌کارت' })).toBeVisible();
}

test('review outcomes are saved: "know" syncs as learned, "don\'t know" survives a reload as review-again', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('cards'), 'Flash Cards');
  await expect(page.getByTestId('header-progress')).toContainText('0/999');

  await openReview(page);
  await radio(page, /یادنگرفته‌ها/).check({ force: true });
  await page.getByLabel('تعداد کارت در جلسه').selectOption('10');
  await page.getByRole('button', { name: 'شروع مرور (10 کارت)' }).click();

  const known = (await card(page).getAttribute('data-entry-id'))!;
  await page.getByRole('button', { name: /بلدم/ }).click();
  const unknown = (await card(page).getAttribute('data-entry-id'))!;
  await page.getByRole('button', { name: /بلد نیستم/ }).click();
  await page.getByRole('button', { name: 'پایان جلسه' }).click();
  await expect(page.getByText(/1 واژه به یادگرفته‌ها اضافه شد/)).toBeVisible();
  await expect(page.getByTestId('header-progress')).toContainText('1/999');
  await synced(page);

  // Reload: learned state comes back from Firestore, the review-again list from IndexedDB.
  await page.reload();
  await expect(page.getByTestId('account-button')).toBeVisible();
  await expect(page.getByTestId('header-progress')).toContainText('1/999', { timeout: 15_000 });
  await openReview(page);
  await expect(page.locator('.rv-stat').filter({ hasText: 'برای مرور دوباره' })).toContainText('1');
  await radio(page, /مرور دوباره/).check({ force: true });
  await page.getByRole('button', { name: 'شروع مرور (1 کارت)' }).click();
  expect(await card(page).getAttribute('data-entry-id')).toBe(unknown);
  await page.getByRole('button', { name: /بلدم/ }).click();
  await expect(page.getByTestId('header-progress')).toContainText('2/999');
  await synced(page);

  // The learned word is not offered in "unlearned" any more.
  await page.getByRole('button', { name: 'تنظیم جلسهٔ جدید' }).click();
  await radio(page, /یادگرفته‌ها/).check({ force: true });
  await page.getByRole('button', { name: 'شروع مرور (2 کارت)' }).click();
  const ids = [await card(page).getAttribute('data-entry-id')];
  await page.getByRole('button', { name: /بعدی/ }).click();
  ids.push(await card(page).getAttribute('data-entry-id'));
  expect(ids.sort()).toEqual([known, unknown].sort());
  expect(errors).toEqual([]);
});

test('another account on the same browser sees none of the previous account’s review data', async ({ page }) => {
  await page.goto('./');
  await signIn(page, uniqueEmail('first'), 'First Account');
  await openReview(page);
  await page.getByLabel('تعداد کارت در جلسه').selectOption('10');
  await page.getByRole('button', { name: 'شروع مرور (10 کارت)' }).click();
  await page.getByRole('button', { name: /بلد نیستم/ }).click();
  await page.getByRole('button', { name: /بلدم/ }).click();
  await synced(page);
  await signOut(page);

  await signIn(page, uniqueEmail('second'), 'Second Account');
  await openReview(page);
  const stats = page.locator('.rv-stats');
  await expect(stats).toContainText('0یادگرفته');
  await expect(page.locator('.rv-stat').filter({ hasText: 'برای مرور دوباره' })).toContainText('0');
  await expect(page.getByTestId('header-progress')).toContainText('0/999');
});
