import { useSyncExternalStore } from 'react';
import {
  downloadVoice, removeVoice, voiceDownloaded, voiceRemainingBytes, voiceStorageSupported, voiceTotalBytes, VoiceAssetError,
  type VoiceId, type VoiceStore,
} from './voiceAssets';

export type OnDeviceVoiceState =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  /** `bytes`: what is still to download (runtime files shared with another voice are not counted). */
  | { kind: 'missing'; bytes: number }
  | { kind: 'downloading'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; reason: VoiceAssetError['reason'] | 'unknown'; bytes: number };

/**
 * App-wide download state of ONE on-device voice. One store per voice, so a download started in the
 * sound settings is immediately usable by the pronunciation buttons and by shadowing.
 */
export interface OnDeviceVoiceStore {
  readonly voice: VoiceId;
  get(): OnDeviceVoiceState;
  subscribe(listener: () => void): () => void;
  download(): Promise<void>;
  cancel(): void;
  remove(): Promise<void>;
}

export function createOnDeviceVoiceStore(store: VoiceStore = {}, voice: VoiceId = 'de'): OnDeviceVoiceStore {
  let state: OnDeviceVoiceState = { kind: 'checking' };
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  const set = (next: OnDeviceVoiceState) => { state = next; for (const l of [...listeners]) l(); };
  const missing = async () => ({ kind: 'missing' as const, bytes: await voiceRemainingBytes(store, voice).catch(() => voiceTotalBytes(voice)) });

  if (!voiceStorageSupported(store)) state = { kind: 'unsupported' };
  else {
    void voiceDownloaded(store, voice).then(async (ok) => {
      if (state.kind === 'checking') set(ok ? { kind: 'ready' } : await missing());
    }, async () => set(await missing()));
  }

  const api: OnDeviceVoiceStore = {
    voice,
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async download() {
      if (state.kind === 'unsupported' || state.kind === 'downloading' || state.kind === 'ready') return;
      const ctrl = new AbortController();
      abort = ctrl;
      set({ kind: 'downloading', loaded: 0, total: voiceTotalBytes(voice) });
      try {
        await downloadVoice((p) => { if (!ctrl.signal.aborted) set({ kind: 'downloading', loaded: p.loaded, total: p.total }); }, ctrl.signal, store, voice);
        if (!ctrl.signal.aborted) set({ kind: 'ready' });
        // Shared runtime files now exist: the other voices need less.
        for (const other of Object.values(shared)) if (other !== api) other.refresh?.();
      } catch (e) {
        if (ctrl.signal.aborted) { set(await missing()); return; }
        set({ kind: 'error', reason: e instanceof VoiceAssetError ? e.reason : 'unknown', bytes: (await missing()).bytes });
      } finally {
        if (abort === ctrl) abort = null;
      }
    },
    cancel() { abort?.abort(); },
    async remove() {
      abort?.abort();
      await removeVoice(store, voice);
      set(await missing());
      for (const other of Object.values(shared)) if (other !== api) other.refresh?.();
    },
  };
  (api as OnDeviceVoiceStore & { refresh?: () => void }).refresh = () => {
    if (state.kind === 'missing' || state.kind === 'ready') void voiceDownloaded(store, voice).then(async (ok) => set(ok ? { kind: 'ready' } : await missing()));
  };
  return api;
}

const shared: Partial<Record<VoiceId, OnDeviceVoiceStore & { refresh?: () => void }>> = {};
/** The app's store for `voice` (created on first use). */
export function onDeviceVoiceStore(voice: VoiceId = 'de'): OnDeviceVoiceStore {
  shared[voice] ??= createOnDeviceVoiceStore({}, voice);
  return shared[voice]!;
}
/** Tests: replace (or with null: reset) the shared store of a voice — all voices when omitted. */
export function setOnDeviceVoiceStore(store: OnDeviceVoiceStore | null, voice?: VoiceId) {
  const voices: VoiceId[] = voice ? [voice] : ['de', 'fa'];
  for (const v of voices) {
    if (store) shared[v] = store; else delete shared[v];
  }
}

/** Download state of an on-device voice (shared by sound settings, buttons and shadowing). */
export function useOnDeviceVoice(store: OnDeviceVoiceStore = onDeviceVoiceStore()) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { state, download: store.download, cancel: store.cancel, remove: store.remove };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)}`;
}
