// Visual review: real screenshots of the running app (no mockups).
//   node scripts/screenshots.mjs <baseUrl> <outDir> [filter]
// Sizes: desktop 1440/1920, phones 390/430; light and dark theme.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', out = 'screenshots', filter = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1920', width: 1920, height: 1080, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '430', width: 430, height: 932, mobile: true },
];
const PAGES = [
  { name: 'words', hash: '#/' },
  { name: 'search', hash: '#/', search: 'wand' },
  { name: 'mine', hash: '#/mine' },
  { name: 'review', hash: '#/review' },
  { name: 'shadowing', hash: '#/shadowing' },
  { name: 'progress', hash: '#/progress' },
];
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('dv2.pref.theme.v1', t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const name = `${p.name}-${vp.name}-${theme}`;
      if (filter && !name.includes(filter)) continue;
      await page.goto(new URL(p.hash, base).href);
      await page.waitForTimeout(600);
      if (p.search) { await page.getByRole('searchbox').fill(p.search); await page.waitForTimeout(500); }
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done');
