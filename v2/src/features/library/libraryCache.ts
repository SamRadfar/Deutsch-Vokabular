// Device copy of a verified library, per uid, in its own IndexedDB database (separate from the
// progress database, so its versioning is untouched). Best effort: without IndexedDB (private mode)
// the library is simply loaded from the server each time.

import type { CachedLibrary, LibraryCache } from './libraryService';
import { memoryLibraryCache } from './libraryService';

const DB = 'deutsch-vokabular-v2-library';
const STORE = 'libraries';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'uid' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createIndexedDbLibraryCache(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): LibraryCache {
  if (!factory) return memoryLibraryCache();
  let db: Promise<IDBDatabase> | null = null;
  const conn = () => (db ??= open(factory));
  return {
    async get(uid) {
      const row = await run<{ uid: string; entry: CachedLibrary } | undefined>(await conn(), 'readonly', (s) => s.get(uid));
      return row?.entry ?? null;
    },
    async put(uid, entry) { await run(await conn(), 'readwrite', (s) => s.put({ uid, entry })); },
    async clear(uid) { await run(await conn(), 'readwrite', (s) => s.delete(uid)); },
  };
}
