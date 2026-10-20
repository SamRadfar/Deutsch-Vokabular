// Locked-screen shadowing: the session is rendered into ONE audio file (render.ts) and played by
// AudioSessionPlayer (HTMLAudioElement + Media Session). Synthesis here is a deterministic tone
// generator; the real on-device voice and real playback are checked by scripts/audio-check.mjs and
// on devices (docs/AUDIO.md).
import { describe, expect, it, vi } from 'vitest';
import type { WordId } from '../../../src/models/vocabulary';
import { AudioSessionPlayer, type AudioLike, type MediaSessionLike } from '../../../src/features/shadowing/audioSession/audioSessionPlayer';
import { renderSession, RenderAbortedError, silentWav, trimSilence, type Synthesizer } from '../../../src/features/shadowing/audioSession/render';

const SR = 1000; // 1 kHz keeps the numbers readable
const id = (s: string) => s as WordId;

/** Each text → a 0.5 s tone per word (+ 0.1 s of leading/trailing silence that trimming removes). */
function toneVoice(): Synthesizer & { calls: string[] } {
  const calls: string[] = [];
  return {
    sampleRate: SR,
    calls,
    async synthesize(text) {
      calls.push(text);
      const words = text.split(/\s+/).length;
      const body = Math.round(words * 0.5 * SR);
      const pcm = new Float32Array(body + 200);
      for (let i = 0; i < body; i++) pcm[100 + i] = 0.3 * Math.sin(i / 3);
      return pcm;
    },
  };
}

const ITEMS = [
  { id: id('a'), word: 'der Tisch', example: 'Der Tisch ist neu.' },
  { id: id('b'), word: 'lernen', example: '' },
];
const SETTINGS = { wordRepeats: 2, exampleRepeats: 1, pauseSec: 1, rate: 1 };

async function decodeWav(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const v = new DataView(buf);
  const text = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4));
  return {
    riff: text(0), wave: text(8), fmt: text(12), data: text(36),
    format: v.getUint16(20, true), channels: v.getUint16(22, true), rate: v.getUint32(24, true), bits: v.getUint16(34, true),
    samples: new Int16Array(buf, 44, v.getUint32(40, true) / 2),
  };
}

describe('renderSession', () => {
  it('renders every repetition and pause into one valid 16-bit mono WAV, synthesizing each text once', async () => {
    const voice = toneVoice();
    const progress: Array<[number, number]> = [];
    const r = await renderSession(ITEMS, SETTINGS, voice, { leadInMs: 200, onProgress: (d, n) => progress.push([d, n]) });
    expect(voice.calls).toEqual(['der Tisch', 'Der Tisch ist neu.', 'lernen']);
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);

    const wav = await decodeWav(r.wav);
    expect(wav).toMatchObject({ riff: 'RIFF', wave: 'WAVE', fmt: 'fmt ', data: 'data', format: 1, channels: 1, rate: SR, bits: 16 });
    expect(wav.samples.length / SR).toBeCloseTo(r.duration, 3);

    const [a, b] = r.items;
    // item a: word, pause, word, pause, example, pause(1 s + example length)
    expect(a!.steps.map((s) => `${s.step.kind}:${s.step.target}`)).toEqual([
      'speak:word', 'pause:word', 'speak:word', 'pause:word', 'speak:example', 'pause:example',
    ]);
    const len = (s: { start: number; end: number }) => +(s.end - s.start).toFixed(3);
    const word = len(a!.steps[0]!);
    expect(word).toBeCloseTo(1 + 0.12, 2); // 2 words × 0.5 s, trimmed, plus 2 × 60 ms margin
    expect(len(a!.steps[1]!)).toBe(1); // learner pause
    expect(len(a!.steps[5]!)).toBeCloseTo(1 + len(a!.steps[4]!), 2); // extended by the sentence length
    expect(a!.start).toBeCloseTo(0.2, 3); // lead-in silence
    expect(b!.start).toBeCloseTo(a!.end, 6);
    expect(b!.steps).toHaveLength(4);

    // audible speech in speak steps, digital silence in pauses
    const at = (t: number) => Math.round(t * SR);
    const slice = (s: { start: number; end: number }) => wav.samples.subarray(at(s.start), at(s.end));
    const peak = (x: Int16Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(slice(a!.steps[0]!))).toBeGreaterThan(25_000); // normalised to ~0.9
    expect(peak(slice(a!.steps[1]!))).toBe(0);
  });

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    const voice = toneVoice();
    const p = renderSession(ITEMS, SETTINGS, voice, { signal: ctrl.signal, onProgress: (d) => { if (d === 1) ctrl.abort(); } });
    await expect(p).rejects.toBeInstanceOf(RenderAbortedError);
    expect(voice.calls.length).toBeLessThan(3);
  });

  it('trims leading and trailing silence and makes short silent primers', async () => {
    const pcm = new Float32Array([0, 0, 0, 0.5, -0.5, 0, 0]);
    expect([...trimSilence(pcm, 1000, 0.01, 0)]).toEqual([0.5, -0.5]);
    expect((await decodeWav(silentWav(50, 1000))).samples.length).toBe(50);
  });
});

