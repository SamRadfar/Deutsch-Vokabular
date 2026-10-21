// Generic local-first document synchronisation for ONE signed-in uid and ONE collection. Pure
// TypeScript: storage and network are injected, so all behaviour is unit-testable. Extracted from
// the Phase 3 progress engine (which is now a thin layer over this class), so learned progress and
// personal vocabulary share one tested algorithm.
//
// Conflict model (per document, last-writer-wins by SERVER commit order):
//  - The server orders writes; its timestamp is the only clock used for ordering.
//  - A pending local change always wins over incoming snapshots until the server has confirmed
//    it — a remote update never silently overwrites an unsynced local action.
//  - Once our write is confirmed (seen in a snapshot with our opId) or acknowledged and a later
//    snapshot shows another value, the server value is adopted.
//  - A write rejected permanently (e.g. by the security rules) stays queued as "failed" — it is
//    never dropped silently; a caller decides (retryFailed / resolve via discardPending).
// Full rationale and limitations: docs/SYNC_DESIGN.md, docs/PERSONAL_SYNC.md.

import { toRemoteError, type RemoteError } from '../progress/remote';
import type { RemoteConnection, SyncStatus, WordSyncState } from '../progress/model';

/** A document as last confirmed by the server. */
export interface SyncedRecord<V> {
  id: string;
  value: V;
  /** Server time in ms; monotonic guard against stale snapshots. */
  serverUpdatedAt: number;
  opId: string;
}

/** A local change the server has not confirmed yet. One per document (latest wins). */
export interface PendingWrite<V> {
  opId: string;
  id: string;
  value: V;
  clientUpdatedAt: number;
  state: 'queued' | 'acked';
  attempts: number;
  lastError: { code: string; permanent: boolean } | null;
}

export interface DocLocalStore<V> {
  readonly persistent: boolean;
  load(uid: string): Promise<{ confirmed: SyncedRecord<V>[]; pending: PendingWrite<V>[] }>;
  putPending(uid: string, op: PendingWrite<V>): Promise<void>;
  /** Deletes the pending write of `id` only if it still has `opId`. */
  deletePending(uid: string, id: string, opId: string): Promise<void>;
  putConfirmed(uid: string, records: SyncedRecord<V>[]): Promise<void>;
  getMeta<T>(uid: string, key: string): Promise<T | undefined>;
  setMeta(uid: string, key: string, value: unknown): Promise<void>;
}

export interface RemoteDoc<V> {
  id: string;
  value: V;
  opId: string;
  serverUpdatedAt: number;
}

export interface DocWrite<V> {
  id: string;
  value: V;
  opId: string;
  deviceId: string;
  clientUpdatedAt: number;
}

export interface DocRemote<V> {
  subscribe(uid: string, handlers: { onDocs(docs: RemoteDoc<V>[]): void; onError(e: RemoteError): void }, options?: { since?: number }): () => void;
  /** Resolves when the server accepted the write; rejects with a RemoteError. */
  write(uid: string, write: DocWrite<V>): Promise<void>;
}

export interface DocSyncSnapshot<V> {
  /** Effective values: pending overlay over confirmed. */
  readonly values: ReadonlyMap<string, V>;
  stateOf(id: string): WordSyncState;
  readonly status: SyncStatus;
}

export interface DocSyncOptions<V> {
  uid: string;
  local: DocLocalStore<V>;
  /** null = local-only mode (cloud sync disabled): changes stay queued on this device. */
  remote: DocRemote<V> | null;
  deviceId: string;
  isValidId(id: string): boolean;
  isValidValue(value: unknown): value is V;
  /** Meta key that stores the time of the last full read (one per collection). */
  fullSyncMetaKey: string;
  online?: boolean;
  now?: () => number;
  newOpId?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Max time the UI waits for the first server snapshot before using local data. */
  firstSnapshotTimeoutMs?: number;
  /** A full read happens at least this often (and whenever there is no local copy). Default 7 days. */
  fullResyncIntervalMs?: number;
}

const DEFAULT_FULL_RESYNC_MS = 7 * 24 * 60 * 60 * 1000;

