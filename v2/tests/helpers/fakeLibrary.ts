import { bundledContent } from '../../src/services/content/bundled';
import { splitLibrary, type LibraryMeta } from '../../src/features/library/format';
import type { LibraryRemote } from '../../src/features/library/libraryService';

export type LibraryKind = 'bundled' | 'empty';

let split: Promise<{ meta: LibraryMeta; chunks: Record<string, string> }> | null = null;
/** The original content in library form (computed once per test file). */
export const bundledLibrary = () => (split ??= splitLibrary(bundledContent as never));

/**
 * In-memory stand-in for users/{uid}/library/* (the real LibraryService runs on top of it).
 * `libraryFor(uid)` decides which account owns the built-in library.
 */
export function createFakeLibraryRemote(libraryFor: (uid: string) => LibraryKind = () => 'bundled') {
  const watchers = new Map<string, Set<(meta: unknown | null) => void>>();
  const overrides = new Map<string, LibraryKind>();
  let offline = false;
  const kindOf = (uid: string) => overrides.get(uid) ?? libraryFor(uid);
  const publish = async (uid: string) => {
    const meta = kindOf(uid) === 'bundled' ? (await bundledLibrary()).meta : null;
    for (const w of watchers.get(uid) ?? []) w(meta);
  };
  const remote: LibraryRemote & {
    calls: { chunks: number };
    /** The owner import finishing while the app is open. */
    setLibrary(uid: string, kind: LibraryKind): Promise<void>;
    setOffline(value: boolean): void;
  } = {
    calls: { chunks: 0 },
    watchMeta(uid, onMeta) {
      const set = watchers.get(uid) ?? new Set();
      watchers.set(uid, set);
      set.add(onMeta);
      if (!offline) {
        void (async () => {
          const meta = kindOf(uid) === 'bundled' ? (await bundledLibrary()).meta : null;
          if (set.has(onMeta)) onMeta(meta);
        })();
      }
      return () => set.delete(onMeta);
    },
    async fetchChunks(_uid, ids) {
      if (offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      remote.calls.chunks++;
      const { chunks } = await bundledLibrary();
      return Object.fromEntries(ids.filter((id) => id in chunks).map((id) => [id, chunks[id]!]));
    },
    async setLibrary(uid, kind) { overrides.set(uid, kind); await publish(uid); },
    setOffline(value) { offline = value; },
  };
  return remote;
}
