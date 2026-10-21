// @vitest-environment node
// AI worker — topic generation (POST /v1/generate): request validation, Workers AI provider (fake
// binding, no network), output validation, word-based limits and provider selection.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from '../../../ai-worker/src/index';
import { memoryCounterStore } from '../../../ai-worker/src/limits';
import { DEFAULT_WORKERS_AI_MODEL, modelOutput, workersAiProvider, type AiBinding } from '../../../ai-worker/src/provider';
import { extractGeneratedList, validateGeneratedEntry, validateGenerateRequest } from '../../../ai-worker/src/contract';

const PROJECT = 'deutsch-vokabular';
const ORIGIN = 'https://deutsch-vokabular.web.app';
const NOW = 1_800_000_000_000;
let keys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('base64url');
async function token(sub = 'uid-alice') {
  const now = Math.floor(NOW / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub, iat: now - 10, exp: now + 3600, auth_time: now - 60 });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' } as JsonWebKey & { kid: string };
});
const keyFor = async (kid: string) => (kid === 'k1' ? jwk : undefined);

const GOOD = {
  lemma: 'Jacke', article: 'die', type: 'n', grammar: 'Plural: die Jacken', fa: 'ژاکت، کاپشن',
  example: 'Im Winter trage ich eine warme Jacke.', exampleFa: 'در زمستان یک کاپشن گرم می‌پوشم.', subcategory: 'Oberbekleidung', level: 'A2',
};
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ ...GOOD, lemma: `Jacke${i ? i : ''}`.replace(/(\d+)$/, (d) => 'x'.repeat(Number(d))) }));

