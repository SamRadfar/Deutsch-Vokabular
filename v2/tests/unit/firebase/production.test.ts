// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentMarkers, findContent, parseEnv, scanBundle, validateProductionDeployArgs, validateProductionEnv } from '../../../scripts/lib/production.mjs';

const good = {
  VITE_FIREBASE_ENV: 'production',
  VITE_FIREBASE_USE_EMULATORS: 'false',
  VITE_FIREBASE_API_KEY: 'AIzaSyD-FAKEfakeFAKEfakeFAKEfakeFAKE012',
  VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_FIREBASE_STORAGE_BUCKET: 'deutsch-vokabular.firebasestorage.app',
  VITE_PERSONAL_WORDS_SYNC: 'true',
  VITE_AI_ENDPOINT: '',
};

describe('production build configuration', () => {
  it('the committed deploy/production.env is valid and contains no secret', () => {
    const env = parseEnv(readFileSync('deploy/production.env', 'utf8'));
    expect(validateProductionEnv(env)).toEqual([]);
    expect(env.VITE_FIREBASE_PROJECT_ID).toBe('deutsch-vokabular');
    // Category sync is on only because the categories rules are deployed to this project.
    expect(env.VITE_CATEGORY_SYNC).toBe('true');
    // The owner's AI worker (Cloudflare Workers AI, free allocation) — exactly this https origin,
    // and the page CSP allows the app to reach it (and nothing else new).
    expect(env.VITE_AI_ENDPOINT).toBe('https://deutsch-vokabular-ai.sfr-arian.workers.dev');
    const csp = (JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { headers: Array<{ headers: Array<{ key: string; value: string }> }> } })
      .hosting.headers.flatMap((h) => h.headers).filter((h) => h.key === 'Content-Security-Policy').map((h) => h.value);
    expect(csp.length).toBeGreaterThan(0);
    for (const c of csp) expect(/connect-src [^;]*https:\/\/deutsch-vokabular-ai\.sfr-arian\.workers\.dev/.test(c)).toBe(true);
  });

  it('accepts only the production project, no emulators, no localhost/mock AI, no secrets', () => {
    expect(validateProductionEnv(good)).toEqual([]);
    expect(validateProductionEnv({ ...good, VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2-dev' }).join()).toContain('not a production project');
    expect(validateProductionEnv({ ...good, VITE_FIREBASE_PROJECT_ID: 'deutsch-wortschatz-c7a11' }).join()).toContain('not a production project');
    expect(validateProductionEnv({ ...good, VITE_FIREBASE_ENV: 'development' }).join()).toContain('must be production');
    expect(validateProductionEnv({ ...good, VITE_FIREBASE_USE_EMULATORS: 'true' }).join()).toContain('must be false');
    expect(validateProductionEnv({ ...good, VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2-dev.firebaseapp.com' }).join()).toContain('AUTH_DOMAIN');
    expect(validateProductionEnv({ ...good, VITE_AI_ENDPOINT: 'http://127.0.0.1:8787' }).join()).toContain('public https endpoint');
    expect(validateProductionEnv({ ...good, VITE_AI_ENDPOINT: 'https://localhost:8787' }).join()).toContain('public https endpoint');
    expect(validateProductionEnv({ ...good, VITE_AI_ENDPOINT: 'https://ai.example.workers.dev' })).toEqual([]);
    expect(validateProductionEnv({ ...good, VITE_ANTHROPIC: 'sk-ant-api03-xyz' }).join()).toContain('looks like a secret');
    expect(validateProductionEnv({ ...good, SECRET: 'x' }).join()).toContain('only VITE_ variables');
  });

  it('bundle scan finds secrets and non-production endpoints', () => {
    expect(scanBundle([{ file: 'a.js', text: 'const p="deutsch-wortschatz-c7a11";const id="deutsch-vokabular"' }])).toEqual([]);
    expect(scanBundle([
      { file: 'a.js', text: 'x="sk-ant-api03-abcdefghij"' },
      { file: 'b.js', text: 'host:"deutsch-vokabular-v2-dev"' },
      { file: 'c.js', text: 'fetch("http://127.0.0.1:8787/v1/suggest")' },
      { file: 'd.json', text: '{"private_key": "-----BEGIN PRIVATE KEY-----"}' },
    ])).toEqual(['a.js: Anthropic / API secret', 'b.js: development project', 'c.js: local AI dev server', 'd.json: private key']);
  });

  it('deploys only to the production project and only with --confirm <id>', () => {
    expect(validateProductionDeployArgs(['--project', 'deutsch-vokabular'])).toEqual({ ok: true, project: 'deutsch-vokabular', confirmed: false });
    expect(validateProductionDeployArgs(['--project', 'deutsch-vokabular', '--confirm', 'deutsch-vokabular'])).toEqual({ ok: true, project: 'deutsch-vokabular', confirmed: true });
    expect(validateProductionDeployArgs(['--project', 'deutsch-vokabular', '--confirm', 'yes'])).toMatchObject({ ok: false });
    expect(validateProductionDeployArgs(['--project', 'deutsch-wortschatz-c7a11', '--confirm', 'deutsch-wortschatz-c7a11'])).toMatchObject({ ok: false, reason: expect.stringContaining('not the production project') });
    expect(validateProductionDeployArgs(['--project', 'deutsch-vokabular-v2-dev'])).toMatchObject({ ok: false });
    expect(validateProductionDeployArgs([])).toMatchObject({ ok: false });
  });

  it('the vocabulary guard finds library content in a bundle (and nothing in app-only code)', () => {
    const vocabulary = JSON.parse(readFileSync('src/data/vocabulary/vocabulary.v1.json', 'utf8'));
    const markers = contentMarkers(vocabulary);
    expect(markers.length).toBeGreaterThan(40);
    expect(findContent([{ file: 'leak.js', text: `const v=${JSON.stringify(vocabulary)}` }], markers)).toHaveLength(1);
    expect(findContent([{ file: 'registry.js', text: JSON.stringify({ entries: [{ legacyKey: 'arch::x' }] }) }], markers)).toHaveLength(1);
    expect(findContent([{ file: 'app.js', text: readFileSync('src/app/App.tsx', 'utf8') }], markers)).toEqual([]);
  });
});
