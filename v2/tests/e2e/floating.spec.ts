// Floating shadowing card in a real Document Picture-in-Picture window (Chromium). Always-on-top
// and minimizing the main window need a real desktop: scripts/pip-desktop-check.mjs.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installSpeechMock } from '../helpers/speechMock';

const pip = (page: Page, selector: string) => page.evaluate((sel) => {
  const w = (window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
  return w ? (w.document.querySelector(sel)?.textContent ?? null) : '__no-window__';
}, selector);
const pipClick = (page: Page, label: string) => page.evaluate((l) => {
  const w = (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window;
  w.document.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)!.click();
}, label);
const mainWord = (page: Page) => page.getByTestId('sh-word').locator('[lang="de"]').textContent();

async function startSession(page: Page) {
  await installSpeechMock(page, 250);
  await page.goto('./');
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await page.getByLabel('تعداد واژه در جلسه').selectOption('5');
  await page.getByLabel('تکرار واژه آلمانی').selectOption('1');
  await page.getByLabel('تکرار جمله مثال آلمانی').selectOption('0');
  await page.getByRole('slider').fill('1');
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
}

test('opens ONE real Picture-in-Picture window that follows the session and controls it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Document Picture-in-Picture is a desktop feature');
  test.setTimeout(90_000);
  await startSession(page);
  await page.getByTestId('floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="floating-word"]')).toBe(await mainWord(page));
  expect(await pip(page, '[data-testid="floating-pos"]')).toMatch(/^\d \/ 5$/);
  // Only the card: no app navigation inside the window.
  expect(await page.evaluate(() => {
    const w = (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window;
    return { nav: w.document.querySelectorAll('nav, aside, header').length, cards: w.document.querySelectorAll('[data-testid="floating-card"]').length, theme: w.document.documentElement.getAttribute('data-theme') };
  })).toEqual({ nav: 0, cards: 1, theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')) });

  // The card changes with the pronunciation (same session state, one audio pipeline).
  await expect.poll(() => pip(page, '[data-testid="floating-pos"]'), { timeout: 20_000 }).toBe('2 / 5');
  expect(await pip(page, '[data-testid="floating-word"]')).toBe(await mainWord(page));
  expect(await page.evaluate(() => window.__speaking)).toBeLessThanOrEqual(1);

  // Controls inside the floating window drive the one session.
  await pipClick(page, 'توقف موقت');
  await expect(page.getByRole('button', { name: 'ادامه' })).toBeVisible();
  const spokenBefore = await page.evaluate(() => window.__spoken.length);
  await pipClick(page, 'واژهٔ بعدی');
  await expect.poll(() => pip(page, '[data-testid="floating-word"]')).toBe(await mainWord(page));
  await pipClick(page, 'پخش');
  await expect(page.getByRole('button', { name: 'توقف موقت' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(spokenBefore);

  // Never two windows: the toggle now closes; closing the window keeps the session.
  await expect(page.getByTestId('floating-toggle')).toHaveText(/بستن پنجره شناور/);
  await page.evaluate(() => (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window.close());
  await expect(page.getByTestId('floating-toggle')).toHaveText(/^\s*پنجره شناور/);
  await expect(page.getByTestId('sh-stage')).toBeVisible();
  const n = await page.evaluate(() => window.__spoken.length);
  await expect.poll(() => page.evaluate(() => window.__spoken.length), { timeout: 15_000 }).toBeGreaterThan(n); // still playing

  // Reopen, then end the session: the window closes (no vocabulary left on the desktop).
  await page.getByTestId('floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="floating-word"]')).toBe(await mainWord(page));
  await page.getByRole('button', { name: 'پایان جلسه' }).click();
  await expect.poll(() => pip(page, '[data-testid="floating-word"]')).toBe('__no-window__');
});

test('without Document Picture-in-Picture: an honest in-page card', async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture; });
  await startSession(page);
  await page.getByTestId('floating-toggle').click();
  const card = page.getByTestId('floating-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('روی برنامه‌های دیگر نمی‌ماند');
  await expect(card.getByTestId('floating-word')).toHaveText((await mainWord(page))!);
  await card.getByRole('button', { name: 'بستن کارت شناور' }).click();
  await expect(card).toHaveCount(0);
});
