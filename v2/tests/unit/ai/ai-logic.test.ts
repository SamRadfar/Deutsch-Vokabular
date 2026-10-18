import { describe, expect, it, vi } from 'vitest';
import { applySelected, existingForRequest, missingFields, reviewRows } from '../../../src/features/ai/merge';
import { createAiClient } from '../../../src/features/ai/aiClient';
import { readAiEndpoint } from '../../../src/features/ai/config';
import { readFirebaseConfig } from '../../../src/services/firebase/config';
import type { PersonalWordInput } from '../../../src/features/personal/model';
import { NACHHALTIGKEIT } from '../../helpers/fakeAi';

const EMPTY: PersonalWordInput = { article: null, lemma: '', type: 'n', grammar: '', fa: '', example: '', exampleFa: '', pronunciationFa: '', placement: null };

describe('review rows: suggestions never overwrite silently', () => {
  it('a new, empty word: every suggested field is "fill" and pre-selected', () => {
    const rows = reviewRows(EMPTY, NACHHALTIGKEIT, { typeIsDefault: true });
    expect(rows.map((r) => [r.field, r.kind, r.preselected])).toEqual([
      ['lemma', 'fill', true], ['article', 'fill', true], ['type', 'same', false], ['fa', 'fill', true],
      ['grammar', 'fill', true], ['example', 'fill', true], ['exampleFa', 'fill', true], ['pronunciationFa', 'fill', true],
    ]);
  });

  it('values the user already has are "replace" and NOT selected; equal values are "same"', () => {
    const mine = { ...EMPTY, lemma: 'Nachhaltigkeit', article: 'die' as const, fa: 'دوام', example: 'Mein eigener Satz.' };
    const rows = reviewRows(mine, NACHHALTIGKEIT, { typeIsDefault: false });
    const by = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(by.lemma).toMatchObject({ kind: 'same', preselected: false });
    expect(by.article).toMatchObject({ kind: 'same' });
    expect(by.fa).toMatchObject({ kind: 'replace', preselected: false, current: 'دوام', suggested: 'پایداری' });
    expect(by.example).toMatchObject({ kind: 'replace', preselected: false });
    expect(by.grammar).toMatchObject({ kind: 'fill', preselected: true });
    // Applying the pre-selection keeps the user's values.
    const applied = applySelected(mine, NACHHALTIGKEIT, new Set(rows.filter((r) => r.preselected).map((r) => r.field)));
    expect(applied).toMatchObject({ fa: 'دوام', example: 'Mein eigener Satz.', grammar: 'Plural: —', pronunciationFa: 'دی ناخ‌هالتیش‌کایت' });
    // Only an explicit tick replaces.
    expect(applySelected(mine, NACHHALTIGKEIT, new Set(['fa'])).fa).toBe('پایداری');
  });

  it('a type the user chose is kept unless replaced explicitly; non-nouns drop the article', () => {
    const verb = { ...EMPTY, lemma: 'nachhalten', type: 'v' as const };
    const rows = reviewRows(verb, NACHHALTIGKEIT, { typeIsDefault: false });
    expect(rows.find((r) => r.field === 'type')).toMatchObject({ kind: 'replace', preselected: false, current: 'فعل', suggested: 'اسم' });
    const applied = applySelected(verb, NACHHALTIGKEIT, new Set(['article', 'fa']));
    expect(applied).toMatchObject({ type: 'v', article: null, fa: 'پایداری' });
    expect(reviewRows(EMPTY, { ...NACHHALTIGKEIT, type: 'v', article: null }, { typeIsDefault: true }).find((r) => r.field === 'type')).toMatchObject({ kind: 'fill', preselected: true });
  });

  it('missing fields and the "complete" request payload', () => {
    expect(missingFields({ ...EMPTY, fa: 'x' })).toEqual(['article', 'grammar', 'example', 'exampleFa', 'pronunciationFa']);
    expect(missingFields({ ...NACHHALTIGKEIT })).toEqual([]);
    expect(existingForRequest({ ...EMPTY, lemma: '  Wand ', type: 'v', article: 'die' })).toMatchObject({ lemma: 'Wand', article: null, type: 'v' });
  });
});

