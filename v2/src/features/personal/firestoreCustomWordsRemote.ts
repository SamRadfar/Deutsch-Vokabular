// Firestore adapter for users/{uid}/customWords/{wordId} (personal vocabulary sync). Same reading
// strategy as progress: a full read once, then only documents with updatedAt newer than the local
// copy; latency-compensated local echoes are ignored (the engine shows its own pending changes).

import type { DocumentData, Firestore } from 'firebase/firestore';
import { timestampToMs } from '../progress/firestoreProgressRemote';
import { toRemoteError } from '../progress/remote';
import type { DocRemote, RemoteDoc } from '../sync/docSyncEngine';
import { CUSTOM_WORD_SCHEMA_VERSION, isCustomWordId, isCustomWordValue, type CustomWordValue } from './syncModel';

export const customWordsPath = (uid: string) => ['users', uid, 'customWords'] as const;

interface TimestampLike { seconds: number; nanoseconds: number }
const isTimestamp = (v: unknown): v is TimestampLike =>
  typeof v === 'object' && v !== null && typeof (v as TimestampLike).seconds === 'number' && typeof (v as TimestampLike).nanoseconds === 'number';

export function parseCustomWordDoc(id: string, data: DocumentData): RemoteDoc<CustomWordValue> | null {
  if (data.schemaVersion !== CUSTOM_WORD_SCHEMA_VERSION || data.id !== id || !isCustomWordId(id)) return null;
  if (typeof data.opId !== 'string' || !isTimestamp(data.updatedAt)) return null;
  const value = {
    article: data.article ?? null, lemma: data.lemma, type: data.type, grammar: data.grammar, fa: data.fa,
    example: data.example, exampleFa: data.exampleFa, pronunciationFa: data.pronunciationFa, placement: data.placement ?? null,
    learned: data.learned, deleted: data.deleted, source: data.source, legacyId: data.legacyId ?? null,
    createdAt: data.createdAt, updatedAt: data.clientUpdatedAt,
  };
  return isCustomWordValue(value) ? { id, value, opId: data.opId, serverUpdatedAt: timestampToMs(data.updatedAt) } : null;
}

export function createFirestoreCustomWordsRemote(dbPromise: Promise<Firestore>): DocRemote<CustomWordValue> {
  const fsModule = import('firebase/firestore');
  return {
    subscribe(uid, handlers, options = {}) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      Promise.all([dbPromise, fsModule])
        .then(([db, fs]) => {
          if (cancelled) return;
          const col = fs.collection(db, ...customWordsPath(uid));
          const source = options.since !== undefined
            ? fs.query(col, fs.where('updatedAt', '>', fs.Timestamp.fromMillis(Math.floor(options.since))))
            : col;
          unsubscribe = fs.onSnapshot(
            source,
            { includeMetadataChanges: true },
            (snap) => {
              const docs: RemoteDoc<CustomWordValue>[] = [];
              for (const change of snap.docChanges({ includeMetadataChanges: true })) {
                if (change.type === 'removed' || change.doc.metadata.hasPendingWrites) continue;
                const parsed = parseCustomWordDoc(change.doc.id, change.doc.data());
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
        await fs.setDoc(fs.doc(db, ...customWordsPath(uid), w.id), {
          schemaVersion: CUSTOM_WORD_SCHEMA_VERSION,
          id: w.id,
          article: v.article,
          lemma: v.lemma,
          type: v.type,
          grammar: v.grammar,
          fa: v.fa,
          example: v.example,
          exampleFa: v.exampleFa,
          pronunciationFa: v.pronunciationFa,
          placement: v.placement ? { category: v.placement.category, subtab: v.placement.subtab } : null,
          learned: v.learned,
          deleted: v.deleted,
          source: v.source,
          legacyId: v.legacyId,
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
