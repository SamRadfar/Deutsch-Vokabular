// Deutsch Vokabular AI worker (Cloudflare Workers). One endpoint:
//   POST /v1/suggest   Authorization: Bearer <Firebase ID token>   body: AiRequest
// Order of checks: method/path → CORS origin → body size/JSON → request validation → Firebase ID
// token → usage limits (counted before the paid call) → provider → output validation.
// Secrets: ANTHROPIC_API_KEY is a Worker secret; it is never logged or returned.

import { AuthFailure, cachedJwks, verifyFirebaseIdToken } from './auth.ts';
import { AI_LIMITS, validateAiRequest, type AiErrorBody, type AiErrorCode, type AiResponse } from './contract.ts';
import { checkAndCount, type CounterStore } from './limits.ts';
import { anthropicProvider, mockProvider, UpstreamError, type Provider } from './provider.ts';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  /** Comma-separated exact origins, e.g. "https://app.example,http://localhost:5173". */
  ALLOWED_ORIGINS: string;
  /** Worker secret. Absent → service "not-configured" unless ALLOW_MOCK_PROVIDER=true (local only). */
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  LIMIT_PER_MINUTE?: string;
  LIMIT_PER_DAY?: string;
  LIMIT_GLOBAL_PER_DAY?: string;
  /** Only for local development: use the mock provider when no key is set. */
  ALLOW_MOCK_PROVIDER?: string;
  USAGE: CounterStore;
}

export interface Deps {
  keyFor?: (kid: string) => Promise<(JsonWebKey & { kid?: string }) | undefined>;
  now?: () => number;
  provider?: Provider;
  fetchImpl?: typeof fetch;
}

const FORBIDDEN_PROJECTS = ['deutsch-wortschatz-c7a11'];
const DEFAULT_MODEL = 'claude-haiku-4-5';
const defaultKeys = cachedJwks();

const MESSAGES: Record<AiErrorCode, string> = {
  'invalid-request': 'Invalid request.',
  unauthenticated: 'Sign-in required.',
  'forbidden-origin': 'Origin not allowed.',
  'rate-limited': 'Too many requests; try again shortly.',
  'daily-limit': 'Daily limit reached.',
  'service-limit': 'Service daily limit reached.',
  'upstream-error': 'The AI service did not answer correctly.',
  'not-configured': 'The AI service is not configured.',
  'not-found': 'Not found.',
  'method-not-allowed': 'Method not allowed.',
};

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, content-type';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function error(code: AiErrorCode, status: number, headers: Record<string, string>, detail?: string, retryAfterSeconds?: number): Response {
  const body: AiErrorBody = { error: { code, message: detail ?? MESSAGES[code], ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers, ...(retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {}) },
  });
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export async function handleRequest(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);
  const url = new URL(request.url);
  const originAllowed = !!cors['Access-Control-Allow-Origin'];

  if (url.pathname !== '/v1/suggest') return error('not-found', 404, cors);
  if (request.method === 'OPTIONS') return originAllowed ? new Response(null, { status: 204, headers: cors }) : error('forbidden-origin', 403, cors);
  if (request.method !== 'POST') return error('method-not-allowed', 405, { ...cors, Allow: 'POST, OPTIONS' });
  // Browsers always send Origin on cross-origin POSTs; other clients must present an allowed one too.
  if (!originAllowed) return error('forbidden-origin', 403, cors);

  if (!env.FIREBASE_PROJECT_ID || FORBIDDEN_PROJECTS.includes(env.FIREBASE_PROJECT_ID)) return error('not-configured', 503, cors);
  const provider = deps.provider
    ?? (env.ANTHROPIC_API_KEY ? anthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || DEFAULT_MODEL, deps.fetchImpl) : env.ALLOW_MOCK_PROVIDER === 'true' ? mockProvider : null);
  if (!provider) return error('not-configured', 503, cors);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > AI_LIMITS.body) return error('invalid-request', 413, cors, 'Body too large.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return error('invalid-request', 400, cors, 'Body must be JSON.'); }
  const parsed = validateAiRequest(raw);
  if (!parsed.ok) return error('invalid-request', 400, cors, parsed.error);

  const auth = request.headers.get('Authorization') ?? '';
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(auth)?.[1];
  if (!token) return error('unauthenticated', 401, cors);
  let uid: string;
  try {
    const now = (deps.now ?? Date.now)();
    ({ uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID, deps.keyFor ?? defaultKeys, Math.floor(now / 1000)));
  } catch (e) {
    return error('unauthenticated', 401, cors, e instanceof AuthFailure ? 'Invalid or expired sign-in.' : 'Sign-in could not be verified.');
  }

  const limit = await checkAndCount(env.USAGE, uid, {
    perMinute: num(env.LIMIT_PER_MINUTE, 6), perDay: num(env.LIMIT_PER_DAY, 60), globalPerDay: num(env.LIMIT_GLOBAL_PER_DAY, 500),
  }, (deps.now ?? Date.now)());
  if (!limit.ok) return error(limit.code, 429, cors, undefined, limit.retryAfterSeconds);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const suggestion = await provider.suggest(parsed.value, controller.signal);
    const body: AiResponse = { suggestion, provider: provider.name, model: provider.model, limits: { remainingToday: limit.remainingToday, dailyLimit: num(env.LIMIT_PER_DAY, 60) } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
  } catch (e) {
    return error('upstream-error', 502, cors, e instanceof UpstreamError && e.status === 429 ? 'The AI service is busy; try again later.' : undefined);
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
