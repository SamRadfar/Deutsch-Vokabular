// Regression tests for the "pronunciation is sometimes silent" bug (v2.0.2). A scripted engine
// mimics the browser behaviours that used to leave the app silent: lost `end` events (Chrome GC),
// a paused engine (Chrome/Android after backgrounding), dropped utterances (Safari after cancel),
// engines that never start (no voice / no audio output). Real audible playback is verified on
// devices (docs/AUDIO.md); these tests pin down the state machine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PronunciationProvider, usePronunciation } from '../../../src/features/pronunciation/PronunciationProvider';
import {
  createSpeechService, pickVoice, RETRY_AFTER_MS, speechWatchdogMs, START_TIMEOUT_MS, type SpeechService,
} from '../../../src/features/pronunciation/speechService';

class U {
  lang = ''; rate = 1; pitch = 1; volume = 1; voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

type Voice = { lang: string; name: string; localService?: boolean; default?: boolean };

/** `mode`: what the engine does with speak(): start it, or drop it silently. */
function engine(voices: Voice[] = [{ lang: 'de-DE', name: 'Anna', localService: true }]) {
  const log: string[] = [];
  const e = {
    mode: 'start' as 'start' | 'drop',
    current: null as U | null,
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    speak: vi.fn((u: U) => {
      log.push(`speak:${u.text}`);
      if (e.mode === 'drop') return;
      e.current = u;
      e.speaking = true;
      u.onstart?.();
    }),
    cancel: vi.fn(() => {
      log.push('cancel');
      const u = e.current;
      e.current = null; e.speaking = false; e.pending = false;
      u?.onerror?.({ error: 'interrupted' });
    }),
    pause: vi.fn(() => { log.push('pause'); }),
    resume: vi.fn(() => { log.push('resume'); e.paused = false; }),
    /** The engine finishes the utterance, optionally without reporting it (lost event). */
    end(report = true) { const u = e.current; e.current = null; e.speaking = false; if (report) u?.onend?.(); },
  };
  const service = createSpeechService({ speechSynthesis: e as never, SpeechSynthesisUtterance: U as never, navigator: { userAgent: 'Desktop' } });
  return { e, log, service };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('speech robustness', () => {
  it('cancels only a busy engine and resumes a paused one before speaking', () => {
    const { e, log, service } = engine();
    e.paused = true;
    service.speak('Wand');
    expect(log).toEqual(['resume', 'speak:Wand']);
    service.speak('Dach'); // replaces the audible utterance
    expect(log.slice(2)).toEqual(['cancel', 'speak:Dach']);
  });

  it('a replaced utterance ends exactly once ("interrupted"), its late events are ignored', () => {
    const { e, service } = engine();
    const first = { onError: vi.fn(), onEnd: vi.fn() };
    service.speak('Wand', first);
    const old = e.current!;
    service.speak('Dach');
    old.onend?.(); // late event of the replaced utterance
    expect(first.onError).toHaveBeenCalledExactlyOnceWith('interrupted');
    expect(first.onEnd).toHaveBeenCalledOnce();
  });

  it('a lost end event (Chrome GC) cannot leave the utterance open: the watchdog ends it', () => {
    const { e, service } = engine();
    const cb = { onError: vi.fn(), onEnd: vi.fn() };
    service.speak('Wand', cb);
    e.end(false); // audible, but `end` never arrives
    vi.advanceTimersByTime(speechWatchdogMs('Wand', 0.85) - 1);
    expect(cb.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb.onEnd).toHaveBeenCalledOnce();
    expect(cb.onError).not.toHaveBeenCalled(); // it was heard
  });

  it('a dropped utterance (engine idle, never started) is spoken once more', () => {
    const { e, log, service } = engine();
    e.mode = 'drop';
    const cb = { onStart: vi.fn(), onEnd: vi.fn() };
    service.speak('Wand', cb);
    e.mode = 'start';
    vi.advanceTimersByTime(RETRY_AFTER_MS);
    expect(log.filter((l) => l === 'speak:Wand')).toHaveLength(2);
    expect(cb.onStart).toHaveBeenCalledOnce();
    e.end();
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('an engine that never starts is reported as "no-start" (the UI explains instead of staying silent)', () => {
    const { e, service } = engine();
    e.mode = 'drop';
    const cb = { onError: vi.fn(), onEnd: vi.fn() };
    service.speak('Wand', cb);
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith('no-start');
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('cancel() ends the current utterance once with "canceled"', () => {
    const { service } = engine();
    const cb = { onError: vi.fn(), onEnd: vi.fn() };
    service.speak('Wand', cb);
    service.cancel();
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith('canceled');
    expect(cb.onEnd).toHaveBeenCalledOnce();
  });

  it('unlock() speaks a silent empty utterance inside the gesture, only when idle', () => {
    const { e, service } = engine();
    service.unlock();
    expect(e.speak).toHaveBeenCalledOnce();
    expect(e.speak.mock.calls[0]![0]).toMatchObject({ text: '', volume: 0 });
    e.end();
    service.speak('Wand');
    service.unlock();
    expect(e.speak).toHaveBeenCalledTimes(2);
  });

  it('keeps long sentences of a remote desktop voice alive (Chrome ~15 s cut-off)', () => {
    const { e, log, service } = engine([{ lang: 'de-DE', name: 'Google Deutsch', localService: false }]);
    service.speak('Ein sehr langer Beispielsatz, '.repeat(6));
    vi.advanceTimersByTime(10_000);
    expect(log).toContain('pause');
    expect(log.at(-1)).toBe('resume');
    e.end();
  });

  it('prefers an exact, on-device, default German voice', () => {
    const v = (lang: string, name: string, localService = true, def = false) => ({ lang, name, localService, default: def }) as SpeechSynthesisVoice;
    expect(pickVoice([v('en-US', 'Sam'), v('de-AT', 'Maria'), v('de-DE', 'Anna')], 'de-DE')?.name).toBe('Anna');
    expect(pickVoice([v('de-DE', 'Google Deutsch', false), v('de_DE', 'Android Deutsch')], 'de-DE')?.name).toBe('Android Deutsch');
    expect(pickVoice([v('de-DE', 'A'), v('de-DE', 'B', true, true)], 'de-DE')?.name).toBe('B');
    expect(pickVoice([v('en-US', 'Sam')], 'de-DE')).toBeUndefined();
  });
});

function Probe({ k, text }: { k: string; text: string }) {
  const { toggle, speakingKey } = usePronunciation();
  return <button type="button" onClick={() => toggle(k, text)}>{speakingKey === k ? 'speaking' : 'idle'}</button>;
}

describe('pronunciation buttons', () => {
  it('a second tap after a lost end event speaks again instead of only stopping (the silent-tap bug)', () => {
    const { e, service } = engine();
    render(<PronunciationProvider service={service}><Probe k="w" text="Wand" /></PronunciationProvider>);
    const btn = screen.getByRole('button');
    act(() => btn.click());
    expect(btn.textContent).toBe('speaking');
    e.end(false); // the browser loses `end`
    act(() => { vi.advanceTimersByTime(speechWatchdogMs('Wand', 0.85)); });
    expect(btn.textContent).toBe('idle');
    act(() => btn.click());
    expect(e.speak).toHaveBeenCalledTimes(2);
  });

  it('shows a clear message when nothing could be played, and when the browser blocked audio', () => {
    const { e, service } = engine();
    e.mode = 'drop';
    render(<PronunciationProvider service={service}><Probe k="w" text="Wand" /></PronunciationProvider>);
    act(() => screen.getByRole('button').click());
    act(() => { vi.advanceTimersByTime(START_TIMEOUT_MS); });
    expect(screen.getByTestId('speech-notice').textContent).toMatch(/صدایی پخش نشد/);
    e.mode = 'start';
    act(() => screen.getByRole('button', { name: 'idle' }).click());
    act(() => { e.current!.onerror?.({ error: 'not-allowed' }); });
    expect(screen.getByTestId('speech-notice').textContent).toMatch(/مسدود/);
  });

  it('says so when the browser has no speech synthesis at all', () => {
    const service: SpeechService = createSpeechService({});
    render(<PronunciationProvider service={service}><Probe k="w" text="Wand" /></PronunciationProvider>);
    act(() => screen.getByRole('button').click());
    expect(screen.getByTestId('speech-notice').textContent).toMatch(/پشتیبانی نمی‌کند/);
  });
});
