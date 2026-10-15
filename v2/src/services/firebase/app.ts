// Lazily initialised Firebase app, Auth and Firestore. Loaded with dynamic import so the
// Firebase SDK is a separate chunk and anonymous vocabulary browsing never waits for it.

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseClientOptions, EmulatorSettings } from './config';

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let pending: Promise<FirebaseHandles> | null = null;

export function getFirebase(options: FirebaseClientOptions, emulators: EmulatorSettings | null): Promise<FirebaseHandles> {
  pending ??= (async () => {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    const app = initializeApp(options);
    // Explicit persistence: the session survives reloads (browserLocalPersistence), with
    // IndexedDB first. Popup resolver enables signInWithPopup.
    const auth = authMod.initializeAuth(app, {
      persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
      popupRedirectResolver: authMod.browserPopupRedirectResolver,
    });
    // Memory cache only: the app's own IndexedDB store is the single local source of truth
    // for progress (see docs/SYNC_DESIGN.md); a second persistent cache would compete with it.
    const db = fsMod.initializeFirestore(app, { localCache: fsMod.memoryLocalCache() });
    if (emulators) {
      authMod.connectAuthEmulator(auth, `http://${emulators.host}:${emulators.authPort}`, { disableWarnings: true });
      fsMod.connectFirestoreEmulator(db, emulators.host, emulators.firestorePort);
    }
    return { app, auth, db };
  })();
  return pending;
}
