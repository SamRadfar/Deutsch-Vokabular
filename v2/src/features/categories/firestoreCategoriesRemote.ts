// Firestore adapter for users/{uid}/categories/{categoryId} (account categories). Same strategy as
// personal words: a full read once, then only documents changed since the local copy; local echoes
// (pending writes) are ignored because the engine shows its own pending changes.

import type { DocumentData, Firestore } from 'firebase/firestore';
import { timestampToMs } from '../progress/firestoreProgressRemote';
import { toRemoteError } from '../progress/remote';
import type { DocRemote, RemoteDoc } from '../sync/docSyncEngine';
import { CATEGORY_SCHEMA_VERSION, isCategoryId, isCategoryValue, type CategoryValue } from './model';

export const categoriesPath = (uid: string) => ['users', uid, 'categories'] as const;

interface TimestampLike { seconds: number; nanoseconds: number }
const isTimestamp = (v: unknown): v is TimestampLike =>
  typeof v === 'object' && v !== null && typeof (v as TimestampLike).seconds === 'number' && typeof (v as TimestampLike).nanoseconds === 'number';

export function parseCategoryDoc(id: string, data: DocumentData): RemoteDoc<CategoryValue> | null {
  if (data.schemaVersion !== CATEGORY_SCHEMA_VERSION || data.id !== id || !isCategoryId(id)) return null;
  if (typeof data.opId !== 'string' || !isTimestamp(data.updatedAt)) return null;
  const value = {
    name: data.name, parentId: data.parentId ?? null, sort: data.sort, deleted: data.deleted,
    createdAt: data.createdAt, updatedAt: data.clientUpdatedAt,
  };
  return isCategoryValue(value) ? { id, value, opId: data.opId, serverUpdatedAt: timestampToMs(data.updatedAt) } : null;
}

export function createFirestoreCategoriesRemote(dbPromise: Promise<Firestore>): DocRemote<CategoryValue> {
  const fsModule = import('firebase/firestore');
  return {
    subscribe(uid, handlers, options = {}) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      Promise.all([dbPromise, fsModule])
        .then(([db, fs]) => {
          if (cancelled) return;
          const col = fs.collection(db, ...categoriesPath(uid));
          const source = options.since !== undefined
            ? fs.query(col, fs.where('updatedAt', '>', fs.Timestamp.fromMillis(Math.floor(options.since))))
            : col;
          unsubscribe = fs.onSnapshot(
            source,
            { includeMetadataChanges: true },
            (snap) => {
              const docs: RemoteDoc<CategoryValue>[] = [];
              for (const change of snap.docChanges({ includeMetadataChanges: true })) {
                if (change.type === 'removed' || change.doc.metadata.hasPendingWrites) continue;
                const parsed = parseCategoryDoc(change.doc.id, change.doc.data());
                if (parsed) docs.push(parsed);
              }
              if (docs.length || !snap.metadata.fromCache) handlers.onDocs(docs);
            },
            (error) => handlers.onError(toRemoteError(error)),
          );
        })
        .catch((e: unknown) => handlers.onError(toRemoteError(e)));
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },

    async write(uid, w) {
      const [db, fs] = await Promise.all([dbPromise, fsModule]);
      const v = w.value;
      try {
        await fs.setDoc(fs.doc(db, ...categoriesPath(uid), w.id), {
          schemaVersion: CATEGORY_SCHEMA_VERSION,
          id: w.id,
          name: v.name,
          parentId: v.parentId,
          sort: v.sort,
          deleted: v.deleted,
          createdAt: v.createdAt,
          clientUpdatedAt: w.clientUpdatedAt,
          updatedAt: fs.serverTimestamp(),
          opId: w.opId,
          deviceId: w.deviceId,
        });
      } catch (e) {
        throw toRemoteError(e);
      }
    },
  };
}
