// Dashboard and learned/unlearned search filters with the real Firebase SDK (Auth + Firestore
// emulators, demo project). The sign-in popup is the Auth Emulator's stand-in, not Google OAuth.

import { expect, test } from '@playwright/test';
import vocabulary from '../../src/data/vocabulary/vocabulary.v1.json' with { type: 'json' };
import { signIn, trackErrors, uniqueEmail } from './helpers';

const first = vocabulary.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
const archTotal = vocabulary.categories[0]!.subtabs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.entries.length, 0), 0);

test('dashboard shows synced progress, survives a reload, and the search filters use it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await signIn(page, uniqueEmail('dash'), 'Dashboard User');
  await page.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` }).check();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('class', /sync-pill--ok/, { timeout: 15_000 });

  await page.getByRole('link', { name: 'پیشرفت', exact: true }).click();
  await expect(page.getByTestId('db-learned')).toHaveText('1');
  await expect(page.getByTestId('db-remaining')).toHaveText('998');
  await expect(page.getByRole('button', { name: new RegExp(`Architecture: 1 از ${archTotal} یادگرفته`) })).toBeVisible();
  await expect(page.getByTestId('db-sync')).toContainText('ذخیره شد');
  await expect(page.getByTestId('db-local')).toContainText('هنوز تمرینی روی این دستگاه ثبت نشده است');

  await page.reload();
  await expect(page.getByTestId('account-button')).toBeVisible();
  await expect(page.getByTestId('db-learned')).toHaveText('1', { timeout: 15_000 }); // still on #/progress

  await page.getByRole('link', { name: 'واژه‌ها', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'جستجوی واژه' })).toBeVisible(); // isVisible() below does not wait
  const toggle = page.getByRole('button', { name: /^فیلترها/ }); // phones fold the filters away
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('radio', { name: 'یادگرفته' }).check({ force: true });
  const results = page.getByRole('list', { name: 'نتیجه‌های جستجو' }).locator('article[data-entry-id]');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAttribute('data-entry-id', first.id);
  await page.getByRole('radio', { name: 'یادنگرفته' }).check({ force: true });
  await expect(page.getByTestId('search-count')).toHaveText('998 واژه پیدا شد');
  expect(errors).toEqual([]);
});