/** HTMLAudioElement stand-in: the test moves `currentTime` like the browser would while playing. */
class FakeAudio implements AudioLike {
  src = '';
  preload = '';
  currentTime = 0;
  duration = NaN;
  playing = false;
  playResult: Promise<void> = Promise.resolve();
  private readonly l = new Map<string, Set<() => void>>();
  play = vi.fn(() => { this.playing = true; this.fire('play'); return this.playResult; });
  pause = vi.fn(() => { if (this.playing) { this.playing = false; this.fire('pause'); } });
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  addEventListener(t: string, f: () => void) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t)!.add(f); }
  removeEventListener(t: string, f: () => void) { this.l.get(t)?.delete(f); }
  fire(t: string) { for (const f of [...(this.l.get(t) ?? [])]) f(); }
  /** Natural playback progress (timeupdate). */
  advance(to: number) { this.currentTime = to; this.fire('timeupdate'); }
  /** A user / lock-screen seek. */
  seekTo(to: number) { this.fire('seeking'); this.currentTime = to; this.fire('seeked'); }
}

function fakeMedia() {
  const handlers = new Map<string, ((d: { seekTime?: number; seekOffset?: number }) => void) | null>();
  const media: MediaSessionLike & { handlers: typeof handlers; positions: number[] } = {
    metadata: null,
    playbackState: 'none',
    handlers,
    positions: [],
    setActionHandler: (a, h) => { handlers.set(a, h); },
    setPositionState: (s) => { media.positions.push(s.position); },
  };
  return media;
}

async function setup() {
  const rendered = await renderSession(ITEMS, SETTINGS, toneVoice(), { leadInMs: 200 });
  const audio = new FakeAudio();
  const media = fakeMedia();
  const urls = { create: vi.fn(() => 'blob:session'), revoke: vi.fn() };
  const completed: string[] = [];
  const finished = vi.fn();
  const player = new AudioSessionPlayer(rendered, {
    audio, mediaSession: media, urls, now: () => 1000,
    createMetadata: (init) => init, onItemCompleted: (i) => completed.push(i), onFinished: finished,
  });
  return { rendered, audio, media, urls, completed, finished, player };
}

