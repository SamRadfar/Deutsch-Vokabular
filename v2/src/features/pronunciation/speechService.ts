/**
 * German text-to-speech via the browser Web Speech API (free, on-device or browser voices).
 * Mirrors the legacy speakWord(): lang de-DE, rate 0.85, a German voice when available.
 *
 * Voices may load asynchronously (Chrome fills getVoices() only after `voiceschanged`), and which
 * voices exist depends on the browser and operating system — offline availability is not
 * guaranteed. Callers that need to know can use germanVoice() / whenVoicesReady().
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
   * or "exception" / "unsupported".
   */
  onError?: (code: string) => void;
}

export type GermanVoiceStatus = 'available' | 'missing' | 'unknown';

export interface SpeechService {
  /** False when the browser has no speechSynthesis (e.g. some embedded webviews). */
  readonly supported: boolean;
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
  /** `unknown` while the voice list is still empty (it may load asynchronously). */
  germanVoice(): GermanVoiceStatus;
  /** Resolves when the voice list is non-empty, or after `timeoutMs` at the latest. */
  whenVoicesReady(timeoutMs?: number): Promise<void>;
  /** Notifies when the voice list changes; returns an unsubscribe function. */
  onVoicesChanged(listener: () => void): () => void;
}

export const GERMAN = 'de-DE';
export const DEFAULT_RATE = 0.85;

interface SpeechHost {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

const unsupported: SpeechService = {
  supported: false,
  speak: (_text, options) => { options?.onError?.('unsupported'); options?.onEnd?.(); },
  cancel: () => {},
  germanVoice: () => 'missing',
  whenVoicesReady: () => Promise.resolve(),
  onVoicesChanged: () => () => {},
};

export function createSpeechService(host: SpeechHost = window as SpeechHost): SpeechService {
  const synth = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return unsupported;

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

  return {
    supported: true,
    speak(text, { lang = GERMAN, rate = DEFAULT_RATE, onStart, onEnd, onError } = {}) {
      let ended = false;
      const end = () => { if (!ended) { ended = true; onEnd?.(); } };
      try {
        synth.cancel();
        const u = new Utterance(text);
        u.lang = lang;
        u.rate = rate;
        u.pitch = 1;
        const prefix = lang.slice(0, 2).toLowerCase();
        const voice = voices().find((v) => v.lang.toLowerCase().startsWith(prefix));
        if (voice) u.voice = voice;
        u.onstart = () => onStart?.();
        u.onend = end;
        u.onerror = (e?: SpeechSynthesisErrorEvent) => {
          if (!ended) onError?.(e?.error ?? 'unknown');
          end();
        };
        synth.speak(u);
      } catch {
        if (!ended) onError?.('exception');
        end();
      }
    },
    cancel() {
      try { synth.cancel(); } catch { /* ignore */ }
    },
    germanVoice() {
      const list = voices();
      if (!list.length) return 'unknown';
      return list.some((v) => v.lang.toLowerCase().startsWith('de')) ? 'available' : 'missing';
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
