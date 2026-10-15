import type { Auth, User } from 'firebase/auth';
import { AuthServiceError, type AuthService, type AuthUser } from './types';

type AuthModule = typeof import('firebase/auth');

const toAuthUser = (u: User): AuthUser => ({
  uid: u.uid,
  displayName: u.displayName,
  email: u.email,
  photoURL: u.photoURL,
});

const codeOf = (e: unknown) => (typeof e === 'object' && e && 'code' in e && typeof e.code === 'string' ? e.code : 'auth/unknown');

/**
 * Firebase adapter. Google sign-in uses a popup (primary flow; see docs/FIREBASE_SETUP.md §8 for
 * why redirect is not used as an automatic fallback). `prompt: select_account` makes account
 * switching explicit instead of silently reusing the last Google session.
 *
 * Popup blockers (notably Safari) only allow window.open during the user's click. The SDK starts
 * loading at app start, so by the time the user clicks it is normally resolved and
 * signInWithPopup is called synchronously inside the click handler — without an intervening await.
 */
export function createFirebaseAuthService(authPromise: Promise<Auth>): AuthService {
  let ready: { auth: Auth; mod: AuthModule } | null = null;
  const loaded = Promise.all([authPromise, import('firebase/auth')]).then(([auth, mod]) => {
    ready = { auth, mod };
    return ready;
  });

  const popup = ({ auth, mod }: { auth: Auth; mod: AuthModule }) => {
    const provider = new mod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return mod.signInWithPopup(auth, provider).then(
      () => undefined,
      (e: unknown) => { throw new AuthServiceError(codeOf(e)); },
    );
  };

  return {
    onAuthStateChanged(listener) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      void loaded.then(({ auth, mod }) => {
        if (cancelled) return;
        unsubscribe = mod.onAuthStateChanged(auth, (u) => listener(u ? toAuthUser(u) : null));
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
    signInWithGoogle() {
      // Synchronous path keeps the browser's user-activation for the popup.
      if (ready) return popup(ready);
      return loaded.then(popup);
    },
    async signOut() {
      const { auth, mod } = await loaded;
      await mod.signOut(auth);
    },
  };
}