export class DocSyncEngine<V> {
  private readonly confirmed = new Map<string, SyncedRecord<V>>();
  private readonly pending = new Map<string, PendingWrite<V>>();
  private readonly inflight = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly retryAt = new Map<string, number>();
  /** One timer for the earliest due retry (re-armed by flush; see armRetry). */
  private retryTimer: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private chain: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private status: SyncStatus;
  private snapshot: DocSyncSnapshot<V>;
  private stopped = false;
  private gotFirstSnapshot = false;
  private resubscribeAttempts = 0;
  /** True while the current subscription is a full read whose first snapshot is still pending. */
  private fullReadPending = false;
  private incremental = false;

  constructor(private readonly o: DocSyncOptions<V>) {
    this.status = {
      phase: 'loading',
      online: o.online ?? true,
      remote: o.remote ? 'connecting' : 'local',
      pendingCount: 0,
      failedCount: 0,
      writing: false,
      localPersistence: o.local.persistent,
      lastError: null,
    };
    this.snapshot = this.build();
  }

  get uid() { return this.o.uid; }
  /** Diagnostic accessor. */
  get firstSnapshotReceived() { return this.gotFirstSnapshot; }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const { confirmed, pending } = await this.o.local.load(this.o.uid);
    if (this.stopped) return;
    for (const c of confirmed) if (this.validConfirmed(c)) this.confirmed.set(c.id, c);
    for (const p of pending) if (this.validPending(p)) this.pending.set(p.id, { ...p, state: p.state === 'acked' ? 'acked' : 'queued' });
    const lastFull = await this.o.local.getMeta<number>(this.o.uid, this.o.fullSyncMetaKey).catch(() => undefined);
    const now = (this.o.now ?? Date.now)();
    this.incremental = this.confirmed.size > 0 && typeof lastFull === 'number'
      && now - lastFull < (this.o.fullResyncIntervalMs ?? DEFAULT_FULL_RESYNC_MS);
    if (this.stopped) return;
    if (!this.o.remote) {
      this.status.phase = 'ready'; // local-only: everything is on this device already
      this.emit();
      return;
    }
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

  getSnapshot(): DocSyncSnapshot<V> { return this.snapshot; }

  // ── changes ────────────────────────────────────────────────────────────────

