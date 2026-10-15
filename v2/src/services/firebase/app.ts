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

/**
 * The Google popup returns its result through an auth iframe in this page. Firebase loads that
 * iframe at start-up only on mobile/Safari (`_shouldInitProactively`); on desktop it loads when
 * the popup opens, and a fast sign-in on a slow connection can complete before the iframe is
 * ready — the result is then lost and the popup stays open (reproduced with the Auth Emulator;
 * docs/FIREBASE_VALIDATION.md §3). This subclass opts desktop into the same eager initialisation.
 *
 * `_shouldInitProactively` is an internal SDK member: a unit test fails if an SDK upgrade removes
 * it, and if it ever disappears the behaviour silently falls back to Firebase's default.
 */
export function eagerPopupResolver<T>(resolver: T): T {
  const Base = resolver as unknown as new () => object;
  if (typeof Base !== 'function') return resolver;
  class EagerPopupRedirectResolver extends Base {
    get _shouldInitProactively() { return true; }
  }
  return EagerPopupRedirectResolver as unknown as T;
}

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
      popupRedirectResolver: eagerPopupResolver(authMod.browserPopupRedirectResolver),
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
