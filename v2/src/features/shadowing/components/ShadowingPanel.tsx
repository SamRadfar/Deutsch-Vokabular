import '../shadowing.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Category, WordId } from '../../../models/vocabulary';
import { PREFERENCE_KEYS, readJsonPreference, writeJsonPreference } from '../../../services/preferences';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { modeAvailable, shuffle, type DeckCard, type DeckProgress } from '../../review/deck';
import { practiceScopes, usePersonal, usePracticeCards } from '../../personal/usePersonal';
import { openNeuralVoice } from '../../audio/neuralVoice';
import { useOnDeviceVoice } from '../../audio/useOnDeviceVoice';
import { AudioSessionPlayer } from '../audioSession/audioSessionPlayer';
import { renderSession, RenderAbortedError } from '../audioSession/render';
import { ShadowingPlayer, type PlayerSnapshot, type ShadowingItem } from '../player';
import { buildShadowingQueue, selectShadowingCards } from '../queue';
import { sanitizePreferences, type ShadowingPreferences } from '../settings';
import { useShadowingBackend } from '../useShadowingBackend';
import { createWakeLockPort, type WakeLockPort } from '../wakeLock';
import { ShadowingSession } from './ShadowingSession';
import { ShadowingSetup } from './ShadowingSetup';
import { ShadowingSummary } from './ShadowingSummary';

interface Props {
  categories: readonly Category[];
  /** The shadowing tab is visible. Leaving it pauses playback. */
  active: boolean;
  random?: () => number;
  wakeLock?: WakeLockPort;
}

type SessionPlayer = Pick<ShadowingPlayer, 'subscribe' | 'getSnapshot' | 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'end' | 'dispose'>;

interface Session {
  player: SessionPlayer;
  order: WordId[];
  /** Pre-rendered audio (keeps playing with the screen locked) instead of live browser speech. */
  audio: boolean;
}

/** Rendering the audio of an audio-mode session. */
interface Preparing {
  done: number;
  total: number;
  abort: AbortController;
  failed: boolean;
}

const EMPTY_EXPOSURE: ReadonlyMap<WordId, number> = new Map();
const noop = () => () => {};
const none = () => null;

