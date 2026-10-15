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
});
