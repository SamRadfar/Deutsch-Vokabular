/** Signed-in user as the app sees it. Identified by Firebase `uid` only — never by email. */
export interface AuthUser {
  uid: string;
  displayName: string | null;
  /** Shown in the account menu only; never stored in Firestore or used as an identifier. */
  email: string | null;
  photoURL: string | null;
}

export interface AuthError {
  code: string;
  /** Persian, user-facing. */
  message: string;
  /** 'info' for user cancellation, 'error' otherwise. */
  severity: 'info' | 'error';
}

export type AuthUnavailableReason = 'not-configured' | 'invalid-config' | 'init-failed';

export type AuthState =
  | { status: 'unavailable'; reason: AuthUnavailableReason; details: string[] }
  | { status: 'initializing' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signing-out'; user: AuthUser };

/** Boundary to the identity provider; the Firebase adapter and test fakes implement it. */
export interface AuthService {
  /** Called once with the restored session (or null), then on every change. */
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Short-lived Firebase ID token of the signed-in user (null when signed out). Only sent to our
   * own AI worker, which verifies it; never logged or stored by the app.
   */
  getIdToken(): Promise<string | null>;
  /** Redirect sign-in only: the error of a sign-in that returned to this page (null = none). */
  takeRedirectError?(): Promise<AuthServiceError | null>;
}

/** Errors thrown by an AuthService carry the provider's error code. */
export class AuthServiceError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'AuthServiceError';
  }
}
