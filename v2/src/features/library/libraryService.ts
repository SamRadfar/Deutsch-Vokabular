// The signed-in account's vocabulary library (built-in categories). Owner-protected in Firestore
// (users/{uid}/library/*, readable only by that uid, never written by clients); an account without
// a library gets an empty one and manages its personal words only.
//
// Local-first: a verified copy is cached per uid on the device, shown at once on reload and used
// offline; the server meta document is watched, and new content replaces the copy only after every
// chunk passed its checksum and the content validation.

import type { IdRegistry } from '../../models/legacy';
import type { Dvok5MapSet } from '../progress/migration/dvok5Maps';
import { createRepositoryFromRaw, EMPTY_REPOSITORY, type VocabularyRepository } from '../../services/content/vocabularyRepository';
import { assembleLibrary, coreChunkIds, DVOK5_CHUNK, isLibraryMeta, parseExtraChunk, REGISTRY_CHUNK, type LibraryMeta } from './format';

export type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; repository: VocabularyRepository; empty: boolean; source: 'server' | 'cache' }
  | { status: 'error'; reason: 'offline' | 'invalid' | 'denied' | 'unknown' };

export interface LibraryRemote {
  /**
   * Server-confirmed meta document of the library (null = no library), on start and on change.
   * Snapshots that only come from a local SDK cache must not be reported.
   */
  watchMeta(uid: string, onMeta: (meta: unknown | null) => void, onError: (error: unknown) => void): () => void;
  /** JSON strings of the given chunks (missing chunks are left out). */
  fetchChunks(uid: string, ids: readonly string[]): Promise<Record<string, string>>;
}

export interface CachedLibrary { meta: LibraryMeta; chunks: Record<string, string> }

export interface LibraryCache {
  get(uid: string): Promise<CachedLibrary | null>;
  put(uid: string, entry: CachedLibrary): Promise<void>;
  clear(uid: string): Promise<void>;
}

export interface LibraryExtras { idRegistry: IdRegistry; dvok5Maps: Dvok5MapSet }

export interface LibraryService {
  /** Calls back with the library state of `uid` until the returned function is called. */
  watch(uid: string, onState: (state: LibraryState) => void): () => void;
  /** Legacy-migration chunks of the library (null: the account has no library). */
  loadExtras(uid: string): Promise<LibraryExtras | null>;
}

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '');

async function build(meta: LibraryMeta, chunks: Record<string, string>): Promise<VocabularyRepository> {
  const { vocabulary, technicalInfo } = await assembleLibrary(meta, chunks);
  return createRepositoryFromRaw(vocabulary, technicalInfo);
}

export function createLibraryService(opts: { remote: LibraryRemote; cache: LibraryCache; offlineTimeoutMs?: number; online?: () => boolean }): LibraryService {
  const { remote, cache } = opts;
  const online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const metaByUid = new Map<string, LibraryMeta | null>();

  return {
    watch(uid, onState) {
      let stopped = false;
      let shownHash: string | null = null; // content currently shown ('' = empty library)
      let serverSeen = false;
      const emit = (s: LibraryState) => { if (!stopped) onState(s); };
      emit({ status: 'loading' });

      // 1. The device copy first (instant reload, offline).
      void cache.get(uid).then(async (cached) => {
        if (!cached || stopped || serverSeen) return;
        try {
          const repository = await build(cached.meta, cached.chunks);
          if (stopped || serverSeen) return;
          shownHash = cached.meta.contentHash;
          emit({ status: 'ready', repository, empty: false, source: 'cache' });
        } catch {
          await cache.clear(uid).catch(() => {}); // a damaged copy is dropped, the server copy follows
        }
      }).catch(() => {});

      // 2. Without a copy and without a server answer: say so after a while (keeps waiting).
      const timer = setTimeout(() => { if (shownHash === null && !stopped) emit({ status: 'error', reason: online() ? 'unknown' : 'offline' }); }, opts.offlineTimeoutMs ?? 10_000);

      // 3. The server meta document (current content, changes, removal).
      const unsubscribe = remote.watchMeta(uid, (raw) => {
        serverSeen = true;
        void (async () => {
          if (raw === null) {
            metaByUid.set(uid, null);
            await cache.clear(uid).catch(() => {});
            shownHash = '';
            emit({ status: 'ready', repository: EMPTY_REPOSITORY, empty: true, source: 'server' });
            return;
          }
          if (!isLibraryMeta(raw)) { emit({ status: 'error', reason: 'invalid' }); return; }
          metaByUid.set(uid, raw);
          if (raw.contentHash === shownHash) return;
          try {
            const cached = await cache.get(uid).catch(() => null);
            const chunks = cached?.meta.contentHash === raw.contentHash ? cached.chunks : await remote.fetchChunks(uid, coreChunkIds(raw));
            const repository = await build(raw, chunks);
            if (stopped) return;
            if (cached?.meta.contentHash !== raw.contentHash) await cache.put(uid, { meta: raw, chunks }).catch(() => {});
            shownHash = raw.contentHash;
            emit({ status: 'ready', repository, empty: false, source: 'server' });
          } catch (e) {
            if (shownHash === null) emit({ status: 'error', reason: codeOf(e) === 'permission-denied' ? 'denied' : codeOf(e) === 'unavailable' ? 'offline' : 'invalid' });
          }
        })();
      }, (e) => {
        if (shownHash === null) emit({ status: 'error', reason: codeOf(e) === 'permission-denied' ? 'denied' : online() ? 'unknown' : 'offline' });
      });

      return () => { stopped = true; clearTimeout(timer); unsubscribe(); };
    },

    async loadExtras(uid) {
      const meta = metaByUid.get(uid) ?? (await cache.get(uid))?.meta ?? null;
      if (!meta) return null;
      const chunks = await remote.fetchChunks(uid, [REGISTRY_CHUNK, DVOK5_CHUNK]);
      const idRegistry = await parseExtraChunk(meta, REGISTRY_CHUNK, chunks[REGISTRY_CHUNK]) as IdRegistry;
      const dvok5Maps = await parseExtraChunk(meta, DVOK5_CHUNK, chunks[DVOK5_CHUNK]) as Dvok5MapSet;
      if (!Array.isArray(idRegistry?.entries) || !Array.isArray(dvok5Maps?.versions)) throw new Error('library: invalid migration data');
      return { idRegistry, dvok5Maps };
    },
  };
}

/** In-memory cache (tests). */
export function memoryLibraryCache(): LibraryCache & { entries: Map<string, CachedLibrary> } {
  const entries = new Map<string, CachedLibrary>();
  return {
    entries,
    async get(uid) { return entries.get(uid) ?? null; },
    async put(uid, entry) { entries.set(uid, entry); },
    async clear(uid) { entries.delete(uid); },
  };
}
