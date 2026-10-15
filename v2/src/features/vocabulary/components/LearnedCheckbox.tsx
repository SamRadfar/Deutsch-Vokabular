import type { WordSyncState } from '../../progress/model';

/** Progress capabilities handed to the vocabulary views (only when saving is actually available). */
export interface EntryProgress {
  isLearned(id: string): boolean;
  stateOf(id: string): WordSyncState;
  setLearned(id: string, learned: boolean): void;
}

const STATE_TEXT: Record<WordSyncState, string | null> = {
  synced: null,
  pending: 'در انتظار همگام‌سازی',
  failed: 'ذخیره نشد',
};

/** Legacy ✓ checkbox, now bound to the signed-in user's progress for one entry id. */
export function LearnedCheckbox({ entryId, word, progress }: { entryId: string; word: string; progress: EntryProgress }) {
  const learned = progress.isLearned(entryId);
  const state = progress.stateOf(entryId);
  const stateText = STATE_TEXT[state];
  return (
    <span className="learned">
      <input
        type="checkbox"
        className="vchk"
        checked={learned}
        onChange={(e) => progress.setLearned(entryId, e.currentTarget.checked)}
        aria-label={`یادگرفتم: ${word}`}
        data-sync={state}
      />
      {stateText ? <span className={`learned__state learned__state--${state}`} title={stateText} role="img" aria-label={stateText} /> : null}
    </span>
  );
}
