import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from '../../../src/services/firebase/config';

// Synthetic, well-formed but fake development values (no real project).
const dev = {
  VITE_FIREBASE_ENV: 'development',
  VITE_FIREBASE_API_KEY: 'AIzaSyD-FAKEfakeFAKEfakeFAKEfakeFAKE012',
  VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2-dev.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2-dev',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:0123456789abcdef',
};
const emulator = {
  VITE_FIREBASE_ENV: 'emulator',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-deutsch-vokabular.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-deutsch-vokabular',
  VITE_FIREBASE_APP_ID: 'demo-app',
  VITE_FIREBASE_USE_EMULATORS: 'true',
};
const problems = (env: Record<string, string>) => {
  const r = readFirebaseConfig(env);
  return r.status === 'invalid' ? r.problems.join(' | ') : r.status;
};

describe('readFirebaseConfig', () => {
  it('nothing configured → browse-only, listing the missing variable names', () => {
    expect(readFirebaseConfig({})).toEqual({
      status: 'missing',
      missing: ['VITE_FIREBASE_ENV', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
    });
    expect(readFirebaseConfig({ ...dev, VITE_FIREBASE_APP_ID: '  ' })).toMatchObject({ status: 'missing', missing: ['VITE_FIREBASE_APP_ID'] });
  });

  it('accepts a consistent development configuration (no emulators)', () => {
    expect(readFirebaseConfig({ ...dev, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012', VITE_FIREBASE_STORAGE_BUCKET: 'deutsch-vokabular-v2-dev.firebasestorage.app' }))
      .toMatchObject({ status: 'configured', environment: 'development', emulators: null, options: { projectId: 'deutsch-vokabular-v2-dev' } });
  });

  it('accepts emulator mode only with a demo- project and the emulator flag', () => {
    expect(readFirebaseConfig(emulator)).toMatchObject({ status: 'configured', environment: 'emulator', emulators: { host: '127.0.0.1', authPort: 9099, firestorePort: 8080 } });
    expect(problems({ ...emulator, VITE_FIREBASE_USE_EMULATORS: 'false' })).toContain('requires VITE_FIREBASE_USE_EMULATORS=true');
    expect(problems({ ...emulator, VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2-dev', VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2-dev.firebaseapp.com' }))
      .toContain('requires a "demo-" project id');
  });

  it('never allows emulator flags or demo ids outside emulator mode', () => {
    expect(problems({ ...dev, VITE_FIREBASE_USE_EMULATORS: 'true' })).toContain('only allowed with VITE_FIREBASE_ENV=emulator');
    expect(problems({ ...dev, VITE_FIREBASE_PROJECT_ID: 'demo-x-dev', VITE_FIREBASE_AUTH_DOMAIN: 'demo-x-dev.firebaseapp.com' })).toContain('only work with the emulators');
  });

  it('refuses the legacy production project in every environment', () => {
    for (const environment of ['development', 'production', 'emulator']) {
      const msg = problems({ ...dev, VITE_FIREBASE_ENV: environment, VITE_FIREBASE_PROJECT_ID: 'deutsch-wortschatz-c7a11', VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-wortschatz-c7a11.firebaseapp.com' });
      expect(msg).toContain('legacy app\'s production project');
    }
  });

  it('development requires a -dev project; production is refused until approved', () => {
    expect(problems({ ...dev, VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2', VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2.firebaseapp.com' })).toContain('requires a development project');
    expect(problems({ ...dev, VITE_FIREBASE_ENV: 'production', VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2', VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2.firebaseapp.com' })).toContain('not approved yet');
    expect(problems({ ...dev, VITE_FIREBASE_ENV: 'staging' })).toContain('must be one of');
  });

  it('detects values mixed from two different projects', () => {
    expect(problems({ ...dev, VITE_FIREBASE_AUTH_DOMAIN: 'other-project-dev.firebaseapp.com' })).toContain('AUTH_DOMAIN belongs to a different project');
    expect(problems({ ...dev, VITE_FIREBASE_STORAGE_BUCKET: 'other.appspot.com' })).toContain('STORAGE_BUCKET belongs to a different project');
    expect(problems({ ...dev, VITE_FIREBASE_MESSAGING_SENDER_ID: '999' })).toContain('MESSAGING_SENDER_ID belongs to a different project');
    expect(problems({ ...dev, VITE_FIREBASE_API_KEY: 'not-a-key' })).toContain('does not look like a Firebase web API key');
    expect(problems({ ...dev, VITE_FIREBASE_APP_ID: 'abc' })).toContain('does not look like a Firebase web app id');
  });

  it('rejects anything that looks like a secret without echoing the value', () => {
    for (const value of ['-----BEGIN PRIVATE KEY-----abc', '{"private_key":"abc"}', 'client_secret=abc', 'refresh_token=abc']) {
      const r = readFirebaseConfig({ ...dev, VITE_FIREBASE_EXTRA: value });
      expect(r.status).toBe('invalid');
      expect(JSON.stringify(r)).not.toContain('abc');
    }
  });

  it('diagnostics never contain the configured values', () => {
    const r = readFirebaseConfig({ ...dev, VITE_FIREBASE_API_KEY: 'AIza-short', VITE_FIREBASE_AUTH_DOMAIN: 'evil.example/path' });
    expect(JSON.stringify(r)).not.toContain('AIza-short');
    expect(JSON.stringify(r)).not.toContain('evil.example');
  });
});
