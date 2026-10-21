// The on-device voices (Piper, medium quality) and the WebAssembly runtimes they share:
//  - German: "thorsten" (de_DE, MIT-licensed model),
//  - Persian: "amir" (fa_IR, trained on a CC0 dataset; Piper itself is MIT).
// They are public, vocabulary-free files from pinned URLs (exact Hugging Face revision, exact npm
// versions on jsDelivr). Every file is checked against its SHA-256 before it is stored, and stored
// only in this browser (Cache Storage, origin-private). Text is never sent anywhere: synthesis runs
// in a Web Worker on the device (piper.worker.ts). The runtime files are downloaded once for both voices.
//
// The files are NOT served from Firebase Hosting (Spark: 360 MB/day transfer), so downloading a
// voice does not use the site's free quota.

export type VoiceId = 'de' | 'fa';
export type VoiceAssetKey = 'model' | 'ortWasm' | 'phonemizeWasm' | 'phonemizeData';

export interface VoiceAsset {
  key: VoiceAssetKey;
  url: string;
  sha256: string;
  bytes: number;
}

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const JSD = 'https://cdn.jsdelivr.net/npm';

/** Shared by all voices. */
export const RUNTIME_ASSETS: readonly VoiceAsset[] = [
  {
    // Must match the onnxruntime-web version in package.json (its JS glue is bundled).
    key: 'ortWasm',
    url: `${JSD}/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm`,
    sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
    bytes: 14_239_897,
  },
  {
    key: 'phonemizeWasm',
    url: `${JSD}/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm`,
    sha256: 'b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6',
    bytes: 635_212,
  },
  {
    key: 'phonemizeData', // espeak-ng language data (contains German and Persian)
    url: `${JSD}/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data`,
    sha256: '29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c',
    bytes: 18_077_249,
  },
];

export interface VoiceConfig {
  name: string;
  lang: string;
  sampleRate: number;
  espeakVoice: string;
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
}

/** Model files and parameters (from the voices' .onnx.json). Both run at 22,050 Hz. */
export const VOICES: Record<VoiceId, { model: VoiceAsset; config: VoiceConfig; license: string }> = {
  de: {
    model: {
      key: 'model',
      url: `${HF}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx`,
      sha256: '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819',
      bytes: 63_201_294,
    },
    config: { name: 'Thorsten (Piper, de_DE, medium)', lang: 'de-DE', sampleRate: 22_050, espeakVoice: 'de', noiseScale: 0.667, lengthScale: 1, noiseW: 0.8 },
    license: 'Piper (MIT), Thorsten voice dataset (CC0)',
  },
  fa: {
    model: {
      key: 'model',
      url: `${HF}/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx`,
      sha256: 'fb815380d969ea372b0b21b0de14421f58fe481047e153e69685d079b6e1a9d1',
      bytes: 63_531_379,
    },
    config: { name: 'Amir (Piper, fa_IR, medium)', lang: 'fa-IR', sampleRate: 22_050, espeakVoice: 'fa', noiseScale: 0.667, lengthScale: 1, noiseW: 0.8 },
    license: 'Piper (MIT), Amir dataset (CC0, datacula.com)',
  },
};

/** Every file a voice needs. */
export const assetsFor = (voice: VoiceId): readonly VoiceAsset[] => [VOICES[voice].model, ...RUNTIME_ASSETS];
export const voiceTotalBytes = (voice: VoiceId) => assetsFor(voice).reduce((n, a) => n + a.bytes, 0);

/** German defaults (kept for existing callers). */
export const VOICE_ASSETS = assetsFor('de');
export const VOICE_TOTAL_BYTES = voiceTotalBytes('de');
export const VOICE_CONFIG = VOICES.de.config;

/** Not "dv2-…": the service worker deletes those caches on every release. */
export const VOICE_CACHE = 'tts-voice-v1';

export type VoiceAssets = Record<VoiceAssetKey, ArrayBuffer>;

export interface DownloadProgress {
  loaded: number;
  total: number;
}

export class VoiceAssetError extends Error {
  constructor(public readonly reason: 'network' | 'integrity' | 'storage' | 'aborted', message: string) {
    super(message);
    this.name = 'VoiceAssetError';
  }
}

