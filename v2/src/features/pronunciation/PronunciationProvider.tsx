import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSpeechService, type SpeechService } from './speechService';

interface PronunciationContextValue {
  supported: boolean;
  /** Key of the item currently being spoken (null = silent). */
  speakingKey: string | null;
  /** Speak `text`; calling again with the same key while it is speaking stops it (legacy behaviour). */
  toggle(key: string, text: string): void;
}

const PronunciationContext = createContext<PronunciationContextValue | null>(null);

export function PronunciationProvider({ children, service }: { children: ReactNode; service?: SpeechService }) {
  const speech = useMemo(() => service ?? createSpeechService(), [service]);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => () => speech.cancel(), [speech]);

  const toggle = useCallback((key: string, text: string) => {
    if (!speech.supported) return;
    if (current.current === key) {
      speech.cancel();
      current.current = null;
      setSpeakingKey(null);
      return;
    }
    current.current = key;
    setSpeakingKey(key);
    speech.speak(text, {
      onEnd: () => {
        if (current.current === key) {
          current.current = null;
          setSpeakingKey(null);
        }
      },
    });
  }, [speech]);

  const value = useMemo(() => ({ supported: speech.supported, speakingKey, toggle }), [speech.supported, speakingKey, toggle]);
  return <PronunciationContext.Provider value={value}>{children}</PronunciationContext.Provider>;
}

export function usePronunciation(): PronunciationContextValue {
  const ctx = useContext(PronunciationContext);
  if (!ctx) throw new Error('usePronunciation must be used inside <PronunciationProvider>');
  return ctx;
}
