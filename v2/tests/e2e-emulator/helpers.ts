// Shared helpers for the emulator browser tests. The sign-in popup is the Auth Emulator's
// stand-in — NOT real Google OAuth.

import { expect, type Page } from '@playwright/test';

export const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/**
 * WebKit reports Firestore's long-lived Listen/Write channels as "… due to access control checks"
 * when a navigation (reload / sign-out redirect) aborts them. Measured: these appear only at the
 * moment of navigation, never during use or idle, and state is correct afterwards
 * (docs/FIREBASE_VALIDATION.md §5). Exactly this message is tolerated; anything else fails.
 */
export const WEBKIT_ABORTED_CHANNEL = /\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/;

export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => { if (!WEBKIT_ABORTED_CHANNEL.test(e.message)) errors.push(`pageerror: ${e.message}`); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|Failed to load resource|ERR_ABORTED/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** Sign in through the Auth Emulator popup (creates the account on first use). */
export async function signIn(page: Page, email: string, name: string) {
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

export async function signOut(page: Page) {
  await page.getByTestId('account-button').click();
  await page.getByRole('menuitem', { name: 'خروج از حساب' }).click();
  await expect(page.getByRole('button', { name: 'ورود با گوگل' })).toBeVisible();
}
