import { describe, expect, it } from 'vitest';

describe('test isolation', () => {
  it('unit tests never see a developer .env.local (no real Firebase project in tests)', () => {
    const env = import.meta.env as Record<string, unknown>;
    const leaked = Object.keys(env).filter((k) => k.startsWith('VITE_FIREBASE_') && !(k in process.env));
    expect(leaked).toEqual([]);
    expect(env.VITE_FIREBASE_PROJECT_ID).toBeUndefined();
  });
});