function fakeAi(response: unknown | ((input: Record<string, unknown>) => unknown)) {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const ai: AiBinding = {
    run: vi.fn(async (model: string, input: Record<string, unknown>) => {
      calls.push({ model, input });
      const r = typeof response === 'function' ? (response as (i: Record<string, unknown>) => unknown)(input) : response;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  return { ai, calls };
}

const env = (o: Partial<Env> = {}): Env => ({
  FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, USAGE: memoryCounterStore(() => NOW), ...o,
} as Env);

async function gen(body: unknown, e: Env, sub = 'uid-alice') {
  const req = new Request('https://ai.example/v1/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${await token(sub)}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handleRequest(req, e, { keyFor, now: () => NOW });
  return { res, json: (await res.json()) as Record<string, any> };
}

const REQ = { topic: 'Kleidung und Mode', level: 'B1-B2', count: 3 };

describe('generation request validation', () => {
  it('accepts a topic batch and rejects everything else', () => {
    expect(validateGenerateRequest({ ...REQ, instructions: ' Alltag ', avoid: ['die Jacke'], subcategories: ['Schuhe'], focus: 'Schuhe' })).toMatchObject({ ok: true, value: { instructions: 'Alltag' } });
    expect(validateGenerateRequest({ ...REQ, count: 16 }).ok).toBe(false); // batches of ≤ 15
    expect(validateGenerateRequest({ ...REQ, level: 'B3' }).ok).toBe(false);
    expect(validateGenerateRequest({ ...REQ, topic: '' }).ok).toBe(false);
    expect(validateGenerateRequest({ ...REQ, extra: 1 }).ok).toBe(false);
    expect(validateGenerateRequest({ ...REQ, avoid: Array.from({ length: 251 }, () => 'x') }).ok).toBe(false);
    expect(validateGenerateRequest({ ...REQ, instructions: 'x'.repeat(301) }).ok).toBe(false);
  });

  it('validates every model entry: German in German fields, Persian in Persian fields, nouns with article', () => {
    expect(validateGeneratedEntry(GOOD)).toMatchObject({ lemma: 'Jacke', article: 'die', level: 'A2' });
    expect(validateGeneratedEntry({ ...GOOD, lemma: 'die Hose', article: null })).toMatchObject({ lemma: 'Hose', article: 'die' });
    expect(validateGeneratedEntry({ ...GOOD, article: null })).toBeNull(); // noun without article
    expect(validateGeneratedEntry({ ...GOOD, lemma: 'jacke' })).toBeNull(); // noun not capitalised
    expect(validateGeneratedEntry({ ...GOOD, lemma: 'ژاکت' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, fa: 'jacket' })).toBeNull();
    // Real model output seen in the live test: other scripts mixed into Persian.
    expect(validateGeneratedEntry({ ...GOOD, fa: 'دレス' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, fa: 'галستوک' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, exampleFa: 'خواهر من یک د레스 زیبا می‌پوشد.' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, fa: 'ژاکت (Jacke)' })).not.toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, example: 'Ich trage eine Курточка.' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, example: 'Jacke.' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, exampleFa: '' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, type: 'zz' })).toBeNull();
    expect(validateGeneratedEntry({ ...GOOD, type: 'v', lemma: 'anziehen', article: 'die' })).toMatchObject({ type: 'v', article: null });
  });

  it('extracts the list from object, array or (fenced) JSON text', () => {
    expect(extractGeneratedList({ entries: [GOOD] })).toHaveLength(1);
    expect(extractGeneratedList([GOOD])).toHaveLength(1);
    expect(extractGeneratedList('```json\n{"entries":[{"a":1}]}\n```')).toHaveLength(1);
    expect(extractGeneratedList('Here you go: {"entries":[]} thanks')).toEqual([]);
    expect(extractGeneratedList('no json')).toBeNull();
    expect(modelOutput({ choices: [{ message: { content: '{"entries":[]}' } }] })).toBe('{"entries":[]}');
  });
});

describe('Workers AI provider (free allocation, no API key)', () => {
  it('asks the model with JSON mode and returns only validated, de-duplicated entries', async () => {
    const { ai, calls } = fakeAi({ response: { entries: [GOOD, { ...GOOD }, { ...GOOD, lemma: 'Schal', article: 'der', fa: 'scarf' }, { ...GOOD, lemma: 'Mantel', article: 'der' }] } });
    const { res, json } = await gen(REQ, env({ AI: ai }));
    expect(res.status).toBe(200);
    expect(json.provider).toBe('workers-ai');
    expect(json.model).toBe(DEFAULT_WORKERS_AI_MODEL);
    expect(json.entries.map((e: { lemma: string }) => e.lemma)).toEqual(['Jacke', 'Mantel']);
    expect(json.rejected).toBe(2); // duplicate + Latin "fa"
    const input = calls[0]!.input as { messages: Array<{ role: string; content: string }>; reasoning_effort?: string };
    expect(calls[0]!.model).toBe(DEFAULT_WORKERS_AI_MODEL);
    expect(input.reasoning_effort).toBe('low');
    expect(JSON.parse(input.messages[1]!.content)).toEqual(REQ); // only the request — nothing else of the user
    expect(JSON.stringify(json)).not.toMatch(/api[_-]?key|secret/i);
  });

  it('uses JSON mode for models that support it (llama-3.3-70b)', async () => {
    const { ai, calls } = fakeAi({ response: { entries: [GOOD] } });
    await workersAiProvider(ai, '@cf/meta/llama-3.3-70b-instruct-fp8-fast').generate({ topic: 'Mode', level: 'all', count: 1 });
    expect((calls[0]!.input as { response_format: { type: string } }).response_format.type).toBe('json_schema');
  });

  it('accepts text answers of models without JSON mode', async () => {
    const provider = workersAiProvider(fakeAi({ response: `Sure!\n${JSON.stringify({ entries: [GOOD] })}` }).ai, '@cf/openai/gpt-oss-120b');
    expect((await provider.generate({ topic: 'Mode', level: 'all', count: 1 })).entries).toHaveLength(1);
  });

  it('unusable output and upstream failures become a retryable upstream-error (no internals leaked)', async () => {
    for (const r of [{ response: 'kaputt' }, { response: { entries: [{ ...GOOD, fa: '' }] } }, new Error('JSON Mode couldn\'t be met'), new Error('3036: account limited: daily free allocation of neurons exceeded')]) {
      const { res, json } = await gen(REQ, env({ AI: fakeAi(r).ai }));
      expect(res.status).toBe(502);
      expect(json.error.code).toBe('upstream-error');
      expect(json.error.message).not.toMatch(/neuron|3036|JSON Mode/);
    }
  });

  it('counts generated WORDS against the daily limits (keeps the service inside the free allocation)', async () => {
    const e = env({ AI: fakeAi({ response: { entries: entries(15) } }).ai, LIMIT_WORDS_PER_DAY: '20' });
    const first = await gen({ ...REQ, count: 15 }, e);
    expect(first.res.status).toBe(200);
    expect(first.json.limits).toEqual({ remainingToday: 5, dailyLimit: 20 });
    const second = await gen({ ...REQ, count: 15 }, e);
    expect(second.res.status).toBe(429);
    expect(second.json.error.code).toBe('daily-limit');
    expect((await gen({ ...REQ, count: 5 }, e)).res.status).toBe(200); // the rest of the budget still works
    // The service-wide cap holds across users.
    const shared = env({ AI: fakeAi({ response: { entries: entries(15) } }).ai, LIMIT_GLOBAL_WORDS_PER_DAY: '15' });
    expect((await gen({ ...REQ, count: 15 }, shared, 'uid-alice')).res.status).toBe(200);
    expect((await gen({ ...REQ, count: 1 }, shared, 'uid-bob')).json.error.code).toBe('service-limit');
  });

  it('needs a valid request, sign-in, and a configured provider', async () => {
    const e = env({ AI: fakeAi({ response: { entries: [GOOD] } }).ai });
    expect((await gen({ ...REQ, count: 99 }, e)).res.status).toBe(400);
    expect((await gen(JSON.stringify({ ...REQ, avoid: Array.from({ length: 250 }, () => 'x'.repeat(60)), instructions: 'y'.repeat(300) }) + ' '.repeat(10_000), e)).res.status).toBe(413);
    const noAuth = await handleRequest(new Request('https://ai.example/v1/generate', { method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(REQ) }), e, { keyFor, now: () => NOW });
    expect(noAuth.status).toBe(401);
    expect((await gen(REQ, env())).json.error.code).toBe('not-configured'); // no AI binding, no key, no mock
    expect((await gen(REQ, env({ ALLOW_MOCK_PROVIDER: 'true' }))).json.provider).toBe('mock');
  });
});
