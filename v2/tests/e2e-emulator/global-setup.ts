// Warm-up for the emulator browser suite.
//
// Observed in this environment: the FIRST popup sign-in after the Auth Emulator starts does not
// report back to the app (the popup completes, but signInWithPopup never settles), while every
// later sign-in works. The cause lies in the emulator's popup/iframe hand-off on a cold start and
// is not reproducible in the app code. This setup performs one throw-away sign-in — using the
// app's own «لغو» (cancel) + retry path — so test results reflect the app, not the cold start.
// It does not hide app failures: every test signs in again from scratch.

import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use.baseURL ?? 'http://localhost:4174/');
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  const log: string[] = [];
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto('./');
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'ورود با گوگل' }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      const closed = popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);
      await popup.getByText('Add new account').click();
      await popup.locator('#email-input').fill(`warmup-${attempt}-${Date.now()}@example.test`);
      await popup.locator('#display-name-input').fill('Warm-up');
      await popup.locator('#sign-in').click();
      await closed;
      try {
        await page.getByTestId('account-button').waitFor({ timeout: 15_000 });
        log.push(`attempt ${attempt}: signed in`);
        break;
      } catch {
        log.push(`attempt ${attempt}: popup finished but sign-in did not settle → cancel + retry`);
        await page.getByRole('button', { name: 'لغو' }).click().catch(() => undefined);
      }
    }
  } finally {
    console.log(`[emulator warm-up] ${log.join('; ')}`);
    await browser.close();
  }
}
