import type { AiFields, AiRequest, GeneratedEntry, GenerateRequest } from '../../ai-worker/src/contract';
import { aiErrorMessage, type AiClient, type AiClientErrorCode, type AiResult, type GenerateResult } from '../../src/features/ai/aiClient';

export const NACHHALTIGKEIT: AiFields = {
  article: 'die', lemma: 'Nachhaltigkeit', type: 'n', grammar: 'Plural: —', fa: 'پایداری',
  example: 'Nachhaltigkeit spielt beim Bauen eine große Rolle.', exampleFa: 'پایداری در ساخت‌وساز نقش بزرگی دارد.',
  pronunciationFa: 'دی ناخ‌هالتیش‌کایت',
};

/** Scriptable AI client for component tests (stands in for the worker; no network). */
export function createFakeAi() {
  const calls: AiRequest[] = [];
  const generateCalls: GenerateRequest[] = [];
  let plan: Array<(req: AiRequest) => AiResult> = [];
  /** Generation: a queue of scripted answers; when empty, `generator` answers (if set). */
  let genPlan: Array<(req: GenerateRequest) => GenerateResult> = [];
  let generator: ((req: GenerateRequest) => GenerateResult) | null = null;
  let hold: { release(): void } | null = null;
  const ai: AiClient & {
    calls: AiRequest[];
    generateCalls: GenerateRequest[];
    willGenerate(entries: GeneratedEntry[] | ((req: GenerateRequest) => GenerateResult)): void;
    willFailGenerate(code: AiClientErrorCode, retryAfterSeconds?: number): void;
    useGenerator(fn: ((req: GenerateRequest) => GenerateResult) | null): void;
    willSuggest(fields: AiFields, opts?: { mock?: boolean }): void;
    willFail(code: AiClientErrorCode, retryAfterSeconds?: number): void;
    holdNext(): () => void;
  } = {
    calls,
    generateCalls,
    async generate(req, signal) {
      generateCalls.push(req);
      await Promise.resolve();
      if (signal?.aborted) return { ok: false, code: 'aborted', message: aiErrorMessage('aborted') };
      const step = genPlan.shift() ?? generator;
      if (!step) throw new Error('fake AI: no generation planned');
      return step(req);
    },
    willGenerate(entries) {
      genPlan.push(typeof entries === 'function' ? entries : () => ({ ok: true, batch: { entries, rejected: 0, mock: false, model: 'fake-model', remainingToday: 250, dailyLimit: 300 } }));
    },
    willFailGenerate(code, retryAfterSeconds) {
      genPlan.push(() => ({ ok: false, code, message: aiErrorMessage(code, retryAfterSeconds) }));
    },
    useGenerator(fn) { generator = fn; },
    async suggest(req, signal) {
      calls.push(req);
      if (hold) {
        const h = hold;
        await new Promise<void>((resolve) => { h.release = resolve; signal?.addEventListener('abort', () => resolve()); });
        hold = null;
        if (signal?.aborted) { plan.shift(); return { ok: false, code: 'aborted', message: aiErrorMessage('aborted') }; }
      }
      const step = plan.shift();
      if (!step) throw new Error('fake AI: no response planned');
      return step(req);
    },
    willSuggest(fields, opts = {}) {
      plan.push(() => ({ ok: true, suggestion: { fields, mock: !!opts.mock, model: 'fake-model', remainingToday: 59, dailyLimit: 60 } }));
    },
    willFail(code, retryAfterSeconds) {
      plan.push(() => ({ ok: false, code, message: aiErrorMessage(code, retryAfterSeconds) }));
    },
    holdNext() {
      const h = { release: () => {} };
      hold = h;
      return () => h.release();
    },
  };
  return ai;
}
