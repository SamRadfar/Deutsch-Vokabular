// On-device German speech synthesis (Piper VITS model via ONNX Runtime Web, phonemes via
// espeak-ng compiled to WebAssembly). Runs entirely in this worker: no network access, the text
// never leaves the device. The main thread passes the verified model and runtime bytes once
// ('init'), then requests PCM audio per text ('synth').

import createPiperPhonemize, { type PiperPhonemizeOptions } from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import * as ort from 'onnxruntime-web/wasm';
import type { VoiceAssets, VoiceConfig } from './voiceAssets';

export type WorkerRequest =
  | { type: 'init'; assets: VoiceAssets; config: VoiceConfig }
  | { type: 'synth'; id: number; text: string; lengthScale: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'audio'; id: number; pcm: Float32Array }
  | { type: 'error'; id: number | null; message: string };

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let session: ort.InferenceSession | null = null;
let phonemizeModule: WebAssembly.Module | null = null;
let phonemizeData: ArrayBuffer | null = null;
let config: VoiceConfig | null = null;

async function init(assets: VoiceAssets, voiceConfig: VoiceConfig) {
  config = voiceConfig;
  phonemizeModule = await WebAssembly.compile(assets.phonemizeWasm);
  phonemizeData = assets.phonemizeData;
  ort.env.wasm.wasmBinary = assets.ortWasm; // never fetched from a URL
  ort.env.wasm.numThreads = 1; // no cross-origin isolation → no SharedArrayBuffer threads
  ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(new Uint8Array(assets.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

/** Text → phoneme ids. A fresh, tiny program instance per call (its main() exits the runtime). */
async function phonemeIds(text: string): Promise<number[]> {
  const lines: string[] = [];
  const errors: string[] = [];
  const module = phonemizeModule!;
  const options: PiperPhonemizeOptions = {
    getPreloadedPackage: () => phonemizeData!, // read-only data files (MEMFS keeps views of it)
    instantiateWasm: (imports, done) => {
      void WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
      return {};
    },
    print: (line) => lines.push(line),
    printErr: (line) => errors.push(line),
    locateFile: (p) => p,
  };
  const program = await createPiperPhonemize(options);
  program.callMain(['-l', config!.espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const ids: number[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { phoneme_ids?: number[] };
      if (Array.isArray(parsed.phoneme_ids)) ids.push(...parsed.phoneme_ids);
    } catch { /* not a result line */ }
  }
  if (!ids.length) throw new Error(`phonemizer produced no output${errors.length ? `: ${errors[0]}` : ''}`);
  return ids;
}

async function synth(text: string, lengthScale: number): Promise<Float32Array> {
  if (!session) throw new Error('voice not initialised');
  const ids = await phonemeIds(text);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([config!.noiseScale, lengthScale, config!.noiseW]), [3]),
  };
  const result = await session.run(feeds);
  const output = result.output ?? Object.values(result)[0];
  if (!output) throw new Error('model produced no audio');
  return Float32Array.from(output.data as Float32Array);
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg.assets, msg.config).then(
      () => scope.postMessage({ type: 'ready' }),
      (err: unknown) => scope.postMessage({ type: 'error', id: null, message: String((err as Error)?.message ?? err) }),
    );
    return;
  }
  synth(msg.text, msg.lengthScale).then(
    (pcm) => scope.postMessage({ type: 'audio', id: msg.id, pcm }, [pcm.buffer]),
    (err: unknown) => scope.postMessage({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) }),
  );
};
