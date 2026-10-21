import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDeviceSpeechService, createVoiceHandle } from '../audio/deviceSpeech';
import { sharedMediaOutput } from '../audio/mediaOutput';
import { createRoutedSpeech, isAppleMobile, type RoutedSpeechService, type VoicePreference } from '../audio/routedSpeech';
import { onDeviceVoiceStore, useOnDeviceVoice } from '../audio/useOnDeviceVoice';
import { PREFERENCE_KEYS } from '../../services/preferences';
import { openNeuralVoice } from '../audio/neuralVoice';
import { useOptionalUid } from '../auth/AuthProvider';
import { createSpeechService, isUserCancel, type SpeechService } from './speechService';
import './PronunciationButton.css';

const SoundSettings = lazy(() => import('./SoundSettings').then((m) => ({ default: m.SoundSettings })));

/** Why a pronunciation could not be heard (mapped to Persian text below). */
export type SpeechNotice = 'unsupported' | 'blocked' | 'no-sound' | 'no-german-voice' | 'device-failed' | 'ios-hint';

export const SPEECH_NOTICE_TEXT: Record<SpeechNotice, string> = {
  unsupported: 'این مرورگر از پخش گفتار پشتیبانی نمی‌کند. صدای آلمانی دستگاه را در «تنظیمات صدا» دانلود کنید یا از Chrome یا Safari استفاده کنید.',
  blocked: 'مرورگر پخش صدا را مسدود کرد. یک بار دیگر روی دکمهٔ تلفظ بزنید.',
  'no-sound': 'صدایی پخش نشد. بلندی صدای دستگاه و خروجی صدا (بلوتوث) را بررسی کنید. اگر باز هم صدایی نبود، «صدای آلمانی دستگاه» را در تنظیمات صدا دانلود کنید.',
  'no-german-voice': 'صدای آلمانی مرورگر روی این دستگاه نصب نیست؛ متن با صدای پیش‌فرض خوانده می‌شود. برای تلفظ درست، «صدای آلمانی دستگاه» را در تنظیمات صدا دانلود کنید.',
  'device-failed': 'ساخت صدا روی این دستگاه ناموفق بود. صفحه را دوباره باز کنید یا در تنظیمات صدا «صدای مرورگر» را انتخاب کنید.',
  'ios-hint': 'روی iPhone، صدای مرورگر در حالت بی‌صدا (کلید کنار گوشی) شنیده نمی‌شود و خطایی هم نشان نمی‌دهد. برای صدای مطمئن، «صدای آلمانی دستگاه» را یک بار دانلود کنید؛ مثل موسیقی پخش می‌شود.',
};

export type SpeakingPhase = 'loading' | 'playing';

interface PronunciationContextValue {
  supported: boolean;
  /** The one speech service of the app (the shadowing player drives it directly). */
  service: SpeechService;
  /** Present when the app routes between browser speech and the on-device voice. */
  routed: RoutedSpeechService | null;
  /**
   * Persian speech (on-device "Amir" voice, played as media) — null until the Persian voice is
   * downloaded on this device. Used by shadowing for Persian meanings and example translations.
   */
  persian: SpeechService | null;
  voicePreference: VoicePreference;
  setVoicePreference(pref: VoicePreference): void;
  /** Key of the item currently being spoken (null = silent). */
  speakingKey: string | null;
  /** 'loading' until sound is actually playing (on-device voice: synthesis first). */
  speakingPhase: SpeakingPhase | null;
  /** Speak `text`; calling again with the same key while it is speaking stops it (legacy behaviour). */
  toggle(key: string, text: string): void;
  /** The latest playback problem, shown as a message (null = none). */
  notice: SpeechNotice | null;
  dismissNotice(): void;
  openSoundSettings(): void;
}

const PronunciationContext = createContext<PronunciationContextValue | null>(null);

const NOTICE_MS = 12_000;
const PREFS: readonly VoicePreference[] = ['auto', 'browser', 'device'];

function readPreference(): VoicePreference {
  try {
    const v = localStorage.getItem(PREFERENCE_KEYS.voice);
    return PREFS.includes(v as VoicePreference) ? (v as VoicePreference) : 'auto';
  } catch { return 'auto'; }
}

