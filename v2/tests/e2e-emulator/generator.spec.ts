// AI vocabulary generator end to end with the real Firebase SDK (Auth + Firestore emulators) and a
// MOCKED AI worker (page.route on VITE_AI_ENDPOINT; the worker is covered by tests/unit/worker).
// 200 words → preview → import → synced to the account, visible on a second device, invisible to
// another account.

import { expect, test, type Page, type Route } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';
import { signIn, signOut, trackErrors, uniqueEmail } from './helpers';
import { AI_TEST_ENDPOINT } from '../../playwright.emulator.config';

const cors = { 'access-control-allow-origin': 'http://localhost:4174', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const L = 'abcdefghijklmnopqrstuvwxyz';
const word = (n: number) => `Probekleid${L[n % 26]}${L[Math.floor(n / 26) % 26]}ung`;

async function mockGenerator(page: Page) {
  const requests: Array<Record<string, unknown>> = [];
  let next = 0;
  await page.route(`${AI_TEST_ENDPOINT}/v1/generate`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as { count: number; subcategories?: string[] };
    requests.push(body);
    const entries = Array.from({ length: body.count }, () => {
      const n = next++;
      return {
        article: 'die', lemma: word(n), type: 'n', grammar: '', fa: `لباس آزمایشی ${n}`,
        example: `Die ${word(n)} hängt im Schrank.`, exampleFa: 'این لباس در کمد آویزان است.',
        subcategory: n % 2 ? 'Oberteile' : 'Schuhe', level: 'B1',
      };
    });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ entries, rejected: 0, provider: 'workers-ai', model: 'mocked-in-e2e', limits: { remainingToday: 100, dailyLimit: 300 } }) });
  });
  return requests;
}

const openMine = (page: Page) => page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();

test('generate 200 words → preview → import → synced across devices, private to the account', async ({ browser }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('gen');
  const laptopCtx = await browser.newContext();
  const phoneCtx = await browser.newContext();
  const laptop = await laptopCtx.newPage();
  const phone = await phoneCtx.newPage();
  try {
    const errors = trackErrors(laptop);
    await installSpeechMock(laptop);
    const requests = await mockGenerator(laptop);
    await laptop.goto('./');
    await signIn(laptop, email, 'Generator');
    await openMine(laptop);
    await expect(laptop.getByTestId('pw-storage')).toHaveAttribute('data-mode', 'cloud');

    await laptop.getByTestId('open-generator').click();
    const dialog = laptop.getByRole('dialog', { name: 'ساخت واژه با هوش مصنوعی' });
    await dialog.getByLabel('موضوع').fill('Kleidung und Mode');
    await dialog.getByRole('radio', { name: '200' }).check();
    await dialog.getByRole('button', { name: /ساخت واژه‌ها/ }).click();
    await expect(dialog.getByTestId('gen-row')).toHaveCount(200, { timeout: 60_000 });
    expect(requests.every((r) => (r.count as number) <= 15)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('@'); // no e-mail or account data in requests
    await expect(dialog.getByTestId('gen-counts')).toContainText('200 از 200');

    await dialog.getByTestId('gen-import').click();
    await expect(dialog.getByTestId('gen-done')).toContainText('200 واژه');
    await expect(dialog.getByTestId('gen-sync')).toContainText('200 / 200', { timeout: 90_000 });
    await expect(dialog.getByTestId('gen-stored')).toHaveText('روی این دستگاه ذخیره شد.');
    // Importing the same preview again is impossible (the dialog moved on); a second device sees it all.
    await dialog.getByRole('button', { name: 'نمایش واژه‌ها' }).click();
    await expect(laptop.getByTestId('pw-count')).toHaveText('200 از 200');
    expect(errors).toEqual([]);

    await phone.goto('./');
    await signIn(phone, email, 'Generator');
    await openMine(phone);
    await expect(phone.locator('article[data-personal-id]')).toHaveCount(200, { timeout: 30_000 });
    await expect(phone.getByTestId('pw-collection')).toContainText('Kleidung und Mode (200)');

    // Another account never sees these words.
    await signOut(phone);
    await signIn(phone, uniqueEmail('other'), 'Other');
    await openMine(phone);
    await expect(phone.getByText('هنوز واژه‌ای اضافه نکرده‌اید')).toBeVisible();
  } finally {
    await laptopCtx.close();
    await phoneCtx.close();
  }
});
