// Account categories end to end with the real Firebase SDK (Auth + Firestore emulators): create a
// main category in «مدیریت دسته‌بندی‌ها», add a word into a new subcategory with the shared picker,
// reload, then see the same tabs and word on a second device — and nothing in another account.

import { expect, test, type Page } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';

const openMine = (page: Page) => page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();
const openWords = (page: Page) => page.getByRole('link', { name: 'واژه‌ها', exact: true }).click();

async function expectInBrowser(page: Page) {
  await openWords(page);
  await page.getByRole('tab', { name: 'Reisen' }).click({ timeout: 30_000 });
  await page.getByRole('tab', { name: /Gepäck/ }).click();
  await expect(page.getByText('der Rucksack').first()).toBeVisible();
}

test('categories: create, assign, reload, second device, private to the account', async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('cat');
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  try {
    const errors = trackErrors(laptop);
    await installSpeechMock(laptop);
    await laptop.goto('./');
    await signIn(laptop, email, 'Kategorien');
    await openMine(laptop);

    // «مدیریت دسته‌بندی‌ها»: a new main category.
    await laptop.getByTestId('open-categories').click();
    const manager = laptop.getByRole('dialog', { name: 'مدیریت دسته‌بندی‌ها' });
    await manager.getByLabel('دسته اصلی جدید').fill('Reisen');
    await manager.getByRole('button', { name: 'ساخت دسته' }).click();
    await expect(manager.getByTestId('catm-notice')).toContainText('Reisen');
    await expect(manager.getByText('دسته‌ها با حساب شما همگام می‌شوند.')).toBeVisible();
    await manager.getByRole('button', { name: 'بستن پنجره' }).click();

    // A word into a NEW subcategory of that main category.
    await laptop.getByRole('button', { name: 'افزودن واژه' }).first().click();
    const form = laptop.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
    await form.getByLabel(/واژه یا عبارت آلمانی/).fill('der Rucksack');
    await form.getByRole('textbox', { name: 'معنی فارسی', exact: true }).fill('کوله‌پشتی');
    await form.getByRole('radio', { name: 'ساخت زیرمجموعه در دسته موجود' }).check();
    await form.getByLabel('در دسته اصلی').selectOption({ label: 'Reisen' });
    await form.getByLabel('نام زیرمجموعهٔ جدید').fill('Gepäck');
    await form.getByRole('button', { name: 'افزودن واژه' }).click();
    await expect(laptop.locator('article[data-personal-id]')).toContainText('Reisen › Gepäck');
    await expectInBrowser(laptop);

    // Reload: still there.
    await laptop.reload();
    await expectInBrowser(laptop);

    // Shadowing: main chip → subcategory row → a session with exactly the matching word.
    await laptop.getByRole('link', { name: 'تلفظ', exact: true }).click();
    await laptop.locator('label.sh-chip').filter({ hasText: 'Reisen' }).locator('input').check();
    const subs = laptop.getByTestId('sh-subs');
    await expect(subs.getByRole('radio', { name: /همه زیرمجموعه‌ها/ })).toBeChecked();
    await subs.locator('label').filter({ hasText: 'Gepäck' }).locator('input').check();
    await expect(subs.locator('label').filter({ hasText: 'Gepäck' }).locator('.sh-chip__n')).toHaveText('1');
    expect(await laptop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // no sideways page scroll
    await laptop.getByRole('button', { name: 'شروع تمرین (1 واژه)' }).click();
    await expect(laptop.getByTestId('sh-stage')).toContainText('der Rucksack');
    expect(errors).toEqual([]);

    // Second device of the same account.
    await phone.goto('./');
    await signIn(phone, email, 'Kategorien');
    await expectInBrowser(phone);

    // Another account sees neither the category nor the word.
    await signOut(phone);
    await signIn(phone, uniqueEmail('cat-other'), 'Andere');
    await openWords(phone);
    await expect(phone.getByRole('tab', { name: 'Reisen' })).toHaveCount(0);
  } finally {
    await laptopCtx.close();
    await phoneCtx.close();
  }
});
