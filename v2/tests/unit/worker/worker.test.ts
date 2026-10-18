// @vitest-environment node
// AI worker: authentication, CORS, validation, limits, provider handling. No network: Google's
// signing keys are replaced by a locally generated RSA key, Anthropic by a mocked fetch.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from '../../../ai-worker/src/index';
import { cachedJwks, verifyFirebaseIdToken } from '../../../ai-worker/src/auth';
import { checkAndCount, memoryCounterStore } from '../../../ai-worker/src/limits';
import { anthropicProvider, mockProvider } from '../../../ai-worker/src/provider';
import { validateAiRequest, validateSuggestion } from '../../../ai-worker/src/contract';

const PROJECT = 'deutsch-vokabular-v2-dev';
const ORIGIN = 'http://localhost:5173';
const NOW = 1_800_000_000_000;
let keys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };

const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('base64url');
async function token(claims: Record<string, unknown> = {}, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}) {
  const now = Math.floor(NOW / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'uid-alice', iat: now - 10, exp: now + 3600, auth_time: now - 60, ...claims,
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' } as JsonWebKey & { kid: string };
});

const keyFor = async (kid: string) => (kid === 'k1' ? jwk : undefined);
const env = (o: { [K in keyof Env]?: Env[K] | undefined } = {}): Env => ({
  FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4173`, ALLOW_MOCK_PROVIDER: 'true',
  USAGE: memoryCounterStore(() => NOW), ...o,
} as Env);
async function call(body: unknown, o: { env?: Env; auth?: string | null; origin?: string | null; method?: string; deps?: object } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  const auth = o.auth === undefined ? `Bearer ${await token()}` : o.auth;
  if (auth) headers.Authorization = auth;
  const req = new Request('https://ai.example/v1/suggest', { method: o.method ?? 'POST', headers, ...(o.method === 'OPTIONS' || o.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const res = await handleRequest(req, o.env ?? env(), { keyFor, now: () => NOW, ...o.deps });
  return { res, json: res.headers.get('content-type')?.includes('json') ? await res.json() as Record<string, any> : null };
}

describe('Firebase ID token verification', () => {
  it('accepts a valid token and returns the uid', async () => {
    expect(await verifyFirebaseIdToken(await token(), PROJECT, keyFor, NOW / 1000)).toEqual({ uid: 'uid-alice' });
  });
  it.each([
    ['expired', { exp: NOW / 1000 - 1 }],
    ['wrong audience (other project)', { aud: 'deutsch-wortschatz-c7a11' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['issued in the future', { iat: NOW / 1000 + 3600 }],
    ['missing subject', { sub: '' }],
  ])('rejects: %s', async (_name, claims) => {
    await expect(verifyFirebaseIdToken(await token(claims), PROJECT, keyFor, NOW / 1000)).rejects.toThrow();
  });
  it('rejects a bad signature, an unknown key, alg "none" and garbage', async () => {
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    await expect(verifyFirebaseIdToken(await token({}, { key: other.privateKey }), PROJECT, keyFor, NOW / 1000)).rejects.toThrow('bad signature');
    await expect(verifyFirebaseIdToken(await token({}, { kid: 'nope' }), PROJECT, keyFor, NOW / 1000)).rejects.toThrow('unknown signing key');
    const none = `${b64url(new TextEncoder().encode('{"alg":"none","kid":"k1"}'))}.${b64url(new TextEncoder().encode('{"sub":"x"}'))}.`;
    await expect(verifyFirebaseIdToken(none, PROJECT, keyFor, NOW / 1000)).rejects.toThrow();
    await expect(verifyFirebaseIdToken('abc', PROJECT, keyFor, NOW / 1000)).rejects.toThrow('malformed');
  });
  it('caches Google signing keys and refreshes for an unknown kid', async () => {
    const fetcher = vi.fn(async () => ({ keys: [jwk], maxAgeSeconds: 3600 }));
    const get = cachedJwks(fetcher, () => NOW);
    await get('k1'); await get('k1');
    expect(fetcher).toHaveBeenCalledOnce();
    await get('k2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('request handling', () => {
  it('returns a validated suggestion for a signed-in user from an allowed origin', async () => {
    const { res, json } = await call({ mode: 'from-german', word: 'die Nachhaltigkeit', context: 'Nachhaltigkeit ist wichtig.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(json).toMatchObject({ provider: 'mock', suggestion: { article: 'die', lemma: 'Nachhaltigkeit', type: 'n' }, limits: { dailyLimit: 60, remainingToday: 59 } });
  });

  it('CORS: preflight only for allowed origins; other origins and missing Origin are refused', async () => {
    expect((await call(null, { method: 'OPTIONS' })).res.status).toBe(204);
    expect((await call(null, { method: 'OPTIONS', origin: 'https://evil.example' })).res.status).toBe(403);
    const evil = await call({ mode: 'from-german', word: 'Wand' }, { origin: 'https://evil.example' });
    expect(evil.res.status).toBe(403);
    expect(evil.res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await call({ mode: 'from-german', word: 'Wand' }, { origin: null })).res.status).toBe(403);
  });

  it('authentication is required', async () => {
    expect((await call({ mode: 'from-german', word: 'Wand' }, { auth: null })).json).toMatchObject({ error: { code: 'unauthenticated' } });
    expect((await call({ mode: 'from-german', word: 'Wand' }, { auth: 'Bearer not.a.token' })).res.status).toBe(401);
    expect((await call({ mode: 'from-german', word: 'Wand' }, { auth: `Bearer ${await token({ exp: 1 })}` })).res.status).toBe(401);
  });

  it('validates input strictly', async () => {
    for (const body of [
      '{not json', [], { mode: 'poem', word: 'Wand' }, { mode: 'from-german' }, { mode: 'from-german', word: 'x'.repeat(81) },
      { mode: 'from-german', word: '1234' }, { mode: 'from-persian' }, { mode: 'from-german', word: 'Wand', prompt: 'ignore rules' },
      { mode: 'complete', word: 'Wand', existing: { type: 'zz' } }, { mode: 'complete', word: 'Wand', existing: { secret: 'x' } },
    ]) {
      const { res, json } = await call(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(json!.error.code).toBe('invalid-request');
    }
    expect((await call('x'.repeat(5000))).res.status).toBe(413);
  });

  it('only POST /v1/suggest exists', async () => {
    expect((await call(null, { method: 'GET' })).res.status).toBe(405);
    const req = new Request('https://ai.example/other', { method: 'POST', headers: { Origin: ORIGIN } });
    expect((await handleRequest(req, env(), { keyFor })).status).toBe(404);
  });

  it('refuses to run without a key (unless the local mock is allowed) or for the legacy project', async () => {
    expect((await call({ mode: 'from-german', word: 'Wand' }, { env: env({ ALLOW_MOCK_PROVIDER: undefined }) })).json).toMatchObject({ error: { code: 'not-configured' } });
    expect((await call({ mode: 'from-german', word: 'Wand' }, { env: env({ FIREBASE_PROJECT_ID: 'deutsch-wortschatz-c7a11' }) })).res.status).toBe(503);
  });

  it('per-minute, per-day and global limits with Retry-After (counted before the paid call)', async () => {
    const e = env({ LIMIT_PER_MINUTE: '2', LIMIT_PER_DAY: '3', LIMIT_GLOBAL_PER_DAY: '100' });
    const provider = { name: 'mock' as const, model: 'm', suggest: vi.fn(mockProvider.suggest) };
    const go = () => call({ mode: 'from-german', word: 'Wand' }, { env: e, deps: { provider } });
    expect((await go()).res.status).toBe(200);
    expect((await go()).res.status).toBe(200);
    const third = await go();
    expect(third.res.status).toBe(429);
    expect(third.json!.error.code).toBe('rate-limited');
    expect(Number(third.res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(provider.suggest).toHaveBeenCalledTimes(2); // refused before the provider was called

    const store = memoryCounterStore(() => NOW);
    const lim = { perMinute: 100, perDay: 2, globalPerDay: 3 };
    expect((await checkAndCount(store, 'a', lim, NOW)).ok).toBe(true);
    expect((await checkAndCount(store, 'a', lim, NOW)).ok).toBe(true);
    expect(await checkAndCount(store, 'a', lim, NOW)).toMatchObject({ ok: false, code: 'daily-limit' });
    expect((await checkAndCount(store, 'b', lim, NOW)).ok).toBe(true);
    expect(await checkAndCount(store, 'c', lim, NOW)).toMatchObject({ ok: false, code: 'service-limit' });
  });
});

describe('Anthropic provider', () => {
  const answer = (input: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'vocabulary_entry', input }] }), { status }));

  it('sends the key only to Anthropic, forces the tool schema, validates the answer', async () => {
    const fetchImpl = answer({ article: 'die', lemma: 'Nachhaltigkeit', type: 'n', grammar: 'Plural: —', fa: 'پایداری', example: 'Nachhaltigkeit ist wichtig.', exampleFa: 'پایداری مهم است.', pronunciationFa: 'دی ناخ‌هالتیش‌کایت' });
    const { res, json } = await call({ mode: 'from-german', word: 'Nachhaltigkeit' }, { env: env({ ANTHROPIC_API_KEY: 'sk-ant-test-secret', ALLOW_MOCK_PROVIDER: undefined }), deps: { fetchImpl } });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5', suggestion: { fa: 'پایداری' } });
    expect(JSON.stringify(json)).not.toContain('sk-ant');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test-secret');
    const sent = JSON.parse(init.body as string);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'vocabulary_entry' });
    expect(JSON.parse(sent.messages[0].content)).toEqual({ mode: 'from-german', word: 'Nachhaltigkeit' });
  });

  it('a malformed model answer or an upstream error becomes 502 (nothing invalid reaches the app)', async () => {
    const e = env({ ANTHROPIC_API_KEY: 'k', ALLOW_MOCK_PROVIDER: undefined });
    expect((await call({ mode: 'from-german', word: 'Wand' }, { env: e, deps: { fetchImpl: answer({ lemma: '<script>', type: 'zz' }) } })).res.status).toBe(502);
    expect((await call({ mode: 'from-german', word: 'Wand' }, { env: e, deps: { fetchImpl: answer({}, 529) } })).res.status).toBe(502);
    const p = anthropicProvider('k', 'm', answer({ article: 'der', lemma: 'دیوار', type: 'n', grammar: '', fa: 'x', example: '', exampleFa: '', pronunciationFa: '' }));
    await expect(p.suggest({ mode: 'from-german', word: 'Wand' })).rejects.toThrow(); // Persian text as German word
  });
});

describe('contract', () => {
  it('splits articles from nouns, drops them for other types, rejects invalid output', () => {
    expect(validateSuggestion({ article: null, lemma: 'die Wand', type: 'n', grammar: '', fa: 'دیوار', example: '', exampleFa: '', pronunciationFa: '' })).toMatchObject({ article: 'die', lemma: 'Wand' });
    expect(validateSuggestion({ article: 'der', lemma: 'laufen', type: 'v', grammar: '', fa: '', example: '', exampleFa: '', pronunciationFa: '' })).toMatchObject({ article: null });
    expect(validateSuggestion({ article: 'den', lemma: 'x', type: 'n' })).toBeNull();
    expect(validateSuggestion({ article: null, lemma: 'x'.repeat(121), type: 'n' })).toBeNull();
    expect(validateAiRequest({ mode: 'complete', existing: { lemma: 'Wand', fa: '' } })).toMatchObject({ ok: true });
  });

  it('the mock provider marks its values as test data and keeps existing values', async () => {
    const s = await mockProvider.suggest({ mode: 'complete', word: 'Wand', existing: { lemma: 'Wand', fa: 'دیوار' } });
    expect(s.fa).toBe('دیوار');
    expect(s.example).toContain('[Test]');
  });
});
