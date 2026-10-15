// Browser tests with the real Firebase SDK against the Auth + Firestore Emulators.
// The sign-in popup is the Auth Emulator's stand-in — NOT real Google OAuth.

import { expect, test, type Page } from '@playwright/test';
import vocabulary from '../../src/data/vocabulary/vocabulary.v1.json' with { type: 'json' };

const first = vocabulary.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
const second = vocabulary.categories[0]!.subtabs[0]!.groups[0]!.entries[1]!;
const checkbox = (page: Page, word: string) => page.getByRole('checkbox', { name: `یادگرفتم: ${word}` });
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|Failed to load resource|ERR_ABORTED/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** Sign in through the Auth Emulator popup (creates the account on first use). */
async function signIn(page: Page, email: string, name: string) {
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'ورود با گوگل' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const closed = popup.waitForEvent('close'); // attach before clicking: the popup may close at once
  const existing = popup.getByText(email, { exact: false });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await popup.getByText('Add new account').click();
    await popup.locator('#email-input').fill(email);
    await popup.locator('#display-name-input').fill(name);
    await popup.locator('#sign-in').click();
  }
  await closed;
  await expect(page.getByTestId('account-button')).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByTestId('account-button').click();
  await page.getByRole('menuitem', { name: 'خروج از حساب' }).click();
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeVisible();
}

test('signed out: browsing works and no progress checkboxes are offered', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeVisible();
  await expect(page.locator(`[data-entry-id="${first.id}"]`)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('sign in, mark learned, persist across reload, sign out', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('alice'), 'Alice Emulator');
  await expect(checkbox(page, first.word)).toBeVisible();
  await expect(page.getByTestId('header-progress')).toContainText(`0/999`);

  await checkbox(page, first.word).check();
  await expect(checkbox(page, first.word)).toBeChecked();
  await expect(page.getByTestId('header-progress')).toContainText(`1/999`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('class', /sync-pill--ok/, { timeout: 15_000 });

  await page.reload();
  await expect(page.getByTestId('account-button')).toBeVisible(); // session restored
  await expect(checkbox(page, first.word)).toBeChecked({ timeout: 15_000 });

  await checkbox(page, first.word).uncheck();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('class', /sync-pill--ok/, { timeout: 15_000 });
  await signOut(page);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('two devices with the same account see each other’s changes live', async ({ browser }) => {
  const email = uniqueEmail('twodev');
  const laptop = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext()).newPage();
  await laptop.goto('./');
  await phone.goto('./');
  await signIn(laptop, email, 'Two Devices');
  await signIn(phone, email, 'Two Devices');

  await checkbox(laptop, first.word).check();
  await checkbox(laptop, second.word).check();
  await expect(checkbox(phone, first.word)).toBeChecked({ timeout: 15_000 });
  await expect(checkbox(phone, second.word)).toBeChecked({ timeout: 15_000 });

  await checkbox(phone, first.word).uncheck();
  await expect(checkbox(laptop, first.word)).not.toBeChecked({ timeout: 15_000 });
  await expect(laptop.getByTestId('header-progress')).toContainText('1/999');
});

test('switching accounts never shows the previous account’s progress', async ({ page }) => {
  await page.goto('./');
  const aliceEmail = uniqueEmail('switch-a');
  await signIn(page, aliceEmail, 'Switch A');
  await checkbox(page, first.word).check();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('class', /sync-pill--ok/, { timeout: 15_000 });
  await signOut(page);

  await signIn(page, uniqueEmail('switch-b'), 'Switch B');
  await expect(checkbox(page, first.word)).toBeVisible();
  await expect(checkbox(page, first.word)).not.toBeChecked();
  await expect(page.getByTestId('header-progress')).toContainText('0/999');
  await signOut(page);

  await signIn(page, aliceEmail, 'Switch A');
  await expect(checkbox(page, first.word)).toBeChecked({ timeout: 15_000 });
});

test('closing the sign-in popup shows a Persian cancellation message', async ({ page }) => {
  await page.goto('./');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'ورود با گوگل' }).click();
  const popup = await popupPromise;
  await popup.close();
  await expect(page.getByText('ورود لغو شد.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeEnabled();
});

test('dark theme: checkboxes and account menu remain usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await signIn(page, uniqueEmail('dark'), 'Dark Theme');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await checkbox(page, first.word).check();
  const bg = await checkbox(page, first.word).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await page.getByTestId('account-button').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('mobile layout: cards carry the checkbox and nothing overflows', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await page.goto('./');
  await signIn(page, uniqueEmail('mobile'), 'Mobile User');
  const box = checkbox(page, first.word);
  await expect(box).toBeVisible();
  await box.check();
  await expect(box).toBeChecked();
  expect(await box.evaluate((el) => !!el.closest('article.vcard'))).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
