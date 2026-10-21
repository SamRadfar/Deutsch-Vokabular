import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Category } from '../../models/vocabulary';
import { useProgress } from '../progress/ProgressProvider';
import { applyDestination, buildCatalog, type CatalogMain, type Destination } from './catalog';
import type { CategorySnapshot, CategoryStore } from './categoryStore';
import type { UserCategory } from './model';

const noop = () => () => {};
const none = () => null;
const EMPTY: readonly UserCategory[] = [];

export interface CategoriesApi {
  /** null while signed out or loading. */
  store: CategoryStore | null;
  snapshot: CategorySnapshot | null;
  /** The account's own categories (live). */
  user: readonly UserCategory[];
  /** Built-in + own categories — the one list every workflow uses. */
  catalog: CatalogMain[];
  builtInKeys: ReadonlySet<string>;
  /** Commits a destination (creates new categories now) → the word placement. */
  apply(d: Destination): ReturnType<typeof applyDestination>;
}

/** The account's categories (central service). `builtIn` = the library's categories. */
export function useCategories(builtIn: readonly Category[]): CategoriesApi {
  const progress = useProgress();
  const store = progress.status === 'ready' ? progress.categories : null;
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? none, store?.getSnapshot ?? none);
  const user = snapshot?.categories ?? EMPTY;
  const catalog = useMemo(() => buildCatalog(builtIn, user), [builtIn, user]);
  const builtInKeys = useMemo(() => new Set<string>(builtIn.map((c) => c.key)), [builtIn]);
  const apply = useCallback((d: Destination) => (store ? applyDestination(d, store, builtInKeys) : { ok: false as const, error: 'برای ساخت دسته وارد حساب شوید.' }), [store, builtInKeys]);
  return { store, snapshot, user, catalog, builtInKeys, apply };
}
