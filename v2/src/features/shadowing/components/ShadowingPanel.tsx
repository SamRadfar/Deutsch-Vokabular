import '../shadowing.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Category, WordId } from '../../../models/vocabulary';
import { PREFERENCE_KEYS, readJsonPreference, writeJsonPreference } from '../../../services/preferences';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { modeAvailable, shuffle, type DeckCard, type DeckProgress } from '../../review/deck';
import { practiceScopes, usePersonal, usePracticeCards } from '../../personal/usePersonal';
import { ShadowingPlayer, type PlayerSnapshot } from '../player';
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

interface Session {
  player: ShadowingPlayer;
  order: WordId[];
}

const EMPTY_EXPOSURE: ReadonlyMap<WordId, number> = new Map();
const noop = () => () => {};
const none = () => null;

/** The "🗣 تلفظ" tab: setup → shadowing session → summary. */
export function ShadowingPanel({ categories, active, random, wakeLock }: Props) {
  const backend = useShadowingBackend();
  const { service: speech } = usePronunciation();
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

  // Leaving the tab or hiding the page pauses (timers are throttled and speech may stop in the background).
  useEffect(() => { if (!active) session?.player.pause('left'); }, [active, session]);
  useEffect(() => {
    if (!session) return;
    const onVisibility = () => { if (document.visibilityState === 'hidden') session.player.pause('background'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session]);

  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  // A remembered personal mode falls back to "all" while it is unavailable (signed out, loading).
  const shown: ShadowingPreferences = modeAvailable(prefs.mode, progress) ? prefs : { ...prefs, mode: 'all' };

  /** Starts a session and its first word inside the user's click (browser autoplay policies). */
  const begin = (deck: readonly DeckCard[]) => {
    const player = new ShadowingPlayer(
      deck.map((c) => ({ id: c.entry.id, word: c.entry.word, example: c.entry.example })),
      {
        speech,
        settings: () => prefsRef.current,
        wakeLock: port,
        onItemCompleted: (id) => backendRef.current.recordItem?.(id),
        onFinished: (s) => backendRef.current.recordSession?.(!s.endedEarly, (s.finishedAt ?? 0) - (s.startedAt ?? s.finishedAt ?? 0)),
      },
    );
    setSession({ player, order: deck.map((c) => c.entry.id) });
    player.play();
  };

  const startNew = () => {
    const selected = selectShadowingCards(cards, shown.mode, new Set(shown.categories), progress);
    begin(buildShadowingQueue(selected, backend.exposure ?? EMPTY_EXPOSURE, shown.size, random));
  };

  if (!session || !snap) {
    return <ShadowingSetup cards={cards} scopes={scopes} backend={backend} prefs={shown} onChange={updatePrefs} onStart={startNew} />;
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
      controls={{ play: () => p.play(), pause: () => p.pause(), stop: () => p.stop(), next: () => p.next(), previous: () => p.previous(), end: () => p.end() }}
      rate={prefs.rate}
      showTranslation={prefs.showTranslation}
      onRate={(rate) => updatePrefs({ ...prefsRef.current, rate })}
      onShowTranslation={(showTranslation) => updatePrefs({ ...prefsRef.current, showTranslation })}
    />
  );
}
