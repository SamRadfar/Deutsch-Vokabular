// AI suggestions end to end with the real Firebase SDK (Auth + Firestore emulators) and a MOCKED AI
// worker (page.route on VITE_AI_ENDPOINT). The worker itself is covered by tests/unit/worker; no
// real AI is called here, and the browser must never contact api.anthropic.com.

import { expect, test, type Page, type Route } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';
import { signIn, trackErrors, uniqueEmail } from './helpers';
import { AI_TEST_ENDPOINT } from '../../playwright.emulator.config';

const card = (page: Page, word: string) => page.locator(`article[data-personal-id][aria-label="${word}"]`);
const cors = { 'access-control-allow-origin': 'http://localhost:4174', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };

const SUGGESTIONS: Record<string, object> = {
  'from-german': {
    article: 'die', lemma: 'Probeplanungsmappe', type: 'n', grammar: 'Plural: die Probeplanungsmappen', fa: 'پوشهٔ آزمایشی طراحی',
    example: 'Die Probeplanungsmappe liegt im Büro.', exampleFa: 'پوشهٔ آزمایشی طراحی در دفتر است.', pronunciationFa: 'دی پروبه‌پلانونگس‌ماپه',
  },
  complete: {
    article: null, lemma: 'probeverschrauben', type: 'v', grammar: 'verschraubte, hat verschraubt', fa: 'آزمایشی پیچ کردن',
    example: 'Wir probeverschrauben die Platte.', exampleFa: 'ما صفحه را آزمایشی پیچ می‌کنیم.', pronunciationFa: 'پروبه‌فِرشراوبن',
  },
};

async function mockWorker(page: Page) {
  const requests: Array<{ auth: string; body: Record<string, unknown> }> = [];
  await page.route('**/api.anthropic.com/**', (r) => { throw new Error(`browser called Anthropic directly: ${r.request().url()}`); });
  await page.route(`${AI_TEST_ENDPOINT}/v1/suggest`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as Record<string, unknown>;
    requests.push({ auth: req.headers().authorization ?? '', body });
    const suggestion = SUGGESTIONS[body.mode as string];
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ suggestion, provider: 'anthropic', model: 'mocked-in-e2e', limits: { remainingToday: 59, dailyLimit: 60 } }) });
  });
  return requests;
}

test('generate a word with AI → review → save → it syncs and appears in search, flashcards and shadowing', async ({ page }) => {
  const errors = trackErrors(page);
  await installSpeechMock(page);
  const requests = await mockWorker(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('ai'), 'AI Words');
  await page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();
  await expect(page.getByTestId('pw-storage')).toHaveAttribute('data-mode', 'cloud');

  await page.getByRole('button', { name: 'افزودن با هوش مصنوعی' }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  await dialog.getByLabel('واژهٔ آلمانی برای پیشنهاد').fill('probeplanungsmappe');
  await dialog.getByRole('button', { name: 'دریافت پیشنهاد' }).click();
  const review = page.getByTestId('ai-review');
  await expect(review).toContainText('پوشهٔ آزمایشی طراحی');
  // A real Firebase ID token (emulator) was sent — never an API key.
  expect(requests).toHaveLength(1);
  expect(requests[0]!.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]*$/);
  expect(JSON.stringify(requests)).not.toMatch(/sk-ant|x-api-key/);
  expect(requests[0]!.body).toEqual({ mode: 'from-german', word: 'probeplanungsmappe' });

  await expect(page.getByTestId('pw-count')).toHaveCount(0); // nothing saved yet (no list)
  await review.getByRole('button', { name: /^قرار دادن/ }).click();
  await expect(dialog.getByLabel(/واژه یا عبارت آلمانی/)).toHaveValue('Probeplanungsmappe');
  await dialog.getByRole('button', { name: 'افزودن واژه' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, 'die Probeplanungsmappe')).toBeVisible();
  await expect(page.getByTestId('pw-storage')).toContainText('همگام', { timeout: 15_000 });

  // After a reload the word comes back (cloud + device).
  await page.reload();
  await expect(card(page, 'die Probeplanungsmappe')).toBeVisible({ timeout: 15_000 });

  // Search
  await page.getByRole('link', { name: 'واژه‌ها', exact: true }).click();
  await page.getByRole('searchbox', { name: 'جستجوی واژه' }).fill('planungsmappe');
  await expect(page.locator('article.sres[aria-label="die Probeplanungsmappe"]')).toBeVisible();

  // Flashcards
  await page.getByRole('link', { name: 'مرور', exact: true }).click();
  await page.getByLabel('دسته', { exact: true }).selectOption('mine');
  await expect(page.getByRole('button', { name: 'شروع مرور (1 کارت)' })).toBeVisible();

  // Shadowing
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  const chip = page.locator('label.sh-chip').filter({ hasText: 'واژه‌های من' });
  await chip.locator('input').check();
  await expect(chip.locator('.sh-chip__n')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('«✨ تکمیل» fills only empty fields of a saved word; offline disables AI', async ({ page, context }) => {
  const errors = trackErrors(page);
  const requests = await mockWorker(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('ai-complete'), 'AI Complete');
  await page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();
  await page.getByRole('button', { name: 'افزودن واژه' }).click();
  const add = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  await add.getByLabel('نوع واژه').selectOption('v');
  await add.getByLabel(/واژه یا عبارت آلمانی/).fill('probeverschrauben');
  await add.getByRole('textbox', { name: 'معنی فارسی', exact: true }).fill('معنی خودم');
  await add.getByRole('button', { name: 'افزودن واژه' }).click();
  await expect(add).toHaveCount(0);

  await card(page, 'probeverschrauben').getByRole('button', { name: 'تکمیل probeverschrauben با هوش مصنوعی' }).click();
  const edit = page.getByRole('dialog', { name: 'ویرایش واژه' });
  await expect(page.getByTestId('ai-review')).toBeVisible();
  expect(requests[0]!.body).toMatchObject({ mode: 'complete', existing: { lemma: 'probeverschrauben', type: 'v', fa: 'معنی خودم', example: '' } });
  await expect(page.locator('tr[data-field="fa"] input')).not.toBeChecked();
  await page.getByTestId('ai-review').getByRole('button', { name: /^قرار دادن/ }).click();
  await expect(edit.getByRole('textbox', { name: 'معنی فارسی', exact: true })).toHaveValue('معنی خودم');
  await edit.getByRole('button', { name: 'ذخیرهٔ تغییرات' }).click();
  await expect(card(page, 'probeverschrauben')).toContainText('Wir probeverschrauben die Platte.');
  await expect(card(page, 'probeverschrauben')).toContainText('معنی خودم');

  await context.setOffline(true);
  await card(page, 'probeverschrauben').getByRole('button', { name: 'ویرایش probeverschrauben' }).click();
  await expect(page.getByRole('dialog', { name: 'ویرایش واژه' }).getByRole('button', { name: 'دریافت پیشنهاد' })).toBeDisabled();
  await expect(page.getByText('برای پیشنهاد هوش مصنوعی به اینترنت نیاز است.')).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
