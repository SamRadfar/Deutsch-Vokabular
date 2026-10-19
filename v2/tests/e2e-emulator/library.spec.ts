// Account-owned vocabulary in the real browser (Auth + Firestore emulators): signed-out welcome,
// owner vs. other account, reload and an unreachable server (device copy in IndexedDB).

import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';

const VOCAB = ['die Außenwand', 'دیوار خارجی'];
async function expectNoVocabulary(page: Page) {
  const text = await page.locator('body').innerText();
  for (const t of VOCAB) expect(text).not.toContain(t);
  await expect(page.locator('[data-entry-id]')).toHaveCount(0);
}

test('signed out: welcome screen only — no vocabulary, no navigation', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'بخش‌های اصلی' })).toHaveCount(0);
  await expectNoVocabulary(page);
  for (const hash of ['#/mine', '#/review', '#/shadowing', '#/progress']) {
    await page.goto(`./${hash}`);
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expectNoVocabulary(page);
  }
  expect(errors).toEqual([]);
});

test('another account has an empty library; the owner sees all words; reload keeps them', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('other'), 'Other User', { library: false });
  await expect(page.getByTestId('empty-library')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Kategorien' })).toHaveCount(0);
  await expectNoVocabulary(page);
  await signOut(page);
  await expect(page.getByTestId('welcome')).toBeVisible();

  await signIn(page, uniqueEmail('owner'), 'Library Owner');
  await expect(page.getByRole('tablist', { name: 'Kategorien' }).getByRole('tab')).toHaveCount(7);
  await expect(page.getByTestId('header-progress')).toContainText('0/999');
  await page.reload();
  await expect(page.getByTestId('header-progress')).toContainText('/999', { timeout: 15_000 });
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('server unreachable after the first load: the verified device copy is used', async ({ page }) => {
  await page.goto('./');
  await signIn(page, uniqueEmail('owner-offline'), 'Offline Owner');
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  // Firestore (emulator) blocked: the library comes from IndexedDB.
  await page.route(/:8080\//, (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Kategorien' }).getByRole('tab')).toHaveCount(7, { timeout: 15_000 });
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
});
