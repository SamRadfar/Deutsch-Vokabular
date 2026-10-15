// Deterministic stand-in for the Web Speech API in browser tests (headless browsers have no
// dependable voices): every utterance "speaks" for `speakMs` (÷ rate), cancel() interrupts it like a
// browser does, window.__spoken records what was said and window.__speaking counts open utterances.

import type { Page } from '@playwright/test';

declare global {
  interface Window { __spoken: Array<{ text: string; rate: number; lang: string }>; __speaking: number }
}

/** `speakMs`: how long each mocked utterance takes at rate 1. */
export async function installSpeechMock(page: Page, speakMs = 300) {
  await page.addInitScript((speakMs: number) => {
    class MockUtterance {
      lang = ''; rate = 1; pitch = 1; voice: unknown = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(public text: string) {}
    }
    let current: { u: MockUtterance; timer: number } | null = null;
    const target = new EventTarget();
    window.__spoken = [];
    window.__speaking = 0;
    const synth = Object.assign(target, {
      getVoices: () => [{ lang: 'de-DE', name: 'Mock Deutsch', default: true, localService: true, voiceURI: 'mock' }],
      speak(u: MockUtterance) {
        if (current) synth.cancel();
        window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang });
        const timer = window.setTimeout(() => { current = null; window.__speaking--; u.onend?.(); }, speakMs / (u.rate || 1));
        current = { u, timer };
        window.__speaking++;
        u.onstart?.();
      },
      cancel() {
        if (!current) return;
        const { u, timer } = current;
        current = null;
        window.__speaking--;
        clearTimeout(timer);
        u.onerror?.({ error: 'interrupted' });
      },
      get speaking() { return current !== null; },
      pending: false, paused: false, pause() {}, resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
  }, speakMs);
}
