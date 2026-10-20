import { useSyncExternalStore } from 'react';
import {
  downloadVoice, removeVoice, voiceDownloaded, voiceStorageSupported, VoiceAssetError, VOICE_TOTAL_BYTES, type VoiceStore,
} from './voiceAssets';

export type OnDeviceVoiceState =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'missing' }
  | { kind: 'downloading'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; reason: VoiceAssetError['reason'] | 'unknown' };

/**
 * App-wide download state of the on-device German voice. One store, so a download started in the
 * sound settings is immediately usable by the pronunciation buttons and by shadowing.
 */
export interface OnDeviceVoiceStore {
  get(): OnDeviceVoiceState;
  subscribe(listener: () => void): () => void;
  download(): Promise<void>;
  cancel(): void;
  remove(): Promise<void>;
}

export function createOnDeviceVoiceStore(store: VoiceStore = {}): OnDeviceVoiceStore {
  let state: OnDeviceVoiceState = { kind: 'checking' };
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  const set = (next: OnDeviceVoiceState) => { state = next; for (const l of [...listeners]) l(); };

  if (!voiceStorageSupported(store)) state = { kind: 'unsupported' };
  else void voiceDownloaded(store).then((ok) => { if (state.kind === 'checking') set({ kind: ok ? 'ready' : 'missing' }); }, () => set({ kind: 'missing' }));

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async download() {
      if (state.kind === 'unsupported' || state.kind === 'downloading' || state.kind === 'ready') return;
      const ctrl = new AbortController();
      abort = ctrl;
      set({ kind: 'downloading', loaded: 0, total: VOICE_TOTAL_BYTES });
      try {
        await downloadVoice((p) => { if (!ctrl.signal.aborted) set({ kind: 'downloading', loaded: p.loaded, total: p.total }); }, ctrl.signal, store);
        if (!ctrl.signal.aborted) set({ kind: 'ready' });
      } catch (e) {
        if (ctrl.signal.aborted) { set({ kind: 'missing' }); return; }
        set({ kind: 'error', reason: e instanceof VoiceAssetError ? e.reason : 'unknown' });
      } finally {
        if (abort === ctrl) abort = null;
      }
    },
    cancel() { abort?.abort(); },
    async remove() {
      abort?.abort();
      await removeVoice(store);
      set({ kind: 'missing' });
    },
  };
}

let shared: OnDeviceVoiceStore | null = null;
/** The app's store (created on first use). */
export function onDeviceVoiceStore(): OnDeviceVoiceStore {
  shared ??= createOnDeviceVoiceStore();
  return shared;
}
/** Tests: replace the shared store. */
export function setOnDeviceVoiceStore(store: OnDeviceVoiceStore | null) { shared = store; }

/** Download state of the on-device German voice (shared by sound settings, buttons and shadowing). */
export function useOnDeviceVoice(store: OnDeviceVoiceStore = onDeviceVoiceStore()) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { state, download: store.download, cancel: store.cancel, remove: store.remove };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)}`;
}
