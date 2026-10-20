import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Download state of the on-device German voice (shared by the shadowing setup and the sound test). */
export function useOnDeviceVoice(store: VoiceStore = {}) {
  const [state, setState] = useState<OnDeviceVoiceState>({ kind: 'checking' });
  const abort = useRef<AbortController | null>(null);
  const storeRef = useRef(store);

  useEffect(() => {
    let live = true;
    if (!voiceStorageSupported(storeRef.current)) { setState({ kind: 'unsupported' }); return; }
    void voiceDownloaded(storeRef.current).then((ok) => { if (live) setState({ kind: ok ? 'ready' : 'missing' }); });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const download = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ kind: 'downloading', loaded: 0, total: VOICE_TOTAL_BYTES });
    try {
      await downloadVoice((p) => { if (!ctrl.signal.aborted) setState({ kind: 'downloading', loaded: p.loaded, total: p.total }); }, ctrl.signal, storeRef.current);
      if (!ctrl.signal.aborted) setState({ kind: 'ready' });
    } catch (e) {
      if (ctrl.signal.aborted) { setState({ kind: 'missing' }); return; }
      setState({ kind: 'error', reason: e instanceof VoiceAssetError ? e.reason : 'unknown' });
    }
  }, []);

  const cancel = useCallback(() => { abort.current?.abort(); }, []);

  const remove = useCallback(async () => {
    abort.current?.abort();
    await removeVoice(storeRef.current);
    setState({ kind: 'missing' });
  }, []);

  return { state, download, cancel, remove };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)}`;
}