  /** Optimistic: the snapshot updates synchronously; persistence and upload follow. */
  set(id: string, value: V): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.o.isValidId(id)) return Promise.reject(new Error(`invalid document id ${id}`));
    const op: PendingWrite<V> = {
      opId: this.o.newOpId?.() ?? crypto.randomUUID(),
      id,
      value,
      clientUpdatedAt: (this.o.now ?? Date.now)(),
      state: 'queued',
      attempts: 0,
      lastError: null,
    };
    this.pending.set(id, op);
    this.retryAt.delete(id);
    this.emit();
    const persisted = this.serial(async () => {
      try {
        await this.o.local.putPending(this.o.uid, op);
      } catch {
        this.status = { ...this.status, lastError: 'local-write-failed' };
        this.emit(); // the UI must learn at once that this change is not stored on the device
      }
    });
    this.flush();
    return persisted;
  }

  /**
   * Many writes at once (bulk import): one state update, one serialized local save, one flush —
   * instead of one re-render and one flush per document.
   */
  setMany(entries: ReadonlyArray<readonly [string, V]>): Promise<void> {
    if (this.stopped || !entries.length) return Promise.resolve();
    const bad = entries.find(([id]) => !this.o.isValidId(id));
    if (bad) return Promise.reject(new Error(`invalid document id ${bad[0]}`));
    const at = (this.o.now ?? Date.now)();
    const ops = entries.map(([id, value]): PendingWrite<V> => ({
      opId: this.o.newOpId?.() ?? crypto.randomUUID(), id, value, clientUpdatedAt: at, state: 'queued', attempts: 0, lastError: null,
    }));
    for (const op of ops) { this.pending.set(op.id, op); this.retryAt.delete(op.id); }
    this.emit();
    const persisted = this.serial(async () => {
      try {
        for (const op of ops) await this.o.local.putPending(this.o.uid, op);
      } catch {
        this.status = { ...this.status, lastError: 'local-write-failed' };
        this.emit();
      }
    });
    this.flush();
    return persisted;
  }

  /**
   * Removes a pending write (e.g. after the caller preserved its content elsewhere). Only the op
   * with `opId` is removed, so a newer change is never lost.
   */
  discardPending(id: string, opId: string): Promise<void> {
    const p = this.pending.get(id);
    if (!p || p.opId !== opId) return Promise.resolve();
    this.pending.delete(id);
    this.retryAt.delete(id);
    this.emit();
    return this.serial(async () => {
      try { await this.o.local.deletePending(this.o.uid, id, opId); } catch { this.status = { ...this.status, lastError: 'local-write-failed' }; }
    });
  }

  /** Re-queue writes that failed permanently (e.g. after the rules were deployed or a re-login). */
  retryFailed(): void {
    for (const p of this.pending.values()) if (p.lastError) { p.lastError = null; p.attempts = 0; this.retryAt.delete(p.id); }
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

  /** Resolves true once none of `ids` (default: all) has a pending change, false on timeout. */
  waitForSettled(ids?: Iterable<string>, timeoutMs = 30_000): Promise<boolean> {
    const set = ids ? new Set(ids) : null;
    const settled = () => (set ? ![...set].some((id) => this.pending.has(id)) : this.pending.size === 0);
    if (settled()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const off = this.subscribe(() => { if (settled()) { off(); clearTimeout(t); resolve(true); } });
      const t = setTimeout(() => { off(); resolve(false); }, timeoutMs);
    });
  }

  readMeta<T>(key: string): Promise<T | undefined> { return this.o.local.getMeta<T>(this.o.uid, key); }
  writeMeta(key: string, value: unknown): Promise<void> { return this.o.local.setMeta(this.o.uid, key, value); }

  /** Resolves when every local write queued so far is stored on the device. */
  whenStored(): Promise<void> { return this.chain; }

  confirmedOf(id: string): SyncedRecord<V> | undefined { return this.confirmed.get(id); }
  pendingOf(id: string): PendingWrite<V> | undefined { return this.pending.get(id); }
  hasPending(id: string): boolean { return this.pending.has(id); }

  // ── network ────────────────────────────────────────────────────────────────

  flush(): void {
    if (this.stopped || !this.status.online || !this.o.remote) return;
    const now = Date.now();
    for (const op of this.pending.values()) {
      if (op.state !== 'queued' || op.lastError?.permanent || this.inflightFor(op.id)) continue;
      const wait = this.retryAt.get(op.id);
      // Not due yet: make sure a timer will come back for it. A timer may fire slightly before
      // Date.now() reaches its due time (clock rounding); without re-arming, the change would
      // then wait for an unrelated event (seen on CI).
      if (wait && wait > now) { this.armRetry(wait); continue; }
      this.send(op);
    }
  }

  private inflightFor(id: string) {
    for (const key of this.inflight) if (key.startsWith(`${id}|`)) return true;
    return false;
  }

  private send(op: PendingWrite<V>): void {
    const remote = this.o.remote!;
    const key = `${op.id}|${op.opId}`;
    this.inflight.add(key);
    this.status = { ...this.status, writing: true };
    this.emit();
    remote
      .write(this.o.uid, { id: op.id, value: op.value, opId: op.opId, deviceId: this.o.deviceId, clientUpdatedAt: op.clientUpdatedAt })
      .then(() => this.serial(() => this.onAck(op)), (e: unknown) => this.serial(() => this.onWriteError(op, toRemoteError(e))))
      .finally(() => {
        this.inflight.delete(key);
        this.status = { ...this.status, writing: this.inflight.size > 0 };
        this.emit();
        this.flush(); // a newer op for the same document may be waiting
      });
  }

  private async onAck(op: PendingWrite<V>) {
    const p = this.pending.get(op.id);
    if (!p || p.opId !== op.opId) return; // superseded or already confirmed by a snapshot
    p.state = 'acked';
    p.lastError = null;
    await this.persistPending(p);
    this.emit();
  }

  private async onWriteError(op: PendingWrite<V>, err: RemoteError) {
    const p = this.pending.get(op.id);
    if (!p || p.opId !== op.opId) return;
    p.attempts += 1;
    p.lastError = { code: err.code, permanent: err.permanent };
    this.status = { ...this.status, lastError: err.code };
    if (!err.permanent) {
      const delay = Math.min((this.o.retryBaseMs ?? 2000) * 2 ** (p.attempts - 1), this.o.retryMaxMs ?? 60_000);
      this.retryAt.set(p.id, Date.now() + delay);
      this.armRetry(Date.now() + delay);
    }
    await this.persistPending(p);
    this.emit();
  }

  private newestConfirmed(): number | undefined {
    let max: number | undefined;
    for (const c of this.confirmed.values()) if (max === undefined || c.serverUpdatedAt > max) max = c.serverUpdatedAt;
    return max;
  }

  private subscribeRemote() {
    const remote = this.o.remote;
    if (!remote) return;
    this.unsubscribe?.();
    this.status = { ...this.status, remote: 'connecting' };
    const since = this.incremental ? this.newestConfirmed() : undefined;
    this.fullReadPending = since === undefined;
    this.unsubscribe = remote.subscribe(this.o.uid, {
      onDocs: (docs) => { void this.serial(() => this.onDocs(docs)); },
      onError: (e) => { void this.serial(() => this.onRemoteError(e)); },
    }, since === undefined ? {} : { since });
  }

  private async onDocs(docs: RemoteDoc<V>[]) {
    if (this.stopped) return;
    const toPersist: SyncedRecord<V>[] = [];
    const dropped: PendingWrite<V>[] = [];
    for (const d of docs) {
      if (!this.validRemote(d)) continue;
      const current = this.confirmed.get(d.id);
      const stale = !!current && (d.serverUpdatedAt < current.serverUpdatedAt
        || (d.serverUpdatedAt === current.serverUpdatedAt && d.opId === current.opId));
      if (!stale) {
        const rec: SyncedRecord<V> = { id: d.id, value: d.value, serverUpdatedAt: d.serverUpdatedAt, opId: d.opId };
        this.confirmed.set(d.id, rec);
        toPersist.push(rec);
      }
      const p = this.pending.get(d.id);
      if (p && (d.opId === p.opId || (p.state === 'acked' && !stale))) {
        this.pending.delete(d.id);
        dropped.push(p);
      }
    }
    this.gotFirstSnapshot = true;
    this.resubscribeAttempts = 0;
    if (this.fullReadPending) {
      // A complete server copy is now local: later (re)subscriptions can be incremental.
      this.fullReadPending = false;
      this.incremental = true;
      await this.o.local.setMeta(this.o.uid, this.o.fullSyncMetaKey, (this.o.now ?? Date.now)()).catch(() => {});
    }
    this.status = { ...this.status, remote: 'live', lastError: this.status.lastError === 'unavailable' ? null : this.status.lastError };
    this.markReady(false);
    try {
      await this.o.local.putConfirmed(this.o.uid, toPersist);
      for (const p of dropped) await this.o.local.deletePending(this.o.uid, p.id, p.opId);
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

  private async persistPending(p: PendingWrite<V>) {
    try { await this.o.local.putPending(this.o.uid, p); } catch { this.status = { ...this.status, lastError: 'local-write-failed' }; this.emit(); }
  }

  private serial(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }

  /** Flushes at `at` (1 ms margin for early timers); keeps a single timer for the earliest time. */
  private armRetry(at: number) {
    if (this.stopped || (this.retryTimer && this.retryTimer.at <= at)) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer.timer); this.timers.delete(this.retryTimer.timer); }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.retryTimer?.timer === timer) this.retryTimer = null;
      this.flush();
    }, Math.max(0, at - Date.now()) + 1);
    this.timers.add(timer);
    this.retryTimer = { at, timer };
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
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): DocSyncSnapshot<V> {
    const values = new Map<string, V>();
    for (const [id, c] of this.confirmed) if (!this.pending.has(id)) values.set(id, c.value);
    for (const [id, p] of this.pending) values.set(id, p.value);
    const pending = new Map(this.pending);
    return {
      values,
      stateOf: (id) => {
        const p = pending.get(id);
        if (!p) return 'synced';
        return p.lastError?.permanent ? 'failed' : 'pending';
      },
      status: this.status,
    };
  }

  private validConfirmed(c: SyncedRecord<V>) {
    return typeof c?.id === 'string' && typeof c.serverUpdatedAt === 'number' && typeof c.opId === 'string' && this.o.isValidValue(c.value);
  }

  private validPending(p: PendingWrite<V>) {
    return typeof p?.id === 'string' && typeof p.opId === 'string' && this.o.isValidValue(p.value);
  }

  private validRemote(d: RemoteDoc<V>) {
    return typeof d?.id === 'string' && this.o.isValidId(d.id) && this.o.isValidValue(d.value)
      && typeof d.opId === 'string' && typeof d.serverUpdatedAt === 'number' && Number.isFinite(d.serverUpdatedAt);
  }
}

export type { RemoteConnection };
