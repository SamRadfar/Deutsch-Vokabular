import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSignedInUser } from '../auth/AuthProvider';
import type { AccountRemote } from './accountRemote';
import { getDeviceId, type ProgressLocalStore } from './localStore';
import type { ProgressRemote } from './remote';
import { ProgressSyncEngine, type ProgressView } from './syncEngine';

export interface ProgressServices {
  createRemote(): ProgressRemote;
  account: AccountRemote;
  /** Called once per provider; IndexedDB with in-memory fallback. */
  createLocalStore(): Promise<ProgressLocalStore>;
}

export type ProgressContextValue =
  | { status: 'unavailable' }
  | { status: 'loading'; uid: string }
  | { status: 'ready'; uid: string; view: ProgressView; engine: ProgressSyncEngine; account: AccountRemote };

const ProgressContext = createContext<ProgressContextValue>({ status: 'unavailable' });

const noopSubscribe = () => () => {};
const nullView = () => null;

/**
 * Binds one ProgressSyncEngine to the signed-in uid. The engine is recreated on every uid
 * change and stopped on sign-out; data of the previous account is never exposed because
 * the context only reports an engine whose uid equals the current uid.
 */
export function ProgressProvider({ services, knownIds, children }: { services: ProgressServices | null; knownIds: ReadonlySet<string>; children: ReactNode }) {
  const user = useSignedInUser();
  const uid = user?.uid ?? null;
  const [store, setStore] = useState<Promise<ProgressLocalStore> | null>(null);
  const [engine, setEngine] = useState<ProgressSyncEngine | null>(null);

  useEffect(() => {
    if (services && !store) setStore(services.createLocalStore());
  }, [services, store]);

  useEffect(() => {
    setEngine(null);
    if (!uid || !services || !store) return;
    let cancelled = false;
    let created: ProgressSyncEngine | null = null;
    void (async () => {
      const local = await store;
      const deviceId = await getDeviceId(local);
      if (cancelled) return;
      created = new ProgressSyncEngine({
        uid, local, remote: services.createRemote(), deviceId, knownIds,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
      });
      setEngine(created);
      await created.start();
    })();
    return () => {
      cancelled = true;
      created?.stop();
    };
  }, [uid, services, store, knownIds]);

  useEffect(() => {
    if (!engine) return;
    const on = () => engine.setOnline(true);
    const off = () => engine.setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [engine]);

  // Minimal profile document (best effort; progress works without it).
  useEffect(() => {
    if (!user || !services) return;
    services.account.saveProfile(user.uid, { displayName: user.displayName, photoURL: user.photoURL }).catch(() => {});
    // Re-save only when the profile fields change, not on every auth event.
  }, [user?.uid, user?.displayName, user?.photoURL, services]);

  const subscribe = useCallback((l: () => void) => (engine ? engine.subscribe(l) : noopSubscribe()), [engine]);
  const getView = useCallback(() => (engine ? engine.getView() : nullView()), [engine]);
  const view = useSyncExternalStore(subscribe, getView, getView);

  const value = useMemo<ProgressContextValue>(() => {
    if (!uid || !services) return { status: 'unavailable' };
    if (!engine || engine.uid !== uid || !view || view.status.phase !== 'ready') return { status: 'loading', uid };
    return { status: 'ready', uid, view, engine, account: services.account };
  }, [uid, services, engine, view]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  return useContext(ProgressContext);
}