/** The "🗣 تلفظ" tab: setup → shadowing session → summary. */
export function ShadowingPanel({ categories, active, random, wakeLock }: Props) {
  const backend = useShadowingBackend();
  const { service: speech } = usePronunciation();
  const onDeviceVoice = useOnDeviceVoice();
  const [preparing, setPreparing] = useState<Preparing | null>(null);
  const preparingRef = useRef<Preparing | null>(null);
  preparingRef.current = preparing;
  useEffect(() => () => preparingRef.current?.abort.abort(), []);
  const port = useMemo(() => wakeLock ?? createWakeLockPort(), [wakeLock]);
  const cards = usePracticeCards(categories); // built-in + personal words
  const { snapshot: personal } = usePersonal();
  const scopes = useMemo(() => practiceScopes(categories, personal?.words.length ?? 0), [categories, personal]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.entry.id, c])), [cards]);

  const [prefs, setPrefs] = useState(() => sanitizePreferences(readJsonPreference(PREFERENCE_KEYS.shadowing)));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const updatePrefs = useCallback((next: ShadowingPreferences) => {
    setPrefs(next);
    writeJsonPreference(PREFERENCE_KEYS.shadowing, next);
  }, []);

  const backendRef = useRef(backend);
  backendRef.current = backend;

  const [session, setSession] = useState<Session | null>(null);
  const snap: PlayerSnapshot | null = useSyncExternalStore(
    session?.player.subscribe ?? noop, session?.player.getSnapshot ?? none, session?.player.getSnapshot ?? none);

  // One player per session; every way out (new session, unmount, account switch) disposes it.
  useEffect(() => () => session?.player.dispose(), [session]);

  // Leaving the tab pauses. Hiding the page pauses live speech (timers are throttled and speech
  // stops in the background); an audio session keeps playing — that is its purpose.
  useEffect(() => { if (!active) session?.player.pause('left'); }, [active, session]);
  useEffect(() => {
    if (!session || session.audio) return;
    const onVisibility = () => { if (document.visibilityState === 'hidden') session.player.pause('background'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session]);

  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  // A remembered personal mode falls back to "all" while it is unavailable (signed out, loading).
  const shown: ShadowingPreferences = modeAvailable(prefs.mode, progress) ? prefs : { ...prefs, mode: 'all' };

  const onItemCompleted = (id: WordId) => backendRef.current.recordItem?.(id);
  const onFinished = (s: PlayerSnapshot) => backendRef.current.recordSession?.(!s.endedEarly, (s.finishedAt ?? 0) - (s.startedAt ?? s.finishedAt ?? 0));

  /** Starts a session and its first word inside the user's click (browser autoplay policies). */
  const begin = (deck: readonly DeckCard[]) => {
    const items: ShadowingItem[] = deck.map((c) => ({ id: c.entry.id, word: c.entry.word, example: c.entry.example }));
    const order = deck.map((c) => c.entry.id);
    if (prefsRef.current.playback === 'audio') { void prepareAudio(items, order); return; }
    const player = new ShadowingPlayer(items, { speech, settings: () => prefsRef.current, wakeLock: port, onItemCompleted, onFinished });
    setSession({ player, order, audio: false });
    player.play();
  };

  /** Audio mode: synthesize the whole session on this device first (no network, nothing stored). */
  const prepareAudio = async (items: ShadowingItem[], order: WordId[]) => {
    preparingRef.current?.abort.abort();
    setSession(null);
    const abort = new AbortController();
    const state: Preparing = { done: 0, total: 0, abort, failed: false };
    setPreparing(state);
    try {
      const voice = await openNeuralVoice();
      let rendered;
      try {
        rendered = await renderSession(items, prefsRef.current, voice, {
          signal: abort.signal,
          onProgress: (done, total) => { if (!abort.signal.aborted) setPreparing({ ...state, done, total }); },
        });
      } finally {
        voice.dispose();
      }
      if (abort.signal.aborted) return;
      const player = new AudioSessionPlayer(rendered, { onItemCompleted, onFinished });
      setPreparing(null);
      setSession({ player, order, audio: true });
    } catch (e) {
      if (abort.signal.aborted || e instanceof RenderAbortedError) return;
      setPreparing({ ...state, failed: true });
    }
  };

  const startNew = () => {
    const selected = selectShadowingCards(cards, shown.mode, new Set(shown.categories), progress);
    begin(buildShadowingQueue(selected, backend.exposure ?? EMPTY_EXPOSURE, shown.size, random));
  };

  if (preparing) {
    return (
      <section className="sh-prepare" aria-labelledby="sh-prep-title" lang="fa" dir="rtl" data-testid="sh-prepare">
        <h2 id="sh-prep-title" className="page-head__title">آماده‌سازی جلسهٔ صوتی</h2>
        {preparing.failed ? (
          <p className="rv-notice rv-notice--error" role="alert">ساخت صدای جلسه روی این دستگاه ناموفق بود (حافظه یا پشتیبانی مرورگر). جلسه را کوتاه‌تر کنید یا حالت «صدای مرورگر» را انتخاب کنید.</p>
        ) : (
          <>
            <p role="status">
              صدای واژه‌ها و جمله‌ها روی همین دستگاه ساخته می‌شود (بدون ارسال به اینترنت)…{' '}
              {preparing.total ? <span dir="ltr">{preparing.done} / {preparing.total}</span> : null}
            </p>
            <progress max={preparing.total || 1} value={preparing.done} aria-label="پیشرفت آماده‌سازی" />
            <p className="sh-prepare__hint">پس از آماده‌شدن، «پخش» را بزنید؛ سپس می‌توانید صفحه را قفل کنید.</p>
          </>
        )}
        <button type="button" className="fc-tool" onClick={() => { preparing.abort.abort(); setPreparing(null); }}>
          {preparing.failed ? 'بازگشت' : 'لغو'}
        </button>
      </section>
    );
  }

  if (!session || !snap) {
    return <ShadowingSetup cards={cards} scopes={scopes} backend={backend} prefs={shown} onChange={updatePrefs} onStart={startNew} onDeviceVoice={onDeviceVoice} />;
  }

  if (snap.status === 'finished') {
    return (
      <ShadowingSummary
        snap={snap}
        saving={backend.status === 'ready'}
        onNewRound={startNew}
        onRepeat={() => begin(shuffle(session.order.map((id) => cardsById.get(id)!), random))}
        onSettings={() => setSession(null)}
      />
    );
  }

  const p = session.player;
  return (
    <ShadowingSession
      snap={snap}
      cardsById={cardsById}
      order={session.order}
      active={active}
      audioMode={session.audio}
      controls={{ play: () => p.play(), pause: () => p.pause(), stop: () => p.stop(), next: () => p.next(), previous: () => p.previous(), end: () => p.end() }}
      rate={prefs.rate}
      showTranslation={prefs.showTranslation}
      onRate={(rate) => updatePrefs({ ...prefsRef.current, rate })}
      onShowTranslation={(showTranslation) => updatePrefs({ ...prefsRef.current, showTranslation })}
    />
  );
}
