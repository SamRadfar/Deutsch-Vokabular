import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from '../../../src/services/firebase/config';

const valid = {
  VITE_FIREBASE_API_KEY: 'AIza-demo-public-identifier',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-deutsch-vokabular.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-deutsch-vokabular',
  VITE_FIREBASE_APP_ID: '1:000:web:000',
};

describe('readFirebaseConfig', () => {
  it('reports every missing required variable (browse-only mode)', () => {
    expect(readFirebaseConfig({})).toEqual({
      status: 'missing',
      missing: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
    });
    expect(readFirebaseConfig({ ...valid, VITE_FIREBASE_APP_ID: '  ' })).toMatchObject({ status: 'missing', missing: ['VITE_FIREBASE_APP_ID'] });
  });

  it('accepts a complete public configuration without emulators', () => {
    expect(readFirebaseConfig(valid)).toEqual({
      status: 'configured',
      options: { apiKey: valid.VITE_FIREBASE_API_KEY, authDomain: valid.VITE_FIREBASE_AUTH_DOMAIN, projectId: valid.VITE_FIREBASE_PROJECT_ID, appId: valid.VITE_FIREBASE_APP_ID },
      emulators: null,
    });
  });

  it('enables emulators only when explicitly requested', () => {
    expect(readFirebaseConfig({ ...valid, VITE_FIREBASE_USE_EMULATORS: 'true' })).toMatchObject({
      emulators: { host: '127.0.0.1', authPort: 9099, firestorePort: 8080 },
    });
    expect(readFirebaseConfig({ ...valid, VITE_FIREBASE_USE_EMULATORS: 'false' })).toMatchObject({ emulators: null });
  });

  it('rejects malformed values and anything that looks like a secret', () => {
    expect(readFirebaseConfig({ ...valid, VITE_FIREBASE_AUTH_DOMAIN: 'https://x.firebaseapp.com/' })).toMatchObject({ status: 'invalid' });
    const secret = readFirebaseConfig({ ...valid, VITE_FIREBASE_EXTRA: '-----BEGIN PRIVATE KEY-----abc' });
    expect(secret.status).toBe('invalid');
    expect(JSON.stringify(secret)).not.toContain('abc'); // the value itself is never echoed
  });
});
