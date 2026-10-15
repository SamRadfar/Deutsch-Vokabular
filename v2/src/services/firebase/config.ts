/**
 * Public Firebase client configuration, read from Vite env variables (VITE_FIREBASE_*).
 * These values identify the Firebase project; they are not secrets. Security comes from
 * Firebase Auth + Firestore Security Rules. Never put service-account keys or OAuth client
 * secrets here — see docs/FIREBASE_SETUP.md.
 */

export interface FirebaseClientOptions {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

export interface EmulatorSettings {
  host: string;
  authPort: number;
  firestorePort: number;
}

export type FirebaseConfigResult =
  | { status: 'configured'; options: FirebaseClientOptions; emulators: EmulatorSettings | null }
  | { status: 'missing'; missing: string[] }
  | { status: 'invalid'; problems: string[] };

type Env = Record<string, string | boolean | undefined>;

const REQUIRED = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_APP_ID: 'appId',
} as const;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function readFirebaseConfig(env: Env = import.meta.env as Env): FirebaseConfigResult {
  const missing = Object.keys(REQUIRED).filter((k) => !str(env[k]));
  if (missing.length) return { status: 'missing', missing };

  const options: FirebaseClientOptions = {
    apiKey: str(env.VITE_FIREBASE_API_KEY),
    authDomain: str(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: str(env.VITE_FIREBASE_PROJECT_ID),
    appId: str(env.VITE_FIREBASE_APP_ID),
  };
  const sender = str(env.VITE_FIREBASE_MESSAGING_SENDER_ID);
  const bucket = str(env.VITE_FIREBASE_STORAGE_BUCKET);
  if (sender) options.messagingSenderId = sender;
  if (bucket) options.storageBucket = bucket;

  const problems: string[] = [];
  if (!/^[a-z0-9-]{4,40}$/.test(options.projectId)) problems.push('VITE_FIREBASE_PROJECT_ID has an unexpected format');
  if (/\s|\//.test(options.authDomain)) problems.push('VITE_FIREBASE_AUTH_DOMAIN must be a bare host name (e.g. my-project.firebaseapp.com)');
  // Guard against pasting privileged material into a client variable.
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('VITE_') && typeof v === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|client_secret/i.test(v)) {
      problems.push(`${k} looks like a secret; secrets must never be used in the frontend`);
    }
  }
  if (problems.length) return { status: 'invalid', problems };

  let emulators: EmulatorSettings | null = null;
  if (str(env.VITE_FIREBASE_USE_EMULATORS) === 'true') {
    emulators = {
      host: str(env.VITE_FIREBASE_EMULATOR_HOST) || '127.0.0.1',
      authPort: Number(str(env.VITE_FIREBASE_AUTH_EMULATOR_PORT) || 9099),
      firestorePort: Number(str(env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT) || 8080),
    };
  }
  return { status: 'configured', options, emulators };
}