describe('AI client', () => {
  const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
  const client = (fetchImpl: typeof fetch, token: string | null = 'tok.en.sig', online = true) =>
    createAiClient({ endpoint: 'https://ai.example', getIdToken: async () => token, fetchImpl, online: () => online, timeoutMs: 50 });

  it('sends the Firebase ID token as Bearer (no API key) and validates the answer', async () => {
    const fetchImpl = ok({ suggestion: NACHHALTIGKEIT, provider: 'anthropic', model: 'claude-haiku-4-5', limits: { remainingToday: 5, dailyLimit: 60 } });
    const r = await client(fetchImpl).suggest({ mode: 'from-german', word: 'Nachhaltigkeit' });
    expect(r).toMatchObject({ ok: true, suggestion: { fields: { lemma: 'Nachhaltigkeit' }, mock: false, remainingToday: 5 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.example/v1/suggest');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer tok.en.sig' });
    expect(init.credentials).toBe('omit');
  });

  it('signed out / offline: no request at all', async () => {
    const fetchImpl = ok({});
    expect(await client(fetchImpl, null).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ ok: false, code: 'signed-out' });
    expect(await client(fetchImpl, 't.o.k', false).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ ok: false, code: 'offline', message: 'برای پیشنهاد هوش مصنوعی به اینترنت نیاز است.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps worker errors to Persian messages', async () => {
    expect(await client(ok({ error: { code: 'rate-limited', message: 'x', retryAfterSeconds: 30 } }, 429)).suggest({ mode: 'from-german', word: 'x' }))
      .toMatchObject({ ok: false, code: 'rate-limited', message: expect.stringContaining('30 ثانیه') });
    expect(await client(ok({ error: { code: 'daily-limit', message: 'x' } }, 429)).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'daily-limit' });
    expect(await client(ok({ error: { code: 'unauthenticated', message: 'x' } }, 401)).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'unauthenticated' });
    expect(await client(ok('garbage', 500)).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'upstream-error' });
    expect(await client(vi.fn(async () => { throw new TypeError('fetch failed'); })).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'network' });
  });

  it('rejects an invalid suggestion and times out', async () => {
    expect(await client(ok({ suggestion: { lemma: '<b>', type: 'zz' }, provider: 'anthropic' })).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'bad-response' });
    const never = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    expect(await client(never as unknown as typeof fetch).suggest({ mode: 'from-german', word: 'x' })).toMatchObject({ code: 'timeout' });
  });
});

describe('configuration', () => {
  it('endpoint must be https (http only for localhost); API keys in VITE_ variables are refused', () => {
    expect(readAiEndpoint({})).toEqual({ status: 'off' });
    expect(readAiEndpoint({ VITE_AI_ENDPOINT: 'https://ai.example.workers.dev/' })).toEqual({ status: 'configured', endpoint: 'https://ai.example.workers.dev' });
    expect(readAiEndpoint({ VITE_AI_ENDPOINT: 'http://127.0.0.1:8787' })).toMatchObject({ status: 'configured' });
    expect(readAiEndpoint({ VITE_AI_ENDPOINT: 'http://ai.example' })).toMatchObject({ status: 'invalid' });
    expect(readAiEndpoint({ VITE_AI_ENDPOINT: 'https://ai.example?key=1' })).toMatchObject({ status: 'invalid' });
    const leaked = readAiEndpoint({ VITE_AI_ENDPOINT: 'https://ai.example', VITE_ANTHROPIC_API_KEY: 'sk-ant-api03-abcdefghijklmnop' });
    expect(leaked).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(leaked)).not.toContain('abcdefgh');
  });

  it('the Firebase config also refuses an Anthropic key in any VITE_ variable', () => {
    const r = readFirebaseConfig({
      VITE_FIREBASE_ENV: 'emulator', VITE_FIREBASE_USE_EMULATORS: 'true', VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
      VITE_FIREBASE_PROJECT_ID: 'demo-deutsch-vokabular', VITE_FIREBASE_APP_ID: 'demo-app', VITE_ANTHROPIC_KEY: 'sk-ant-api03-abcdefghijklmnop',
    });
    expect(r).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(r)).not.toContain('abcdefgh');
  });
});
