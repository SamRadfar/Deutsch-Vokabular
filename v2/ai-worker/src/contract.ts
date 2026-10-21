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
  provider: 'workers-ai' | 'anthropic' | 'mock';
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

// ── Topic generation (POST /v1/generate) ─────────────────────────────────────────────────────
// The app asks for one BATCH (≤ GENERATE_LIMITS.batch entries) per request and builds larger lists
// (25–200) from several batches, so each request stays short, cheap and retryable.

export const AI_LEVELS = ['A1-A2', 'B1-B2', 'C1-C2', 'all'] as const;
export type AiLevel = (typeof AI_LEVELS)[number];
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export const GENERATE_LIMITS = {
  topic: 80, instructions: 300, batch: 15, subcategory: 40, subcategories: 12,
  avoid: 250, avoidItem: 60, body: 24_576,
  lemma: 60, fa: 120, example: 220, exampleFa: 260,
} as const;

export interface GenerateRequest {
  topic: string;
  level: AiLevel;
  /** Entries in this batch (1 … GENERATE_LIMITS.batch). */
  count: number;
  instructions?: string;
  /** Subcategory names already in use for this topic (keep them consistent across batches). */
  subcategories?: string[];
  /** Concentrate this batch on one subcategory (parallel batches do not overlap). */
  focus?: string;
  /** German words already generated in THIS session (never the user's saved vocabulary). */
  avoid?: string[];
}

export interface GeneratedEntry {
  article: 'der' | 'die' | 'das' | null;
  lemma: string;
  type: 'n' | 'v' | 'a' | 'au' | 'x';
  /** Optional plural / verb forms. */
  grammar: string;
  fa: string;
  example: string;
  exampleFa: string;
  subcategory: string;
  level: (typeof CEFR)[number] | null;
}

export interface GenerateResponse {
  entries: GeneratedEntry[];
  /** Model entries dropped by validation (malformed, wrong script, missing article, …). */
  rejected: number;
  provider: 'workers-ai' | 'anthropic' | 'mock';
  model: string;
  limits: { remainingToday: number; dailyLimit: number };
}

const PERSIAN = /[؀-ۿ]/;
const LATIN = /[A-Za-zÄÖÜäöüß]/;

export function validateGenerateRequest(raw: unknown): { ok: true; value: GenerateRequest } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'body must be a JSON object' };
  const allowed = new Set(['topic', 'level', 'count', 'instructions', 'subcategories', 'focus', 'avoid']);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) return { ok: false, error: `unknown field ${k}` };
  const topic = cleanAiText(raw.topic, GENERATE_LIMITS.topic);
  if (!topic || !/\p{L}/u.test(topic)) return { ok: false, error: `topic must be text of 1–${GENERATE_LIMITS.topic} characters` };
  if (!(AI_LEVELS as readonly unknown[]).includes(raw.level)) return { ok: false, error: 'level must be A1-A2, B1-B2, C1-C2 or all' };
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > GENERATE_LIMITS.batch) {
    return { ok: false, error: `count must be 1–${GENERATE_LIMITS.batch}` };
  }
  const value: GenerateRequest = { topic, level: raw.level as AiLevel, count: raw.count };
  if (raw.instructions !== undefined) {
    const v = cleanAiText(raw.instructions, GENERATE_LIMITS.instructions);
    if (v === null) return { ok: false, error: `instructions must be text of at most ${GENERATE_LIMITS.instructions} characters` };
    if (v) value.instructions = v;
  }
  if (raw.focus !== undefined) {
    const v = cleanAiText(raw.focus, GENERATE_LIMITS.subcategory);
    if (v === null) return { ok: false, error: 'focus invalid' };
    if (v) value.focus = v;
  }
  for (const [k, maxItems, maxLen] of [['subcategories', GENERATE_LIMITS.subcategories, GENERATE_LIMITS.subcategory], ['avoid', GENERATE_LIMITS.avoid, GENERATE_LIMITS.avoidItem]] as const) {
    const list = raw[k];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > maxItems) return { ok: false, error: `${k} must be a list of at most ${maxItems} items` };
    const clean: string[] = [];
    for (const item of list) {
      const v = cleanAiText(item, maxLen);
      if (v === null) return { ok: false, error: `${k} items must be text of at most ${maxLen} characters` };
      if (v) clean.push(v);
    }
    if (clean.length) value[k] = clean;
  }
  return { ok: true, value };
}

/** Validates ONE generated entry (model output is untrusted). Returns null if unusable. */
export function validateGeneratedEntry(raw: unknown): GeneratedEntry | null {
  if (!isObj(raw)) return null;
  const s = (k: string, max: number) => cleanAiText(raw[k] ?? '', max);
  let lemma = s('lemma', GENERATE_LIMITS.lemma) ?? s('word', GENERATE_LIMITS.lemma);
  const fa = s('fa', GENERATE_LIMITS.fa);
  const example = s('example', GENERATE_LIMITS.example);
  const exampleFa = s('exampleFa', GENERATE_LIMITS.exampleFa);
  const grammar = s('grammar', AI_LIMITS.grammar) ?? '';
  const sub = s('subcategory', GENERATE_LIMITS.subcategory) ?? '';
  if (!lemma || fa === null || example === null || exampleFa === null) return null;
  if (!(AI_TYPES as readonly unknown[]).includes(raw.type)) return null;
  const type = raw.type as GeneratedEntry['type'];
  let article: GeneratedEntry['article'] = raw.article === null || raw.article === undefined || raw.article === '' ? null
    : typeof raw.article === 'string' && (AI_ARTICLES as readonly string[]).includes(raw.article.toLowerCase()) ? raw.article.toLowerCase() as GeneratedEntry['article'] : null;
  const m = /^(der|die|das)\s+(.+)$/i.exec(lemma);
  if (m) { article = article ?? (m[1]!.toLowerCase() as GeneratedEntry['article']); lemma = m[2]!; }
  if (type !== 'n') article = null;
  if (type === 'n' && !article) return null; // a noun without its article is not useful for learners
  // German in German fields, Persian in Persian fields; no empty meaning or example.
  if (!/\p{L}/u.test(lemma) || PERSIAN.test(lemma) || lemma.split(' ').length > 6) return null;
  if (!fa || !PERSIAN.test(fa) || LATIN.test(fa.replace(/\([^)]*\)/g, ''))) return null;
  if (example.length < 12 || !LATIN.test(example) || PERSIAN.test(example)) return null;
  if (!exampleFa || !PERSIAN.test(exampleFa)) return null;
  if (type === 'n' && !/^\p{Lu}/u.test(lemma)) return null; // German nouns are capitalised
  const level = typeof raw.level === 'string' && (CEFR as readonly string[]).includes(raw.level.toUpperCase()) ? raw.level.toUpperCase() as GeneratedEntry['level'] : null;
  return { article, lemma, type, grammar, fa, example, exampleFa, subcategory: sub, level };
}

/** Pulls the entry list out of a model answer (object with `entries`, a bare array, or JSON text). */
export function extractGeneratedList(raw: unknown): unknown[] | null {
  let v = raw;
  if (typeof v === 'string') {
    const text = v.replace(/^```(?:json)?\s*|\s*```$/g, '');
    const start = Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0));
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (!Number.isFinite(start) || end <= start) return null;
    try { v = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
  if (Array.isArray(v)) return v;
  if (isObj(v) && Array.isArray(v.entries)) return v.entries;
  return null;
}
