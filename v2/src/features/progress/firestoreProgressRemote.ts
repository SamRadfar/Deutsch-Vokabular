import type { DocumentData, Firestore } from 'firebase/firestore';
import { PROGRESS_SCHEMA_VERSION, type ProgressOrigin } from './model';
import { toRemoteError, type ProgressRemote, type RemoteProgressDoc } from './remote';

/** Firestore paths — the only place they are spelled out. */
export const paths = {
  user: (uid: string) => ['users', uid] as const,
  progressCollection: (uid: string) => ['users', uid, 'progress'] as const,
  migrations: (uid: string) => ['users', uid, 'migrations'] as const,
};

interface TimestampLike { seconds: number; nanoseconds: number }
const isTimestamp = (v: unknown): v is TimestampLike =>
  typeof v === 'object' && v !== null && typeof (v as TimestampLike).seconds === 'number' && typeof (v as TimestampLike).nanoseconds === 'number';

/** ms with sub-millisecond precision, so two commits within one ms still order correctly. */
export const timestampToMs = (t: TimestampLike) => t.seconds * 1000 + t.nanoseconds / 1e6;

export function parseProgressDoc(id: string, data: DocumentData): RemoteProgressDoc | null {
  if (data.wordId !== id || typeof data.learned !== 'boolean' || typeof data.opId !== 'string' || !isTimestamp(data.updatedAt)) return null;
  const origin: ProgressOrigin = data.origin === 'migration' ? 'migration' : 'toggle';
  return { wordId: id, learned: data.learned, opId: data.opId, origin, serverUpdatedAt: timestampToMs(data.updatedAt) };
}

export function createFirestoreProgressRemote(dbPromise: Promise<Firestore>): ProgressRemote {
  const fsModule = import('firebase/firestore');
  return {
    subscribe(uid, handlers, options = {}) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      Promise.all([dbPromise, fsModule])
        .then(([db, fs]) => {
          if (cancelled) return;
          const col = fs.collection(db, ...paths.progressCollection(uid));
          // Incremental: only documents changed after the newest server time already stored
          // locally (uses Firestore's automatic single-field index on updatedAt).
          const source = options.since !== undefined
            ? fs.query(col, fs.where('updatedAt', '>', fs.Timestamp.fromMillis(Math.floor(options.since))))
            : col;
          unsubscribe = fs.onSnapshot(
            source,
            { includeMetadataChanges: true },
            (snap) => {
              const docs: RemoteProgressDoc[] = [];
              for (const change of snap.docChanges({ includeMetadataChanges: true })) {
                if (change.type === 'removed') continue;
                // Latency-compensated local echoes are not server-confirmed; the engine already
                // shows its own pending changes.
                if (change.doc.metadata.hasPendingWrites) continue;
                const parsed = parseProgressDoc(change.doc.id, change.doc.data());
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
      try {
        await fs.setDoc(fs.doc(db, ...paths.progressCollection(uid), w.wordId), {
          schemaVersion: PROGRESS_SCHEMA_VERSION,
          wordId: w.wordId,
          learned: w.learned,
          opId: w.opId,
          deviceId: w.deviceId,
          clientUpdatedAt: w.clientUpdatedAt,
          origin: w.origin,
          updatedAt: fs.serverTimestamp(),
        });
      } catch (e) {
        throw toRemoteError(e);
      }
    },
  };
}
