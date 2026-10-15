/**
 * German text-to-speech via the browser Web Speech API (free, on-device voices).
 * Mirrors the legacy speakWord(): lang de-DE, rate 0.85, a German voice when available.
 */

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

export interface SpeechService {
  /** False when the browser has no speechSynthesis (e.g. some embedded webviews). */
  readonly supported: boolean;
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
}

export const GERMAN = 'de-DE';
export const DEFAULT_RATE = 0.85;

interface SpeechHost {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

export function createSpeechService(host: SpeechHost = window as SpeechHost): SpeechService {
  const synth = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  if (!synth || !Utterance) {
    return { supported: false, speak: (_text, options) => options?.onEnd?.(), cancel: () => {} };
  }
  // Some browsers load voices asynchronously; touching the list early warms it up.
  try { synth.getVoices(); } catch { /* ignore */ }

  return {
    supported: true,
    speak(text, { lang = GERMAN, rate = DEFAULT_RATE, onStart, onEnd } = {}) {
      try {
        synth.cancel();
        const u = new Utterance(text);
        u.lang = lang;
        u.rate = rate;
        u.pitch = 1;
        const prefix = lang.slice(0, 2).toLowerCase();
        const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix));
        if (voice) u.voice = voice;
        let ended = false;
        const end = () => { if (!ended) { ended = true; onEnd?.(); } };
        u.onstart = () => onStart?.();
        u.onend = end;
        u.onerror = end;
        synth.speak(u);
      } catch {
        onEnd?.();
      }
    },
    cancel() {
      try { synth.cancel(); } catch { /* ignore */ }
    },
  };
}

/** Legacy rule: strip a leading article so the noun itself is pronounced clearly. */
export function speechTextForWord(word: string): string {
  return word.replace(/^(der|die|das|ein|eine)\s+/i, '');
}
