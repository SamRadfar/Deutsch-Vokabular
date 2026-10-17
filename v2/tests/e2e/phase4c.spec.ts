// Phase 4C in the production build (browse-only; signed-in dashboard numbers are covered in the
// emulator suite): navigation, search, filters, dashboard, mobile layout, keyboard, dark mode.

import { expect, test, type Page } from '@playwright/test';
import vocabulary from '../../src/data/vocabulary/vocabulary.v1.json' with { type: 'json' };

const AUSSENWAND = vocabulary.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
const fitness = vocabulary.categories.find((c) => c.key === 'fitness')!;

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

const nav = (page: Page) => page.getByRole('navigation', { name: 'بخش‌های اصلی' });
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'جستجوی واژه' });
const results = (page: Page) => page.getByRole('list', { name: 'نتیجه‌های جستجو' }).locator('article[data-entry-id]');
/** Phones fold the filters behind a «فیلترها» button; desktop shows them directly. */
async function openFilters(page: Page) {
  await expect(searchBox(page)).toBeVisible(); // isVisible() below does not wait
  const toggle = page.getByRole('button', { name: /^فیلترها/ });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('main navigation: four sections, hash routes, back button, page titles', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(nav(page).getByRole('link')).toHaveText(['📚واژه‌ها', '⭐واژه‌های من', '🔄مرور', '🗣تلفظ', '📊پیشرفت']);
  await expect(page).toHaveTitle(/^واژه‌ها · /);
  await nav(page).getByRole('link', { name: 'پیشرفت' }).click();
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('heading', { name: 'پیشرفت یادگیری' })).toBeVisible();
  await nav(page).getByRole('link', { name: 'مرور' }).click();
  await expect(page.getByRole('heading', { name: 'مرور با فلش‌کارت' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'پیشرفت یادگیری' })).toBeVisible();
  await page.goto('./#/shadowing'); // deep link
  await expect(page.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('search: German with ß/umlaut folding, Persian, highlighting, show in list', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await searchBox(page).fill('aussenwand');
  await expect(results(page).first()).toHaveAttribute('data-entry-id', AUSSENWAND.id);
  await expect(results(page).first().locator('mark').first()).toHaveText('Außenwand');
  await expect(page.getByTestId('search-count')).toHaveText(/واژه پیدا شد$/);

  await searchBox(page).fill('ديوار خارجي'); // Arabic yeh
  await expect(results(page).first()).toHaveAttribute('data-entry-id', AUSSENWAND.id);

  const target = fitness.subtabs[1]!.groups[0]!.entries[0]!;
  await searchBox(page).fill(target.word);
  const card = page.locator(`article.sres[data-entry-id="${target.id}"]`);
  await card.getByRole('button', { name: 'نمایش در فهرست' }).click();
  await expect(page.getByRole('tab', { name: fitness.label, exact: true })).toHaveAttribute('aria-selected', 'true');
  const row = page.locator(`.mcontent [data-entry-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-focused/);
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
  expect(errors).toEqual([]);
});

test('filters: category + subcategory + query, empty state, reset', async ({ page }) => {
  await page.goto('./');
  await openFilters(page);
  await page.getByRole('combobox', { name: 'دسته' }).selectOption('fitness');
  await page.getByRole('combobox', { name: 'زیرمجموعه' }).selectOption(fitness.subtabs[0]!.id);
  const total = fitness.subtabs[0]!.groups.reduce((n, g) => n + g.entries.length, 0);
  await expect(page.getByTestId('search-count')).toHaveText(`${total} واژه پیدا شد`);
  await searchBox(page).fill('qqqzzz');
  await expect(page.getByText('برای «qqqzzz» واژه‌ای پیدا نشد')).toBeVisible();
  await page.getByRole('button', { name: /^پاک کردن/ }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(page.locator('.mcontent [data-entry-id]').first()).toBeVisible();
  // Signed out: learned/unlearned filters need an account.
  await openFilters(page);
  await expect(page.getByRole('radio', { name: 'یادگرفته' })).toBeDisabled();
});

test('search stays fast on the full dataset', async ({ page }) => {
  await page.goto('./');
  await searchBox(page).click();
  const t0 = Date.now();
  await page.keyboard.type('a', { delay: 0 }); // the broadest query: hundreds of results
  await expect(page.getByTestId('search-count')).toHaveText(/واژه پیدا شد$/);
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(results(page)).toHaveCount(50); // first page only
  await page.getByRole('button', { name: /نتیجهٔ بیشتر/ }).click();
  await expect(results(page)).toHaveCount(100);
});

test('keyboard: skip link, "/" to search, Escape clears, tab order reaches the main nav', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard');
  await page.goto('./');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'رفتن به محتوای اصلی' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type('wand');
  await page.keyboard.press('Escape');
  await expect(searchBox(page)).toHaveValue('');
  const progress = nav(page).getByRole('link', { name: 'پیشرفت' });
  await progress.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/progress$/);
});

test('dashboard (signed out): totals, categories, quick access', async ({ page }) => {
  await page.goto('./#/progress');
  await expect(page.getByTestId('db-total')).toHaveText('999');
  await expect(page.getByRole('note')).toContainText('برای ثبت پیشرفت');
  await expect(page.locator('.db-cat')).toHaveCount(7);
  await page.locator('.db-cat').filter({ hasText: fitness.label }).click();
  await expect(page.getByRole('tab', { name: fitness.label, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goto('./#/progress');
  await page.getByRole('button', { name: /تمرین تلفظ/ }).click();
  await expect(page).toHaveURL(/#\/shadowing$/);
});

test('layout: every section fits the viewport; phones use a bottom tab bar', async ({ page, isMobile }) => {
  await page.goto('./');
  for (const section of ['', 'mine', 'review', 'shadowing', 'progress']) {
    await page.goto(`./#/${section}`);
    await page.waitForTimeout(100);
    expect(await overflow(page), `#/${section} overflows`).toBeLessThanOrEqual(0);
  }
  await page.goto('./');
  await searchBox(page).fill('wand');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const box = (await nav(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  if (isMobile) {
    expect(Math.round(box.y + box.height)).toBe(viewport.height); // fixed at the bottom
    const sizes = await nav(page).getByRole('link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of sizes) expect(h).toBeGreaterThanOrEqual(48);
    // The header stays compact: brand + actions on one line, then the category tabs.
    const header = (await page.locator('header').boundingBox())!;
    expect(header.height).toBeLessThan(120);
    // The search field is reachable without scrolling, and the first words follow right after it.
    await expect(searchBox(page)).toBeInViewport();
    await page.getByRole('button', { name: 'پاک کردن' }).click();
    await expect(page.locator('.mcontent article.vcard').first()).toBeInViewport();
  } else {
    expect(box.y).toBeLessThan(100); // inside the header
  }
});

test('dark mode: new screens use the dark palette and readable accents', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./#/progress');
  const card = await page.locator('.db-card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(card).toBe('rgb(27, 30, 41)');
  await page.goto('./');
  await searchBox(page).fill('wand');
  await expect(page.getByTestId('search-count')).toHaveText(/واژه پیدا شد$/);
  // Polled: the list may still be re-rendering for the deferred query when first read.
  await expect.poll(() => page.locator('.sres').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(27, 30, 41)');
  // Muted text meets WCAG AA on dark surfaces (≥ 4.5:1).
  const ratio = await page.locator('.sres__crumb').first().evaluate((el) => {
    const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { const c = v! / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const fg = lum(rgb(getComputedStyle(el).color));
    const bg = lum(rgb(getComputedStyle(el.closest('.sres')!).backgroundColor));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
