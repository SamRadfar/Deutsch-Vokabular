// Browser side of the AI worker. Sends the Firebase ID token (never an API key), validates the
// answer again, and turns every failure into a Persian message. It only fetches a suggestion —
// saving is always a separate, explicit user action.

import { validateSuggestion, type AiErrorCode, type AiFields, type AiRequest } from '../../../ai-worker/src/contract';

export type AiClientErrorCode = AiErrorCode | 'signed-out' | 'offline' | 'network' | 'timeout' | 'bad-response' | 'aborted';

export interface AiSuggestion {
  fields: AiFields;
  /** Local development provider — placeholder values, not real AI. */
  mock: boolean;
  model: string;
  remainingToday: number;
  dailyLimit: number;
}

export type AiResult = { ok: true; suggestion: AiSuggestion } | { ok: false; code: AiClientErrorCode; message: string };

export interface AiClient {
  suggest(req: AiRequest, signal?: AbortSignal): Promise<AiResult>;
}

const wait = (s: number) => (s >= 3600 ? `${Math.ceil(s / 3600)} ساعت` : s >= 120 ? `${Math.ceil(s / 60)} دقیقه` : `${s} ثانیه`);

export function aiErrorMessage(code: AiClientErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case 'signed-out':
    case 'unauthenticated': return 'ورود شما تأیید نشد؛ یک بار خارج و دوباره وارد شوید.';
    case 'offline': return 'برای پیشنهاد هوش مصنوعی به اینترنت نیاز است.';
    case 'rate-limited': return `درخواست‌ها پشت سر هم زیاد بود؛ ${wait(retryAfterSeconds ?? 60)} دیگر دوباره امتحان کنید.`;
    case 'daily-limit': return 'سهم امروز شما از پیشنهادهای هوش مصنوعی تمام شده است؛ فردا دوباره امتحان کنید.';
    case 'service-limit': return 'سقف روزانهٔ سرویس هوش مصنوعی پر شده است؛ فردا دوباره امتحان کنید.';
    case 'invalid-request': return 'این ورودی پذیرفته نشد؛ واژه یا جمله را کوتاه‌تر بنویسید.';
    case 'not-configured': return 'سرویس هوش مصنوعی هنوز راه‌اندازی نشده است.';
    case 'forbidden-origin': return 'این نسخهٔ برنامه اجازهٔ استفاده از سرویس هوش مصنوعی را ندارد.';
    case 'upstream-error': return 'سرویس هوش مصنوعی پاسخ درستی نداد؛ کمی بعد دوباره امتحان کنید.';
    case 'timeout': return 'پاسخ سرویس هوش مصنوعی بیش از حد طول کشید؛ دوباره امتحان کنید.';
    case 'bad-response': return 'پاسخ سرویس هوش مصنوعی معتبر نبود و کنار گذاشته شد.';
    case 'aborted': return 'درخواست لغو شد.';
    default: return 'اتصال به سرویس هوش مصنوعی برقرار نشد.';
  }
}

const fail = (code: AiClientErrorCode, retryAfterSeconds?: number): AiResult => ({ ok: false, code, message: aiErrorMessage(code, retryAfterSeconds) });
const KNOWN: readonly string[] = ['invalid-request', 'unauthenticated', 'forbidden-origin', 'rate-limited', 'daily-limit', 'service-limit', 'upstream-error', 'not-configured', 'not-found', 'method-not-allowed'];

export function createAiClient(opts: {
  endpoint: string;
  getIdToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  online?: () => boolean;
}): AiClient {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  return {
    async suggest(req, signal) {
      if (!online()) return fail('offline');
      let token: string | null;
      try { token = await opts.getIdToken(); } catch { return fail('signed-out'); }
      if (!token) return fail('signed-out');
      if (signal?.aborted) return fail('aborted');
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? 25_000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const res = await fetchImpl(`${opts.endpoint}/v1/suggest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        });
        let body: unknown = null;
        try { body = await res.json(); } catch { /* handled below */ }
        if (!res.ok) {
          const err = (body as { error?: { code?: unknown; retryAfterSeconds?: unknown } } | null)?.error;
          const code: AiClientErrorCode = typeof err?.code === 'string' && KNOWN.includes(err.code)
            ? (err.code as AiErrorCode)
            : res.status === 401 ? 'unauthenticated' : res.status === 429 ? 'rate-limited' : 'upstream-error';
          const retry = typeof err?.retryAfterSeconds === 'number' ? err.retryAfterSeconds : Number(res.headers.get('Retry-After')) || undefined;
          return fail(code, retry);
        }
        const b = body as { suggestion?: unknown; provider?: unknown; model?: unknown; limits?: { remainingToday?: unknown; dailyLimit?: unknown } } | null;
        const fields = validateSuggestion(b?.suggestion);
        if (!fields || (b?.provider !== 'anthropic' && b?.provider !== 'mock')) return fail('bad-response');
        return {
          ok: true,
          suggestion: {
            fields,
            mock: b.provider === 'mock',
            model: typeof b.model === 'string' ? b.model.slice(0, 60) : '',
            remainingToday: typeof b.limits?.remainingToday === 'number' ? b.limits.remainingToday : 0,
            dailyLimit: typeof b.limits?.dailyLimit === 'number' ? b.limits.dailyLimit : 0,
          },
        };
      } catch {
        if (timedOut) return fail('timeout');
        if (controller.signal.aborted) return fail('aborted');
        return fail(online() ? 'network' : 'offline');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
