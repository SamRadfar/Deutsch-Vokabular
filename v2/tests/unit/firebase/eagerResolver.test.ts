import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { eagerPopupResolver } from '../../../src/services/firebase/app';

// Vitest resolves `firebase/auth` to its Node build, which has no popup resolver. The app bundle
// uses the browser build, so these checks load exactly that file.
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/@firebase/auth');
const browserEntry = (JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as { exports: { '.': { browser: { import: string } } } })
  .exports['.'].browser.import;

type ResolverClass = new () => { _shouldInitProactively: boolean };
async function browserResolver(): Promise<ResolverClass> {
  const mod = (await import(pathToFileURL(resolve(pkgDir, browserEntry)).href)) as { browserPopupRedirectResolver: ResolverClass };
  return mod.browserPopupRedirectResolver;
}

describe('eagerPopupResolver', () => {
  it('the browser SDK still has the internal _shouldInitProactively getter we override', async () => {
    // If this fails after an SDK upgrade, re-check docs/FIREBASE_VALIDATION.md §3: the desktop
    // first-sign-in fix would silently stop working.
    const Resolver = await browserResolver();
    expect(Object.getOwnPropertyDescriptor(Resolver.prototype, '_shouldInitProactively')?.get).toBeTypeOf('function');
  });

  it('opts every browser into eager initialisation and remains a real resolver', async () => {
    const Resolver = await browserResolver();
    expect(new Resolver()._shouldInitProactively).toBe(false); // jsdom = "desktop": lazy by default
    const Eager = eagerPopupResolver(Resolver);
    const instance = new Eager();
    expect(instance._shouldInitProactively).toBe(true);
    expect(instance).toBeInstanceOf(Resolver);
  });

  it('returns non-constructors unchanged', () => {
    const odd = { notAClass: true };
    expect(eagerPopupResolver(odd)).toBe(odd);
  });
});
