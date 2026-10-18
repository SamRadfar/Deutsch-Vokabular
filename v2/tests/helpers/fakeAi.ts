import type { AiFields, AiRequest } from '../../ai-worker/src/contract';
import { aiErrorMessage, type AiClient, type AiClientErrorCode, type AiResult } from '../../src/features/ai/aiClient';

export const NACHHALTIGKEIT: AiFields = {
  article: 'die', lemma: 'Nachhaltigkeit', type: 'n', grammar: 'Plural: —', fa: 'پایداری',
  example: 'Nachhaltigkeit spielt beim Bauen eine große Rolle.', exampleFa: 'پایداری در ساخت‌وساز نقش بزرگی دارد.',
  pronunciationFa: 'دی ناخ‌هالتیش‌کایت',
};

/** Scriptable AI client for component tests (stands in for the worker; no network). */
export function createFakeAi() {
  const calls: AiRequest[] = [];
  let plan: Array<(req: AiRequest) => AiResult> = [];
  let hold: { release(): void } | null = null;
  const ai: AiClient & {
    calls: AiRequest[];
    willSuggest(fields: AiFields, opts?: { mock?: boolean }): void;
    willFail(code: AiClientErrorCode, retryAfterSeconds?: number): void;
    holdNext(): () => void;
  } = {
    calls,
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
