// Real audio pipeline check in a real browser (no mocks): downloads the pinned on-device voice,
// verifies it, synthesizes German speech in the worker, renders a shadowing session into one WAV,
// decodes it with the browser's own audio decoder, and plays it through AudioSessionPlayer with the
// Media Session API. Uses neutral sample sentences only (no user vocabulary).
// Run: node scripts/audio-check.mjs   (results: window.__audioCheck)

import { createDeviceSpeechService, createVoiceHandle } from '../../src/features/audio/deviceSpeech';
import { sharedMediaOutput } from '../../src/features/audio/mediaOutput';
import { openNeuralVoice } from '../../src/features/audio/neuralVoice';
import { downloadVoice, voiceDownloaded, VOICE_TOTAL_BYTES } from '../../src/features/audio/voiceAssets';
import { DEFAULT_PREFERENCES } from '../../src/features/shadowing/settings';
import { AudioSessionPlayer } from '../../src/features/shadowing/audioSession/audioSessionPlayer';
import { renderSession } from '../../src/features/shadowing/audioSession/render';
import type { WordId } from '../../src/models/vocabulary';

declare global {
  interface Window { __audioCheck?: Record<string, unknown>; __audioCheckDone?: boolean; __audioCheckError?: string }
}

const ITEMS = [
  { id: 'a' as WordId, word: 'der Tisch', example: 'Der Tisch steht in der Küche.' },
  { id: 'b' as WordId, word: 'lernen', example: 'Ich lerne jeden Tag Deutsch.' },
  { id: 'c' as WordId, word: 'das Fenster', example: '' },
];

function stats(samples: Float32Array) {
  let sum = 0;
  let peak = 0;
  let voiced = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    sum += v * v;
    peak = Math.max(peak, v);
    if (v > 0.02) voiced++;
  }
  return { rms: Math.sqrt(sum / Math.max(1, samples.length)), peak, voicedShare: voiced / Math.max(1, samples.length) };
}

