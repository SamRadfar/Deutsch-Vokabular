// Shadowing workflow in the production build, with the deterministic speech mock of
// tests/helpers/speechMock.ts (headless browsers have no dependable voices).

import { expect, test, type Page } from '@playwright/test';
import { installSpeechMock } from '../helpers/speechMock';

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

const spoken = (page: Page) => page.evaluate(() => window.__spoken.map((s) => s.text));
const phase = (page: Page) => page.getByTestId('sh-phase');
const count = (page: Page) => page.getByTestId('sh-count');

async function openSetup(page: Page, opts: { size?: string; word?: string; example?: string; pause?: string; speakMs?: number } = {}) {
  await installSpeechMock(page, opts.speakMs);
  await page.goto('./');
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' })).toBeVisible();
  await page.getByLabel('تعداد واژه در جلسه').selectOption(opts.size ?? '5');
  await page.getByLabel('تکرار هر واژه').selectOption(opts.word ?? '1');
  await page.getByLabel('تکرار جملهٔ مثال').selectOption(opts.example ?? '0');
  await page.getByRole('slider').fill(opts.pause ?? '1');
}

test('complete shadowing session: word, your turn, example, highlight, summary', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await openSetup(page, { example: '1' });
  // Record every visible state change of the session (robust against polling missing a short phase).
  await page.evaluate(() => {
    const w = window as unknown as { __states: string[] };
    w.__states = [];
    const read = () => {
      const phase = document.querySelector('[data-testid="sh-phase"]')?.textContent ?? '';
      const word = document.querySelector('[data-testid="sh-word"]')?.classList.contains('is-speaking');
      const ex = document.querySelector('[data-testid="sh-example"]')?.classList.contains('is-speaking');
      const count = document.querySelector('[data-testid="sh-count"]')?.textContent ?? '';
      const state = `${count}|${phase.replace(/[🗣🔊]\s*/u, '')}|${word ? 'W' : ''}${ex ? 'E' : ''}`;
      if (count && w.__states.at(-1) !== state) w.__states.push(state);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  const word = await page.getByTestId('sh-word').locator('[lang="de"]').textContent();
  const example = await page.getByTestId('sh-example').locator('[lang="de"]').textContent();

  await expect(page.getByRole('heading', { name: 'دور تمرین تمام شد!' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('sh-summary-done')).toHaveText('5');
  const states = await page.evaluate(() => (window as unknown as { __states: string[] }).__states);
  const firstItem = states.filter((x) => x.startsWith('1 / 5|'));
  expect(firstItem).toEqual([
    '1 / 5|گوش کن: واژه|W',
    '1 / 5|حالا تو واژه را بلند تکرار کن|',
    '1 / 5|گوش کن: جمله|E',
    '1 / 5|حالا تو جمله را بلند تکرار کن|',
  ]);
  expect(states.filter((x) => x.endsWith('|W')).map((x) => x.split('|')[0])).toEqual(['1 / 5', '2 / 5', '3 / 5', '4 / 5', '5 / 5']);
  const said = await spoken(page);
  expect(said.slice(0, 2)).toEqual([word, example]);
  expect(said).toHaveLength(10); // 5 words + 5 sentences, nothing twice
  // Nothing overlapped: every utterance ended before the next one started.
  expect(await page.evaluate(() => window.__speaking)).toBe(0);
  expect(errors).toEqual([]);
});

test('pause, resume, stop, next, previous — never two utterances at once', async ({ page }) => {
  await openSetup(page, { pause: '8' }); // long learner pause: the session does not advance by itself here
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await page.getByRole('button', { name: 'توقف موقت' }).click();
  await expect(phase(page)).toContainText('متوقف شده');
  const before = (await spoken(page)).length;
  await page.waitForTimeout(1500);
  expect((await spoken(page)).length).toBe(before); // silent while paused
  await page.getByRole('button', { name: 'ادامه' }).click();
  await expect(phase(page)).toContainText(/گوش کن|تکرار کن/); // playing again (listen or your turn)

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'واژهٔ بعدی' }).click(); // rapid skips
  await expect(count(page)).toHaveText('4 / 5');
  expect(await page.evaluate(() => window.__speaking)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'واژهٔ قبلی' }).click();
  await expect(count(page)).toHaveText('3 / 5');
  await page.getByRole('button', { name: 'توقف', exact: true }).click();
  await expect(phase(page)).toContainText('آماده');
  expect(await page.evaluate(() => window.__speaking)).toBe(0);
});

test('keyboard controls (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard');
  await openSetup(page, { pause: '8' });
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await page.locator('body').click({ position: { x: 2, y: 400 } });
  await page.keyboard.press('Space');
  await expect(phase(page)).toContainText('متوقف شده');
  await page.keyboard.press('Space');
  await expect(phase(page)).toContainText(/گوش کن|تکرار کن/);
  await page.keyboard.press('ArrowRight');
  await expect(count(page)).toHaveText('2 / 5');
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId('sh-fa')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(phase(page)).toContainText('آماده');
});

test('settings persist across reloads', async ({ page }) => {
  await openSetup(page, { size: '10', word: '3', example: '2' });
  await page.getByLabel('سرعت گفتار').selectOption('1.2');
  await page.reload();
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await expect(page.getByLabel('تعداد واژه در جلسه')).toHaveValue('10');
  await expect(page.getByLabel('تکرار هر واژه')).toHaveValue('3');
  await expect(page.getByLabel('تکرار جملهٔ مثال')).toHaveValue('2');
  await expect(page.getByLabel('سرعت گفتار')).toHaveValue('1.2');
  await page.getByRole('button', { name: 'شروع تمرین (10 واژه)' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken[0]?.rate)).toBe(1.2);
  expect(await page.evaluate(() => window.__spoken[0]?.lang)).toBe('de-DE');
});

test('leaving the tab stops the sound; coming back offers to continue', async ({ page }) => {
  await openSetup(page);
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await page.getByRole('link', { name: 'مرور', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__speaking)).toBe(0); // the pause runs in an effect after the render
  const n = (await spoken(page)).length;
  await page.waitForTimeout(2000);
  expect((await spoken(page)).length).toBe(n);
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await expect(page.getByText('از تب تمرین خارج شدید')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ادامه' })).toBeVisible();
});

test('layout: no horizontal overflow, touch-sized controls, works in dark mode', async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSetup(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const sizes = await page.locator('.sh-btn, .fc-tool').evaluateAll((els) => els.map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)));
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(40);
  if (isMobile) await expect(page.getByRole('button', { name: /توقف موقت|پخش|ادامه/ })).toBeInViewport();
  const bg = await page.getByTestId('sh-stage').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(27, 30, 41)');
});
