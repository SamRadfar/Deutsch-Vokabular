// REAL desktop check (Windows, headed Chrome / Edge): the floating Shadowing card stays visible and
// keeps updating while the main browser window is MINIMIZED, and the main window never comes back
// to the foreground. Window state is read from Windows itself (always-on-top flag, minimized,
// foreground) — no screenshots. Run: npm run test:desktop   (starts the emulators; not part of CI)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/fixtures';
import { installSpeechMock } from '../helpers/speechMock';

interface Win { title: string; process: string; iconic: boolean; topmost: boolean; foreground: boolean }
/** Browser frame windows end with " - Google Chrome" / " - Microsoft Edge"; the PiP window is titled after the page only. */
const isFrame = (w: Win) => / - (Google Chrome|Microsoft.*Edge)$/.test(w.title);
const SCRIPT = fileURLToPath(new URL('../../scripts/lib/win-windows.ps1', import.meta.url));
/** Only the test's own windows (title marker); other windows of the tester are never read. */
const windows = (marker = 'DV-MAIN-WINDOW'): Win[] => {
  const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Marker', marker], { encoding: 'utf8' }).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Win | Win[];
  return Array.isArray(parsed) ? parsed : [parsed];
};
const pip = (page: Page, sel: string) => page.evaluate((s) => {
  const w = (window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
  return w ? (w.document.querySelector(s)?.textContent ?? null) : '__no-window__';
}, sel);

test('floating card: always on top, keeps updating with the main window minimized, no focus stealing', async ({ page }) => {
  test.setTimeout(180_000);
  await installSpeechMock(page, 700);
  await page.goto('./');
  await page.evaluate(() => { document.title = 'DV-MAIN-WINDOW'; });
  await page.getByRole('link', { name: 'تلفظ', exact: true }).click();
  await page.getByLabel('تعداد واژه در جلسه').selectOption('5');
  await page.getByLabel('تکرار واژه آلمانی').selectOption('1');
  await page.getByLabel('تکرار جمله مثال آلمانی').selectOption('1');
  await page.getByRole('slider').fill('3');
  await page.getByRole('button', { name: 'شروع تمرین (5 واژه)' }).click();
  await page.evaluate(() => { document.title = 'DV-MAIN-WINDOW'; });
  await page.getByTestId('floating-toggle').click();
  await expect.poll(() => pip(page, '[data-testid="floating-pos"]')).toBe('1 / 5');

  // Minimize the main browser window (like the user would).
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  await expect.poll(() => windows().find(isFrame)?.iconic).toBe(true);
  console.log('main document visibility while minimized:', await page.evaluate(() => document.visibilityState));

  const before = windows();
  console.log('windows after minimizing:', JSON.stringify(before));
  const main = before.find(isFrame);
  const floating = before.filter((w) => !isFrame(w) && !w.iconic && w.topmost);
  expect(main?.iconic, 'main window minimized').toBe(true);
  expect(floating.length, 'a visible always-on-top browser window (the floating card)').toBeGreaterThan(0);

  // The session continues while minimized and the card follows it.
  const spokenAtMinimize = await page.evaluate(() => window.__spoken.length);
  await expect.poll(() => pip(page, '[data-testid="floating-pos"]'), { timeout: 60_000, intervals: [500] }).toBe('3 / 5');
  expect(await page.evaluate(() => window.__spoken.length)).toBeGreaterThan(spokenAtMinimize + 2);

  const after = windows();
  console.log('windows after two word changes:', JSON.stringify(after));
  const mainAfter = after.find(isFrame);
  expect(mainAfter?.iconic, 'main window still minimized').toBe(true);
  expect(mainAfter?.foreground, 'main window did not take the foreground').toBe(false);
  expect(after.some((w) => !isFrame(w) && !w.iconic && w.topmost)).toBe(true);

  // Controls in the floating window while minimized.
  await page.evaluate(() => {
    const w = (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window;
    w.document.querySelector<HTMLButtonElement>('button[aria-label="توقف موقت"]')!.click();
  });
  await expect.poll(() => pip(page, '[data-testid="floating-state"]')).toBe('متوقف');
  await page.evaluate(() => {
    const w = (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window;
    w.document.querySelector<HTMLButtonElement>('button[aria-label="پخش"]')!.click();
  });
  await expect.poll(() => pip(page, '[data-testid="floating-state"]')).not.toBe('متوقف');
});

test('the real speech engine keeps reporting while the window is minimized (silent utterances)', async ({ page }) => {
  await page.goto('./');
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await page.evaluate(() => { document.title = 'DV-SPEECH-WINDOW'; });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  await expect.poll(() => windows('DV-SPEECH-WINDOW').find(isFrame)?.iconic).toBe(true);
  const result = await page.evaluate(() => new Promise<string[]>((resolve) => {
    const log: string[] = [];
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('de'));
    log.push(`german voices: ${voices.length}`);
    const u = new SpeechSynthesisUtterance('Guten Tag, das ist ein Test.');
    u.lang = 'de-DE';
    u.volume = 0; // engine runs, nothing audible on the tester's laptop
    if (voices[0]) u.voice = voices[0];
    const t0 = performance.now();
    u.onstart = () => log.push(`start ${Math.round(performance.now() - t0)}ms`);
    u.onend = () => { log.push(`end ${Math.round(performance.now() - t0)}ms`); resolve(log); };
    u.onerror = (e) => { log.push(`error ${e.error}`); resolve(log); };
    speechSynthesis.speak(u);
    setTimeout(() => { log.push('timeout'); resolve(log); }, 20_000);
  }));
  console.log('speech while minimized:', result.join(' | '));
  expect(result.some((l) => l.startsWith('end'))).toBe(true);
});
