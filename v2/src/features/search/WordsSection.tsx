import './search.css';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, CategoryKey, TechnicalInfo, WordId } from '../../models/vocabulary';
import { panelElementId, tabElementId } from '../../components/TabList/TabList';
import { CategoryView } from '../vocabulary/components/CategoryView';
import type { EntryProgress } from '../vocabulary/components/LearnedCheckbox';
import { MAIN_TABS_PREFIX } from '../vocabulary/components/MainNavigation';
import type { DeckCard } from '../review/deck';
import { usePersonal, usePracticeCards } from '../personal/usePersonal';
import { createSearchIndex, filtersActive, NO_FILTERS, type SearchFilters } from './searchIndex';
import { SearchResults } from './SearchResults';
import { VocabularySearch } from './VocabularySearch';

export interface WordsSearchState {
  query: string;
  filters: SearchFilters;
}

interface Props {
  /** The library's built-in categories (practice cards add the personal words themselves). */
  categories: readonly Category[];
  /** Everything the browser shows: built-in (+ own subcategories) and own main categories. */
  browse: readonly Category[];
  /** The active category of `browse`. */
  category: Category;
  activeSubtabId: string;
  onSelectSubtab(id: string): void;
  onShow(key: CategoryKey, subtabId: string): void;
  /** "Show in list" for a personal word: its placement, or the "my words" section. */
  onShowPersonal(id: WordId): void;
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
  progress: EntryProgress | undefined;
  learned: ReadonlySet<WordId> | undefined;
  search: WordsSearchState;
  onSearch(state: WordsSearchState): void;
  /** Entry to highlight after "show in list"; cleared by the parent when the user navigates. */
  focusEntryId: WordId | null;
  onFocusEntry(id: WordId | null): void;
}

/** The "words" section: search + filters above the category browser, or the result list. */
export function WordsSection(p: Props) {
  const { categories, browse, search, onSearch, progress, learned } = p;
  const cards = usePracticeCards(categories); // built-in + personal words
  const { snapshot: personal } = usePersonal();
  const index = useMemo(() => createSearchIndex(cards), [cards]);
  const inputRef = useRef<HTMLInputElement>(null);

  const statusAvailable = !!learned;
  const filters: SearchFilters = statusAvailable ? search.filters : { ...search.filters, status: 'all' };
  const searching = search.query.trim() !== '' || filtersActive(filters);

  // Typing stays responsive: results follow at React's lower priority.
  const query = useDeferredValue(search.query);
  const deferredFilters = useDeferredValue(filters);

  // Words ticked/unticked in the current result view stay visible under a status filter.
  const [keep, setKeep] = useState<ReadonlySet<WordId>>(new Set());
  const filterKey = `${search.query}|${filters.category}|${filters.subtab}|${filters.status}`;
  useEffect(() => { setKeep(new Set()); }, [filterKey]);

  const hits = useMemo(
    () => (searching ? index.search(query, deferredFilters, learned ?? null, keep) : null),
    [searching, index, query, deferredFilters, learned, keep],
  );

  const resultsProgress = useMemo<EntryProgress | undefined>(() => progress && {
    ...progress,
    setLearned: (id, value) => { setKeep((k) => new Set(k).add(id)); progress.setLearned(id, value); },
  }, [progress]);
  const learnedOf = useCallback((id: WordId) => learned?.has(id) ?? false, [learned]);

  const { onShow, onShowPersonal, onFocusEntry } = p;
  const showInList = useCallback((card: DeckCard) => {
    onSearch({ query: '', filters: NO_FILTERS });
    if (card.personal) { onShowPersonal(card.entry.id); return; }
    onShow(card.categoryKey as Parameters<typeof onShow>[0], card.subtabId);
    onFocusEntry(card.entry.id);
  }, [onSearch, onShow, onShowPersonal, onFocusEntry]);

  // After "show in list": bring the entry into view and move keyboard focus to it.
  useEffect(() => {
    if (!p.focusEntryId || searching) return;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.mcontent [data-entry-id="${p.focusEntryId}"]`);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [p.focusEntryId, searching, p.category.key, p.activeSubtabId]);

  // "/" jumps to the search field (unless the user is typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, select, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="words">
      <VocabularySearch
        ref={inputRef}
        query={search.query}
        filters={filters}
        categories={browse}
        personalCount={personal?.words.length ?? 0}
        statusAvailable={statusAvailable}
        resultCount={hits ? hits.length : null}
        onQuery={(q) => onSearch({ ...search, query: q })}
        onFilters={(f) => onSearch({ ...search, filters: f })}
        onReset={() => onSearch({ query: '', filters: NO_FILTERS })}
      />
      {hits ? (
        <SearchResults key={`${query}|${deferredFilters.category}|${deferredFilters.subtab}|${deferredFilters.status}`} hits={hits} query={search.query} progress={resultsProgress} learnedOf={learnedOf} onShow={showInList} />
      ) : (
        <div role="tabpanel" id={panelElementId(MAIN_TABS_PREFIX, p.category.key)} aria-labelledby={tabElementId(MAIN_TABS_PREFIX, p.category.key)}>
          <CategoryView
            key={p.category.key}
            category={p.category}
            activeSubtabId={p.activeSubtabId}
            onSelectSubtab={(id) => { onFocusEntry(null); p.onSelectSubtab(id); }}
            getTechnicalInfo={p.getTechnicalInfo}
            progress={progress}
            learned={learned}
            focusEntryId={p.focusEntryId}
          />
        </div>
      )}
    </div>
  );
}
