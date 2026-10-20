// The on-device German voice (Piper "thorsten", medium quality, MIT licensed) and the WebAssembly
// runtimes it needs. They are public, vocabulary-free files from pinned URLs (exact Hugging Face
// revision, exact npm versions on jsDelivr). Every file is checked against its SHA-256 before it is
// stored, and stored only in this browser (Cache Storage, origin-private). Text is never sent
// anywhere: synthesis runs in a Web Worker on the device (piper.worker.ts).
//
// The files are NOT served from Firebase Hosting (Spark: 360 MB/day transfer), so downloading the
// voice does not use the site's free quota.

export type VoiceAssetKey = 'model' | 'ortWasm' | 'phonemizeWasm' | 'phonemizeData';

export interface VoiceAsset {
  key: VoiceAssetKey;
  url: string;
  sha256: string;
  bytes: number;
}

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const JSD = 'https://cdn.jsdelivr.net/npm';

export const VOICE_ASSETS: readonly VoiceAsset[] = [
  {
    key: 'model',
    url: `${HF}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx`,
    sha256: '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819',
    bytes: 63_201_294,
  },
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
    key: 'phonemizeData', // espeak-ng language data
    url: `${JSD}/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data`,
    sha256: '29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c',
    bytes: 18_077_249,
  },
];

export const VOICE_TOTAL_BYTES = VOICE_ASSETS.reduce((n, a) => n + a.bytes, 0);

/** Model parameters (from de_DE-thorsten-medium.onnx.json). */
export const VOICE_CONFIG = {
  name: 'Thorsten (Piper, de_DE, medium)',
  sampleRate: 22_050,
  espeakVoice: 'de',
  noiseScale: 0.667,
  lengthScale: 1,
  noiseW: 0.8,
} as const;

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

/** Which assets are already stored on this device. */
export async function storedVoiceAssets(s: VoiceStore = {}): Promise<Set<VoiceAssetKey>> {
  const cs = storage(s);
  const have = new Set<VoiceAssetKey>();
  if (!cs) return have;
  try {
    const cache = await cs.open(VOICE_CACHE);
    for (const a of VOICE_ASSETS) {
      const hit = await cache.match(a.url);
      if (hit && hit.headers.get('x-sha256') === a.sha256) have.add(a.key);
    }
  } catch { /* storage unavailable (private mode) */ }
  return have;
}

export async function voiceDownloaded(s: VoiceStore = {}): Promise<boolean> {
  return (await storedVoiceAssets(s)).size === VOICE_ASSETS.length;
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
export async function downloadVoice(onProgress: (p: DownloadProgress) => void, signal?: AbortSignal, s: VoiceStore = {}): Promise<void> {
  const cs = storage(s);
  if (!cs) throw new VoiceAssetError('storage', 'Cache Storage is not available');
  const f = s.fetch ?? fetch;
  const digest = s.digest ?? sha256Hex;
  const have = await storedVoiceAssets(s);
  let loaded = VOICE_ASSETS.filter((a) => have.has(a.key)).reduce((n, a) => n + a.bytes, 0);
  onProgress({ loaded, total: VOICE_TOTAL_BYTES });
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const cache = await cs.open(VOICE_CACHE);
  for (const a of VOICE_ASSETS) {
    if (have.has(a.key)) continue;
    const bytes = await download(a, f, (n) => { loaded += n; onProgress({ loaded, total: VOICE_TOTAL_BYTES }); }, signal);
    const hash = await digest(bytes);
    if (hash !== a.sha256) throw new VoiceAssetError('integrity', `checksum mismatch: ${a.key}`);
    try {
      await cache.put(a.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'x-sha256': hash } }));
    } catch {
      throw new VoiceAssetError('storage', 'not enough storage space for the voice');
    }
  }
}

/** Reads the stored assets (call voiceDownloaded() first). */
export async function loadVoiceAssets(s: VoiceStore = {}): Promise<VoiceAssets> {
  const cs = storage(s);
  if (!cs) throw new VoiceAssetError('storage', 'Cache Storage is not available');
  const cache = await cs.open(VOICE_CACHE);
  const out = {} as VoiceAssets;
  for (const a of VOICE_ASSETS) {
    const hit = await cache.match(a.url);
    if (!hit || hit.headers.get('x-sha256') !== a.sha256) throw new VoiceAssetError('storage', `voice file missing: ${a.key}`);
    out[a.key] = await hit.arrayBuffer();
  }
  return out;
}

export async function removeVoice(s: VoiceStore = {}): Promise<void> {
  const cs = storage(s);
  if (cs) await cs.delete(VOICE_CACHE);
}
