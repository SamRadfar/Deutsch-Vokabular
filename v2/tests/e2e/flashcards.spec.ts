// Flashcard workflow in the production build (browse-only: no Firebase configuration, so nothing is
// saved — persistence is covered by tests/e2e-emulator/flashcards.spec.ts).

import { expect, test, type Page } from '@playwright/test';
import vocabulary from '../../src/data/vocabulary/vocabulary.v1.json' with { type: 'json' };

const entries = new Map(vocabulary.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries))).map((e) => [e.id, e]));

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|Failed to load resource/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const card = (page: Page) => page.getByTestId('flashcard');
const count = (page: Page) => page.getByTestId('fc-count');
const currentEntry = async (page: Page) => entries.get((await card(page).getAttribute('data-entry-id'))!)!;

async function startSession(page: Page, size = '10') {
  await page.goto('./');
  await page.getByRole('tab', { name: '🔄 مرور' }).click();
  await expect(page.getByRole('heading', { name: 'مرور با فلش‌کارت' })).toBeVisible();
  await page.getByLabel('تعداد کارت در جلسه').selectOption(size);
  await page.getByRole('button', { name: `شروع مرور (${size} کارت)` }).click();
  await expect(card(page)).toBeVisible();
}

test('complete flashcard workflow: flip, navigate, answer, summary, repeat, restart', async ({ page }) => {
  const errors = trackErrors(page);
  await startSession(page);
  await expect(count(page)).toHaveText('1 / 10');

  // Front: German word; back: Persian meaning after a tap on the card.
  const entry = await currentEntry(page);
  await expect(card(page).locator('.fc-face--front .v-word')).toHaveText(entry.word);
  await card(page).locator('.fc-face--front').click({ position: { x: 20, y: 20 } });
  await expect(card(page)).toHaveAttribute('data-side', 'back');
  await expect(card(page).locator('.fc-face--back .v-fa')).toHaveText(entry.fa);
  // The 3D flip really turns the card (transition finished → rotated by 180°).
  await expect.poll(() => card(page).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m11)).toBeCloseTo(-1, 1);

  // Navigation
  await page.getByRole('button', { name: /بعدی/ }).click();
  await expect(count(page)).toHaveText('2 / 10');
  await expect(card(page)).toHaveAttribute('data-side', 'front');
  await page.getByRole('button', { name: /قبلی/ }).click();
  await expect(count(page)).toHaveText('1 / 10');

  // Answer all ten: three unknown.
  const unknown: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = (await card(page).getAttribute('data-entry-id'))!;
    if (i < 3) { unknown.push(id); await page.getByRole('button', { name: /بلد نیستم/ }).click(); }
    else await page.getByRole('button', { name: /بلدم/ }).click();
  }
  await expect(page.getByTestId('summary-know')).toHaveText('7');
  await expect(page.getByTestId('summary-again')).toHaveText('3');
  await expect(page.getByText('نتیجه‌های این جلسه ذخیره نشد')).toBeVisible();

  // Legacy V3: the repeat must show the cards again.
  await page.getByRole('button', { name: 'مرور دوبارهٔ کارت‌های نادانسته (3)' }).click();
  await expect(card(page)).toBeVisible();
  await expect(count(page)).toHaveText('1 / 3');
  expect(unknown).toContain(await card(page).getAttribute('data-entry-id'));
  await page.getByRole('button', { name: /بلدم/ }).click();

  // Restart: back to card 1 with nothing answered.
  await page.getByRole('button', { name: 'شروع دوباره', exact: true }).click();
  await expect(count(page)).toHaveText('1 / 3');
  await expect(page.locator('.fc-tally__know')).toHaveText('✓ 0');

  // End session → summary → new session setup.
  await page.getByRole('button', { name: 'پایان جلسه' }).click();
  await expect(page.getByTestId('summary-unanswered')).toHaveText('3');
  await page.getByRole('button', { name: 'تنظیم جلسهٔ جدید' }).click();
  await expect(page.getByRole('button', { name: 'شروع مرور (10 کارت)' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard controls (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard');
  await startSession(page);
  await page.locator('body').click({ position: { x: 2, y: 400 } }); // focus outside any control
  await page.keyboard.press('Space');
  await expect(card(page)).toHaveAttribute('data-side', 'back');
  await page.keyboard.press('ArrowRight');
  await expect(count(page)).toHaveText('2 / 10');
  await page.keyboard.press('ArrowLeft');
  await expect(count(page)).toHaveText('1 / 10');
  await page.keyboard.press('2');
  await page.keyboard.press('1');
  await expect(count(page)).toHaveText('3 / 10');
  await expect(page.locator('.fc-tally__know')).toHaveText('✓ 1');
  await expect(page.locator('.fc-tally__again')).toHaveText('✗ 1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(page.getByTestId('summary-unanswered')).toHaveText('8');
});

test('swipe gestures: right = know, left = don\'t know, short drag snaps back', async ({ page }) => {
  await startSession(page);
  const box = (await card(page).boundingBox())!;
  const swipe = async (dx: number) => {
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + 2);
    await page.mouse.up();
  };
  await swipe(40);
  await expect(count(page)).toHaveText('1 / 10');
  await expect(card(page)).toHaveAttribute('data-side', 'front'); // the drag did not flip the card
  await swipe(140);
  await expect(count(page)).toHaveText('2 / 10');
  await expect(card(page)).toHaveAttribute('data-side', 'front'); // the click ending the swipe did not flip the next card
  await swipe(-140);
  await expect(count(page)).toHaveText('3 / 10');
  await expect(page.locator('.fc-tally__know')).toHaveText('✓ 1');
  await expect(page.locator('.fc-tally__again')).toHaveText('✗ 1');
});

test('review screens fit the viewport and controls are touch-sized', async ({ page, isMobile }) => {
  await startSession(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const sizes = await page.locator('.fc-answer, .fc-tool, .fc-flip').evaluateAll((els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { h: r.height, w: r.width }; }));
  for (const s of sizes) expect(Math.min(s.h, s.w)).toBeGreaterThanOrEqual(isMobile ? 40 : 32);
  // The answer buttons are reachable without scrolling on a phone.
  if (isMobile) await expect(page.getByRole('button', { name: /بلدم/ })).toBeInViewport();
  await page.getByRole('button', { name: 'پایان جلسه' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('dark mode applies to the flashcards', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await startSession(page);
  const bg = await card(page).locator('.fc-face--front').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(27, 30, 41)'); // --sf (dark)
});
