// In-memory stand-in for Firestore used by sync-engine tests. It reproduces the properties
// the engine relies on: the server assigns a strictly increasing commit time, snapshots are
// delivered asynchronously in commit order, offline devices neither send nor receive until
// reconnected (writes then flush in order), and errors can be injected per write.

import type { ProgressWrite } from '../../src/features/progress/model';
import type { ProgressRemote, RemoteError, RemoteProgressDoc, RemoteSubscriptionHandlers, SubscribeOptions } from '../../src/features/progress/remote';

interface ServerDoc extends RemoteProgressDoc { deviceId: string }

export function createFakeCloud() {
  const docs = new Map<string, Map<string, ServerDoc>>(); // uid → wordId → doc
  let clock = 1_000_000;
  const writeLog: Array<{ device: string; uid: string; write: ProgressWrite }> = [];
  /** Every document delivered to any subscriber (read-cost accounting). */
  const readLog: Array<{ device: string; uid: string; wordId: string; since: number | undefined }> = [];

  function device(name: string) {
    let online = true;
    const subs = new Set<{ uid: string; h: RemoteSubscriptionHandlers; seen: Map<string, number>; since: number | undefined }>();
    const queued: Array<() => void> = [];
    let nextError: RemoteError | null = null;
    let failNext = 0;

    const deliver = (sub: { uid: string; h: RemoteSubscriptionHandlers; seen: Map<string, number>; since: number | undefined }) => {
      if (!online) return;
      const changed: RemoteProgressDoc[] = [];
      for (const d of docs.get(sub.uid)?.values() ?? []) {
        if ((sub.seen.get(d.wordId) ?? -1) < d.serverUpdatedAt) {
          sub.seen.set(d.wordId, d.serverUpdatedAt);
          readLog.push({ device: name, uid: sub.uid, wordId: d.wordId, since: sub.since });
          changed.push({ wordId: d.wordId, learned: d.learned, opId: d.opId, origin: d.origin, serverUpdatedAt: d.serverUpdatedAt });
        }
      }
      setTimeout(() => sub.h.onDocs(changed), 0);
    };

    const remote: ProgressRemote & {
      setOnline(v: boolean): void;
      failNextWrites(n: number, err: RemoteError): void;
      /** Deliver an arbitrary (e.g. stale) document directly to subscribers. */
      inject(uid: string, doc: RemoteProgressDoc): void;
      readonly subscriptions: number;
    } = {
      subscribe(uid, h, options: SubscribeOptions = {}) {
        const sub = { uid, h, seen: new Map<string, number>(), since: options.since };
        // Incremental query: documents at or before `since` are not part of the result set.
        if (options.since !== undefined) {
          for (const d of docs.get(uid)?.values() ?? []) if (d.serverUpdatedAt <= options.since) sub.seen.set(d.wordId, d.serverUpdatedAt);
        }
        subs.add(sub);
        deliver(sub);
        return () => subs.delete(sub);
      },
      write(uid, w) {
        return new Promise<void>((resolve, reject) => {
          const commit = () => {
            if (failNext > 0 && nextError) {
              failNext--;
              setTimeout(() => reject(nextError), 0);
              return;
            }
            clock += 1;
            const userDocs = docs.get(uid) ?? new Map<string, ServerDoc>();
            docs.set(uid, userDocs);
            userDocs.set(w.wordId, { wordId: w.wordId, learned: w.learned, opId: w.opId, origin: w.origin, serverUpdatedAt: clock, deviceId: w.deviceId });
            writeLog.push({ device: name, uid, write: w });
            broadcast(uid);
            setTimeout(resolve, 0);
          };
          if (online) commit(); else queued.push(commit);
        });
      },
      setOnline(v) {
        online = v;
        if (v) {
          while (queued.length) queued.shift()!();
          for (const s of subs) deliver(s);
        }
      },
      failNextWrites(n, err) { failNext = n; nextError = err; },
      inject(uid, doc) { for (const s of subs) if (s.uid === uid) setTimeout(() => s.h.onDocs([doc]), 0); },
      get subscriptions() { return subs.size; },
    };
    devices.push({ subs, deliver });
    return remote;
  }

  const devices: Array<{ subs: Set<{ uid: string; h: RemoteSubscriptionHandlers; seen: Map<string, number> }>; deliver: (s: never) => void }> = [];
  function broadcast(uid: string) {
    for (const d of devices) for (const s of d.subs) if (s.uid === uid) d.deliver(s as never);
  }

  return {
    device,
    serverState(uid: string) {
      return new Map([...(docs.get(uid) ?? new Map<string, ServerDoc>())].map(([k, v]) => [k, v.learned]));
    },
    writeLog,
    readLog,
  };
}

/** Poll until `predicate` holds (real timers; the engine uses small retry delays in tests). */
export async function until(predicate: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
