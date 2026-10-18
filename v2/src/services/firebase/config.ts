/**
 * Public Firebase client configuration, read from Vite env variables (VITE_FIREBASE_*).
 * These values identify the Firebase project; they are not secrets. Security comes from
 * Firebase Auth + Firestore Security Rules. Never put service-account keys or OAuth client
 * secrets here — see docs/FIREBASE_SETUP.md.
 *
 * Safety rails (docs/FIREBASE_VALIDATION.md §2): every configuration declares its environment,
 * and the combination of environment, project id and emulator flag is checked so that
 *  - the legacy production project can never be used by v2,
 *  - emulator mode only ever uses "demo-" projects (which cannot reach real Google services),
 *  - development uses a project whose id marks it as development,
 *  - production is allowed only for the explicitly approved production project(s),
 *  - values copied from two different Firebase projects are detected.
 * Diagnostics name variables, never their values.
 */

import { SECRET_KEY_PATTERN } from '../../features/ai/config';

export type FirebaseEnvironment = 'emulator' | 'development' | 'production';

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
  | {
    status: 'configured'; environment: FirebaseEnvironment; options: FirebaseClientOptions; emulators: EmulatorSettings | null;
    /**
     * Cloud sync of personal vocabulary (users/{uid}/customWords). Needs the Phase 5A.1 security
     * rules on the target project: always on with the emulators (which load v2/firestore.rules),
     * otherwise only with VITE_PERSONAL_WORDS_SYNC=true after those rules were deployed.
     */
    personalWordsSync: boolean;
  }
  | { status: 'missing'; missing: string[] }
  | { status: 'invalid'; problems: string[] };

type Env = Record<string, string | boolean | undefined>;

const REQUIRED = [
  'VITE_FIREBASE_ENV',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

/** Firebase projects that v2 must never talk to (legacy app: index.html `firebaseConfig`). */
export const FORBIDDEN_PROJECT_IDS = ['deutsch-wortschatz-c7a11'] as const;

/**
 * The ONLY Firebase projects a production build may use (approved by the product owner for the
 * public release on Firebase Hosting; docs/PRODUCTION.md). Any other id is refused in production.
 */
export const PRODUCTION_PROJECT_IDS = ['deutsch-vokabular'] as const;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ENVIRONMENTS: readonly FirebaseEnvironment[] = ['emulator', 'development', 'production'];

export function readFirebaseConfig(env: Env = import.meta.env as Env): FirebaseConfigResult {
  // Nothing configured at all → browse-only mode (not an error).
  const missing = REQUIRED.filter((k) => !str(env[k]));
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
  const environment = str(env.VITE_FIREBASE_ENV) as FirebaseEnvironment;
  const useEmulators = str(env.VITE_FIREBASE_USE_EMULATORS) === 'true';
  const id = options.projectId;

  if (!ENVIRONMENTS.includes(environment)) problems.push('VITE_FIREBASE_ENV must be one of: emulator, development, production');
  const personalSyncFlag = str(env.VITE_PERSONAL_WORDS_SYNC);
  if (personalSyncFlag && personalSyncFlag !== 'true' && personalSyncFlag !== 'false') problems.push('VITE_PERSONAL_WORDS_SYNC must be true or false');
  if (!/^[a-z0-9-]{4,40}$/.test(id)) problems.push('VITE_FIREBASE_PROJECT_ID has an unexpected format');
  if ((FORBIDDEN_PROJECT_IDS as readonly string[]).includes(id)) {
    problems.push('VITE_FIREBASE_PROJECT_ID is the legacy app\'s production project; v2 must use its own project');
  }
  if (/\s|\//.test(options.authDomain)) problems.push('VITE_FIREBASE_AUTH_DOMAIN must be a bare host name (e.g. my-project.firebaseapp.com)');

  // Values copied from two different projects.
  const hosted = /^([a-z0-9-]+)\.(firebaseapp\.com|web\.app)$/.exec(options.authDomain);
  if (hosted && hosted[1] !== id) problems.push('VITE_FIREBASE_AUTH_DOMAIN belongs to a different project than VITE_FIREBASE_PROJECT_ID');
  if (bucket && !bucket.startsWith(`${id}.`)) problems.push('VITE_FIREBASE_STORAGE_BUCKET belongs to a different project than VITE_FIREBASE_PROJECT_ID');

  if (environment === 'emulator') {
    if (!useEmulators) problems.push('VITE_FIREBASE_ENV=emulator requires VITE_FIREBASE_USE_EMULATORS=true');
    if (!id.startsWith('demo-')) problems.push('emulator mode requires a "demo-" project id so that no real Firebase resource can be reached');
  } else {
    if (useEmulators) problems.push('VITE_FIREBASE_USE_EMULATORS=true is only allowed with VITE_FIREBASE_ENV=emulator');
    if (id.startsWith('demo-')) problems.push('"demo-" project ids only work with the emulators (VITE_FIREBASE_ENV=emulator)');
    if (!/^AIza[0-9A-Za-z_-]{35}$/.test(options.apiKey)) problems.push('VITE_FIREBASE_API_KEY does not look like a Firebase web API key');
    const appIdMatch = /^1:(\d+):web:[0-9a-f]+$/.exec(options.appId);
    if (!appIdMatch) problems.push('VITE_FIREBASE_APP_ID does not look like a Firebase web app id (1:<number>:web:<hex>)');
    else if (sender && sender !== appIdMatch[1]) problems.push('VITE_FIREBASE_MESSAGING_SENDER_ID belongs to a different project than VITE_FIREBASE_APP_ID');
  }
  if (environment === 'development' && !/(^|-)dev(-|$)/.test(id)) {
    problems.push('VITE_FIREBASE_ENV=development requires a development project (project id containing "-dev")');
  }
  if (environment === 'production') {
    if (!(PRODUCTION_PROJECT_IDS as readonly string[]).includes(id)) {
      problems.push(`VITE_FIREBASE_ENV=production is only allowed for the approved production project (${PRODUCTION_PROJECT_IDS.join(', ')})`);
    }
    if (/(^|-)dev(-|$)/.test(id)) problems.push('VITE_FIREBASE_ENV=production must not use a development project');
  }

  // Guard against pasting privileged material into a client variable.
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('VITE_') && typeof v === 'string' && (/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|client_secret|refresh_token/i.test(v) || SECRET_KEY_PATTERN.test(v))) {
      problems.push(`${k} looks like a secret; secrets must never be used in the frontend`);
    }
  }
  if (problems.length) return { status: 'invalid', problems };

  const emulators: EmulatorSettings | null = useEmulators
    ? {
        host: str(env.VITE_FIREBASE_EMULATOR_HOST) || '127.0.0.1',
        authPort: Number(str(env.VITE_FIREBASE_AUTH_EMULATOR_PORT) || 9099),
        firestorePort: Number(str(env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT) || 8080),
      }
    : null;
  return { status: 'configured', environment, options, emulators, personalWordsSync: environment === 'emulator' || personalSyncFlag === 'true' };
}
