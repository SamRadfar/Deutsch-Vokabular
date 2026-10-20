// Main-thread client of the on-device voice worker (piper.worker.ts).

import { loadVoiceAssets, VOICE_CONFIG, type VoiceStore } from './voiceAssets';
import type { WorkerRequest, WorkerResponse } from './piper.worker';

export interface NeuralVoice {
  readonly sampleRate: number;
  /** PCM (mono, float, `sampleRate`) for `text`. `rate` uses the browser-speech scale (1 = normal). */
  synthesize(text: string, rate: number): Promise<Float32Array>;
  /** Stops the worker and frees the model memory. */
  dispose(): void;
}

/** Browser speech rate (0.55–1.2) → Piper length scale (larger = slower). */
export function lengthScaleFor(rate: number): number {
  return Math.min(2, Math.max(0.6, VOICE_CONFIG.lengthScale / Math.max(rate, 0.1)));
}

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null; onerror: ((e: ErrorEvent) => void) | null };

export interface OpenOptions {
  store?: VoiceStore;
  /** Test seam. */
  createWorker?: () => WorkerLike;
}

const defaultWorker = (): WorkerLike => new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module', name: 'dv2-voice' }) as unknown as WorkerLike;

/** Loads the stored voice into a new worker. Rejects when the voice is not downloaded or fails to start. */
export async function openNeuralVoice({ store = {}, createWorker = defaultWorker }: OpenOptions = {}): Promise<NeuralVoice> {
  const assets = await loadVoiceAssets(store);
  const worker = createWorker();
  let nextId = 1;
  const waiting = new Map<number, { resolve: (pcm: Float32Array) => void; reject: (e: Error) => void }>();
  let fail: ((e: Error) => void) | null = null;
  let disposed = false;

  const failAll = (err: Error) => {
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
  };

  await new Promise<void>((resolve, reject) => {
    fail = reject;
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') { fail = null; resolve(); return; }
      if (msg.type === 'error' && msg.id === null) { (fail ?? failAll)(new Error(msg.message)); return; }
      if (msg.id === null) return;
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.type === 'audio') w.resolve(msg.pcm); else w.reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'voice worker failed');
      if (fail) fail(err); else failAll(err);
    };
    const init: WorkerRequest = { type: 'init', assets };
    worker.postMessage(init, [assets.model, assets.ortWasm, assets.phonemizeWasm, assets.phonemizeData]);
  }).catch((e: unknown) => { worker.terminate(); throw e; });

  return {
    sampleRate: VOICE_CONFIG.sampleRate,
    synthesize(text, rate) {
      if (disposed) return Promise.reject(new Error('voice disposed'));
      const id = nextId++;
      return new Promise<Float32Array>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        const req: WorkerRequest = { type: 'synth', id, text, lengthScale: lengthScaleFor(rate) };
        worker.postMessage(req);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      failAll(new Error('voice disposed'));
    },
  };
}
