// Pure checks for the production release (unit-tested in tests/unit/firebase/production.test.ts).

/** The approved production Firebase project (Firebase Hosting site: https://deutsch-vokabular.web.app). */
export const PRODUCTION_PROJECT = 'deutsch-vokabular';
/** Never used by a production build: the legacy app and the v2 development project. */
export const NON_PRODUCTION_PROJECTS = ['deutsch-wortschatz-c7a11', 'deutsch-vokabular-v2-dev'];

const REQUIRED = [
  'VITE_FIREBASE_ENV', 'VITE_FIREBASE_USE_EMULATORS', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_PERSONAL_WORDS_SYNC', 'VITE_AI_ENDPOINT',
];
const SECRET = /sk-ant-|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|client_secret|refresh_token|ya29\./i;

/** KEY=value lines; comments and blank lines ignored. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Problems of a production build configuration (empty = OK). */
export function validateProductionEnv(env) {
  const p = [];
  for (const k of REQUIRED) if (!(k in env)) p.push(`${k} is missing`);
  for (const k of Object.keys(env)) if (!k.startsWith('VITE_')) p.push(`${k}: only VITE_ variables belong in the production build configuration`);
  for (const [k, v] of Object.entries(env)) if (SECRET.test(v)) p.push(`${k} looks like a secret; secrets never go into the frontend`);
  if (env.VITE_FIREBASE_ENV !== 'production') p.push('VITE_FIREBASE_ENV must be production');
  if (env.VITE_FIREBASE_USE_EMULATORS !== 'false') p.push('VITE_FIREBASE_USE_EMULATORS must be false');
  const id = env.VITE_FIREBASE_PROJECT_ID;
  if (NON_PRODUCTION_PROJECTS.includes(id)) p.push(`${id} is not a production project`);
  if (id !== PRODUCTION_PROJECT) p.push(`VITE_FIREBASE_PROJECT_ID must be ${PRODUCTION_PROJECT}`);
  if (![`${PRODUCTION_PROJECT}.firebaseapp.com`, `${PRODUCTION_PROJECT}.web.app`].includes(env.VITE_FIREBASE_AUTH_DOMAIN)) p.push('VITE_FIREBASE_AUTH_DOMAIN must belong to the production project');
  if (env.VITE_FIREBASE_STORAGE_BUCKET && !env.VITE_FIREBASE_STORAGE_BUCKET.startsWith(`${PRODUCTION_PROJECT}.`)) p.push('VITE_FIREBASE_STORAGE_BUCKET belongs to another project');
  if (!['true', 'false'].includes(env.VITE_PERSONAL_WORDS_SYNC)) p.push('VITE_PERSONAL_WORDS_SYNC must be true or false');
  const ai = env.VITE_AI_ENDPOINT ?? '';
  if (ai) {
    let url = null;
    try { url = new URL(ai); } catch { p.push('VITE_AI_ENDPOINT is not a URL'); }
    if (url && (url.protocol !== 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))) p.push('VITE_AI_ENDPOINT must be a public https endpoint (no localhost or mock worker in production)');
  }
  return p;
}

/**
 * Things that must never appear in the deployed files. The legacy project id is allowed: it is
 * part of the app's own refusal list (FORBIDDEN_PROJECT_IDS).
 */
const BUNDLE_FORBIDDEN = [
  { name: 'Anthropic / API secret', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:/ },
  { name: 'OAuth secret or token', re: /client_secret"\s*:|refresh_token"\s*:|ya29\.[A-Za-z0-9_-]{20,}/ },
  { name: 'development project', re: /deutsch-vokabular-v2-dev/ },
  { name: 'emulator project', re: /demo-deutsch-vokabular/ },
  { name: 'local AI dev server', re: /127\.0\.0\.1:8787|localhost:8787/ },
];

/** @param {Array<{ file: string, text: string }>} files */
export function scanBundle(files) {
  const findings = [];
  for (const { file, text } of files) {
    for (const f of BUNDLE_FORBIDDEN) if (f.re.test(text)) findings.push(`${file}: ${f.name}`);
  }
  return findings;
}

/**
 * Deploy arguments: --project must be the production project and deployment needs
 * "--confirm <project-id>". Without --confirm it is a dry run.
 */
export function validateProductionDeployArgs(args) {
  const at = args.indexOf('--project');
  const project = at >= 0 ? args[at + 1] : undefined;
  if (!project || project.startsWith('--')) return { ok: false, reason: 'missing --project <project-id>' };
  if (NON_PRODUCTION_PROJECTS.includes(project)) return { ok: false, reason: `"${project}" is not the production project — refusing` };
  if (project !== PRODUCTION_PROJECT) return { ok: false, reason: `"${project}" is not the approved production project (${PRODUCTION_PROJECT})` };
  const c = args.indexOf('--confirm');
  if (c < 0) return { ok: true, project, confirmed: false };
  if (args[c + 1] !== project) return { ok: false, reason: `--confirm must be followed by the project id ("--confirm ${project}")` };
  return { ok: true, project, confirmed: true };
}

/**
 * Samples of the built-in content (from every category: words, Persian meanings, example
 * sentences) plus signatures of the id registry and legacy maps. None may appear in the public
 * bundle: the vocabulary belongs to the owner's account (Firestore library).
 */
export function contentMarkers(vocabulary) {
  const markers = ['"legacyKey"', '"legacyWord"', '"checkboxCount"', '"dataSha256"'];
  for (const c of vocabulary.categories) {
    const entries = c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries));
    for (const e of entries.filter((_, i) => i % 25 === 0)) {
      if (e.example && e.example.length > 24) markers.push(e.example);
      if (e.exampleFa && e.exampleFa.length > 24) markers.push(e.exampleFa);
    }
  }
  return markers;
}

/** @param {Array<{ file: string, text: string }>} files */
export function findContent(files, markers) {
  const hits = [];
  for (const { file, text } of files) {
    const found = markers.filter((m) => text.includes(m) || text.includes(JSON.stringify(m).slice(1, -1)));
    if (found.length) hits.push(`${file}: ${found.length} content sample(s), e.g. ${found[0].slice(0, 40)}`);
  }
  return hits;
}
