// Usage limits per user and for the whole service (cost protection). Counters live in a KV-like
// store with expiry. Workers KV is eventually consistent, so the limits are soft (a burst across
// data centres can exceed them slightly); the global daily cap bounds the total cost regardless.

export interface CounterStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Limits {
  perMinute: number;
  perDay: number;
  /** All users together per day (bounds the API bill). */
  globalPerDay: number;
}

export type LimitResult =
  | { ok: true; remainingToday: number }
  | { ok: false; code: 'rate-limited' | 'daily-limit' | 'service-limit'; retryAfterSeconds: number };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const secondsToMidnightUtc = (ms: number) => Math.max(60, Math.ceil((Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate() + 1) - ms) / 1000));

/** Checks all limits and, if allowed, counts this request (before the paid call is made). */
export async function checkAndCount(store: CounterStore, uid: string, limits: Limits, nowMs: number): Promise<LimitResult> {
  const minute = Math.floor(nowMs / 60_000);
  const keys = {
    global: `global:${day(nowMs)}`,
    daily: `user:${uid}:${day(nowMs)}`,
    burst: `burst:${uid}:${minute}`,
  };
  const [g, d, b] = await Promise.all([store.get(keys.global), store.get(keys.daily), store.get(keys.burst)]);
  const global = Number(g ?? 0);
  const daily = Number(d ?? 0);
  const burst = Number(b ?? 0);
  if (global >= limits.globalPerDay) return { ok: false, code: 'service-limit', retryAfterSeconds: secondsToMidnightUtc(nowMs) };
  if (daily >= limits.perDay) return { ok: false, code: 'daily-limit', retryAfterSeconds: secondsToMidnightUtc(nowMs) };
  if (burst >= limits.perMinute) return { ok: false, code: 'rate-limited', retryAfterSeconds: 60 - Math.floor((nowMs % 60_000) / 1000) };
  await Promise.all([
    store.put(keys.global, String(global + 1), { expirationTtl: 2 * 86_400 }),
    store.put(keys.daily, String(daily + 1), { expirationTtl: 2 * 86_400 }),
    store.put(keys.burst, String(burst + 1), { expirationTtl: 120 }),
  ]);
  return { ok: true, remainingToday: limits.perDay - daily - 1 };
}

/** In-memory store (tests and the local development server). */
export function memoryCounterStore(now: () => number = Date.now): CounterStore {
  const data = new Map<string, { value: string; until: number }>();
  return {
    async get(key) {
      const e = data.get(key);
      if (!e || e.until < now()) return null;
      return e.value;
    },
    async put(key, value, options) {
      data.set(key, { value, until: now() + (options?.expirationTtl ?? 86_400) * 1000 });
    },
  };
}
