// Mobile (iPhone) playback regressions (v2.0.2): on iOS, browser speech can be silenced by the
// silent switch without any error, so pronunciation is routed to the on-device voice played as
// media; the media element is unlocked inside the tap; failures are reported, never faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeviceSpeechService, createVoiceHandle } from '../../../src/features/audio/deviceSpeech';
import { createMediaOutput, type MediaOutput } from '../../../src/features/audio/mediaOutput';
import { chooseRoute, createRoutedSpeech, isAppleMobile } from '../../../src/features/audio/routedSpeech';
import type { NeuralVoice } from '../../../src/features/audio/neuralVoice';
import type { SpeakOptions, SpeechService } from '../../../src/features/pronunciation/speechService';
import { sameOriginAuthDomain } from '../../../src/services/firebase/config';

/** <audio> stand-in: play() resolves (or rejects like iOS without a gesture), events are fired by the test. */
class FakeEl {
  src = '';
  preload = '';
  plays: string[] = [];
  reject: string | null = null;
  private l = new Map<string, Array<() => void>>();
  addEventListener(t: string, f: () => void) { this.l.set(t, [...(this.l.get(t) ?? []), f]); }
  fire(t: string) { for (const f of this.l.get(t) ?? []) f(); }
  play = vi.fn(() => {
    this.plays.push(this.src);
    return this.reject ? Promise.reject(Object.assign(new Error(this.reject), { name: this.reject })) : Promise.resolve();
  });
  pause = vi.fn();
}

