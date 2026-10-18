import { readFirebaseConfig } from '../services/firebase/config';
import { getFirebase } from '../services/firebase/app';
import { createFirebaseAuthService } from '../features/auth/firebaseAuthService';
import type { AuthService, AuthUnavailableReason } from '../features/auth/types';
import { createFirestoreProgressRemote } from '../features/progress/firestoreProgressRemote';
import { createFirestoreAccountRemote } from '../features/progress/accountRemote';
import { createDefaultLocalStore } from '../features/progress/localStore';
import type { ProgressServices } from '../features/progress/ProgressProvider';
import { createFirestoreCustomWordsRemote } from '../features/personal/firestoreCustomWordsRemote';

export interface AppServices {
  /** Shown in the header so it is always visible which backend the app talks to. */
  environmentLabel?: string;
  auth: AuthService | null;
  authUnavailable?: { reason: AuthUnavailableReason; details: string[] };
  progress: ProgressServices | null;
}

/** Real services from the public Firebase configuration; browse-only when it is missing. */
export function createAppServices(): AppServices {
  const config = readFirebaseConfig();
  if (config.status === 'missing') {
    return { auth: null, authUnavailable: { reason: 'not-configured', details: config.missing }, progress: null };
  }
  if (config.status === 'invalid') {
    return { auth: null, authUnavailable: { reason: 'invalid-config', details: config.problems }, progress: null };
  }
  const handles = getFirebase(config.options, config.emulators);
  const db = handles.then((h) => h.db);
  return {
    environmentLabel: config.environment === 'emulator' ? 'emulator' : `${config.environment === 'development' ? 'dev' : config.environment}: ${config.options.projectId}`,
    auth: createFirebaseAuthService(handles.then((h) => h.auth)),
    progress: {
      createRemote: () => createFirestoreProgressRemote(db),
      account: createFirestoreAccountRemote(db),
      createLocalStore: createDefaultLocalStore,
      // Personal vocabulary sync needs the Phase 5A.1 rules on the project (config.personalWordsSync).
      createPersonalRemote: () => (config.personalWordsSync ? createFirestoreCustomWordsRemote(db) : null),
    },
  };
}
