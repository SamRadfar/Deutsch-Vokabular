// Real audio pipeline check (no mocks) in Chromium: tests/audio/harness.ts.
//   node scripts/audio-check.mjs
// Needs internet the first time (downloads the pinned ~96 MB voice into a reusable browser profile
// in the OS temp folder). Contacts no Firebase project. Not part of CI.
import { chromium } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

process.env.DV2_HERMETIC = '1';
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'warn' });
await server.listen();
const profile = join(tmpdir(), 'dv2-audio-check-profile');
const ctx = await chromium.launchPersistentContext(profile, { args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = false;
try {
  const page = await ctx.newPage();
  page.on('console', (m) => console.log(`  [browser:${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('worker', (w) => console.log('  [worker started]', w.url()));
  await page.goto('http://localhost:5199/tests/audio/harness.html');
  await page.click('#go');
  await page.waitForFunction(() => window.__audioCheckDone === true, null, { timeout: 15 * 60_000, polling: 1000 });
  const error = await page.evaluate(() => window.__audioCheckError);
  const result = await page.evaluate(() => window.__audioCheck);
  console.log(JSON.stringify(result, null, 2));
  const wav = await page.evaluate(() => window.__bilingualWav);
  if (wav) {
    const { writeFileSync } = await import('node:fs');
    const file = join(tmpdir(), 'dv2-bilingual-sample.wav');
    writeFileSync(file, Buffer.from(wav, 'base64'));
    console.log(`bilingual sample (neutral words) saved for listening: ${file}`);
  }
  if (error) { console.error('✖', error); failed = true; } else {
    const r = result;
    const checks = [
      ['voice stored and verified', r.stored === true],
      ['sample speech is audible (rms > 0.02)', r.sampleStats.rms > 0.02],
      ['session WAV decodes in the browser (full length)', Math.abs(r.decoded.seconds - r.sessionSeconds) < 0.05 && r.decoded.rms > 0.02],
      ['speech in word steps, silence in pauses', r.firstWordRms > 0.03 && r.firstPauseRms < 0.001],
      ['session played to the end', r.playback.finished && !r.playback.endedEarly],
      ['every item counted as practised', r.playback.completed.join() === 'a,b,c'],
      ['media session metadata set', r.mediaSession && /Shadowing/.test(r.playback.metadataTitle ?? '')],
      ['pronunciation clip plays as media (start → end, no error)', /^start@\d+$/.test(r.pronunciation[0]) && /^end@\d+$/.test(r.pronunciation[1]) && !r.pronunciation.some((e) => e.startsWith('error'))],
      ['repeated word comes from the clip cache', r.pronunciation.some((e) => e.startsWith('cached-start@'))],
      ['Persian voice speaks (rms > 0.02)', r.persianSample.rms > 0.02],
      ['bilingual order: DE→pause→FA ×3, DE example ×2, pause→FA example', r.bilingual.order.join() === [
        'de:word', 'pause:1.0s', 'fa:meaning', 'de:word', 'pause:1.0s', 'fa:meaning', 'de:word', 'pause:1.0s', 'fa:meaning',
        'de:example', 'de:example', 'pause:1.0s', 'fa:exampleFa'].join()],
      ['every German and Persian segment is audible, every pause silent', r.bilingual.speechRms.every((v) => v > 0.02) && r.bilingual.pauseRms.every((v) => v < 0.001)],
    ];
    for (const [name, ok] of checks) { console.log(`${ok ? '✔' : '✖'} ${name}`); if (!ok) failed = true; }
  }
} finally {
  await ctx.close();
  await server.close();
}
process.exitCode = failed ? 1 : 0;
