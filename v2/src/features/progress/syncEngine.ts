// Local-first progress synchronisation for ONE signed-in uid. Pure TypeScript: storage and
// network are injected (ProgressLocalStore, ProgressRemote), so all behaviour is unit-testable.
//
// Conflict model (per word, last-writer-wins by SERVER commit order):
//  - The server orders writes; its timestamp is the only clock used for ordering.
//  - A pending local change always wins over incoming snapshots until the server has
//    confirmed it — a remote update never silently overwrites an unsynced local action.
//  - Once our write is confirmed (seen in a snapshot with our opId) or acknowledged and a
//    later snapshot shows another value, the server value is adopted.
// Full rationale and limitations: docs/SYNC_DESIGN.md.

import { WORD_ID_PATTERN, type WordId } from '../../models/vocabulary';
import type { ConfirmedProgress, PendingOp, ProgressOrigin, SyncStatus, WordSyncState } from './model';
import type { ProgressLocalStore } from './localStore';
import { toRemoteError, type ProgressRemote, type RemoteError, type RemoteProgressDoc } from './remote';

export interface ProgressView {
  /** Effective learned set (pending overlay over confirmed). Includes unknown ids. */
  readonly learned: ReadonlySet<WordId>;
  stateOf(wordId: WordId): WordSyncState;
  readonly status: SyncStatus;
  /** Learned ids that are not part of the current built-in content (kept, never deleted). */
  readonly unknownLearnedIds: readonly string[];
}

export interface SyncEngineOptions {
  uid: string;
  local: ProgressLocalStore;
  remote: ProgressRemote;
  deviceId: string;
  knownIds: ReadonlySet<string>;
  online?: boolean;
  now?: () => number;
  newOpId?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Max time the UI waits for the first server snapshot before using local data. */
  firstSnapshotTimeoutMs?: number;
}

const ERROR_TEXT: Record<string, string> = {
  'permission-denied': 'دسترسی به داده‌های حساب رد شد (قوانین امنیتی Firestore).',
  unauthenticated: 'نشست ورود منقضی شده است؛ دوباره وارد شوید.',
  'invalid-argument': 'سرور دادهٔ ارسالی را نپذیرفت.',
  unavailable: 'سرور در دسترس نیست؛ دوباره تلاش می‌شود.',
  'local-write-failed': 'ذخیره روی این دستگاه ناموفق بود.',
};
export const syncErrorText = (code: string) => ERROR_TEXT[code] ?? `خطای همگام‌سازی (${code})`;

export class ProgressSyncEngine {
  private readonly confirmed = new Map<string, ConfirmedProgress>();
  private readonly pending = new Map<string, PendingOp>();
  private readonly inflight = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly retryAt = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private status: SyncStatus;
  private view: ProgressView;
  private stopped = false;
  private gotFirstSnapshot = false;
  private resubscribeAttempts = 0;

  constructor(private readonly o: SyncEngineOptions) {
    this.status = {
      phase: 'loading',
      online: o.online ?? true,
      remote: 'connecting',
      pendingCount: 0,
      failedCount: 0,
      writing: false,
      localPersistence: o.local.persistent,
      lastError: null,
    };
    this.view = this.buildView();
  }

  get uid() { return this.o.uid; }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const { confirmed, pending } = await this.o.local.load(this.o.uid);
    if (this.stopped) return;
    for (const c of confirmed) if (isValidConfirmed(c)) this.confirmed.set(c.wordId, c);
    for (const p of pending) if (isValidPending(p)) this.pending.set(p.wordId, { ...p, state: p.state === 'acked' ? 'acked' : 'queued' });
    this.subscribeRemote();
    // Local data is usable immediately when offline; otherwise wait (bounded) for the server.
    if (!this.status.online) this.status.phase = 'ready';
    else this.later(() => this.markReady(), this.o.firstSnapshotTimeoutMs ?? 5000);
    this.emit();
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.status = { ...this.status, phase: 'stopped' };
    this.emit();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getView(): ProgressView { return this.view; }

  // ── user actions ───────────────────────────────────────────────────────────

