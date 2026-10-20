/**
 * German text-to-speech via the browser Web Speech API (free, on-device or browser voices).
 * Mirrors the legacy speakWord(): lang de-DE, rate 0.85, a German voice when available.
 *
 * Voices may load asynchronously (Chrome fills getVoices() only after `voiceschanged`), and which
 * voices exist depends on the browser and operating system — offline availability is not
 * guaranteed. Callers that need to know can use germanVoice() / whenVoicesReady().
 *
 * Robustness rules (each one fixes a way the app used to stay silent, see docs/AUDIO.md):
 *  - The current utterance is kept referenced until it ends. Chrome garbage-collects unreferenced
 *    utterances and then never fires `end`, which left the UI "speaking" forever (the next tap on the
 *    same button then only stopped, so nothing was heard).
 *  - Every utterance ends exactly once: by `end`/`error`, by being replaced, or by a watchdog (no
 *    `start` at all, or no `end` long after it should have finished). Callbacks of a replaced
 *    utterance are ignored.
 *  - speak() never calls cancel() on an idle engine (Safari/iOS can drop an utterance queued right
 *    after a cancel) and resumes a paused engine (Chrome/Android can be left paused after the page
 *    was in the background). An utterance that is dropped anyway is spoken once more.
 *  - Remote (network) voices of desktop Chrome stop after ~15 s; long sentences get a keep-alive.
 *  - A local German voice is preferred (lang exact match, on-device, default).
 */

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  onStart?: () => void;
  /** Called exactly once when the utterance ends, fails or is cancelled. */
  onEnd?: () => void;
  /**
   * Called before onEnd when the utterance failed. `code` is the SpeechSynthesisErrorEvent.error
   * (e.g. "interrupted" / "canceled" after cancel(), "not-allowed" when autoplay is blocked),
   * "no-start" (the engine never started — typically no audio output or no voice), "timeout",
   * "exception" or "unsupported".
   */
  onError?: (code: string) => void;
}

export type GermanVoiceStatus = 'available' | 'missing' | 'unknown';

export interface VoiceInfo {
  name: string;
  lang: string;
  local: boolean;
}

export interface SpeechService {
  /** False when the browser has no speechSynthesis (e.g. some embedded webviews). */
  readonly supported: boolean;
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
  /**
   * Call synchronously inside a user gesture when the first utterance will only follow later
   * (iOS Safari allows speech only after one utterance was started by a gesture).
   */
  unlock(): void;
  /** `unknown` while the voice list is still empty (it may load asynchronously). */
  germanVoice(): GermanVoiceStatus;
  /** The German voices of this device and the one speak() uses (sound test, diagnostics). */
  voiceInfo(): { total: number; german: VoiceInfo[]; selected: VoiceInfo | null };
  /** Resolves when the voice list is non-empty, or after `timeoutMs` at the latest. */
  whenVoicesReady(timeoutMs?: number): Promise<void>;
  /** Notifies when the voice list changes; returns an unsubscribe function. */
  onVoicesChanged(listener: () => void): () => void;
}

export const GERMAN = 'de-DE';
export const DEFAULT_RATE = 0.85;

/** No `start` after this long → the utterance did not play (no voice, no audio output, dropped). */
export const START_TIMEOUT_MS = 5000;
/** A dropped utterance (engine idle, never started) is spoken once more after this delay. */
export const RETRY_AFTER_MS = 700;
const KEEPALIVE_MS = 10_000;

/** No `end` after this long → the utterance is considered finished (some engines never report). */
export function speechWatchdogMs(text: string, rate: number): number {
  return Math.max(6000, Math.round((text.length * 180) / Math.max(rate, 0.1)) + 4000);
}

