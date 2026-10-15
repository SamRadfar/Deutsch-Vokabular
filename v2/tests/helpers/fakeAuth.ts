import { AuthServiceError, type AuthService, type AuthUser } from '../../src/features/auth/types';

export const ALICE: AuthUser = { uid: 'uid-alice', displayName: 'Alice Example', email: 'alice@example.test', photoURL: null };
export const BOB: AuthUser = { uid: 'uid-bob', displayName: 'Bob Example', email: 'bob@example.test', photoURL: 'https://example.test/bob.png' };

/**
 * Controllable fake identity provider for component tests. It is a test double for the
 * AuthService boundary — it does not verify real Google OAuth.
 */
export function createFakeAuth(options: { restored?: AuthUser | null; restoreDelayMs?: number } = {}) {
  let current: AuthUser | null = options.restored ?? null;
  const listeners = new Set<(u: AuthUser | null) => void>();
  let nextSignIn: { user?: AuthUser; errorCode?: string } = {};
  let pendingSignIn: { resolve(): void; reject(e: unknown): void } | null = null;
  let signOutError: string | null = null;
  const emit = () => { for (const l of listeners) l(current); };

  const service: AuthService & {
    willSignInAs(user: AuthUser): void;
    willFailSignIn(code: string): void;
    holdNextSignIn(): void;
    completeHeldSignIn(): void;
    willFailSignOut(code: string | null): void;
    switchUserExternally(user: AuthUser | null): void;
    calls: { signIn: number; signOut: number };
  } = {
    calls: { signIn: 0, signOut: 0 },
    onAuthStateChanged(listener) {
      listeners.add(listener);
      setTimeout(() => listener(current), options.restoreDelayMs ?? 0);
      return () => listeners.delete(listener);
    },
    signInWithGoogle() {
      service.calls.signIn++;
      const plan = nextSignIn;
      nextSignIn = {};
      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          if (plan.errorCode) { reject(new AuthServiceError(plan.errorCode)); return; }
          current = plan.user ?? ALICE;
          emit();
          resolve();
        };
        if (held) { held = false; pendingSignIn = { resolve: finish, reject }; } else setTimeout(finish, 0);
      });
    },
    async signOut() {
      service.calls.signOut++;
      if (signOutError) throw new AuthServiceError(signOutError);
      current = null;
      emit();
    },
    willSignInAs(user) { nextSignIn = { user }; },
    willFailSignIn(code) { nextSignIn = { errorCode: code }; },
    holdNextSignIn() { held = true; },
    completeHeldSignIn() { pendingSignIn?.resolve(); pendingSignIn = null; },
    willFailSignOut(code) { signOutError = code; },
    switchUserExternally(user) { current = user; emit(); },
  };
  let held = false;
  return service;
}
