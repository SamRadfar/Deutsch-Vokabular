// Personal vocabulary of ONE signed-in uid, observable by React. Backed by the shared
// DocSyncEngine (the same engine as learned progress), collection users/{uid}/customWords:
//  - local-first: every change applies at once, is queued in IndexedDB and uploaded when online;
//  - remote = null → local-only mode (cloud sync switched off): changes stay queued on the device
//    and are uploaded once sync is enabled;
//  - deletions are tombstones (deleted: true); the rules never let a tombstone come back to life;
//  - an edit made on this device to a word that another device deleted is rejected by the rules —
//    it is NOT dropped: it is kept as a new word ("conflict copy") and the user is told.
// Details: docs/PERSONAL_SYNC.md.

import type { ProgressLocalStore } from '../progress/localStore';
import type { SyncStatus, WordSyncState } from '../progress/model';
import { DocSyncEngine, type DocRemote, type PendingWrite } from '../sync/docSyncEngine';
import {
  displayWord, isValidInput, isValidPersonalWord, newPersonalId, normalizeInput, validateInput,
  type FieldErrors, type PersonalWord, type PersonalWordInput,
} from './model';
import { fromValue, isCustomWordId, isCustomWordValue, toValue, type CustomWordValue } from './syncModel';

export interface ConflictNotice {
  /** The deleted word's id and the id of the copy that preserves the local edit. */
  deletedId: string;
  copyId: string;
  word: string;
}

export interface PersonalSnapshot {
  /** Live words (no tombstones), newest first. */
  readonly words: readonly PersonalWord[];
  readonly byId: ReadonlyMap<string, PersonalWord>;
  /** False when the last local write failed (changes are kept in memory for this page). */
  readonly saved: boolean;
  /** Phase 5A records that could not be read (left untouched in storage). */
  readonly unreadable: number;
  readonly sync: {
    /** `cloud`: synced with users/{uid}/customWords; `local`: cloud sync switched off. */
    mode: 'cloud' | 'local';
    status: SyncStatus;
    stateOf(id: string): WordSyncState;
  };
  readonly conflicts: readonly ConflictNotice[];
}

export type SaveResult = { ok: true; word: PersonalWord } | { ok: false; errors: FieldErrors };

export interface PersonalVocabularyOptions {
  remote?: DocRemote<CustomWordValue> | null;
  deviceId?: string;
  online?: boolean;
  now?: () => number;
  newId?: () => string;
  newOpId?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
  firstSnapshotTimeoutMs?: number;
}

const MIGRATED_5A_KEY = 'migrated-from-personal-words-v1';

export class PersonalVocabulary {
  private readonly engine: DocSyncEngine<CustomWordValue>;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly mode: 'cloud' | 'local';
  private unreadable = 0;
  private conflicts: ConflictNotice[] = [];
  private resolving = false;
  private snapshot: PersonalSnapshot;
  private engineSnap: unknown = null;

