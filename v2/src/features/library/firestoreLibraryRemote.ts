import type { Firestore } from 'firebase/firestore';
import { LIBRARY_META_ID } from './format';
import type { LibraryRemote } from './libraryService';

type FirestoreModule = typeof import('firebase/firestore');

/** users/{uid}/library/* — readable only by the owner (firestore.rules); never written by the app. */
export function createFirestoreLibraryRemote(dbPromise: Promise<Firestore>): LibraryRemote {
  const loaded = Promise.all([dbPromise, import('firebase/firestore')]);
  return {
    watchMeta(uid, onMeta, onError) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      void loaded.then(([db, fs]: [Firestore, FirestoreModule]) => {
        if (cancelled) return;
        unsubscribe = fs.onSnapshot(fs.doc(db, 'users', uid, 'library', LIBRARY_META_ID), { includeMetadataChanges: true }, (snap) => {
          if (snap.metadata.fromCache) return; // only server-confirmed answers decide "no library"
          onMeta(snap.exists() ? snap.data() : null);
        }, onError);
      }).catch(onError);
      return () => { cancelled = true; unsubscribe?.(); };
    },
    async fetchChunks(uid, ids) {
      const [db, fs] = await loaded;
      const docs = await Promise.all(ids.map((id) => fs.getDocFromServer(fs.doc(db, 'users', uid, 'library', id))));
      const out: Record<string, string> = {};
      docs.forEach((d, i) => {
        const json = d.exists() ? (d.data() as { json?: unknown }).json : undefined;
        if (typeof json === 'string') out[ids[i]!] = json;
      });
      return out;
    },
  };
}
