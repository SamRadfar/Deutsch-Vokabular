// The account's categories, observable by React. Backed by the shared DocSyncEngine (like personal
// words): local-first (IndexedDB, works offline), uploaded when online, deletions are tombstones.
// remote = null → local-only mode (cloud sync of categories switched off): changes stay queued on the
// device and are uploaded once sync is enabled.

import type { ProgressLocalStore } from '../progress/localStore';
import type { SyncStatus } from '../progress/model';
import { DocSyncEngine, type DocRemote } from '../sync/docSyncEngine';
import {
  BUILTIN_KEY_PATTERN, cleanCategoryName, isCategoryId, isCategoryValue, nameKey, newCategoryId, toCategory, validateName,
  type CategoryValue, type NameError, type UserCategory,
} from './model';

export interface CategorySnapshot {
  /** Live categories (no tombstones), by sort then name. */
  readonly categories: readonly UserCategory[];
  readonly byId: ReadonlyMap<string, UserCategory>;
  readonly sync: { mode: 'cloud' | 'local'; status: SyncStatus };
}

export type CategoryResult = { ok: true; category: UserCategory } | { ok: false; error: NameError | 'invalid-parent' | 'not-found' };

export interface CategoryStoreOptions {
  remote?: DocRemote<CategoryValue> | null;
  deviceId?: string;
  online?: boolean;
  now?: () => number;
  newId?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export class CategoryStore {
  private readonly engine: DocSyncEngine<CategoryValue>;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly mode: 'cloud' | 'local';
  private snapshot: CategorySnapshot;
  private engineSnap: unknown = null;

  constructor(readonly uid: string, store: ProgressLocalStore, opts: CategoryStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => newCategoryId());
    this.mode = opts.remote ? 'cloud' : 'local';
    this.engine = new DocSyncEngine<CategoryValue>({
      uid,
      local: store.docStore<CategoryValue>('categories'),
      remote: opts.remote ?? null,
      deviceId: opts.deviceId ?? 'device-unknown',
      isValidId: isCategoryId,
      isValidValue: isCategoryValue,
      fullSyncMetaKey: 'lastFullSyncAt',
      now: this.now,
      ...(opts.online !== undefined ? { online: opts.online } : {}),
      ...(opts.retryBaseMs !== undefined ? { retryBaseMs: opts.retryBaseMs } : {}),
      ...(opts.retryMaxMs !== undefined ? { retryMaxMs: opts.retryMaxMs } : {}),
    });
    this.snapshot = this.build();
    this.engine.subscribe(() => this.emit());
  }

  async load(): Promise<void> { await this.engine.start(); this.emit(); }
  stop(): void { this.engine.stop(); this.listeners.clear(); }
  setOnline(online: boolean): void { this.engine.setOnline(online); }
  retryFailed(): void { this.engine.retryFailed(); }
  waitForSettled(timeoutMs?: number): Promise<boolean> { return this.engine.waitForSettled(undefined, timeoutMs); }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): CategorySnapshot => {
    if (this.engineSnap !== this.engine.getSnapshot()) this.snapshot = this.build();
    return this.snapshot;
  };

  /** Children of a parent (null = main categories). */
  children(parentId: string | null): UserCategory[] {
    return this.getSnapshot().categories.filter((c) => c.parentId === parentId);
  }

  /**
   * Creates a category. Duplicate names under the same parent are refused (case, whitespace and
   * umlaut variants included). Subcategories are allowed below user MAIN categories and below
   * built-in categories (`builtInKeys`), never below a subcategory.
   */
  create(name: string, parentId: string | null, builtInKeys: ReadonlySet<string> = new Set(), id?: string, createdAt?: number): CategoryResult {
    const clean = cleanCategoryName(name);
    if (parentId !== null && !this.validParent(parentId, builtInKeys)) return { ok: false, error: 'invalid-parent' };
    const error = validateName(clean, this.children(parentId));
    if (error) return { ok: false, error };
    const at = this.now();
    const value: CategoryValue = { name: clean, parentId, sort: this.children(parentId).length, deleted: false, createdAt: createdAt ?? at, updatedAt: at };
    // A deleted category stays a tombstone (the rules never revive it): a requested id that is
    // already known gets a fresh one instead.
    const newId = id && !this.known(id) ? id : this.freshId();
    void this.engine.set(newId, value);
    return { ok: true, category: toCategory(newId, value) };
  }

  /** The existing category with this name under the parent, or a new one (idempotent: retries never duplicate). */
  ensure(name: string, parentId: string | null, builtInKeys: ReadonlySet<string> = new Set(), id?: string, createdAt?: number): CategoryResult {
    const key = nameKey(name);
    const existing = this.children(parentId).find((c) => nameKey(c.name) === key);
    if (existing) return { ok: true, category: existing };
    if (id && this.getSnapshot().byId.has(id)) return { ok: true, category: this.getSnapshot().byId.get(id)! };
    return this.create(name, parentId, builtInKeys, id, createdAt);
  }

  /** Renames; the id stays (every word keeps pointing to it). */
  rename(id: string, name: string): CategoryResult {
    const current = this.getSnapshot().byId.get(id);
    if (!current) return { ok: false, error: 'not-found' };
    const clean = cleanCategoryName(name);
    const error = validateName(clean, this.children(current.parentId), id);
    if (error) return { ok: false, error };
    const value: CategoryValue = { name: clean, parentId: current.parentId, sort: current.sort, deleted: false, createdAt: current.createdAt, updatedAt: this.now() };
    void this.engine.set(id, value);
    return { ok: true, category: toCategory(id, value) };
  }

  /** Deletes a category and its subcategories (tombstones). Words are NOT touched here — the caller reassigns them first. */
  remove(id: string): UserCategory[] {
    const current = this.getSnapshot().byId.get(id);
    if (!current) return [];
    const removed = [current, ...this.children(id)];
    for (const c of removed) {
      void this.engine.set(c.id, { name: c.name, parentId: c.parentId, sort: c.sort, deleted: true, createdAt: c.createdAt, updatedAt: this.now() });
    }
    return removed;
  }

  private validParent(parentId: string, builtInKeys: ReadonlySet<string>): boolean {
    if (isCategoryId(parentId)) return this.getSnapshot().byId.get(parentId)?.parentId === null; // two levels only
    return BUILTIN_KEY_PATTERN.test(parentId) && builtInKeys.has(parentId);
  }

  private known(id: string): boolean {
    return this.engine.getSnapshot().values.has(id) || !!this.engine.confirmedOf(id);
  }

  private freshId(): string {
    let id = this.newId();
    while (this.known(id)) id = this.newId();
    return id;
  }

  private emit() {
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): CategorySnapshot {
    const snap = this.engine.getSnapshot();
    this.engineSnap = snap;
    const categories: UserCategory[] = [];
    for (const [id, v] of snap.values) if (!v.deleted) categories.push(toCategory(id, v));
    categories.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
    return { categories, byId: new Map(categories.map((c) => [c.id, c])), sync: { mode: this.mode, status: snap.status } };
  }
}