  constructor(readonly uid: string, private readonly store: ProgressLocalStore, opts: PersonalVocabularyOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => newPersonalId());
    this.mode = opts.remote ? 'cloud' : 'local';
    this.engine = new DocSyncEngine<CustomWordValue>({
      uid,
      local: store.docStore<CustomWordValue>('customWords'),
      remote: opts.remote ?? null,
      deviceId: opts.deviceId ?? 'device-unknown',
      isValidId: isCustomWordId,
      isValidValue: isCustomWordValue,
      fullSyncMetaKey: 'lastFullSyncAt',
      now: this.now,
      ...(opts.online !== undefined ? { online: opts.online } : {}),
      ...(opts.newOpId ? { newOpId: opts.newOpId } : {}),
      ...(opts.retryBaseMs !== undefined ? { retryBaseMs: opts.retryBaseMs } : {}),
      ...(opts.retryMaxMs !== undefined ? { retryMaxMs: opts.retryMaxMs } : {}),
      ...(opts.firstSnapshotTimeoutMs !== undefined ? { firstSnapshotTimeoutMs: opts.firstSnapshotTimeoutMs } : {}),
    });
    this.snapshot = this.build();
    this.engine.subscribe(() => this.onEngine());
  }

  /** Loads local data, takes over Phase 5A words once, and starts syncing. */
  async load(): Promise<void> {
    await this.engine.start();
    await this.takeOverPhase5A();
    this.emit();
  }

  stop(): void { this.engine.stop(); this.listeners.clear(); }
  setOnline(online: boolean): void { this.engine.setOnline(online); }
  /** Re-sends changes the server rejected (e.g. after the rules were deployed). */
  retryFailed(): void { this.engine.retryFailed(); }
  /** Resolves when every queued local write has finished (true) or after the timeout (false). */
  waitForSettled(timeoutMs?: number): Promise<boolean> { return this.engine.waitForSettled(undefined, timeoutMs); }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): PersonalSnapshot => {
    if (this.engineSnap !== this.engine.getSnapshot()) this.snapshot = this.build();
    return this.snapshot;
  };

  dismissConflict(copyId: string): void {
    this.conflicts = this.conflicts.filter((c) => c.copyId !== copyId);
    this.emit();
  }

  // ── changes ────────────────────────────────────────────────────────────────

  add(input: PersonalWordInput): SaveResult {
    const clean = normalizeInput(input);
    const errors = validateInput(clean);
    if (!isValidInput(errors)) return { ok: false, errors };
    const at = this.now();
    const word: PersonalWord = {
      schemaVersion: 1, id: this.freshId(), ...clean, learned: false, createdAt: at, updatedAt: at, source: 'manual', legacyId: null,
    };
    void this.engine.set(word.id, toValue(word));
    return { ok: true, word };
  }

  update(id: string, input: PersonalWordInput): SaveResult {
    const current = this.live(id);
    if (!current) return { ok: false, errors: { lemma: 'این واژه دیگر وجود ندارد.' } };
    const clean = normalizeInput(input);
    const errors = validateInput(clean);
    if (!isValidInput(errors)) return { ok: false, errors };
    const word: PersonalWord = { ...current, ...clean, updatedAt: this.now() };
    void this.engine.set(id, toValue(word));
    return { ok: true, word };
  }

  setLearned(id: string, learned: boolean): void {
    const current = this.live(id);
    if (!current || current.learned === learned) return;
    void this.engine.set(id, toValue({ ...current, learned, updatedAt: this.now() }));
  }

  /** Deletes (tombstone) after the user confirmed; returns the word so the UI can offer "undo". */
  remove(id: string): PersonalWord | null {
    const current = this.live(id);
    if (!current) return null;
    void this.engine.set(id, toValue({ ...current, updatedAt: this.now() }, true));
    return current;
  }

  /**
   * Undo of a delete. A tombstone is final (the rules forbid un-deleting, so no device can
   * resurrect a word by accident); undo therefore brings the word back as a new word with the same
   * content and learned state.
   */
  restore(word: PersonalWord): PersonalWord {
    const at = this.now();
    const copy: PersonalWord = { ...word, id: this.freshId(), updatedAt: at };
    void this.engine.set(copy.id, toValue(copy));
    return copy;
  }

  /** Adds prepared (validated) words, e.g. a legacy import. Existing ids are never overwritten. */
  async addMany(words: PersonalWord[]): Promise<void> {
    const values = this.engine.getSnapshot().values;
    const fresh = words.filter((w) => !values.has(w.id) && !this.engine.confirmedOf(w.id) && isValidPersonalWord(w));
    await this.engine.setMany(fresh.map((w) => [w.id, toValue(w)] as const));
  }

  /**
   * Moves words to another category (one batched write). Only the placement changes; words that no
   * longer exist are skipped. Returns how many words were moved.
   */
  async reassign(ids: readonly string[], placement: PersonalWord['placement']): Promise<number> {
    const at = this.now();
    const changes: Array<readonly [string, ReturnType<typeof toValue>]> = [];
    for (const id of ids) {
      const w = this.live(id);
      if (!w) continue;
      const same = (w.placement?.category ?? null) === (placement?.category ?? null) && (w.placement?.subtab ?? null) === (placement?.subtab ?? null);
      if (!same) changes.push([id, toValue({ ...w, placement: placement ? { ...placement } : null, updatedAt: at })] as const);
    }
    await this.engine.setMany(changes);
    return changes.length;
  }

  /** Resolves when the queued local writes are stored on this device. */
  flushed(): Promise<void> { return this.engine.whenStored(); }

  // ── internals ──────────────────────────────────────────────────────────────

  private live(id: string): PersonalWord | null {
    const v = this.engine.getSnapshot().values.get(id);
    return v && !v.deleted ? fromValue(id, v) : null;
  }

  private freshId(): string {
    let id = this.newId();
    while (this.engine.getSnapshot().values.has(id) || this.engine.confirmedOf(id)) id = this.newId();
    return id;
  }

  /** One-time: words created in Phase 5A (device-local store) join the synced collection. */
  private async takeOverPhase5A() {
    try {
      if (await this.engine.readMeta<boolean>(MIGRATED_5A_KEY)) return;
      const legacy = await this.store.loadPersonalWords(this.uid);
      const values = this.engine.getSnapshot().values;
      for (const w of legacy) {
        if (!isValidPersonalWord(w)) { this.unreadable++; continue; }
        if (!values.has(w.id) && !this.engine.confirmedOf(w.id)) await this.engine.set(w.id, toValue(w));
      }
      // The Phase 5A store is kept untouched as a backup.
      await this.engine.writeMeta(MIGRATED_5A_KEY, true);
    } catch {
      /* stays un-migrated; retried on the next start */
    }
  }

  private onEngine() {
    this.emit();
    if (!this.resolving) queueMicrotask(() => this.resolveDeletedElsewhere());
  }

  /**
   * A local edit to a word that another device deleted is rejected by the rules (a tombstone is
   * final). Keep the edit as a new word, then drop the rejected change.
   */
  private resolveDeletedElsewhere() {
    const snap = this.engine.getSnapshot();
    const conflicts: Array<{ op: PendingWrite<CustomWordValue> }> = [];
    for (const [id] of snap.values) {
      if (snap.stateOf(id) !== 'failed') continue;
      const op = this.engine.pendingOf(id);
      const server = this.engine.confirmedOf(id);
      if (op && !op.value.deleted && server?.value.deleted) conflicts.push({ op });
    }
    if (!conflicts.length) return;
    this.resolving = true;
    try {
      for (const { op } of conflicts) {
        const copy: PersonalWord = { ...fromValue(this.freshId(), op.value), updatedAt: this.now() };
        void this.engine.set(copy.id, toValue(copy));
        void this.engine.discardPending(op.id, op.opId);
        this.conflicts = [...this.conflicts, { deletedId: op.id, copyId: copy.id, word: displayWord(copy) }];
      }
    } finally {
      this.resolving = false;
    }
    this.emit();
  }

  private emit() {
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): PersonalSnapshot {
    const snap = this.engine.getSnapshot();
    this.engineSnap = snap;
    const words: PersonalWord[] = [];
    for (const [id, v] of snap.values) if (!v.deleted) words.push(fromValue(id, v));
    words.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return {
      words,
      byId: new Map(words.map((w) => [w.id, w])),
      saved: snap.status.lastError !== 'local-write-failed',
      unreadable: this.unreadable,
      sync: { mode: this.mode, status: snap.status, stateOf: snap.stateOf },
      conflicts: this.conflicts,
    };
  }
}
