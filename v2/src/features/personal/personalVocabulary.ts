// Personal vocabulary of ONE signed-in uid, observable by React. Local-first: every change is
// applied in memory at once and written to IndexedDB (serialised). Cloud sync is NOT enabled:
// it needs the Firestore collection and rules proposed in docs/PERSONAL_VOCABULARY.md §5.

import type { ProgressLocalStore } from '../progress/localStore';
import {
  isValidInput, isValidPersonalWord, newPersonalId, normalizeInput, validateInput,
  type FieldErrors, type PersonalWord, type PersonalWordInput,
} from './model';

export interface PersonalSnapshot {
  /** Newest first. */
  readonly words: readonly PersonalWord[];
  readonly byId: ReadonlyMap<string, PersonalWord>;
  /** False when the last local write failed (changes are kept in memory for this page). */
  readonly saved: boolean;
  /** Records in local storage that could not be read (kept untouched in storage). */
  readonly unreadable: number;
}

export type SaveResult = { ok: true; word: PersonalWord } | { ok: false; errors: FieldErrors };

export class PersonalVocabulary {
  private readonly words = new Map<string, PersonalWord>();
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private saved = true;
  private unreadable = 0;
  private snapshot: PersonalSnapshot;

  constructor(
    readonly uid: string,
    private readonly store: ProgressLocalStore,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => newPersonalId(),
  ) {
    this.snapshot = this.build();
  }

  async load(): Promise<void> {
    try {
      for (const w of await this.store.loadPersonalWords(this.uid)) {
        if (isValidPersonalWord(w)) this.words.set(w.id, w);
        else this.unreadable++;
      }
    } catch {
      this.saved = false;
    }
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): PersonalSnapshot => this.snapshot;

  add(input: PersonalWordInput): SaveResult {
    const clean = normalizeInput(input);
    const errors = validateInput(clean);
    if (!isValidInput(errors)) return { ok: false, errors };
    const at = this.now();
    let id = this.newId();
    while (this.words.has(id)) id = this.newId();
    const word: PersonalWord = {
      schemaVersion: 1, id, ...clean, learned: false, createdAt: at, updatedAt: at, source: 'manual', legacyId: null,
    };
    this.words.set(id, word);
    this.persist(() => this.store.putPersonalWord(this.uid, word));
    return { ok: true, word };
  }

  update(id: string, input: PersonalWordInput): SaveResult {
    const current = this.words.get(id);
    if (!current) return { ok: false, errors: { lemma: 'این واژه دیگر وجود ندارد.' } };
    const clean = normalizeInput(input);
    const errors = validateInput(clean);
    if (!isValidInput(errors)) return { ok: false, errors };
    const word: PersonalWord = { ...current, ...clean, updatedAt: this.now() };
    this.words.set(id, word);
    this.persist(() => this.store.putPersonalWord(this.uid, word));
    return { ok: true, word };
  }

  setLearned(id: string, learned: boolean): void {
    const current = this.words.get(id);
    if (!current || current.learned === learned) return;
    const word = { ...current, learned, updatedAt: this.now() };
    this.words.set(id, word);
    this.persist(() => this.store.putPersonalWord(this.uid, word));
  }

  /** Deletes after the user confirmed; returns the word so the UI can offer "undo". */
  remove(id: string): PersonalWord | null {
    const word = this.words.get(id);
    if (!word) return null;
    this.words.delete(id);
    this.persist(() => this.store.deletePersonalWord(this.uid, id));
    return word;
  }

  /** Undo of a delete: puts the exact record back. */
  restore(word: PersonalWord): void {
    if (this.words.has(word.id)) return;
    this.words.set(word.id, word);
    this.persist(() => this.store.putPersonalWord(this.uid, word));
  }

  /** Adds prepared (already validated) words in one transaction, e.g. a legacy import. */
  addMany(words: PersonalWord[]): Promise<void> {
    const fresh = words.filter((w) => !this.words.has(w.id) && isValidPersonalWord(w));
    for (const w of fresh) this.words.set(w.id, w);
    return this.persist(() => this.store.putPersonalWords(this.uid, fresh));
  }

  /** Resolves when every queued local write has finished. */
  flushed(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  private persist(write: () => Promise<void>): Promise<void> {
    this.emit();
    const next = this.chain.then(async () => {
      try {
        await write();
        this.saved = true;
      } catch {
        this.saved = false;
      }
      this.emit();
    });
    this.chain = next;
    return next;
  }

  private emit() {
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): PersonalSnapshot {
    const words = [...this.words.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { words, byId: new Map(this.words), saved: this.saved, unreadable: this.unreadable };
  }
}
