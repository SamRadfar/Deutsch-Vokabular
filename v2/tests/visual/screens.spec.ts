// Visual review (redesign): real screenshots of the running app — signed in through the Auth
// Emulator (demo project, no real account), personal words in the emulated Firestore, the AI worker
// answered by page.route (no real AI). Not a pass/fail regression test: it writes PNGs for review.
//
//   npm run screenshots   → test-results/screenshots/<screen>-<viewport>-<theme>.png

import { expect, test, type Page } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';
import { signIn, uniqueEmail } from '../e2e-emulator/helpers';
import { AI_TEST_ENDPOINT } from '../../playwright.emulator.config';

const OUT = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
const cors = { 'access-control-allow-origin': 'http://localhost:4174', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const SUGGESTION = {
  article: 'die', lemma: 'Fassadenbegrünung', type: 'n', grammar: 'Plural: die Fassadenbegrünungen', fa: 'سبزکاری نما',
  example: 'Die Fassadenbegrünung verbessert das Mikroklima der Stadt.', exampleFa: 'سبزکاری نما، خرد اقلیم شهر را بهبود می‌دهد.',
  pronunciationFa: 'دی فاسادن‌بگرونونگ',
};

async function shot(page: Page, name: string, theme: string, project: string) {
  await page.waitForTimeout(250); // let transitions settle
  await page.screenshot({ path: `${OUT}/${name}-${project}-${theme}.png` });
}

async function addWord(page: Page, lemma: string, fa: string, example = '') {
  await page.getByRole('button', { name: 'افزودن واژه', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  await dialog.getByLabel(/واژه یا عبارت آلمانی/).fill(lemma);
  await dialog.getByRole('textbox', { name: 'معنی فارسی', exact: true }).fill(fa);
  if (example) await dialog.getByLabel(/جملهٔ مثال آلمانی/).fill(example);
  await dialog.getByRole('button', { name: 'افزودن واژه' }).click();
  await expect(dialog).toHaveCount(0);
}

for (const theme of ['dark', 'light'] as const) {
  test(`all screens — ${theme}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const project = info.project.name;
    const desktop = !project.startsWith('mobile');
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((t) => { try { localStorage.setItem('dv2.pref.theme.v1', t); } catch { /* ignore */ } }, theme);
    await installSpeechMock(page, 900);
    await page.route(`${AI_TEST_ENDPOINT}/v1/suggest`, (route) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ suggestion: SUGGESTION, provider: 'anthropic', model: 'mocked', limits: { remainingToday: 57, dailyLimit: 60 } }) }));

    await page.goto('./');
    await shot(page, '01-words-signed-out', theme, project);
    await signIn(page, uniqueEmail(`shots-${theme}`), 'Arian Safari');
    // A few learned words so progress is visible
    const boxes = page.getByRole('checkbox', { name: /^Gelernt|^یادگرفتم/ });
    for (let i = 0; i < 4; i++) await boxes.nth(i).check().catch(() => {});
    await shot(page, '02-words', theme, project);

    await page.getByRole('searchbox', { name: 'جستجوی واژه' }).fill('wand');
    await page.waitForTimeout(400);
    await shot(page, '03-search', theme, project);
    await page.getByRole('searchbox', { name: 'جستجوی واژه' }).fill('');

    await page.getByRole('link', { name: 'واژه‌های من', exact: true }).click();
    await addWord(page, 'die Tragfähigkeit', 'ظرفیت باربری', 'Die Tragfähigkeit der Decke wurde geprüft.');
    await addWord(page, 'verschalen', 'قالب‌بندی کردن');
    await addWord(page, 'der Sturz', 'نعل درگاه');
    await shot(page, '04-mine', theme, project);

    // Word form with the AI review
    await page.getByRole('button', { name: 'افزودن با هوش مصنوعی' }).click();
    const dialog = page.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
    await shot(page, '05-form', theme, project);
    await dialog.getByLabel('واژهٔ آلمانی برای پیشنهاد').fill('fassadenbegrünung');
    await dialog.getByRole('button', { name: 'دریافت پیشنهاد' }).click();
    await expect(page.getByTestId('ai-review')).toBeVisible();
    await shot(page, '06-form-ai-review', theme, project);
    await page.getByTestId('ai-review').getByRole('button', { name: /^قرار دادن/ }).click();
    await shot(page, '07-form-filled', theme, project);
    await dialog.getByRole('button', { name: 'افزودن واژه' }).click();
    await expect(dialog).toHaveCount(0);

    // Flashcards
    await page.getByRole('link', { name: 'مرور', exact: true }).click();
    await shot(page, '08-review-setup', theme, project);
    await page.getByRole('button', { name: /^شروع مرور/ }).click();
    await shot(page, '09-flashcard', theme, project);
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    await shot(page, '10-flashcard-back', theme, project);
    await page.getByRole('button', { name: /پایان/ }).first().click().catch(() => {});

    // Shadowing
    await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
    await shot(page, '11-shadowing-setup', theme, project);
    await page.getByRole('button', { name: /^شروع تمرین/ }).click();
    await page.waitForTimeout(500);
    await shot(page, '12-shadowing-session', theme, project);

    // Dashboard
    await page.getByRole('link', { name: 'پیشرفت', exact: true }).click();
    await shot(page, '13-progress', theme, project);

    // Account menu (popover) and the collapsed sidebar
    await page.getByTestId('account-button').click();
    await shot(page, '14-account-menu', theme, project);
    await page.keyboard.press('Escape');
    if (desktop) {
      await page.getByTestId('sidebar-toggle').click();
      await shot(page, '15-sidebar-collapsed', theme, project);
      await page.getByTestId('sidebar-toggle').click();
    }
  });
}
