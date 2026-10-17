import { expect, test, type Page } from '@playwright/test';
import vocabulary from '../../src/data/vocabulary/vocabulary.v1.json' with { type: 'json' };

const categories = vocabulary.categories;

/** Fail on uncaught exceptions and console errors (external font loading is tolerated). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|Failed to load resource/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

const mainTab = (page: Page, label: string) =>
  page.getByRole('tablist', { name: 'Kategorien' }).getByRole('tab', { name: label, exact: true });

test.describe('application', () => {
  test('loads without runtime errors and shows all categories', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Deutsch Vokabular' })).toBeVisible();
    await expect(page.getByText('999 واژه')).toBeVisible();
    // Hermetic build: no developer .env.local may leak in (badge would show "dev: …").
    await expect(page.getByTestId('env-badge')).toHaveText('v2 preview');
    const tabs = page.getByRole('tablist', { name: 'Kategorien' }).getByRole('tab');
    await expect(tabs).toHaveCount(7); // categories; practice sections are in the main navigation
    await expect(tabs).toHaveText(categories.map((c) => c.label));
    // The legacy brand logo (extracted from index.html) loads under the relative base path.
    await expect.poll(() => page.locator('.brand__icon').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(300);
    expect(errors).toEqual([]);
  });

  test('navigates every category and shows its first entry', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('./');
    for (const c of categories) {
      await mainTab(page, c.label).click();
      await expect(mainTab(page, c.label)).toHaveAttribute('aria-selected', 'true');
      const first = c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries))[0];
      const firstSubtabEmpty = c.subtabs[0]!.groups.every((g) => g.entries.length === 0);
      if (firstSubtabEmpty) await expect(page.getByText('هنوز واژه‌ای در این بخش وجود ندارد')).toBeVisible();
      else await expect(page.locator(`[data-entry-id="${first!.id}"]`)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('switches subtabs and opens technical information', async ({ page }) => {
    await page.goto('./');
    const tech = categories.find((c) => c.key === 'bautechnik')!;
    await mainTab(page, tech.label).click();
    await page.getByRole('tab', { name: new RegExp(tech.subtabs[0]!.label) }).click();
    const trigger = page.getByRole('button', { name: 'اطلاعات فنی' }).first();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'اطلاعات فنی' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'اطلاعات فنی' })).toHaveCount(0);
  });

  test('theme toggles, changes colours and persists across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('./');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['dv2.pref.theme.v1']);
  });

  test('follows the system dark preference by default', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Persian text is rendered right-to-left and German left-to-right', async ({ page }) => {
    await page.goto('./');
    const entry = categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
    const fa = page.locator(`[data-entry-id="${entry.id}"] .v-fa`);
    const de = page.locator(`[data-entry-id="${entry.id}"] .v-word`);
    await expect(fa).toHaveText(entry.fa);
    expect(await fa.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    expect(await de.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  });
});

test.describe('layout', () => {
  test('desktop shows a table, mobile shows cards', async ({ page, isMobile }) => {
    await page.goto('./');
    if (isMobile) {
      await expect(page.locator('table')).toHaveCount(0);
      await expect(page.locator('article.vcard').first()).toBeVisible();
    } else {
      await expect(page.locator('table.vtable')).toBeVisible();
      await expect(page.locator('article.vcard')).toHaveCount(0);
    }
  });

  test('no horizontal page overflow in any category', async ({ page }) => {
    await page.goto('./');
    for (const c of categories) {
      await mainTab(page, c.label).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${c.key} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test('touch targets on mobile are at least 32px', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('./');
    const sizes = await page.locator('.mbtn, .sbtn, .speak-btn, .icon-btn, .pnav__link').evaluateAll((els) =>
      els.slice(0, 40).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(32);
  });
});
