// Contract between the app and the AI worker (shared by both; no imports, so the worker can run
// under Cloudflare Workers and Node type stripping, and the app can bundle it).
//
// The AI only ever SUGGESTS values. The app shows them for review; nothing is saved without the
// user. Both directions are validated: requests by the worker, suggestions by worker AND app.

export const AI_MODES = ['from-german', 'from-persian', 'complete'] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_ARTICLES = ['der', 'die', 'das'] as const;
export const AI_TYPES = ['n', 'v', 'a', 'au', 'x'] as const;

/** Fields of a vocabulary entry the AI can suggest (same limits as personal words / firestore.rules). */
export interface AiFields {
  article: 'der' | 'die' | 'das' | null;
  lemma: string;
  type: 'n' | 'v' | 'a' | 'au' | 'x';
  grammar: string;
  fa: string;
  example: string;
  exampleFa: string;
  pronunciationFa: string;
}

export const AI_LIMITS = {
  lemma: 120, grammar: 200, fa: 200, example: 400, exampleFa: 400, pronunciationFa: 200,
  /** Request inputs */
  word: 80, context: 300,
  /** Max request body in bytes. */
  body: 4096,
} as const;

export interface AiRequest {
  mode: AiMode;
  /** German word or phrase (from-german, complete). */
  word?: string;
  /** Persian meaning (from-persian). */
  fa?: string;
  /** Optional sentence where the learner met the word. */
  context?: string;
  /** complete: the values the user already has (only empty ones are to be filled). */
  existing?: Partial<AiFields>;
}

export interface AiResponse {
  suggestion: AiFields;
  /** `mock` = local development provider without an API key (not real AI). */
  provider: 'anthropic' | 'mock';
  model: string;
  limits: { remainingToday: number; dailyLimit: number };
}

export interface AiErrorBody {
  error: { code: AiErrorCode; message: string; retryAfterSeconds?: number };
}

export type AiErrorCode =
  | 'invalid-request' | 'unauthenticated' | 'forbidden-origin' | 'rate-limited' | 'daily-limit'
  | 'service-limit' | 'upstream-error' | 'not-configured' | 'not-found' | 'method-not-allowed';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const cleanAiText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates and normalises a request body; never trusts the client. */
export function validateAiRequest(raw: unknown): { ok: true; value: AiRequest } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'body must be a JSON object' };
  const allowed = new Set(['mode', 'word', 'fa', 'context', 'existing']);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) return { ok: false, error: `unknown field ${k}` };
  if (!(AI_MODES as readonly unknown[]).includes(raw.mode)) return { ok: false, error: 'mode must be from-german, from-persian or complete' };
  const mode = raw.mode as AiMode;
  const value: AiRequest = { mode };
  for (const [k, max] of [['word', AI_LIMITS.word], ['fa', AI_LIMITS.fa], ['context', AI_LIMITS.context]] as const) {
    if (raw[k] === undefined) continue;
    const v = cleanAiText(raw[k], max);
    if (v === null) return { ok: false, error: `${k} must be text of at most ${max} characters` };
    if (v) value[k] = v;
  }
  if (raw.existing !== undefined) {
    if (!isObj(raw.existing)) return { ok: false, error: 'existing must be an object' };
    const existing: Partial<AiFields> = {};
    for (const [k, v] of Object.entries(raw.existing)) {
      if (k === 'article') {
        if (v !== null && !(AI_ARTICLES as readonly unknown[]).includes(v)) return { ok: false, error: 'existing.article invalid' };
        existing.article = v as AiFields['article'];
      } else if (k === 'type') {
        if (!(AI_TYPES as readonly unknown[]).includes(v)) return { ok: false, error: 'existing.type invalid' };
        existing.type = v as AiFields['type'];
      } else if (k in FIELD_LIMITS) {
        const t = cleanAiText(v, FIELD_LIMITS[k as keyof typeof FIELD_LIMITS]);
        if (t === null) return { ok: false, error: `existing.${k} invalid` };
        (existing as Record<string, string>)[k] = t;
      } else {
        return { ok: false, error: `unknown existing field ${k}` };
      }
    }
    value.existing = existing;
  }
  if ((mode === 'from-german' || mode === 'complete') && !value.word && !value.existing?.lemma) return { ok: false, error: 'word is required' };
  if (mode === 'from-persian' && !value.fa) return { ok: false, error: 'fa is required' };
  if (value.word && !/\p{L}/u.test(value.word)) return { ok: false, error: 'word must contain letters' };
  return { ok: true, value };
}

const FIELD_LIMITS = {
  lemma: AI_LIMITS.lemma, grammar: AI_LIMITS.grammar, fa: AI_LIMITS.fa, example: AI_LIMITS.example,
  exampleFa: AI_LIMITS.exampleFa, pronunciationFa: AI_LIMITS.pronunciationFa,
} as const;

/** Validates an AI suggestion (model output is untrusted too). Returns null if unusable. */
export function validateSuggestion(raw: unknown): AiFields | null {
  if (!isObj(raw)) return null;
  const article = raw.article === null || raw.article === undefined || raw.article === '' ? null : raw.article;
  if (article !== null && !(AI_ARTICLES as readonly unknown[]).includes(article)) return null;
  if (!(AI_TYPES as readonly unknown[]).includes(raw.type)) return null;
  const out: Partial<AiFields> = { article: article as AiFields['article'], type: raw.type as AiFields['type'] };
  for (const [k, max] of Object.entries(FIELD_LIMITS)) {
    const v = cleanAiText(raw[k] ?? '', max);
    if (v === null) return null;
    (out as Record<string, string>)[k] = v;
  }
  // "die Wand" in lemma: split the article off (nouns only).
  const m = /^(der|die|das)\s+(.+)$/i.exec(out.lemma!);
  if (m && out.type === 'n') { out.article = out.article ?? (m[1]!.toLowerCase() as AiFields['article']); out.lemma = m[2]!; }
  if (out.type !== 'n') out.article = null;
  if (!out.lemma || !/\p{L}/u.test(out.lemma) || /[؀-ۿ]/.test(out.lemma)) return null;
  return out as AiFields;
}
