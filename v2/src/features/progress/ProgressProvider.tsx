import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSignedInUser } from '../auth/AuthProvider';
import type { AccountRemote } from './accountRemote';
import type { DocRemote } from '../sync/docSyncEngine';
import type { CustomWordValue } from '../personal/syncModel';
import { getDeviceId, type ProgressLocalStore } from './localStore';
import type { ProgressRemote } from './remote';
import { ProgressSyncEngine, type ProgressView } from './syncEngine';
import { ReviewLog } from '../review/reviewLog';
import { ShadowingLog } from '../shadowing/shadowingLog';
import { PersonalVocabulary } from '../personal/personalVocabulary';
import { CategoryStore } from '../categories/categoryStore';
import type { CategoryValue } from '../categories/model';
import { migrateLegacyCollections } from '../categories/migration';

export interface ProgressServices {
  createRemote(): ProgressRemote;
  account: AccountRemote;
  /** Called once per provider; IndexedDB with in-memory fallback. */
  createLocalStore(): Promise<ProgressLocalStore>;
  /**
   * Remote for personal vocabulary (users/{uid}/customWords). Absent or null = cloud sync of
   * personal words is switched off (they stay on the device; see config personalWordsSync).
   */
  createPersonalRemote?(): DocRemote<CustomWordValue> | null;
  /** Remote for the account's categories (users/{uid}/categories); null = device-only. */
  createCategoryRemote?(): DocRemote<CategoryValue> | null;
}

export type ProgressContextValue =
  | { status: 'unavailable' }
  | { status: 'loading'; uid: string }
  | { status: 'ready'; uid: string; view: ProgressView; engine: ProgressSyncEngine; account: AccountRemote; reviews: ReviewLog; shadowing: ShadowingLog; personal: PersonalVocabulary; categories: CategoryStore };

const ProgressContext = createContext<ProgressContextValue>({ status: 'unavailable' });

const noopSubscribe = () => () => {};
const nullView = () => null;

/**
 * Binds one ProgressSyncEngine (and the device-local review/shadowing logs and personal vocabulary) to the signed-in uid. Both are
 * recreated on every uid change and dropped on sign-out; data of the previous account is never
 * exposed because the context only reports an engine whose uid equals the current uid.
 */
export function ProgressProvider({ services, knownIds, children }: { services: ProgressServices | null; knownIds: ReadonlySet<string>; children: ReactNode }) {
  const user = useSignedInUser();
  const uid = user?.uid ?? null;
  const [store, setStore] = useState<Promise<ProgressLocalStore> | null>(null);
  const [engine, setEngine] = useState<ProgressSyncEngine | null>(null);
  const [logs, setLogs] = useState<{ reviews: ReviewLog; shadowing: ShadowingLog; personal: PersonalVocabulary; categories: CategoryStore } | null>(null);

  useEffect(() => {
    if (services && !store) setStore(services.createLocalStore());
  }, [services, store]);

  useEffect(() => {
    setEngine(null);
    setLogs(null);
    if (!uid || !services || !store) return;
    let cancelled = false;
    let created: ProgressSyncEngine | null = null;
    let createdPersonal: PersonalVocabulary | null = null;
    let createdCategories: CategoryStore | null = null;
    void (async () => {
      const local = await store;
      const deviceId = await getDeviceId(local);
      const reviewLog = new ReviewLog(uid, local);
      const shadowingLog = new ShadowingLog(uid, local);
      const online = typeof navigator === 'undefined' ? true : navigator.onLine;
      const personal = new PersonalVocabulary(uid, local, { remote: services.createPersonalRemote?.() ?? null, deviceId, online });
      createdPersonal = personal;
      const categories = new CategoryStore(uid, local, { remote: services.createCategoryRemote?.() ?? null, deviceId, online });
      createdCategories = categories;
      await Promise.all([reviewLog.load(), shadowingLog.load(), personal.load(), categories.load()]);
      if (cancelled) { personal.stop(); categories.stop(); return; }
      // Words of the first AI-generator version ("my:<name>" placements) get real categories (idempotent).
      await migrateLegacyCollections(personal, categories).catch(() => {});
      created = new ProgressSyncEngine({
        uid, local, remote: services.createRemote(), deviceId, knownIds,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
      });
      setLogs({ reviews: reviewLog, shadowing: shadowingLog, personal, categories });
      setEngine(created);
      await created.start();
    })();
    return () => {
      cancelled = true;
      created?.stop();
      createdPersonal?.stop();
      createdCategories?.stop();
    };
  }, [uid, services, store, knownIds]);

  useEffect(() => {
    if (!engine) return;
    const on = () => { engine.setOnline(true); logs?.personal.setOnline(true); logs?.categories.setOnline(true); };
    const off = () => { engine.setOnline(false); logs?.personal.setOnline(false); logs?.categories.setOnline(false); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [engine, logs]);

  // Minimal profile document (best effort; progress works without it). Written only when the
  // display name or photo changed since the last successful write from this device — not on
  // every session start (Firestore cost, docs/FIREBASE_VALIDATION.md §6).
  const uidForProfile = user?.uid;
  const displayName = user?.displayName ?? null;
  const photoURL = user?.photoURL ?? null;
  useEffect(() => {
    if (!uidForProfile || !services || !store) return;
    let cancelled = false;
    void (async () => {
      const local = await store;
      const signature = JSON.stringify([displayName, photoURL]);
      if ((await local.getMeta<string>(uidForProfile, 'profileSaved')) === signature || cancelled) return;
      await services.account.saveProfile(uidForProfile, { displayName, photoURL });
      await local.setMeta(uidForProfile, 'profileSaved', signature);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [uidForProfile, displayName, photoURL, services, store]);

  const subscribe = useCallback((l: () => void) => (engine ? engine.subscribe(l) : noopSubscribe()), [engine]);
  const getView = useCallback(() => (engine ? engine.getView() : nullView()), [engine]);
  const view = useSyncExternalStore(subscribe, getView, getView);

  const value = useMemo<ProgressContextValue>(() => {
    if (!uid || !services) return { status: 'unavailable' };
    if (!engine || engine.uid !== uid || !logs || logs.reviews.uid !== uid || !view || view.status.phase !== 'ready') return { status: 'loading', uid };
    return { status: 'ready', uid, view, engine, account: services.account, reviews: logs.reviews, shadowing: logs.shadowing, personal: logs.personal, categories: logs.categories };
  }, [uid, services, engine, logs, view]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  return useContext(ProgressContext);
}