function setup() {
  const el = new FakeEl();
  let n = 0;
  const output = createMediaOutput(() => el, { create: () => `blob:${++n}`, revoke: vi.fn() });
  const synthesized: string[] = [];
  const voice: NeuralVoice = {
    sampleRate: 1000,
    synthesize: vi.fn(async (text: string) => { synthesized.push(text); return Float32Array.from({ length: 300 }, (_, i) => 0.4 * Math.sin(i)); }),
    dispose: vi.fn(),
  };
  const device = createDeviceSpeechService({ output, voice: { get: async () => voice } });
  return { el, output, device, voice, synthesized };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

describe('routing on iPhone', () => {
  it('detects iPhone, iPad (incl. desktop-mode iPadOS) and not Android/desktop', () => {
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' })).toBe(false);
  });

  it('auto: iPhone uses the on-device voice once downloaded; desktop keeps browser speech; preferences win', () => {
    expect(chooseRoute('auto', true, true, true)).toBe('device');
    expect(chooseRoute('auto', false, true, true)).toBe('browser'); // nothing downloaded yet
    expect(chooseRoute('auto', true, false, true)).toBe('browser');
    expect(chooseRoute('auto', true, false, false)).toBe('device'); // no speechSynthesis at all
    expect(chooseRoute('browser', true, true, true)).toBe('browser');
    expect(chooseRoute('device', true, false, true)).toBe('device');
    expect(chooseRoute('device', false, false, true)).toBe('browser');
  });
});

describe('on-device voice played as media', () => {
  it('unlocks the shared <audio> synchronously inside the tap, then plays the synthesized clip on it', async () => {
    const { el, device, synthesized } = setup();
    const cb = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    device.speak('Außenwand', cb);
    // synchronously, still inside the tap: the element was started (silent primer)
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.plays[0]).toBe('blob:1');
    await flush();
    expect(synthesized).toEqual(['Außenwand']);
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(el.src).toBe('blob:2'); // the clip, on the same element
    expect(cb.onStart).not.toHaveBeenCalled(); // real state: not "playing" before the element says so
    el.fire('playing');
    expect(cb.onStart).toHaveBeenCalledOnce();
    el.fire('ended');
    expect(cb.onEnd).toHaveBeenCalledOnce();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('reuses clips (no second synthesis) and replaces a playing clip ("interrupted")', async () => {
    const { el, device, synthesized } = setup();
    const first = { onEnd: vi.fn(), onError: vi.fn() };
    device.speak('Wand', first);
    await flush();
    el.fire('playing');
    device.speak('Wand', {});
    await flush();
    expect(first.onError).toHaveBeenCalledWith('interrupted');
    expect(first.onEnd).toHaveBeenCalledOnce();
    expect(synthesized).toEqual(['Wand']);
  });

  it('reports a playback refused by the browser (no fake success)', async () => {
    const { el, device } = setup();
    const cb = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    el.reject = 'NotAllowedError';
    device.speak('Wand', cb);
    await flush();
    expect(cb.onError).toHaveBeenCalledWith('not-allowed');
    expect(cb.onStart).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('reports a failing voice (e.g. out of memory) as device-voice-failed', async () => {
    const el = new FakeEl();
    const output: MediaOutput = createMediaOutput(() => el, { create: () => 'blob:x', revoke: vi.fn() });
    const device = createDeviceSpeechService({ output, voice: { get: () => Promise.reject(new Error('oom')) } });
    const cb = { onEnd: vi.fn(), onError: vi.fn() };
    device.speak('Wand', cb);
    await flush();
    expect(cb.onError).toHaveBeenCalledWith('device-voice-failed');
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('cancel stops the media and ends the utterance once', async () => {
    const { el, device } = setup();
    const cb = { onEnd: vi.fn(), onError: vi.fn() };
    device.speak('Wand', cb);
    await flush();
    el.fire('playing');
    device.cancel();
    expect(el.pause).toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith('canceled');
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('keeps one voice worker while in use and frees it when idle', async () => {
    vi.useFakeTimers();
    try {
      const v = { sampleRate: 1, synthesize: vi.fn(), dispose: vi.fn() } as unknown as NeuralVoice;
      const open = vi.fn(async () => v);
      const handle = createVoiceHandle(open, 1000);
      await handle.get();
      await handle.get();
      expect(open).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000);
      expect(v.dispose).toHaveBeenCalledOnce();
      await handle.get();
      expect(open).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

describe('browser speech with on-device fallback', () => {
  let browserSpeak: (text: string, o?: SpeakOptions) => void;
  const fake = (over: Partial<SpeechService>): SpeechService => ({
    supported: true, speak: () => {}, cancel: vi.fn(), unlock: vi.fn(), germanVoice: () => 'available',
    voiceInfo: () => ({ total: 0, german: [], selected: null }), whenVoicesReady: async () => {}, onVoicesChanged: () => () => {}, ...over,
  });
  beforeEach(() => { browserSpeak = () => {}; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('when browser speech never starts, the same text is played with the on-device voice (one onEnd)', () => {
    const device = fake({ speak: vi.fn((_t: string, o?: SpeakOptions) => { o?.onStart?.(); o?.onEnd?.(); }) });
    const browser = fake({ speak: (t, o) => browserSpeak(t, o) });
    browserSpeak = (_t, o) => { o?.onError?.('no-start'); o?.onEnd?.(); };
    const r = createRoutedSpeech({ browser, device, preference: () => 'auto', deviceReady: () => true, appleMobile: false });
    const cb = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    r.speak('Wand', cb);
    expect(device.unlock).toHaveBeenCalled(); // media unlocked inside the tap for the fallback
    expect(device.speak).toHaveBeenCalledWith('Wand', cb);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('user cancels and autoplay blocks are not "failures" to fall back from; "browser" preference never falls back', () => {
    const device = fake({ speak: vi.fn() });
    const browser = fake({ speak: (t, o) => browserSpeak(t, o) });
    const r = createRoutedSpeech({ browser, device, preference: () => 'auto', deviceReady: () => true, appleMobile: false });
    browserSpeak = (_t, o) => { o?.onError?.('not-allowed'); o?.onEnd?.(); };
    const cb = { onError: vi.fn(), onEnd: vi.fn() };
    r.speak('Wand', cb);
    expect(cb.onError).toHaveBeenCalledWith('not-allowed');
    const only = createRoutedSpeech({ browser, device, preference: () => 'browser', deviceReady: () => true, appleMobile: false });
    browserSpeak = (_t, o) => { o?.onError?.('no-start'); o?.onEnd?.(); };
    only.speak('Wand', {});
    expect(device.speak).not.toHaveBeenCalled();
  });

  it('on iPhone with the voice downloaded, taps go straight to the media path', () => {
    const device = fake({ speak: vi.fn() });
    const browser = fake({ speak: vi.fn() });
    const r = createRoutedSpeech({ browser, device, preference: () => 'auto', deviceReady: () => true, appleMobile: true });
    r.speak('Wand', {});
    expect(device.speak).toHaveBeenCalledOnce();
    expect(browser.speak).not.toHaveBeenCalled();
    expect(r.germanVoice()).toBe('available');
  });
});

describe('same-origin sign-in helper (Safari storage partitioning)', () => {
  it('uses the page host only for this project\'s Hosting hosts', () => {
    const fb = 'deutsch-vokabular.firebaseapp.com';
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'deutsch-vokabular.web.app')).toBe('deutsch-vokabular.web.app');
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'deutsch-vokabular--v202-test-ww73499n.web.app')).toBe('deutsch-vokabular--v202-test-ww73499n.web.app');
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'deutsch-vokabular.firebaseapp.com')).toBe(fb);
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'evil.example')).toBe(fb);
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'deutsch-vokabularxweb.app')).toBe(fb);
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'other-project.web.app')).toBe(fb);
    expect(sameOriginAuthDomain(fb, 'deutsch-vokabular', 'localhost')).toBe(fb);
  });
});
