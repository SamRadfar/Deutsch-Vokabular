import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SIGN_OUT_FAILED, toAuthError } from './authErrors';
import type { AuthError, AuthService, AuthState, AuthUnavailableReason } from './types';

interface AuthContextValue {
  state: AuthState;
  /** Last user-facing error (sign-in or sign-out), cleared by dismissError or a new attempt. */
  error: AuthError | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  dismissError(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Props {
  /** null = authentication unavailable (see `unavailable`). */
  service: AuthService | null;
  unavailable?: { reason: AuthUnavailableReason; details: string[] };
  children: ReactNode;
}

/**
 * Owns the authentication state machine:
 *   initializing → signed-out ⇄ signing-in → signed-in → signing-out → signed-out
 * Personal-data consumers act only on `signed-in`. During `initializing` nothing personal is
 * shown, so cached progress of a previous user can never flash on screen.
 */
export function AuthProvider({ service, unavailable, children }: Props) {
  const [state, setState] = useState<AuthState>(() =>
    service
      ? { status: 'initializing' }
      : { status: 'unavailable', reason: unavailable?.reason ?? 'not-configured', details: unavailable?.details ?? [] });
  const [error, setError] = useState<AuthError | null>(null);
  const busy = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!service) return;
    return service.onAuthStateChanged((user) => {
      // A changed uid (e.g. switched in another tab) simply replaces the user; consumers key
      // all personal state by uid.
      setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
    });
  }, [service]);

  const signIn = useCallback(async () => {
    if (!service || busy.current) return;
    if (stateRef.current.status !== 'signed-out') return;
    busy.current = true;
    setError(null);
    setState({ status: 'signing-in' });
    try {
      await service.signInWithGoogle();
      // Success is reported through onAuthStateChanged.
    } catch (e) {
      setError(toAuthError(e));
      setState((prev) => (prev.status === 'signing-in' ? { status: 'signed-out' } : prev));
    } finally {
      busy.current = false;
    }
  }, [service]);

  const signOut = useCallback(async () => {
    const current = stateRef.current;
    if (!service || busy.current || current.status !== 'signed-in') return;
    busy.current = true;
    setError(null);
    setState({ status: 'signing-out', user: current.user });
    try {
      await service.signOut();
      setState({ status: 'signed-out' });
    } catch {
      setError(SIGN_OUT_FAILED);
      setState({ status: 'signed-in', user: current.user });
    } finally {
      busy.current = false;
    }
  }, [service]);

  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo(() => ({ state, error, signIn, signOut, dismissError }), [state, error, signIn, signOut, dismissError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user, or null in every other state (including initializing and signing-out). */
export function useSignedInUser() {
  const { state } = useAuth();
  return state.status === 'signed-in' ? state.user : null;
}
