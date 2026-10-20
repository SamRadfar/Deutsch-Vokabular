// v2.0.2 regressions in the production build: pronunciation feedback, locked-screen mode UI and the
// phone tab bar's safe-area spacing (Chromium's safe-area emulation stands in for a notched phone).

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installSpeechMock } from '../helpers/speechMock';

const spoken = (page: Page) => page.evaluate(() => window.__spoken.map((s) => s.text));

async function setSafeArea(page: Page, bottom: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 0, left: 0, right: 0, bottom } } as never);
}

test('pronunciation: word and example buttons speak German in the vocabulary', async ({ page }) => {
  await installSpeechMock(page);
  await page.goto('./');
  const word = page.getByRole('button', { name: /^Aussprache anhören:/ }).first();
  await word.click();
  await expect.poll(() => spoken(page)).toHaveLength(1);
  const label = (await word.getAttribute('aria-label'))!.replace(/^Aussprache anhören: /, '').replace(/ \(stop\)$/, '');
  expect((await spoken(page))[0]).toBe(label.replace(/^(der|die|das|ein|eine)\s+/i, ''));
  expect(await page.evaluate(() => window.__spoken[0]!.lang)).toBe('de-DE');
  await page.getByRole('button', { name: /^Beispiel anhören:/ }).first().click();
  await expect.poll(() => spoken(page)).toHaveLength(2);
  await expect(page.getByTestId('speech-notice')).toHaveCount(0);
});

test('pronunciation: an engine that never starts produces a clear message, not silence', async ({ page }) => {
  await installSpeechMock(page);
  await page.addInitScript(() => {
    // A browser that accepts speak() but never plays anything (no voice / no audio output).
    window.speechSynthesis.speak = () => {};
  });
  await page.goto('./');
  await page.getByRole('button', { name: /^Aussprache anhören:/ }).first().click();
  await expect(page.getByTestId('speech-notice')).toContainText('صدایی پخش نشد', { timeout: 10_000 });
  await expect(page.getByTestId('speech-notice')).toBeInViewport();
});

test('shadowing offers the locked-screen mode with an honest download prompt', async ({ page }) => {
  await installSpeechMock(page);
  await page.goto('./');
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await page.getByRole('radio', { name: /پخش با صفحهٔ قفل/ }).check();
  await expect(page.getByTestId('sh-voice')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByRole('button', { name: /دانلود صدای آلمانی.*96 MB/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^آماده‌سازی جلسه/ })).toBeDisabled();
  await page.getByText('آزمایش صدا').click();
  await page.getByRole('button', { name: /نمونه با صدای مرورگر/ }).click();
  await expect.poll(() => spoken(page)).toEqual(['Guten Tag! Das ist ein Test der deutschen Aussprache.']);
});

test.describe('phone tab bar and safe area', () => {
  test.skip(({ isMobile }) => !isMobile, 'the tab bar exists on phones only');

  for (const inset of [0, 34]) {
    test(`respects a ${inset}px bottom inset with breathing room, aligned items and no overlap`, async ({ page }) => {
      await setSafeArea(page, inset);
      await page.goto('./');
      const nav = page.locator('nav.pnav--bottom');
      await expect(nav).toBeVisible();
      const padding = await nav.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(padding).toBe(12 + inset);
      const viewport = page.viewportSize()!;
      const box = (await nav.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(viewport.height);

      // Icons and labels sit centred in the 56px tap row, above the breathing room + inset.
      const rows = await nav.getByRole('link').evaluateAll((links) => links.map((a) => {
        const r = a.getBoundingClientRect();
        const icon = a.querySelector('svg')!.getBoundingClientRect();
        const label = a.querySelector('.pnav__label')!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, icon: icon.top, iconBottom: icon.bottom, label: label.top, labelBottom: label.bottom };
      }));
      for (const r of rows) {
        expect(r.height).toBeGreaterThanOrEqual(48);
        expect(r.iconBottom).toBeLessThanOrEqual(r.label + 1);
        const above = r.icon - r.top;
        const below = r.bottom - r.labelBottom;
        expect(Math.abs(above - below)).toBeLessThanOrEqual(8);
        expect(viewport.height - r.bottom).toBeGreaterThanOrEqual(12 + inset - 1);
      }
      expect(new Set(rows.map((r) => Math.round(r.top))).size).toBe(1);

      // The end of every section stays visible above the bar.
      for (const section of ['', 'review', 'shadowing', 'progress']) {
        await page.goto(`./#/${section}`);
        await page.waitForTimeout(150);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(100);
        const lastBottom = await page.evaluate(() => {
          const main = document.querySelector('main')!;
          const kids = [...main.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 1 && e.checkVisibility() && getComputedStyle(e).position !== 'absolute');
          const last = kids.reduce((m, e) => (e.getBoundingClientRect().bottom > m.getBoundingClientRect().bottom ? e : m), kids[0]!);
          return { bottom: last.getBoundingClientRect().bottom, what: `${last.tagName}.${last.className}` };
        });
        const navTop = (await nav.boundingBox())!.y;
        expect(lastBottom.bottom, `#/${section}: ${lastBottom.what}`).toBeLessThanOrEqual(navTop);
      }
    });
  }
});
