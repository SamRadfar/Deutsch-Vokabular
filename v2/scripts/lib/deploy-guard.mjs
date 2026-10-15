// Pure safety checks for deploying Firestore rules (unit-tested in tests/unit/firebase/deployGuard.test.ts).

/** The ONLY Firebase projects v2 rules may ever be deployed to. */
export const ALLOWED_PROJECTS = ['deutsch-vokabular-v2-dev'];
/** Never touch these (legacy app, index.html firebaseConfig). */
export const FORBIDDEN_PROJECTS = ['deutsch-wortschatz-c7a11'];

/**
 * @param {string[]} args  CLI arguments
 * @param {string | null} envLocalProjectId  VITE_FIREBASE_PROJECT_ID from v2/.env.local, if present
 * @returns {{ ok: true, project: string, confirmed: boolean } | { ok: false, reason: string }}
 */
export function validateDeployArgs(args, envLocalProjectId) {
  const at = args.indexOf('--project');
  const project = at >= 0 ? args[at + 1] : undefined;
  if (!project || project.startsWith('--')) return { ok: false, reason: 'missing --project <project-id>' };
  if (FORBIDDEN_PROJECTS.includes(project)) return { ok: false, reason: `"${project}" is the legacy production project — never deploy v2 rules there` };
  if (!ALLOWED_PROJECTS.includes(project)) return { ok: false, reason: `"${project}" is not an allowed target (allowed: ${ALLOWED_PROJECTS.join(', ')})` };
  if (envLocalProjectId !== null && envLocalProjectId !== project) {
    return { ok: false, reason: `--project does not match VITE_FIREBASE_PROJECT_ID in v2/.env.local` };
  }
  const c = args.indexOf('--confirm');
  if (c < 0) return { ok: true, project, confirmed: false };
  // Double confirmation: the project id must be repeated after --confirm.
  if (args[c + 1] !== project) return { ok: false, reason: `--confirm must be followed by the project id ("--confirm ${project}")` };
  return { ok: true, project, confirmed: true };
}

/**
 * Interpret an UNAUTHENTICATED read of a non-existent document in the target's (default) database:
 * 403 PERMISSION_DENIED → database exists (rules deny); 404 → database missing (the Firebase CLI
 * would then CREATE one, by default in nam5/US — refuse instead).
 */
export function interpretDatabaseProbe(status, errorStatus) {
  if (status === 403 && errorStatus === 'PERMISSION_DENIED') return { exists: true };
  if (status === 200) return { exists: true };
  if (status === 404) return { exists: false, reason: 'Firestore (default) database not found — refusing (the CLI would create one in nam5/US)' };
  return { exists: false, reason: `unexpected response from Firestore (HTTP ${status} ${errorStatus ?? ''})`.trim() };
}
