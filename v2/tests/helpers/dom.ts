import { vi } from 'vitest';
import type { SpeechService } from '../../src/features/pronunciation/speechService';

/** Install a matchMedia whose result is decided per query. */
export function mockMatchMedia(matches: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export const MOBILE = (q: string) => q.includes('max-width: 640px');
export const DARK_SYSTEM = (q: string) => q.includes('prefers-color-scheme: dark');

/** A fake speech service that records calls; `finish()` simulates the end of playback. */
export function fakeSpeech(supported = true) {
  let pendingEnd: (() => void) | undefined;
  const service: SpeechService & { finish(): void } = {
    supported,
    speak: vi.fn((_text: string, opts?: { onEnd?: () => void }) => { pendingEnd = opts?.onEnd; }),
    cancel: vi.fn(),
    finish: () => pendingEnd?.(),
  };
  return service;
}
