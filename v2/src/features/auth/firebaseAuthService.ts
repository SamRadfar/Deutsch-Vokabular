import type { Auth, User } from 'firebase/auth';
import { AuthServiceError, type AuthService, type AuthUser } from './types';

const toAuthUser = (u: User): AuthUser => ({
  uid: u.uid,
  displayName: u.displayName,
  email: u.email,
  photoURL: u.photoURL,
});

/**
 * Firebase adapter. Google sign-in uses a popup (primary flow, see docs/FIREBASE_SETUP.md
 * for why redirect is not used as an automatic fallback). `prompt: select_account` makes
 * account switching explicit instead of silently reusing the last Google session.
 */
export function createFirebaseAuthService(authPromise: Promise<Auth>): AuthService {
  return {
    onAuthStateChanged(listener) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      void Promise.all([authPromise, import('firebase/auth')]).then(([auth, mod]) => {
        if (cancelled) return;
        unsubscribe = mod.onAuthStateChanged(auth, (u) => listener(u ? toAuthUser(u) : null));
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
    async signInWithGoogle() {
      const [auth, mod] = await Promise.all([authPromise, import('firebase/auth')]);
      const provider = new mod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await mod.signInWithPopup(auth, provider);
      } catch (e) {
        const code = typeof e === 'object' && e && 'code' in e && typeof e.code === 'string' ? e.code : 'auth/unknown';
        throw new AuthServiceError(code);
      }
    },
    async signOut() {
      const [auth, mod] = await Promise.all([authPromise, import('firebase/auth')]);
      await mod.signOut(auth);
    },
  };
}
