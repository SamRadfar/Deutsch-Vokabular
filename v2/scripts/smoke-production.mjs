// Smoke test of a deployed (or locally served) production build — read-only, no sign-in:
//   node scripts/smoke-production.mjs https://deutsch-vokabular.web.app
// Checks: HTTPS/headers, routes, assets, fonts, icons, manifest, service worker + offline reload,
// production Firebase project in the bundle, no console errors (incl. CSP violations), mobile layout.
import { chromium, devices } from '@playwright/test';

const base = (process.argv[2] ?? 'https://deutsch-vokabular.web.app').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };

const head = async (path) => { const r = await fetch(base + path, { redirect: 'manual' }); return { status: r.status, h: r.headers, text: await r.text() }; };
const root = await head('/');
check('index served', root.status === 200 && root.text.includes('<div id="root">'), `HTTP ${root.status}`);
check('index is not cached long', /no-cache/.test(root.h.get('cache-control') ?? ''), root.h.get('cache-control') ?? '');
check('CSP present', (root.h.get('content-security-policy') ?? '').includes("default-src 'self'"));
check('nosniff + referrer policy', root.h.get('x-content-type-options') === 'nosniff' && !!root.h.get('referrer-policy'));
check('indexable production page', !root.text.includes('noindex') && root.text.includes('<title>Deutsch Vokabular'));
const asset = /src="(\/assets\/index-[^"]+\.js)"/.exec(root.text)?.[1];
const js = asset ? await head(asset) : null;
check('hashed asset immutable', !!js && /immutable/.test(js.h.get('cache-control') ?? ''), js?.h.get('cache-control') ?? 'no asset');
check('bundle uses the production project', !!js && js.text.includes('"deutsch-vokabular"') || !!js && /deutsch-vokabular[^-]/.test(js.text));
check('no dev/emulator project in bundle', !!js && !js.text.includes('deutsch-vokabular-v2-dev') && !js.text.includes('demo-deutsch-vokabular'));
const sw = await head('/sw.js');
check('service worker served, not cached', sw.status === 200 && /no-cache/.test(sw.h.get('cache-control') ?? ''));
const version = await head('/version.json');
check('version.json', version.status === 200, version.text.replace(/\s+/g, ' ').slice(0, 120));
const manifest = await head('/manifest.webmanifest');
check('manifest', manifest.status === 200 && JSON.parse(manifest.text).icons.length === 3, manifest.h.get('content-type') ?? '');
const missing = await head('/assets/does-not-exist.js');
check('missing asset is a real 404 (no HTML fallback)', missing.status === 404, `HTTP ${missing.status}`);
const deep = await head('/some/deep/link');
check('deep link falls back to the app', deep.status === 200 && deep.text.includes('<div id="root">'));

const browser = await chromium.launch();
for (const [label, opts] of [['desktop 1440', { viewport: { width: 1440, height: 900 } }], ['mobile 390', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }]]) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  for (const route of ['#/', '#/mine', '#/review', '#/shadowing', '#/progress']) {
    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
    const heading = await page.getByRole('heading', { level: 2 }).first().textContent();
    check(`${label} ${route}`, !!heading, heading ?? 'no heading');
  }
  await page.reload({ waitUntil: 'networkidle' });
  check(`${label} reload keeps the route`, page.url().endsWith('#/progress'));
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
  check(`${label} fonts loaded`, fonts.some((f) => f.includes('Inter')) && fonts.some((f) => f.includes('Vazirmatn')), [...new Set(fonts)].join(', '));
  const icons = await page.locator('svg.lucide').count();
  check(`${label} line icons rendered`, icons > 5, `${icons}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label} no horizontal overflow`, overflow <= 0, `${overflow}px`);
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  const words = await page.locator('[data-entry-id]').count();
  check(`${label} vocabulary rendered`, words > 0, `${words} entries in the first subtab`);
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.scriptURL ?? null; });
  check(`${label} service worker active`, !!sw, sw ?? '');
  await page.reload({ waitUntil: 'networkidle' });
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const offlineOk = await page.locator('[data-entry-id]').count();
  const banner = await page.getByTestId('offline-banner').isVisible().catch(() => false);
  check(`${label} works offline after first visit`, offlineOk > 0 && banner, `${offlineOk} entries, offline banner ${banner}`);
  await ctx.setOffline(false);
  const relevant = errors.filter((e) => !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED|net::ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(e));
  check(`${label} no console errors (incl. CSP)`, relevant.length === 0, relevant.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
