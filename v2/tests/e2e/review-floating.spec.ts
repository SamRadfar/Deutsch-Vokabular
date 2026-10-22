// Floating flashcard review in a real Document Picture-in-Picture window (Chromium): the same
// session as the review page (card, side, order, ratings), never advancing by itself, keyboard
// only inside the window, close/reopen, end of session, one window shared with Shadowing, and
// nothing private left after sign-out. Minimizing the main window: tests/desktop.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installSpeechMock } from '../helpers/speechMock';
import { signOut } from '../e2e-emulator/helpers';

type PipWin = { documentPictureInPicture: { window: Window | null } };
const pip = (page: Page, selector: string, attr?: string) => page.evaluate(([sel, a]) => {
  const w = (window as unknown as PipWin).documentPictureInPicture.window;
  if (!w) return '__no-window__';
  const el = w.document.querySelector(sel!);
  return el ? (a ? el.getAttribute(a) : el.textContent) : null;
}, [selector, attr ?? ''] as const);
const pipClick = (page: Page, testId: string) => page.evaluate((id) => {
  (window as unknown as PipWin).documentPictureInPicture.window!.document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click();
}, testId);
const pipKey = (page: Page, code: string) => page.evaluate((c) => {
  const doc = (window as unknown as PipWin).documentPictureInPicture.window!.document;
  doc.body.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, cancelable: true }));
}, code);
const mainCard = (page: Page) => page.getByTestId('flashcard');
const mainWord = async (page: Page) => (await mainCard(page).locator('.fc-face--front .fc-word').textContent())?.trim();
const tally = (page: Page) => page.locator('.fc-session .fc-tally').textContent();

async function startReview(page: Page) {
  await installSpeechMock(page, 50);
  await page.getByRole('link', { name: 'مرور', exact: true }).click();
  // Category + subcategory filter (dynamic categories) and a session size.
  await page.getByLabel('دسته', { exact: true }).selectOption('fitness');
  await page.getByLabel('زیرمجموعه', { exact: true }).selectOption('ernaehrung');
  await page.getByLabel('تعداد کارت در جلسه').selectOption('10');
  await page.getByRole('button', { name: 'شروع مرور (10 کارت)' }).click();
  await expect(mainCard(page)).toBeVisible();
}