export interface SpeechHost {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  navigator?: { userAgent?: string };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

const unsupported: SpeechService = {
  supported: false,
  speak: (_text, options) => { options?.onError?.('unsupported'); options?.onEnd?.(); },
  cancel: () => {},
  unlock: () => {},
  germanVoice: () => 'missing',
  voiceInfo: () => ({ total: 0, german: [], selected: null }),
  whenVoicesReady: () => Promise.resolve(),
  onVoicesChanged: () => () => {},
};

const norm = (lang: string | undefined) => (lang ?? '').replace('_', '-').toLowerCase();
const info = (v: SpeechSynthesisVoice): VoiceInfo => ({ name: v.name, lang: v.lang, local: v.localService !== false });

/** Best voice for `lang`: exact language match, then on-device, then the system default. */
export function pickVoice(list: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const want = norm(lang);
  const prefix = want.slice(0, 2);
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = -1;
  for (const v of list) {
    const l = norm(v.lang);
    if (!l.startsWith(prefix)) continue;
    const score = (l === want ? 4 : 0) + (v.localService !== false ? 2 : 0) + (v.default ? 1 : 0);
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

export function createSpeechService(host: SpeechHost = window as unknown as SpeechHost): SpeechService {
  if (!host.speechSynthesis || !host.SpeechSynthesisUtterance) return unsupported;
  const synth: SpeechSynthesis = host.speechSynthesis;
  const Utterance: typeof SpeechSynthesisUtterance = host.SpeechSynthesisUtterance;
  const later = (fn: () => void, ms: number) => (host.setTimeout ?? globalThis.setTimeout)(fn, ms);
  const clear = (id: unknown) => (host.clearTimeout ?? globalThis.clearTimeout)(id as ReturnType<typeof setTimeout>);
  const every = (fn: () => void, ms: number) => (host.setInterval ?? globalThis.setInterval)(fn, ms);
  const stopEvery = (id: unknown) => (host.clearInterval ?? globalThis.clearInterval)(id as ReturnType<typeof setInterval>);
  const android = /android/i.test(host.navigator?.userAgent ?? '');

  const voices = (): SpeechSynthesisVoice[] => {
    try { return synth.getVoices() ?? []; } catch { return []; }
  };
  // Some browsers load voices asynchronously; touching the list early warms it up.
  voices();

  const onVoicesChanged = (listener: () => void) => {
    if (typeof synth.addEventListener !== 'function') return () => {};
    synth.addEventListener('voiceschanged', listener);
    return () => synth.removeEventListener('voiceschanged', listener);
  };

  /** The utterance in flight — referenced so it cannot be garbage-collected before it ends. */
  let active: { utterance: SpeechSynthesisUtterance; finish: (error: string | null) => void } | null = null;

  const engineBusy = () => {
    try { return Boolean(synth.speaking || synth.pending); } catch { return false; }
  };

  function speak(text: string, { lang = GERMAN, rate = DEFAULT_RATE, onStart, onEnd, onError }: SpeakOptions = {}) {
    active?.finish('interrupted'); // the replaced utterance ends now; its late events are ignored
    const timers: unknown[] = [];
    let keepAlive: unknown = null;
    let done = false;
    let started = false;
    let entry: NonNullable<typeof active>;

    const finish = (error: string | null) => {
      if (done) return;
      done = true;
      timers.forEach(clear);
      if (keepAlive !== null) stopEvery(keepAlive);
      if (active === entry) active = null;
      if (error) onError?.(error);
      onEnd?.();
    };

    const make = () => {
      const u = new Utterance(text);
      u.lang = lang;
      u.rate = rate;
      u.pitch = 1;
      u.volume = 1;
      const voice = pickVoice(voices(), lang);
      if (voice) u.voice = voice;
      u.onstart = () => {
        if (done || started) return;
        started = true;
        // Desktop Chrome's network voices stop after ~15 s unless the engine is nudged.
        if (voice && voice.localService === false && !android && text.length > 120) {
          keepAlive = every(() => { try { synth.pause(); synth.resume(); } catch { /* ignore */ } }, KEEPALIVE_MS);
        }
        onStart?.();
      };
      u.onend = () => { if (entry?.utterance === u) finish(null); };
      u.onerror = (e?: SpeechSynthesisErrorEvent) => { if (entry?.utterance === u) finish(e?.error ?? 'unknown'); };
      return u;
    };

    try {
      if (engineBusy()) synth.cancel();
      if (synth.paused) synth.resume();
      entry = { utterance: make(), finish };
      active = entry;
      synth.speak(entry.utterance);
    } catch {
      finish('exception');
      return;
    }

    // Dropped (engine idle, nothing started): speak once more.
    timers.push(later(() => {
      if (done || started || engineBusy()) return;
      try {
        if (synth.paused) synth.resume();
        entry.utterance = make();
        synth.speak(entry.utterance);
      } catch { finish('exception'); }
    }, RETRY_AFTER_MS));
    // Never started: report it so the UI can explain instead of staying silent.
    timers.push(later(() => {
      if (done || started) return;
      if (engineBusy() && synth.speaking) return; // speaking without a start event: the end watchdog decides
      try { synth.cancel(); } catch { /* ignore */ }
      finish('no-start');
    }, START_TIMEOUT_MS));
    timers.push(later(() => {
      if (done) return;
      try { synth.cancel(); } catch { /* ignore */ }
      finish(started ? null : 'timeout'); // audible but no end event: treat as finished
    }, speechWatchdogMs(text, rate)));
  }

  return {
    supported: true,
    speak,
    cancel() {
      const current = active;
      active = null;
      current?.finish('canceled');
      try { synth.cancel(); } catch { /* ignore */ }
    },
    unlock() {
      if (active || engineBusy()) return;
      try {
        const u = new Utterance('');
        u.volume = 0;
        u.lang = GERMAN;
        synth.speak(u);
      } catch { /* ignore */ }
    },
    germanVoice() {
      const list = voices();
      if (!list.length) return 'unknown';
      return list.some((v) => norm(v.lang).startsWith('de')) ? 'available' : 'missing';
    },
    voiceInfo() {
      const list = voices();
      const selected = pickVoice(list, GERMAN);
      return {
        total: list.length,
        german: list.filter((v) => norm(v.lang).startsWith('de')).map(info),
        selected: selected ? info(selected) : null,
      };
    },
    whenVoicesReady(timeoutMs = 1500) {
      if (voices().length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); off(); resolve(); };
        const off = onVoicesChanged(() => { if (voices().length) done(); });
        const timer = setTimeout(done, timeoutMs);
      });
    },
    onVoicesChanged,
  };
}

/** Legacy rule: strip a leading article so the noun itself is pronounced clearly. */
export function speechTextForWord(word: string): string {
  return word.replace(/^(der|die|das|ein|eine)\s+/i, '');
}

/** Errors that are a consequence of the user's own action (stop, replace) — not worth a message. */
export function isUserCancel(code: string): boolean {
  return code === 'interrupted' || code === 'canceled';
}