export interface VoiceStore {
  /** Cache Storage (or a test double). */
  caches?: CacheStorage;
  fetch?: typeof fetch;
  digest?: (bytes: ArrayBuffer) => Promise<string>;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const storage = (s: VoiceStore) => s.caches ?? (typeof caches === 'undefined' ? undefined : caches);

export function voiceStorageSupported(s: VoiceStore = {}): boolean {
  return Boolean(storage(s)) && typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

/** Which assets of `voice` are already stored on this device. */
export async function storedVoiceAssets(s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<Set<VoiceAssetKey>> {
  const cs = storage(s);
  const have = new Set<VoiceAssetKey>();
  if (!cs) return have;
  try {
    const cache = await cs.open(VOICE_CACHE);
    for (const a of assetsFor(voice)) {
      const hit = await cache.match(a.url);
      if (hit && hit.headers.get('x-sha256') === a.sha256) have.add(a.key);
    }
  } catch { /* storage unavailable (private mode) */ }
  return have;
}

export async function voiceDownloaded(s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<boolean> {
  return (await storedVoiceAssets(s, voice)).size === assetsFor(voice).length;
}

/** Bytes still to download for `voice` (shared runtime files that are already stored count as done). */
export async function voiceRemainingBytes(s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<number> {
  const have = await storedVoiceAssets(s, voice);
  return assetsFor(voice).filter((a) => !have.has(a.key)).reduce((n, a) => n + a.bytes, 0);
}

async function download(a: VoiceAsset, f: typeof fetch, onBytes: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await f(a.url, { signal: signal ?? null, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  } catch (e) {
    if (signal?.aborted) throw new VoiceAssetError('aborted', 'download cancelled');
    throw new VoiceAssetError('network', `download failed: ${a.key} (${(e as Error).message})`);
  }
  if (!res.ok) throw new VoiceAssetError('network', `download failed: ${a.key} (HTTP ${res.status})`);
  const out = new Uint8Array(a.bytes);
  let at = 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength !== a.bytes) throw new VoiceAssetError('integrity', `unexpected size: ${a.key}`);
    onBytes(buf.byteLength);
    return buf.buffer as ArrayBuffer;
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.byteLength > a.bytes) throw new VoiceAssetError('integrity', `unexpected size: ${a.key}`);
      out.set(value, at);
      at += value.byteLength;
      onBytes(value.byteLength);
    }
  } catch (e) {
    if (signal?.aborted) throw new VoiceAssetError('aborted', 'download cancelled');
    if (e instanceof VoiceAssetError) throw e;
    throw new VoiceAssetError('network', `download interrupted: ${a.key}`);
  }
  if (at !== a.bytes) throw new VoiceAssetError('integrity', `incomplete download: ${a.key}`);
  return out.buffer as ArrayBuffer;
}

/**
 * Downloads the missing assets, verifies each SHA-256 and stores it. Resumable per file (files that
 * are already stored are skipped). Asks the browser to keep the storage (persist) when possible.
 */
export async function downloadVoice(onProgress: (p: DownloadProgress) => void, signal?: AbortSignal, s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<void> {
  const cs = storage(s);
  if (!cs) throw new VoiceAssetError('storage', 'Cache Storage is not available');
  const f = s.fetch ?? fetch;
  const digest = s.digest ?? sha256Hex;
  const have = await storedVoiceAssets(s, voice);
  const assets = assetsFor(voice);
  const total = voiceTotalBytes(voice);
  let loaded = assets.filter((a) => have.has(a.key)).reduce((n, a) => n + a.bytes, 0);
  onProgress({ loaded, total });
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const cache = await cs.open(VOICE_CACHE);
  for (const a of assets) {
    if (have.has(a.key)) continue;
    const bytes = await download(a, f, (n) => { loaded += n; onProgress({ loaded, total }); }, signal);
    const hash = await digest(bytes);
    if (hash !== a.sha256) throw new VoiceAssetError('integrity', `checksum mismatch: ${a.key}`);
    try {
      await cache.put(a.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'x-sha256': hash } }));
    } catch {
      throw new VoiceAssetError('storage', 'not enough storage space for the voice');
    }
  }
}

/** Reads the stored assets of `voice` (call voiceDownloaded() first). */
export async function loadVoiceAssets(s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<VoiceAssets> {
  const cs = storage(s);
  if (!cs) throw new VoiceAssetError('storage', 'Cache Storage is not available');
  const cache = await cs.open(VOICE_CACHE);
  const out = {} as VoiceAssets;
  for (const a of assetsFor(voice)) {
    const hit = await cache.match(a.url);
    if (!hit || hit.headers.get('x-sha256') !== a.sha256) throw new VoiceAssetError('storage', `voice file missing: ${a.key}`);
    out[a.key] = await hit.arrayBuffer();
  }
  return out;
}

/** Removes the voice's model; the shared runtime goes too once no voice is left. */
export async function removeVoice(s: VoiceStore = {}, voice: VoiceId = 'de'): Promise<void> {
  const cs = storage(s);
  if (!cs) return;
  const cache = await cs.open(VOICE_CACHE);
  await cache.delete(VOICES[voice].model.url);
  const others = (Object.keys(VOICES) as VoiceId[]).filter((v) => v !== voice);
  const anyLeft = (await Promise.all(others.map((v) => cache.match(VOICES[v].model.url)))).some(Boolean);
  if (!anyLeft) await cs.delete(VOICE_CACHE);
}
