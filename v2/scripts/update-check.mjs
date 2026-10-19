// Live service-worker update check (read-only, no sign-in): load the CURRENT release, keep the
// browser open while a new release is deployed, then verify the switch.
//   node scripts/update-check.mjs https://deutsch-vokabular.web.app <expected-new-version>
import { chromium } from '@playwright/test';

const [base = 'https://deutsch-vokabular.web.app', expected] = process.argv.slice(2);
if (!expected) { console.error('usage: update-check.mjs <url> <expected-new-version>'); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'allow' });
const page = await ctx.newPage();
const caches = () => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) {
    const reqs = await (await caches.open(k)).keys();
    out[k] = { files: reqs.length, vocabularyChunk: reqs.some((r) => /vocabulary-content/.test(r.url)) };
  }
  return out;
});
const live = async () => (await (await fetch(`${base}/version.json?ts=${Date.now()}`)).json()).version;

await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
const before = await live();
console.log(`• before: release ${before}, caches ${JSON.stringify(await caches())}`);
console.log(`• waiting for release ${expected} …`);
const t0 = Date.now();
while ((await live()) !== expected) {
  if (Date.now() - t0 > 15 * 60_000) { console.error('✖ new release not live within 15 min'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log(`• release ${expected} is live — reloading the open page`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000); // new worker installs, activates and reloads the page
await page.waitForLoadState('networkidle');
const after = await caches();
const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
const welcome = await page.getByTestId('welcome').isVisible().catch(() => false);
const text = await page.locator('body').innerText();
const ok = Object.keys(after).length === 1 && Object.keys(after)[0].includes(expected) && !Object.values(after).some((c) => c.vocabularyChunk)
  && welcome && !text.includes('die Außenwand');
console.log(`• after: caches ${JSON.stringify(after)}, worker ${sw}, welcome ${welcome}`);
console.log(ok ? '✔ the open page moved to the new release; old caches (incl. the old vocabulary bundle) are gone' : '✖ update check FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
