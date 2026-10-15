import type { Firestore } from 'firebase/firestore';
import { paths } from './firestoreProgressRemote';
import { toRemoteError } from './remote';

/** users/{uid}: minimal profile (no email — data minimisation). */
export interface UserProfileInput {
  displayName: string | null;
  photoURL: string | null;
}

/** users/{uid}/migrations/{inputHash}: proof that a legacy dataset was imported (create-only). */
export interface MigrationRecord {
  schemaVersion: 1;
  inputHash: string;
  source: 'same-origin' | 'backup-file';
  legacyContentCommit: string;
  contentVersion: string;
  counts: {
    matchedEntries: number;
    imported: number;
    alreadyLearned: number;
    conflictsSkipped: number;
    ambiguousKeys: number;
    orphanedKeys: number;
  };
  status: 'completed';
}

export interface AccountRemote {
  saveProfile(uid: string, profile: UserProfileInput): Promise<void>;
  getMigrationRecord(uid: string, inputHash: string): Promise<MigrationRecord | null>;
  createMigrationRecord(uid: string, record: MigrationRecord): Promise<void>;
}

const clip = (s: string | null, max: number) => (s === null ? null : s.slice(0, max));

export function createFirestoreAccountRemote(dbPromise: Promise<Firestore>): AccountRemote {
  const fsModule = import('firebase/firestore');
  return {
    async saveProfile(uid, profile) {
      const [db, fs] = await Promise.all([dbPromise, fsModule]);
      try {
        await fs.setDoc(fs.doc(db, ...paths.user(uid)), {
          schemaVersion: 1,
          profile: { displayName: clip(profile.displayName, 200), photoURL: clip(profile.photoURL, 2000) },
          updatedAt: fs.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        throw toRemoteError(e);
      }
    },
    async getMigrationRecord(uid, inputHash) {
      const [db, fs] = await Promise.all([dbPromise, fsModule]);
      try {
        const snap = await fs.getDoc(fs.doc(db, ...paths.migrations(uid), inputHash));
        return snap.exists() ? (snap.data() as MigrationRecord) : null;
      } catch (e) {
        throw toRemoteError(e);
      }
    },
    async createMigrationRecord(uid, record) {
      const [db, fs] = await Promise.all([dbPromise, fsModule]);
      try {
        await fs.setDoc(fs.doc(db, ...paths.migrations(uid), record.inputHash), { ...record, completedAt: fs.serverTimestamp() });
      } catch (e) {
        throw toRemoteError(e);
      }
    },
  };
}
