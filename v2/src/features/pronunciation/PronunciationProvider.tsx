import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSpeechService, isUserCancel, type SpeechService } from './speechService';
import './PronunciationButton.css';

/** Why a pronunciation could not be heard (mapped to Persian text below). */
export type SpeechNotice = 'unsupported' | 'blocked' | 'no-sound' | 'no-german-voice';

export const SPEECH_NOTICE_TEXT: Record<SpeechNotice, string> = {
  unsupported: 'این مرورگر از پخش گفتار پشتیبانی نمی‌کند. لطفاً از Chrome، Edge یا Safari استفاده کنید.',
  blocked: 'مرورگر پخش صدا را مسدود کرد. یک بار دیگر روی دکمهٔ تلفظ بزنید.',
  'no-sound': 'صدایی پخش نشد. بلندی صدای دستگاه، حالت بی‌صدا (کلید کنار iPhone) و خروجی صدا (بلوتوث) را بررسی کنید و دوباره بزنید. اگر باز هم صدایی نبود، صدای آلمانی را در تنظیمات «متن به گفتار» دستگاه نصب کنید.',
  'no-german-voice': 'صدای آلمانی روی این دستگاه نصب نیست؛ متن با صدای پیش‌فرض خوانده می‌شود. برای تلفظ درست، صدای آلمانی را در تنظیمات «متن به گفتار» دستگاه نصب کنید.',
};

interface PronunciationContextValue {
  supported: boolean;
  /** The one speech service of the app (the shadowing player drives it directly). */
  service: SpeechService;
  /** Key of the item currently being spoken (null = silent). */
  speakingKey: string | null;
  /** Speak `text`; calling again with the same key while it is speaking stops it (legacy behaviour). */
  toggle(key: string, text: string): void;
  /** The latest playback problem, shown as a message (null = none). */
  notice: SpeechNotice | null;
  dismissNotice(): void;
}

const PronunciationContext = createContext<PronunciationContextValue | null>(null);

const NOTICE_MS = 9000;

export function PronunciationProvider({ children, service }: { children: ReactNode; service?: SpeechService }) {
  const speech = useMemo(() => service ?? createSpeechService(), [service]);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<SpeechNotice | null>(null);
  const current = useRef<string | null>(null);
  const warnedVoice = useRef(false);

  useEffect(() => () => speech.cancel(), [speech]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = useCallback((key: string, text: string) => {
    if (!speech.supported) { setNotice('unsupported'); return; }
    if (current.current === key) {
      current.current = null;
      setSpeakingKey(null);
      speech.cancel();
      return;
    }
    current.current = key;
    setSpeakingKey(key);
    setNotice(null);
    if (!warnedVoice.current && speech.germanVoice() === 'missing') {
      warnedVoice.current = true;
      setNotice('no-german-voice');
    }
    speech.speak(text, {
      onError: (code) => {
        if (current.current !== key || isUserCancel(code)) return;
        setNotice(code === 'not-allowed' ? 'blocked' : 'no-sound');
      },
      onEnd: () => {
        if (current.current === key) {
          current.current = null;
          setSpeakingKey(null);
        }
      },
    });
  }, [speech]);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const value = useMemo(() => ({ supported: speech.supported, service: speech, speakingKey, toggle, notice, dismissNotice }),
    [speech, speakingKey, toggle, notice, dismissNotice]);
  return (
    <PronunciationContext.Provider value={value}>
      {children}
      {notice ? (
        <div className="speech-toast" role="status" lang="fa" dir="rtl" data-testid="speech-notice">
          <p>{SPEECH_NOTICE_TEXT[notice]}</p>
          <button type="button" onClick={dismissNotice} aria-label="بستن پیام صدا">×</button>
        </div>
      ) : null}
    </PronunciationContext.Provider>
  );
}

export function usePronunciation(): PronunciationContextValue {
  const ctx = useContext(PronunciationContext);
  if (!ctx) throw new Error('usePronunciation must be used inside <PronunciationProvider>');
  return ctx;
}
