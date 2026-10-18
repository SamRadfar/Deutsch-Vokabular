import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_PROJECTS, interpretDatabaseProbe, validateDeployArgs } from '../../../scripts/lib/deploy-guard.mjs';

const DEV = 'deutsch-vokabular-v2-dev';

describe('rules deployment guard', () => {
  it('allows exactly one target project', () => {
    expect(ALLOWED_PROJECTS).toEqual([DEV]);
  });

  it('dry run for the dev project (no --confirm)', () => {
    expect(validateDeployArgs(['--project', DEV], DEV)).toEqual({ ok: true, project: DEV, confirmed: false });
    expect(validateDeployArgs(['--project', DEV], null)).toEqual({ ok: true, project: DEV, confirmed: false });
  });

  it('deploy requires the project id repeated after --confirm', () => {
    expect(validateDeployArgs(['--project', DEV, '--confirm', DEV], DEV)).toEqual({ ok: true, project: DEV, confirmed: true });
    expect(validateDeployArgs(['--project', DEV, '--confirm'], DEV)).toMatchObject({ ok: false });
    expect(validateDeployArgs(['--project', DEV, '--confirm', 'yes'], DEV)).toMatchObject({ ok: false });
  });

  it('refuses the legacy project, other projects, demo ids and missing targets', () => {
    expect(validateDeployArgs(['--project', 'deutsch-wortschatz-c7a11', '--confirm', 'deutsch-wortschatz-c7a11'], null))
      .toMatchObject({ ok: false, reason: expect.stringContaining('legacy') });
    expect(validateDeployArgs(['--project', 'some-other-dev'], null)).toMatchObject({ ok: false, reason: expect.stringContaining('not an allowed target') });
    expect(validateDeployArgs(['--project', 'demo-deutsch-vokabular'], null)).toMatchObject({ ok: false });
    expect(validateDeployArgs([], null)).toMatchObject({ ok: false, reason: expect.stringContaining('missing') });
    expect(validateDeployArgs(['--project', '--confirm'], null)).toMatchObject({ ok: false });
  });

  it('refuses when --project and v2/.env.local disagree', () => {
    expect(validateDeployArgs(['--project', DEV], 'deutsch-wortschatz-c7a11')).toMatchObject({ ok: false, reason: expect.stringContaining('.env.local') });
    expect(validateDeployArgs(['--project', DEV], '')).toMatchObject({ ok: false });
  });

  it('only deploys when the (default) database already exists', () => {
    expect(interpretDatabaseProbe(403, 'PERMISSION_DENIED')).toEqual({ exists: true });
    expect(interpretDatabaseProbe(404, 'NOT_FOUND')).toMatchObject({ exists: false, reason: expect.stringContaining('nam5') });
    expect(interpretDatabaseProbe(400, 'INVALID_ARGUMENT')).toMatchObject({ exists: false });
    expect(interpretDatabaseProbe(500, undefined)).toMatchObject({ exists: false });
  });

  it('one rules file only: firebase.json, the deploy script and the tests all use firestore.rules', () => {
    const root = resolve(__dirname, '../../..');
    const firebaseJson = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8')) as { firestore: { rules: string } };
    expect(firebaseJson.firestore.rules).toBe('firestore.rules');
    const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
    expect(rules).toContain('match /customWords/{wordId}');
    expect(rules).toContain('resource.data.deleted == false'); // tombstones are final
    expect(rules).toContain('awaits the');                     // deployment status is documented in the file
  });
});
