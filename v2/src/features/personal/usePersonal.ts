import { useMemo, useSyncExternalStore } from 'react';
import type { Category, WordId } from '../../models/vocabulary';
import { useProgress } from '../progress/ProgressProvider';
import { flattenCards, PERSONAL_KEY, PERSONAL_LABEL, personalCards, type DeckCard, type PracticeCategoryKey } from '../review/deck';
import { isPersonalId } from './model';
import type { PersonalSnapshot, PersonalVocabulary } from './personalVocabulary';

const noop = () => () => {};
const none = () => null;

/** The signed-in user's personal vocabulary (null while signed out or loading). */
export function usePersonal(): { vocab: PersonalVocabulary | null; snapshot: PersonalSnapshot | null } {
  const progress = useProgress();
  const vocab = progress.status === 'ready' ? progress.personal : null;
  const snapshot = useSyncExternalStore(vocab?.subscribe ?? noop, vocab?.getSnapshot ?? none, vocab?.getSnapshot ?? none);
  return { vocab, snapshot };
}

/** Learned set for practice: built-in words (synced through Firestore) ∪ personal words (local). */
export function mergeLearned(builtIn: ReadonlySet<WordId>, personal: PersonalSnapshot | null): ReadonlySet<WordId> {
  if (!personal?.words.some((w) => w.learned)) return builtIn;
  const all = new Set(builtIn);
  for (const w of personal.words) if (w.learned) all.add(w.id);
  return all;
}

/**
 * Where a learned flag lives: built-in ids (`dv_`) in the synced progress (sync engine →
 * Firestore), personal ids (`pw_`) in the local personal word record. The deployed rules accept
 * only `dv_` ids for progress, so personal words must never reach the sync engine.
 */
export function routeLearned(
  setBuiltIn: (id: WordId, learned: boolean) => void,
  vocab: Pick<PersonalVocabulary, 'setLearned'> | null,
) {
  return (id: WordId, learned: boolean) => {
    if (isPersonalId(id)) vocab?.setLearned(id, learned);
    else setBuiltIn(id, learned);
  };
}

/** Offset of personal cards in content order (after all built-in cards). */
export const PERSONAL_ORDER_OFFSET = 100_000;

/** All practice cards: the 999 built-in entries, then the user's personal words. */
export function usePracticeCards(categories: readonly Category[]): DeckCard[] {
  const { snapshot } = usePersonal();
  const builtIn = useMemo(() => flattenCards(categories), [categories]);
  return useMemo(
    () => (snapshot?.words.length ? [...builtIn, ...personalCards(snapshot.words, PERSONAL_ORDER_OFFSET)] : builtIn),
    [builtIn, snapshot],
  );
}

/** Scopes offered in practice setups: the built-in categories, plus "my words" when there are any. */
export function practiceScopes(categories: readonly Category[], personalCount: number): Array<{ key: PracticeCategoryKey; label: string; theme: string }> {
  const scopes: Array<{ key: PracticeCategoryKey; label: string; theme: string }> = categories.map((c) => ({ key: c.key, label: c.label, theme: c.theme }));
  if (personalCount > 0) scopes.push({ key: PERSONAL_KEY, label: PERSONAL_LABEL, theme: 'review' });
  return scopes;
}
