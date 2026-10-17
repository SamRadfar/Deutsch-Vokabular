// Personal vocabulary with the real Firebase SDK (Auth + Firestore emulators, demo project) and the
// browser's real IndexedDB. Personal words are stored on the device only (cloud sync is a proposal).

import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';

const card = (page: Page, word: string) => page.locator(`article[data-personal-id][aria-label="${word}"]`);

async function openMine(page: Page) {
  await page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^واژه‌های من/ })).toBeVisible();
}

async function addWord(page: Page, lemma: string, fa: string) {
  await page.getByRole('button', { name: '+ افزودن واژه' }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  await dialog.getByLabel(/واژه یا عبارت آلمانی/).fill(lemma);
  await dialog.getByLabel(/معنی فارسی/).fill(fa);
  await dialog.getByRole('button', { name: 'افزودن واژه' }).click();
  await expect(dialog).toHaveCount(0);
}

test('create, reload, search, flashcard, delete with undo — and another account sees nothing', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('mine'), 'My Words');
  await openMine(page);
  await expect(page.getByTestId('pw-storage')).toContainText('همگام‌سازی ابری هنوز فعال نیست');
  await addWord(page, 'die Probewortigkeit', 'واژهٔ آزمایشی');
  await addWord(page, 'testen', 'آزمودن');
  await expect(card(page, 'die Probewortigkeit')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('account-button')).toBeVisible();
  await expect(card(page, 'die Probewortigkeit')).toBeVisible({ timeout: 15_000 }); // still on #/mine
  await expect(card(page, 'testen')).toBeVisible();

  // Search across built-in and personal words
  await page.getByRole('link', { name: 'واژه‌ها', exact: true }).click();
  await page.getByRole('searchbox', { name: 'جستجوی واژه' }).fill('probewortigkeit');
  await expect(page.locator('article.sres[aria-label="die Probewortigkeit"]')).toBeVisible();

  // Flashcards with only my words; "know" is stored locally (not in Firestore progress)
  await page.getByRole('link', { name: 'مرور', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'مرور با فلش‌کارت' })).toBeVisible();
  await page.getByLabel('دسته', { exact: true }).selectOption('mine');
  await page.getByRole('button', { name: 'شروع مرور (2 کارت)' }).click();
  await page.getByRole('button', { name: /بلدم/ }).click();
  await page.getByRole('button', { name: /بلدم/ }).click();
  await expect(page.getByTestId('summary-know')).toHaveText('2');
  await expect(page.getByTestId('header-progress')).toContainText('0/999');

  await openMine(page);
  await expect(card(page, 'testen').getByRole('checkbox')).toBeChecked();
  await card(page, 'testen').getByRole('button', { name: 'حذف testen' }).click();
  await page.getByRole('dialog', { name: 'حذف واژه' }).getByRole('button', { name: 'حذف' }).click();
  await expect(card(page, 'testen')).toHaveCount(0);
  await page.getByRole('button', { name: 'بازگردانی' }).click();
  await expect(card(page, 'testen')).toBeVisible();
  expect(errors).toEqual([]);

  await signOut(page);
  await signIn(page, uniqueEmail('other'), 'Other Person');
  await openMine(page);
  await expect(page.getByText('هنوز واژه‌ای اضافه نکرده‌اید')).toBeVisible();
});

test('legacy custom words are imported after a preview, once, without touching the legacy data', async ({ page }) => {
  await page.goto('./');
  const raw = JSON.stringify([
    { id: 'cw1712345678901', main: 'arch', tab: 'bau', word: 'die Probewortigkeit', sentence: '', type: 'n', fa: 'واژهٔ آزمایشی', ex: '', exFa: '', pr: '', status: 'ready', checked: true },
  ]);
  await page.evaluate((v) => localStorage.setItem('dvok5_custom', v), raw);
  await signIn(page, uniqueEmail('legacy'), 'Legacy Words');
  await openMine(page);
  await page.getByRole('button', { name: 'انتقال از نسخهٔ قدیمی' }).click();
  const dialog = page.getByRole('dialog', { name: 'انتقال واژه‌های شخصی از نسخهٔ قدیمی' });
  await expect(dialog.getByTestId('pw-import-new')).toHaveText('1');
  await dialog.getByRole('button', { name: 'انتقال 1 واژه' }).click();
  await dialog.getByRole('button', { name: 'بستن' }).click();
  await expect(card(page, 'die Probewortigkeit')).toBeVisible();
  await expect(card(page, 'die Probewortigkeit').getByRole('checkbox')).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('dvok5_custom'))).toBe(raw);

  await page.reload();
  await expect(card(page, 'die Probewortigkeit')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'انتقال از نسخهٔ قدیمی' }).click();
  await expect(page.getByRole('dialog').getByTestId('pw-import-new')).toHaveText('0');
});