async function run() {
  const out: Record<string, unknown> = {};
  window.__audioCheck = out;
  const log = (m: string) => console.log(`[audio-check] ${m}`);
  let t = performance.now();
  log('checking stored voice');
  if (!(await voiceDownloaded())) {
    log('downloading voice');
    await downloadVoice(() => {});
    out.downloadMs = Math.round(performance.now() - t);
  }
  out.downloadedBytes = VOICE_TOTAL_BYTES;
  out.stored = await voiceDownloaded();

  log('opening voice worker');
  t = performance.now();
  const voice = await openNeuralVoice();
  log('voice ready');
  out.openMs = Math.round(performance.now() - t);
  t = performance.now();
  const pcm = await voice.synthesize('Guten Tag! Das ist ein Test der deutschen Aussprache.', 0.85);
  out.sampleSynthMs = Math.round(performance.now() - t);
  out.sampleSeconds = +(pcm.length / voice.sampleRate).toFixed(2);
  out.sampleStats = stats(pcm);

  log('rendering session');
  t = performance.now();
  const progress: Array<[number, number]> = [];
  const rendered = await renderSession(ITEMS, { wordRepeats: 2, exampleRepeats: 1, pauseSec: 1, rate: 0.85 }, voice, {
    onProgress: (d, n) => progress.push([d, n]),
  });
  voice.dispose();
  out.renderMs = Math.round(performance.now() - t);
  out.renderProgress = progress;
  out.sessionSeconds = +rendered.duration.toFixed(2);
  out.wavBytes = rendered.wav.size;
  out.timeline = rendered.items.map((i) => ({ id: i.id, start: +i.start.toFixed(2), end: +i.end.toFixed(2), steps: i.steps.length }));

  // The browser's own decoder must accept the file, and it must contain speech AND silence.
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await rendered.wav.arrayBuffer());
  out.decoded = { seconds: +decoded.duration.toFixed(2), sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, ...stats(decoded.getChannelData(0)) };
  // energy inside the first speak step vs. inside the first pause step
  const first = rendered.items[0]!;
  const seg = (a: number, b: number) => decoded.getChannelData(0).subarray(Math.floor(a * decoded.sampleRate), Math.floor(b * decoded.sampleRate));
  out.firstWordRms = stats(seg(first.steps[0]!.start, first.steps[0]!.end)).rms;
  out.firstPauseRms = stats(seg(first.steps[1]!.start, first.steps[1]!.end)).rms;
  await ctx.close();

  // Play it through the session player (HTMLAudioElement + Media Session), at 4× to keep this short.
  log('playing');
  const completed: string[] = [];
  const player = new AudioSessionPlayer(rendered, { onItemCompleted: (id) => completed.push(id) });
  const audioEl = (player as unknown as { audio: HTMLAudioElement }).audio;
  out.mediaSession = 'mediaSession' in navigator;
  player.play();
  audioEl.playbackRate = 4;
  await new Promise<void>((resolve, reject) => {
    const stop = setTimeout(() => reject(new Error('playback did not finish')), 60_000);
    player.subscribe(() => { if (player.getSnapshot().status === 'finished') { clearTimeout(stop); resolve(); } });
  });
  const snap = player.getSnapshot();
  out.playback = {
    finished: snap.status === 'finished',
    endedEarly: snap.endedEarly,
    completed,
    metadataTitle: (navigator.mediaSession?.metadata as MediaMetadata | null)?.title ?? null,
  };
  player.dispose();

  // Pronunciation buttons on iPhone: the on-device voice played through the shared <audio> element.
  log('pronunciation via media');
  const device = createDeviceSpeechService({ output: sharedMediaOutput(), voice: createVoiceHandle() });
  const events: string[] = [];
  t = performance.now();
  await new Promise<void>((resolve) => {
    device.speak('die Außenwand', {
      onStart: () => events.push(`start@${Math.round(performance.now() - t)}`),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => { events.push(`end@${Math.round(performance.now() - t)}`); resolve(); },
    });
  });
  t = performance.now();
  await new Promise<void>((resolve) => device.speak('die Außenwand', { onStart: () => events.push(`cached-start@${Math.round(performance.now() - t)}`), onEnd: () => resolve() }));
  out.pronunciation = events;

  // Bilingual (German + Persian) session — the real Persian voice ("Amir", fa_IR).
  log('downloading / opening the Persian voice');
  if (!(await voiceDownloaded({}, 'fa'))) await downloadVoice(() => {}, undefined, {}, 'fa');
  const de = await openNeuralVoice();
  const fa = await openNeuralVoice({ voice: 'fa' });
  t = performance.now();
  const faPcm = await fa.synthesize('دیوار خارجی باید به‌خوبی عایق‌بندی شود.', 1);
  out.persianSample = { synthMs: Math.round(performance.now() - t), seconds: +(faPcm.length / fa.sampleRate).toFixed(2), ...stats(faPcm) };
  const bi = await renderSession(
    [{ id: 'bi' as WordId, word: 'der Tisch', fa: 'میز', example: 'Der Tisch steht in der Küche.', exampleFa: 'میز در آشپزخانه است.' }],
    { ...DEFAULT_PREFERENCES, wordRepeats: 3, faMeaningRepeats: 1, exampleRepeats: 2, faExample: true, faExampleRepeats: 1, deFaDelaySec: 1, pauseSec: 0 },
    { de, fa }, { leadInMs: 300 },
  );
  de.dispose(); fa.dispose();
  const ctx2 = new AudioContext();
  const dec = await ctx2.decodeAudioData(await bi.wav.arrayBuffer());
  const ch = dec.getChannelData(0);
  const rmsOf = (a: number, b: number) => stats(ch.subarray(Math.floor(a * dec.sampleRate), Math.floor(b * dec.sampleRate))).rms;
  out.bilingual = {
    seconds: +bi.duration.toFixed(2),
    order: bi.items[0]!.steps.map((x) => (x.step.kind === 'speak' ? `${x.step.lang}:${x.step.target}` : `pause:${(x.end - x.start).toFixed(1)}s`)),
    speechRms: bi.items[0]!.steps.filter((x) => x.step.kind === 'speak').map((x) => +rmsOf(x.start, x.end).toFixed(3)),
    pauseRms: bi.items[0]!.steps.filter((x) => x.step.kind === 'pause').map((x) => +rmsOf(x.start, x.end).toFixed(4)),
  };
  await ctx2.close();
  // Hand the file to the check script (saved for listening).
  const bytes = new Uint8Array(await bi.wav.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  (window as unknown as { __bilingualWav: string }).__bilingualWav = btoa(bin);
  out.ok = true;
}

document.getElementById('go')!.addEventListener('click', () => {
  run().then(() => { window.__audioCheckDone = true; }, (e: unknown) => { window.__audioCheckError = String((e as Error)?.stack ?? e); window.__audioCheckDone = true; });
});