describe('AudioSessionPlayer (locked-screen playback)', () => {
  it('plays the in-memory file and derives item, step and progress from the audio position', async () => {
    const { rendered, audio, completed, player, urls } = await setup();
    expect(audio.src).toBe('blob:session');
    expect(urls.create).toHaveBeenCalledWith(rendered.wav);
    player.play();
    expect(player.getSnapshot()).toMatchObject({ status: 'playing', index: 0, stepIndex: 0 });
    const a = rendered.items[0]!;
    audio.advance(a.steps[0]!.start + 0.01);
    expect(player.getSnapshot()).toMatchObject({ stepIndex: 0, speaking: true });
    audio.advance(a.steps[1]!.start + 0.25);
    const s = player.getSnapshot();
    expect(s).toMatchObject({ stepIndex: 1, speaking: false, pauseMs: 1000 });
    expect(s.pauseElapsedMs).toBeGreaterThan(200);
    audio.advance(rendered.items[1]!.start + 0.1);
    expect(completed).toEqual(['a']);
    expect(player.getSnapshot()).toMatchObject({ index: 1, completedIds: ['a'] });
  });

  it('catches up after a long suspension (screen locked, no timeupdate for minutes)', async () => {
    const { rendered, audio, completed, finished, player } = await setup();
    player.play();
    audio.advance(0.1);
    audio.advance(rendered.duration); // the next event the page sees is the very end
    audio.fire('ended');
    expect(completed).toEqual(['a', 'b']);
    expect(player.getSnapshot()).toMatchObject({ status: 'finished', endedEarly: false });
    expect(finished).toHaveBeenCalledOnce();
  });

  it('lock-screen controls: play, pause, next, previous and seeking; skipped items are not counted', async () => {
    const { rendered, audio, media, completed, player } = await setup();
    for (const action of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto']) {
      expect(media.handlers.get(action), action).toBeTypeOf('function');
    }
    expect(media.metadata).toMatchObject({ title: 'Shadowing · Wort 1 / 2', artist: 'Deutsch Vokabular' });
    media.handlers.get('play')!({});
    expect(audio.play).toHaveBeenCalledOnce();
    expect(media.playbackState).toBe('playing');
    media.handlers.get('pause')!({});
    expect(audio.pause).toHaveBeenCalled();
    expect(player.getSnapshot().status).toBe('paused');
    expect(media.playbackState).toBe('paused');

    media.handlers.get('nexttrack')!({}); // jump to item b: a is skipped, not practised
    expect(audio.currentTime).toBeCloseTo(rendered.items[1]!.start, 6);
    audio.fire('seeking'); audio.fire('seeked');
    expect(player.getSnapshot().index).toBe(1);
    expect(media.metadata).toMatchObject({ title: 'Shadowing · Wort 2 / 2' });
    audio.advance(rendered.items[1]!.start + 0.5);
    media.handlers.get('previoustrack')!({}); // early in b → back to a
    expect(player.getSnapshot().index).toBe(0);
    media.handlers.get('seekto')!({ seekTime: rendered.items[1]!.start + 1 });
    expect(player.getSnapshot().index).toBe(1);
    expect(completed).toEqual([]);
    expect(media.positions.length).toBeGreaterThan(0);
  });

  it('reports a blocked start (autoplay policy) instead of pretending to play', async () => {
    const { audio, player } = await setup();
    audio.playResult = Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    player.play();
    await Promise.resolve(); await Promise.resolve();
    expect(player.getSnapshot()).toMatchObject({ status: 'paused', notice: 'blocked' });
  });

  it('stop rewinds to the current item; end finishes early; dispose releases the audio and the lock-screen handlers', async () => {
    const { rendered, audio, media, urls, finished, player } = await setup();
    player.play();
    audio.advance(rendered.items[1]!.start + 0.7);
    player.stop();
    expect(player.getSnapshot().status).toBe('idle');
    expect(audio.currentTime).toBeCloseTo(rendered.items[1]!.start, 6);
    player.end();
    expect(player.getSnapshot()).toMatchObject({ status: 'finished', endedEarly: true });
    expect(finished).toHaveBeenCalledOnce();
    player.dispose();
    expect(urls.revoke).toHaveBeenCalledWith('blob:session');
    expect(audio.src).toBe('');
    expect([...media.handlers.values()].every((h) => h === null)).toBe(true);
    expect(media.metadata).toBeNull();
  });
});
