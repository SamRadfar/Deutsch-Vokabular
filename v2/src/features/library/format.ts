// Owner library format — Firestore users/{uid}/library/* — shared by the app and
// scripts/library-import.mjs. No imports: it runs in the browser and under Node type stripping.
//
// The built-in vocabulary is NOT part of the public bundle. It lives in the owner's account:
//   library/meta                      LibraryMeta (written last; its presence = library exists)
//   library/category-<key>            { json }  one vocabulary category (subtabs, groups, entries)
//   library/technical-info            { json }  technical drawer data
//   library/id-registry               { json }  immutable id registry (legacy progress migration)
//   library/dvok5-maps                { json }  legacy dvok5 index maps (legacy progress migration)
// Every chunk is stored as a JSON string with its SHA-256 in meta.chunks; the app verifies each
// hash before use, so a partial or altered library is never shown.

export const LIBRARY_FORMAT = 'dv2-library/1';
export const LIBRARY_META_ID = 'meta';
export const TECH_CHUNK = 'technical-info';
export const REGISTRY_CHUNK = 'id-registry';
export const DVOK5_CHUNK = 'dvok5-maps';
export const categoryChunkId = (key: string) => `category-${key}`;

export interface LibraryMeta {
  format: typeof LIBRARY_FORMAT;
  /** Header of the vocabulary dataset. */
  schemaVersion: number;
  contentVersion: string;
  /** Provenance of the content (legacy commit and data hash). */
  source: unknown;
  /** Category keys in display order (chunk ids: category-<key>). */
  categories: string[];
  entryCount: number;
  /** chunk id → SHA-256 (hex) of its JSON string. */
  chunks: Record<string, string>;
  /** SHA-256 over the core chunks (vocabulary + technical info): identifies the content. */
  contentHash: string;
  importedAt?: string;
}

export class LibraryIntegrityError extends Error {}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isLibraryMeta(raw: unknown): raw is LibraryMeta {
  return isObj(raw) && raw.format === LIBRARY_FORMAT && typeof raw.schemaVersion === 'number'
    && typeof raw.contentVersion === 'string' && (typeof raw.source === 'string' || isObj(raw.source))
    && Array.isArray(raw.categories) && raw.categories.every((k) => typeof k === 'string')
    && typeof raw.entryCount === 'number' && isObj(raw.chunks) && Object.values(raw.chunks).every((h) => typeof h === 'string')
    && typeof raw.contentHash === 'string';
}

/** Chunks needed to browse and practise (loaded with the library). */
export const coreChunkIds = (meta: Pick<LibraryMeta, 'categories'>) => [...meta.categories.map(categoryChunkId), TECH_CHUNK];

const contentHashOf = (meta: Pick<LibraryMeta, 'categories' | 'chunks'>) =>
  sha256Hex(coreChunkIds(meta).map((id) => `${id}:${meta.chunks[id] ?? ''}`).join('\n'));

/** Splits the content files into library documents (used by the import script and test seeding). */
export async function splitLibrary(src: {
  vocabulary: { schemaVersion: number; contentVersion: string; source: unknown; categories: Array<{ key: string; subtabs: Array<{ groups: Array<{ entries: unknown[] }> }> }> };
  technicalInfo: unknown;
  idRegistry?: unknown;
  dvok5Maps?: unknown;
}): Promise<{ meta: LibraryMeta; chunks: Record<string, string> }> {
  const chunks: Record<string, string> = {};
  let entryCount = 0;
  for (const c of src.vocabulary.categories) {
    chunks[categoryChunkId(c.key)] = JSON.stringify(c);
    for (const s of c.subtabs) for (const g of s.groups) entryCount += g.entries.length;
  }
  chunks[TECH_CHUNK] = JSON.stringify(src.technicalInfo);
  if (src.idRegistry !== undefined) chunks[REGISTRY_CHUNK] = JSON.stringify(src.idRegistry);
  if (src.dvok5Maps !== undefined) chunks[DVOK5_CHUNK] = JSON.stringify(src.dvok5Maps);
  const hashes: Record<string, string> = {};
  for (const [id, json] of Object.entries(chunks)) hashes[id] = await sha256Hex(json);
  const base = {
    format: LIBRARY_FORMAT,
    schemaVersion: src.vocabulary.schemaVersion,
    contentVersion: src.vocabulary.contentVersion,
    source: src.vocabulary.source,
    categories: src.vocabulary.categories.map((c) => c.key),
    entryCount,
    chunks: hashes,
  } as const;
  return { meta: { ...base, categories: [...base.categories], contentHash: await contentHashOf(base) }, chunks };
}

async function verified(meta: LibraryMeta, id: string, json: string | undefined): Promise<unknown> {
  if (json === undefined) throw new LibraryIntegrityError(`library chunk ${id} is missing`);
  const expected = meta.chunks[id];
  if (!expected || (await sha256Hex(json)) !== expected) throw new LibraryIntegrityError(`library chunk ${id} does not match its checksum`);
  return JSON.parse(json) as unknown;
}

/** Verifies every core chunk and rebuilds the raw vocabulary + technical info (validated by the caller). */
export async function assembleLibrary(meta: LibraryMeta, chunks: Record<string, string | undefined>): Promise<{ vocabulary: unknown; technicalInfo: unknown }> {
  if (meta.contentHash !== (await contentHashOf(meta))) throw new LibraryIntegrityError('library content hash does not match its chunks');
  const categories: unknown[] = [];
  for (const key of meta.categories) {
    const c = await verified(meta, categoryChunkId(key), chunks[categoryChunkId(key)]);
    if (!isObj(c) || c.key !== key) throw new LibraryIntegrityError(`library chunk for ${key} holds another category`);
    categories.push(c);
  }
  return {
    vocabulary: { schemaVersion: meta.schemaVersion, contentVersion: meta.contentVersion, source: meta.source, categories },
    technicalInfo: await verified(meta, TECH_CHUNK, chunks[TECH_CHUNK]),
  };
}

/** One optional chunk (id registry, dvok5 maps), verified against meta. */
export function parseExtraChunk(meta: LibraryMeta, id: string, json: string | undefined): Promise<unknown> {
  return verified(meta, id, json);
}