test('floating flashcard: same session, flip, navigate, rate, keyboard, close/reopen, end', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Document Picture-in-Picture is a desktop feature');
  test.setTimeout(120_000);
  await startReview(page);
  await page.getByTestId('review-floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="rf-word"]')).toBe(await mainWord(page));
  expect(await pip(page, '[data-testid="rf-pos"]')).toBe('1 / 10');
  // Only the card in the window; the front shows no Persian.
  expect(await page.evaluate(() => {
    const w = (window as unknown as PipWin).documentPictureInPicture.window!;
    return { nav: w.document.querySelectorAll('nav, aside, header').length, cards: w.document.querySelectorAll('[data-testid="rf-card"]').length, title: w.document.title };
  })).toEqual({ nav: 0, cards: 1, title: 'Deutsch Vokabular · مرور' });
  expect(await pip(page, '[data-testid="rf-fa"]')).toBeNull();

  // It never advances by itself.
  await page.waitForTimeout(1500);
  expect(await pip(page, '[data-testid="rf-pos"]')).toBe('1 / 10');

  // Flip in the window → the page shows the back too (one state).
  await pipClick(page, 'rf-face');
  await expect.poll(() => pip(page, '[data-testid="rf-card"]', 'data-side')).toBe('back');
  await expect(mainCard(page)).toHaveAttribute('data-side', 'back');
  const fa = await mainCard(page).locator('.fc-fa').textContent();
  expect(await pip(page, '[data-testid="rf-fa"]')).toBe(fa?.trim());

  // Next / previous: no rating.
  await pipClick(page, 'rf-next');
  await expect(page.getByTestId('fc-count')).toHaveText('2 / 10');
  await expect.poll(() => pip(page, '[data-testid="rf-word"]')).toBe(await mainWord(page));
  await pipClick(page, 'rf-prev');
  await expect(page.getByTestId('fc-count')).toHaveText('1 / 10');
  expect(await tally(page)).toMatch(/0\D+0/);

  // «بلدم» in the window = «بلدم» on the page (existing review backend), then «دوباره».
  const firstId = await mainCard(page).getAttribute('data-entry-id');
  await pipClick(page, 'rf-know');
  await expect(page.getByTestId('fc-count')).toHaveText('2 / 10');
  await pipClick(page, 'rf-again');
  await expect(page.getByTestId('fc-count')).toHaveText('3 / 10');
  expect(await pip(page, '[data-testid="rf-tally"]')).toMatch(/1\D+1/);
  expect(await tally(page)).toMatch(/1\D+1/);

  // Keyboard inside the window: Space flips, → next, 2 = «بلدم».
  await pipKey(page, 'Space');
  await expect(mainCard(page)).toHaveAttribute('data-side', 'back');
  await pipKey(page, 'ArrowRight');
  await expect(page.getByTestId('fc-count')).toHaveText('4 / 10');
  await pipKey(page, 'Digit2');
  await expect(page.getByTestId('fc-count')).toHaveText('5 / 10');
  expect(await tally(page)).toMatch(/2\D+1/);

  // Closing the window keeps the session; reopening shows the current card.
  await page.evaluate(() => (window as unknown as PipWin).documentPictureInPicture.window!.close());
  await expect(page.getByTestId('review-floating-toggle')).toHaveText(/^\s*پنجره شناور/);
  await expect(page.getByTestId('fc-count')).toHaveText('5 / 10');
  await page.getByTestId('review-floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="rf-pos"]')).toBe('5 / 10');
  expect(await pip(page, '[data-testid="rf-word"]')).toBe(await mainWord(page));

  // End of the session: the window shows the result and can be closed from there.
  await page.getByRole('button', { name: 'پایان جلسه' }).click();
  await expect.poll(() => pip(page, '[data-testid="rf-done"]')).toContain('جلسهٔ مرور تمام شد');
  await page.evaluate(() => (window as unknown as PipWin).documentPictureInPicture.window!.document.querySelector<HTMLButtonElement>('.rf__close')!.click());
  await expect.poll(() => pip(page, '[data-testid="rf-done"]')).toBe('__no-window__');

  // The learned word is real progress (synced): the dashboard counts it after a reload.
  await page.reload();
  await page.getByRole('link', { name: 'پیشرفت', exact: true }).click();
  await expect(page.getByTestId('db-learned')).toHaveText('2', { timeout: 20_000 });
  expect(firstId).toBeTruthy();
});

test('one floating window: Review replaces Shadowing\'s; sign-out closes it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Document Picture-in-Picture is a desktop feature');
  test.setTimeout(120_000);
  await installSpeechMock(page, 250);
  // Shadowing session with its floating card.
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await page.getByLabel('تعداد واژه در جلسه').selectOption('5');
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await page.getByTestId('floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="floating-card"]', 'data-testid')).toBe('floating-card');

  // Review takes the one window; the Shadowing session keeps running in the page.
  await startReview(page);
  await page.getByTestId('review-floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="rf-word"]')).toBe(await mainWord(page));
  expect(await pip(page, '[data-testid="floating-card"]')).toBeNull();
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await expect(page.getByTestId('floating-toggle')).toHaveText(/^\s*پنجره شناور/);
  await expect(page.getByTestId('sh-stage')).toBeVisible();

  // Sign-out: no private vocabulary stays on the desktop.
  await page.getByRole('link', { name: 'مرور', exact: true }).click();
  await signOut(page);
  await expect.poll(() => pip(page, '[data-testid="rf-word"]')).toBe('__no-window__');
});

test('without Document Picture-in-Picture: an honest explanation, the page keeps working', async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture; });
  await page.goto('./');
  await startReview(page);
  await page.getByTestId('review-floating-toggle').click();
  await expect(page.getByTestId('review-floating-unsupported')).toContainText('Chrome یا Edge');
  await page.getByRole('button', { name: 'نمایش معنی' }).click(); // the card centre may be the 🔊 button
  await expect(mainCard(page)).toHaveAttribute('data-side', 'back');
});