  /** Optimistic: the UI updates synchronously; persistence and upload follow. */
  setLearned(wordId: WordId, learned: boolean, origin: ProgressOrigin = 'toggle'): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!WORD_ID_PATTERN.test(wordId)) return Promise.reject(new Error(`invalid word id ${wordId}`));
    const op: PendingOp = {
      opId: this.o.newOpId?.() ?? crypto.randomUUID(),
      wordId,
      learned,
      origin,
      clientUpdatedAt: (this.o.now ?? Date.now)(),
      state: 'queued',
      attempts: 0,
      lastError: null,
    };
    this.pending.set(wordId, op);
    this.retryAt.delete(wordId);
    this.emit();
    const persisted = this.serial(async () => {
      try {
        await this.o.local.putPending(this.o.uid, op);
      } catch {
        this.status = { ...this.status, lastError: 'local-write-failed' };
      }
    });
    this.flush();
    return persisted;
  }

  /** Re-queue operations that failed permanently (e.g. after fixing rules or re-login). */
  retryFailed(): void {
    for (const p of this.pending.values()) if (p.lastError) { p.lastError = null; p.attempts = 0; this.retryAt.delete(p.wordId); }
    this.status = { ...this.status, lastError: null };
    if (this.status.remote === 'error') this.subscribeRemote();
    this.emit();
    this.flush();
  }

  setOnline(online: boolean): void {
    if (this.status.online === online) return;
    this.status = { ...this.status, online };
    if (online) this.retryAt.clear();
    else if (this.status.phase === 'loading') this.status.phase = 'ready';
    this.emit();
    if (online) this.flush();
  }

  /** Resolves true once none of `wordIds` (default: all) has a pending change, false on timeout. */
  waitForSettled(wordIds?: Iterable<string>, timeoutMs = 30_000): Promise<boolean> {
    const ids = wordIds ? new Set(wordIds) : null;
    const settled = () => (ids ? ![...ids].some((id) => this.pending.has(id)) : this.pending.size === 0);
    if (settled()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const off = this.subscribe(() => { if (settled()) { off(); clearTimeout(t); resolve(true); } });
      const t = setTimeout(() => { off(); resolve(false); }, timeoutMs);
    });
  }

  /** Server-confirmed value of a word, if any (used by the migration conflict check). */
  confirmedOf(wordId: string): ConfirmedProgress | undefined { return this.confirmed.get(wordId); }
  hasPending(wordId: string): boolean { return this.pending.has(wordId); }

  // ── network ────────────────────────────────────────────────────────────────

  flush(): void {
    if (this.stopped || !this.status.online) return;
    const now = Date.now();
    for (const op of this.pending.values()) {
      if (op.state !== 'queued' || op.lastError?.permanent || this.inflightFor(op.wordId)) continue;
      const wait = this.retryAt.get(op.wordId);
      if (wait && wait > now) continue;
      this.send(op);
    }
  }

  private inflightFor(wordId: string) {
    for (const id of this.inflight) if (id.startsWith(`${wordId}|`)) return true;
    return false;
  }

  private send(op: PendingOp): void {
    const key = `${op.wordId}|${op.opId}`;
    this.inflight.add(key);
    this.status = { ...this.status, writing: true };
    this.emit();
    this.o.remote
      .write(this.o.uid, {
        wordId: op.wordId, learned: op.learned, opId: op.opId, deviceId: this.o.deviceId,
        clientUpdatedAt: op.clientUpdatedAt, origin: op.origin,
      })
      .then(() => this.serial(() => this.onAck(op)), (e: unknown) => this.serial(() => this.onWriteError(op, toRemoteError(e))))
      .finally(() => {
        this.inflight.delete(key);
        this.status = { ...this.status, writing: this.inflight.size > 0 };
        this.emit();
        this.flush(); // a newer op for the same word may be waiting
      });
  }

  private async onAck(op: PendingOp) {
    const p = this.pending.get(op.wordId);
    if (!p || p.opId !== op.opId) return; // superseded or already confirmed by a snapshot
    p.state = 'acked';
    p.lastError = null;
    await this.persistPending(p);
    this.emit();
  }

  private async onWriteError(op: PendingOp, err: RemoteError) {
    const p = this.pending.get(op.wordId);
    if (!p || p.opId !== op.opId) return;
    p.attempts += 1;
    p.lastError = { code: err.code, permanent: err.permanent };
    this.status = { ...this.status, lastError: err.code };
    if (!err.permanent) {
      const delay = Math.min((this.o.retryBaseMs ?? 2000) * 2 ** (p.attempts - 1), this.o.retryMaxMs ?? 60_000);
      this.retryAt.set(p.wordId, Date.now() + delay);
      this.later(() => this.flush(), delay);
    }
    await this.persistPending(p);
    this.emit();
  }

  private subscribeRemote() {
    this.unsubscribe?.();
    this.status = { ...this.status, remote: 'connecting' };
    this.unsubscribe = this.o.remote.subscribe(this.o.uid, {
      onDocs: (docs) => { void this.serial(() => this.onDocs(docs)); },
      onError: (e) => { void this.serial(() => this.onRemoteError(e)); },
    });
  }

  private async onDocs(docs: RemoteProgressDoc[]) {
    if (this.stopped) return;
    const toPersist: ConfirmedProgress[] = [];
    const dropped: PendingOp[] = [];
    for (const d of docs) {
      if (!isValidRemote(d)) continue;
      const current = this.confirmed.get(d.wordId);
      const stale = !!current && (d.serverUpdatedAt < current.serverUpdatedAt
        || (d.serverUpdatedAt === current.serverUpdatedAt && d.opId === current.opId));
      if (!stale) {
        const rec: ConfirmedProgress = { wordId: d.wordId, learned: d.learned, serverUpdatedAt: d.serverUpdatedAt, opId: d.opId, origin: d.origin };
        this.confirmed.set(d.wordId, rec);
        toPersist.push(rec);
      }
      const p = this.pending.get(d.wordId);
      if (p && (d.opId === p.opId || (p.state === 'acked' && !stale))) {
        this.pending.delete(d.wordId);
        dropped.push(p);
      }
    }
    this.gotFirstSnapshot = true;
    this.resubscribeAttempts = 0;
    this.status = { ...this.status, remote: 'live', lastError: this.status.lastError === 'unavailable' ? null : this.status.lastError };
    this.markReady(false);
    try {
      await this.o.local.putConfirmed(this.o.uid, toPersist);
      for (const p of dropped) await this.o.local.deletePending(this.o.uid, p.wordId, p.opId);
    } catch {
      this.status = { ...this.status, lastError: 'local-write-failed' };
    }
    this.emit();
  }

  private async onRemoteError(e: RemoteError) {
    if (this.stopped) return;
    this.status = { ...this.status, remote: 'error', lastError: e.code };
    this.markReady(false);
    if (!e.permanent) {
      const delay = Math.min((this.o.retryBaseMs ?? 2000) * 2 ** this.resubscribeAttempts++, this.o.retryMaxMs ?? 60_000);
      this.later(() => { if (!this.stopped) this.subscribeRemote(); this.emit(); }, delay);
    }
    this.emit();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private markReady(emit = true) {
    if (this.status.phase !== 'loading') return;
    this.status = { ...this.status, phase: 'ready' };
    if (emit) this.emit();
  }

  private async persistPending(p: PendingOp) {
    try { await this.o.local.putPending(this.o.uid, p); } catch { this.status = { ...this.status, lastError: 'local-write-failed' }; }
  }

  private serial(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  private emit() {
    if (this.stopped && this.status.phase !== 'stopped') return;
    let failed = 0;
    for (const p of this.pending.values()) if (p.lastError?.permanent) failed++;
    this.status = { ...this.status, pendingCount: this.pending.size, failedCount: failed };
    this.view = this.buildView();
    for (const l of [...this.listeners]) l();
  }

  private buildView(): ProgressView {
    const learned = new Set<string>();
    for (const [id, c] of this.confirmed) if (!this.pending.has(id) && c.learned) learned.add(id);
    for (const [id, p] of this.pending) if (p.learned) learned.add(id);
    const pending = new Map(this.pending);
    return {
      learned,
      stateOf: (id) => {
        const p = pending.get(id);
        if (!p) return 'synced';
        return p.lastError?.permanent ? 'failed' : 'pending';
      },
      status: this.status,
      unknownLearnedIds: [...learned].filter((id) => !this.o.knownIds.has(id)),
    };
  }

  /** Test/diagnostic accessor. */
  get firstSnapshotReceived() { return this.gotFirstSnapshot; }
}

function isValidConfirmed(c: ConfirmedProgress) {
  return typeof c?.wordId === 'string' && typeof c.learned === 'boolean' && typeof c.serverUpdatedAt === 'number' && typeof c.opId === 'string';
}
function isValidPending(p: PendingOp) {
  return typeof p?.wordId === 'string' && typeof p.learned === 'boolean' && typeof p.opId === 'string';
}
function isValidRemote(d: RemoteProgressDoc) {
  return typeof d?.wordId === 'string' && WORD_ID_PATTERN.test(d.wordId) && typeof d.learned === 'boolean'
    && typeof d.opId === 'string' && typeof d.serverUpdatedAt === 'number' && Number.isFinite(d.serverUpdatedAt);
}
