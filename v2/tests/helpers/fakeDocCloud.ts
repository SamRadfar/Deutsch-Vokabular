// In-memory stand-in for a Firestore collection used by component tests of the generic
// DocSyncEngine (personal vocabulary). Like the real rules for customWords, a tombstone
// (value.deleted === true) is final: any later write to it is rejected with permission-denied.
// Snapshots are delivered asynchronously in commit order; offline devices neither send nor receive.

import type { DocRemote, DocWrite, RemoteDoc } from '../../src/features/sync/docSyncEngine';
import type { RemoteError } from '../../src/features/progress/remote';

interface ServerDoc<V> { value: V; opId: string; serverUpdatedAt: number }
type Sub<V> = { uid: string; onDocs(d: RemoteDoc<V>[]): void; seen: Map<string, number> };

export function createFakeDocCloud<V extends { deleted: boolean }>() {
  const docs = new Map<string, Map<string, ServerDoc<V>>>();
  const subs = new Set<{ sub: Sub<V>; online: () => boolean }>();
  const writes: Array<{ uid: string; write: DocWrite<V> }> = [];
  let clock = 2_000_000;
  const col = (uid: string) => docs.get(uid) ?? docs.set(uid, new Map()).get(uid)!;

  const deliver = (s: Sub<V>, online: () => boolean) => {
    if (!online()) return;
    const changed: RemoteDoc<V>[] = [];
    for (const [id, d] of col(s.uid)) {
      if ((s.seen.get(id) ?? -1) < d.serverUpdatedAt) {
        s.seen.set(id, d.serverUpdatedAt);
        changed.push({ id, value: structuredClone(d.value), opId: d.opId, serverUpdatedAt: d.serverUpdatedAt });
      }
    }
    setTimeout(() => s.onDocs(changed), 0);
  };
  const broadcast = (uid: string) => { for (const { sub, online } of subs) if (sub.uid === uid) deliver(sub, online); };

  /** Commit as the server would, or reject like the rules (tombstones are final). */
  function commit(uid: string, w: DocWrite<V>): RemoteError | null {
    const current = col(uid).get(w.id);
    if (current?.value.deleted) return { code: 'permission-denied', permanent: true };
    col(uid).set(w.id, { value: structuredClone(w.value), opId: w.opId, serverUpdatedAt: ++clock });
    writes.push({ uid, write: w });
    broadcast(uid);
    return null;
  }

  function device() {
    let online = true;
    let failNext: { n: number; err: RemoteError } | null = null;
    const queued: Array<() => void> = [];
    const remote: DocRemote<V> & { setOnline(v: boolean): void; failNextWrites(n: number, err: RemoteError): void } = {
      subscribe(uid, handlers) {
        const sub: Sub<V> = { uid, onDocs: handlers.onDocs, seen: new Map() };
        const entry = { sub, online: () => online };
        subs.add(entry);
        deliver(sub, entry.online);
        return () => { subs.delete(entry); };
      },
      write(uid, w) {
        return new Promise<void>((resolve, reject) => {
          const run = () => {
            if (failNext && failNext.n > 0) { failNext.n--; setTimeout(() => reject(failNext!.err), 0); return; }
            const err = commit(uid, w);
            setTimeout(() => (err ? reject(err) : resolve()), 0);
          };
          if (online) run(); else queued.push(run);
        });
      },
      setOnline(v) {
        online = v;
        if (v) {
          for (const run of queued.splice(0)) run();
          for (const { sub, online: o } of subs) deliver(sub, o);
        }
      },
      failNextWrites(n, err) { failNext = { n, err }; },
    };
    return remote;
  }

  return {
    device,
    writes,
    /** A change made by another device (bypasses any local engine). */
    external(uid: string, id: string, value: V) {
      col(uid).set(id, { value: structuredClone(value), opId: `external-${clock}`, serverUpdatedAt: ++clock });
      broadcast(uid);
    },
    get(uid: string, id: string) { return col(uid).get(id)?.value; },
  };
}