export function PronunciationProvider({ children, service, persianService }: { children: ReactNode; service?: SpeechService; persianService?: SpeechService | null }) {
  const voiceStore = onDeviceVoiceStore();
  const { state: deviceState } = useOnDeviceVoice(voiceStore);
  const faStore = onDeviceVoiceStore('fa');
  const { state: faState } = useOnDeviceVoice(faStore);
  const [voicePreference, setPref] = useState<VoicePreference>(readPreference);
  const prefRef = useRef(voicePreference);
  prefRef.current = voicePreference;

  const voiceHandle = useMemo(() => (service ? null : createVoiceHandle()), [service]);
  const routed = useMemo<RoutedSpeechService | null>(() => (service || !voiceHandle ? null : createRoutedSpeech({
    browser: createSpeechService(),
    device: createDeviceSpeechService({ output: sharedMediaOutput(), voice: voiceHandle }),
    preference: () => prefRef.current,
    deviceReady: () => voiceStore.get().kind === 'ready',
  })), [service, voiceStore, voiceHandle]);
  // When taps will use the on-device voice, load the model in the background (first tap ≈ instant).
  const deviceRoute = routed !== null && deviceState.kind === 'ready' && routed.route() === 'device';
  useEffect(() => {
    if (!deviceRoute || !voiceHandle) return;
    const t = setTimeout(() => { void voiceHandle.get().catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [deviceRoute, voiceHandle, voicePreference]);
  const speech: SpeechService = service ?? routed!;
  // One Persian service for the app (its own worker; the shared <audio> element, so it never overlaps).
  const persianAll = useMemo<SpeechService | null>(() => (persianService !== undefined ? persianService
    : service ? null : createDeviceSpeechService({ output: sharedMediaOutput(), voiceId: 'fa', voice: createVoiceHandle(() => openNeuralVoice({ voice: 'fa' })) })),
  [service, persianService]);
  const persian = persianService !== undefined ? persianService : faState.kind === 'ready' ? persianAll : null;

  // Synthesized clips contain the account's private words: forget them when the account changes.
  const uid = useOptionalUid();
  useEffect(() => () => { speech.cancel(); speech.clearCache?.(); routed?.device.clearCache?.(); persianAll?.cancel(); persianAll?.clearCache?.(); },
    [uid, speech, routed, persianAll]);

  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [speakingPhase, setPhase] = useState<SpeakingPhase | null>(null);
  const [notice, setNotice] = useState<SpeechNotice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = useRef<string | null>(null);
  const warnedVoice = useRef(false);
  const hintedIos = useRef(false);

  useEffect(() => () => speech.cancel(), [speech]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const setVoicePreference = useCallback((pref: VoicePreference) => {
    setPref(pref);
    prefRef.current = pref;
    try { localStorage.setItem(PREFERENCE_KEYS.voice, pref); } catch { /* best effort */ }
  }, []);

  const toggle = useCallback((key: string, text: string) => {
    if (!speech.supported) { setNotice('unsupported'); return; }
    if (current.current === key) {
      current.current = null;
      setSpeakingKey(null);
      setPhase(null);
      speech.cancel();
      return;
    }
    current.current = key;
    setSpeakingKey(key);
    setPhase('loading');
    setNotice(null);
    const route = routed?.route() ?? 'browser';
    if (route === 'browser' && routed && isAppleMobile() && !hintedIos.current) {
      hintedIos.current = true;
      setNotice('ios-hint'); // silent-switch muting cannot be detected: say it once
    } else if (route === 'browser' && !warnedVoice.current && speech.germanVoice() === 'missing') {
      warnedVoice.current = true;
      setNotice('no-german-voice');
    }
    speech.speak(text, {
      onStart: () => { if (current.current === key) setPhase('playing'); },
      onError: (code) => {
        if (current.current !== key || isUserCancel(code)) return;
        setNotice(code === 'not-allowed' ? 'blocked' : code === 'device-voice-failed' ? 'device-failed' : 'no-sound');
      },
      onEnd: () => {
        if (current.current === key) {
          current.current = null;
          setSpeakingKey(null);
          setPhase(null);
        }
      },
    });
  }, [speech, routed]);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const openSoundSettings = useCallback(() => { setNotice(null); setSettingsOpen(true); }, []);
  const supported = speech.supported || deviceState.kind === 'ready';
  const value = useMemo(() => ({
    supported, service: speech, routed, persian, voicePreference, setVoicePreference, speakingKey, speakingPhase, toggle, notice, dismissNotice, openSoundSettings,
  }), [supported, speech, routed, persian, voicePreference, setVoicePreference, speakingKey, speakingPhase, toggle, notice, dismissNotice, openSoundSettings]);
  return (
    <PronunciationContext.Provider value={value}>
      {children}
      {notice ? (
        <div className="speech-toast" role="status" lang="fa" dir="rtl" data-testid="speech-notice" data-notice={notice}>
          <div className="speech-toast__body">
            <p>{SPEECH_NOTICE_TEXT[notice]}</p>
            {routed && notice !== 'blocked' ? (
              <button type="button" className="speech-toast__action" onClick={openSoundSettings}>تنظیمات صدا</button>
            ) : null}
          </div>
          <button type="button" className="speech-toast__close" onClick={dismissNotice} aria-label="بستن پیام صدا">×</button>
        </div>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SoundSettings onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
    </PronunciationContext.Provider>
  );
}

export function usePronunciation(): PronunciationContextValue {
  const ctx = useContext(PronunciationContext);
  if (!ctx) throw new Error('usePronunciation must be used inside <PronunciationProvider>');
  return ctx;
}
