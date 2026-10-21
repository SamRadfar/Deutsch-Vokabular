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
  await page.getByRole('button', { name: 'افزودن واژه' }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  await dialog.getByLabel(/واژه یا عبارت آلمانی/).fill(lemma);
  await dialog.getByRole('textbox', { name: 'معنی فارسی', exact: true }).fill(fa);
  await dialog.getByRole('button', { name: 'افزودن واژه' }).click();
  await expect(dialog).toHaveCount(0);
}

test('create, reload, search, flashcard, delete with undo — and another account sees nothing', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('mine'), 'My Words');
  await openMine(page);
  // The emulator build syncs personal words (the emulator loads v2/firestore.rules incl. customWords).
  await expect(page.getByTestId('pw-storage')).toHaveAttribute('data-mode', 'cloud');
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

test('two browsers with the same account: create, edit offline, delete — all devices converge', async ({ browser }) => {
  const email = uniqueEmail('pwsync');
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  try {
    await laptop.goto('./');
    await phone.goto('./');
    await signIn(laptop, email, 'Sync Person');
    await signIn(phone, email, 'Sync Person');
    await openMine(laptop);
    await openMine(phone);

    await addWord(laptop, 'die Wolkenwand', 'دیوار ابری');
    await expect(card(phone, 'die Wolkenwand')).toBeVisible({ timeout: 15_000 });

    // Phone goes offline, edits; the change is queued and uploaded after reconnecting.
    await phoneCtx.setOffline(true);
    await card(phone, 'die Wolkenwand').getByRole('button', { name: 'ویرایش die Wolkenwand' }).click();
    const d = phone.getByRole('dialog', { name: 'ویرایش واژه' });
    await d.getByRole('textbox', { name: 'معنی فارسی', exact: true }).fill('دیوار ابری (آفلاین)');
    await d.getByRole('button', { name: 'ذخیرهٔ تغییرات' }).click();
    await expect(card(phone, 'die Wolkenwand')).toContainText('در انتظار همگام‌سازی');
    await phoneCtx.setOffline(false);
    await expect(card(laptop, 'die Wolkenwand')).toContainText('دیوار ابری (آفلاین)', { timeout: 20_000 });

    // Deleting on the laptop removes it on the phone.
    await card(laptop, 'die Wolkenwand').getByRole('button', { name: 'حذف die Wolkenwand' }).click();
    await laptop.getByRole('dialog', { name: 'حذف واژه' }).getByRole('button', { name: 'حذف' }).click();
    await expect(card(phone, 'die Wolkenwand')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await laptopCtx.close();
    await phoneCtx.close();
  }
});
