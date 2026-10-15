import { describe, expect, it, vi } from 'vitest';
import { createSpeechService, speechTextForWord } from '../../../src/features/pronunciation/speechService';

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth(voices: Array<{ lang: string; name: string }>) {
  const spoken: FakeUtterance[] = [];
  return {
    spoken,
    synth: {
      getVoices: vi.fn(() => voices),
      speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
      cancel: vi.fn(),
    },
  };
}

describe('speechService', () => {
  it('reports unsupported browsers and still calls onEnd so the UI never hangs', () => {
    const service = createSpeechService({});
    expect(service.supported).toBe(false);
    const onEnd = vi.fn();
    service.speak('Hallo', { onEnd });
    expect(onEnd).toHaveBeenCalled();
  });

  it('speaks German at the legacy rate with a German voice when available', () => {
    const { synth, spoken } = fakeSynth([{ lang: 'en-US', name: 'en' }, { lang: 'de-DE', name: 'Anna' }]);
    const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
    service.speak('Außenwand');
    expect(synth.cancel).toHaveBeenCalled(); // previous speech is stopped first
    expect(spoken[0]).toMatchObject({ text: 'Außenwand', lang: 'de-DE', rate: 0.85, voice: { name: 'Anna' } });
  });

  it('works without any German voice (lang only) and reports end once on error', () => {
    const { synth, spoken } = fakeSynth([]);
    const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
    const onEnd = vi.fn();
    service.speak('Wand', { onEnd });
    expect(spoken[0]!.voice).toBeNull();
    spoken[0]!.onerror?.();
    spoken[0]!.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing speechSynthesis', () => {
    const synth = { getVoices: () => [], speak: () => { throw new Error('boom'); }, cancel: () => {} };
    const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
    const onEnd = vi.fn();
    expect(() => service.speak('x', { onEnd })).not.toThrow();
    expect(onEnd).toHaveBeenCalled();
  });

  it('strips a leading article like the legacy app', () => {
    expect(speechTextForWord('die Außenwand')).toBe('Außenwand');
    expect(speechTextForWord('Der Balken')).toBe('Balken');
    expect(speechTextForWord('eine Wand')).toBe('Wand');
    expect(speechTextForWord('dieser Satz')).toBe('dieser Satz');
    expect(speechTextForWord('belegen')).toBe('belegen');
  });

  it('reports errors with their code before onEnd (e.g. autoplay blocked)', () => {
    const { synth, spoken } = fakeSynth([{ lang: 'de-DE', name: 'Anna' }]);
    const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
    const calls: string[] = [];
    service.speak('Wand', { onError: (c) => calls.push(`error:${c}`), onEnd: () => calls.push('end') });
    (spoken[0]!.onerror as unknown as (e: { error: string }) => void)({ error: 'not-allowed' });
    spoken[0]!.onend?.();
    expect(calls).toEqual(['error:not-allowed', 'end']);
  });

  it('unsupported browsers report "unsupported" and have no German voice', () => {
    const service = createSpeechService({});
    const onError = vi.fn();
    service.speak('x', { onError });
    expect(onError).toHaveBeenCalledWith('unsupported');
    expect(service.germanVoice()).toBe('missing');
  });

  it('German voice status: unknown while the list is empty, then available / missing', () => {
    const list: Array<{ lang: string; name: string }> = [];
    const { synth } = fakeSynth(list);
    const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
    expect(service.germanVoice()).toBe('unknown');
    list.push({ lang: 'en-GB', name: 'Daniel' });
    expect(service.germanVoice()).toBe('missing');
    list.push({ lang: 'de-AT', name: 'Anna' });
    expect(service.germanVoice()).toBe('available');
  });

  it('waits for asynchronously loaded voices (voiceschanged), bounded by a timeout', async () => {
    vi.useFakeTimers();
    try {
      const list: Array<{ lang: string; name: string }> = [];
      const target = new EventTarget();
      const synth = Object.assign(target, { getVoices: () => list, speak: vi.fn(), cancel: vi.fn() });
      const service = createSpeechService({ speechSynthesis: synth as never, SpeechSynthesisUtterance: FakeUtterance as never });
      const changed = vi.fn();
      const off = service.onVoicesChanged(changed);
      let ready = false;
      void service.whenVoicesReady(1500).then(() => { ready = true; });
      list.push({ lang: 'de-DE', name: 'Anna' });
      target.dispatchEvent(new Event('voiceschanged'));
      await Promise.resolve();
      expect(ready).toBe(true);
      expect(changed).toHaveBeenCalledOnce();
      off();
      target.dispatchEvent(new Event('voiceschanged'));
      expect(changed).toHaveBeenCalledOnce();

      list.length = 0;
      let late = false;
      void service.whenVoicesReady(1500).then(() => { late = true; });
      await vi.advanceTimersByTimeAsync(1499);
      expect(late).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(late).toBe(true); // no voices ever: the session still starts
    } finally {
      vi.useRealTimers();
    }
  });
});
