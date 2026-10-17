import { vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { GermanVoiceStatus, SpeakOptions, SpeechService } from '../../src/features/pronunciation/speechService';

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

/**
 * A fake speech service that records calls and behaves like the browser: a new speak() or cancel()
 * interrupts the current utterance (onError "interrupted", then onEnd). `finish()` ends the current
 * utterance normally, `fail(code)` makes it fail.
 */
export function fakeSpeech(supported = true, voice: GermanVoiceStatus = 'available') {
  let pending: SpeakOptions | undefined;
  const interrupt = () => {
    const p = pending;
    pending = undefined;
    if (p) { p.onError?.('interrupted'); p.onEnd?.(); }
  };
  const service: SpeechService & { finish(): void; fail(code: string): void; readonly speaking: boolean } = {
    supported,
    speak: vi.fn((_text: string, opts?: SpeakOptions) => {
      interrupt();
      if (!supported) { opts?.onError?.('unsupported'); opts?.onEnd?.(); return; }
      pending = opts ?? {};
      pending.onStart?.();
    }),
    cancel: vi.fn(interrupt),
    germanVoice: () => voice,
    whenVoicesReady: () => Promise.resolve(),
    onVoicesChanged: () => () => {},
    finish: () => { const p = pending; pending = undefined; p?.onEnd?.(); },
    fail: (code: string) => { const p = pending; pending = undefined; p?.onError?.(code); p?.onEnd?.(); },
    get speaking() { return pending !== undefined; },
  };
  return service;
}

/**
 * Waits until the signed-in vocabulary view shows its learned checkboxes, using a cheap DOM query.
 * (A *ByRole query over a full category table costs 50–250 ms in jsdom; inside waitFor it runs on
 * every DOM mutation and can starve the very updates it is waiting for.)
 */
export async function waitForLearnedCheckboxes(): Promise<void> {
  await waitFor(() => { if (!document.querySelector('input.vchk')) throw new Error('learned checkboxes are not rendered yet'); });
}
