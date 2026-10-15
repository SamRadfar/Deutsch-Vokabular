import {
  CATEGORY_KEYS, WORD_ID_PATTERN, WORD_TYPES,
  type Category, type TechnicalInfoDataset, type VocabularyDataset,
} from '../../models/vocabulary';

/** Thrown when bundled content does not match the schema. Fails fast at startup and in tests. */
export class ContentValidationError extends Error {
  override name = 'ContentValidationError';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, path: string, { allowEmpty = false } = {}): string {
  if (typeof v !== 'string') throw new ContentValidationError(`${path}: expected string`);
  if (!allowEmpty && v.length === 0) throw new ContentValidationError(`${path}: empty`);
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ContentValidationError(`${path}: expected array`);
  return v;
}

const includes = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** Runtime validation of the vocabulary JSON (TypeScript cannot type-check imported JSON precisely). */
export function validateVocabularyDataset(raw: unknown): VocabularyDataset {
  if (!isObject(raw) || raw.schemaVersion !== 1) throw new ContentValidationError('vocabulary: unsupported schemaVersion');
  const ids = new Set<string>();
  const categories = arr(raw.categories, 'categories').map((c, ci): Category => {
    const p = `categories[${ci}]`;
    if (!isObject(c)) throw new ContentValidationError(`${p}: expected object`);
    const key = str(c.key, `${p}.key`);
    if (!includes(CATEGORY_KEYS, key)) throw new ContentValidationError(`${p}.key: unknown category "${key}"`);
    return {
      key,
      label: str(c.label, `${p}.label`),
      theme: str(c.theme, `${p}.theme`),
      subtabs: arr(c.subtabs, `${p}.subtabs`).map((t, ti) => {
        const tp = `${p}.subtabs[${ti}]`;
        if (!isObject(t)) throw new ContentValidationError(`${tp}: expected object`);
        return {
          id: str(t.id, `${tp}.id`),
          icon: str(t.icon, `${tp}.icon`),
          label: str(t.label, `${tp}.label`),
          fa: str(t.fa, `${tp}.fa`, { allowEmpty: true }),
          groups: arr(t.groups, `${tp}.groups`).map((g, gi) => {
            const gp = `${tp}.groups[${gi}]`;
            if (!isObject(g)) throw new ContentValidationError(`${gp}: expected object`);
            return {
              label: str(g.label, `${gp}.label`),
              entries: arr(g.entries, `${gp}.entries`).map((e, ei) => {
                const ep = `${gp}.entries[${ei}]`;
                if (!isObject(e)) throw new ContentValidationError(`${ep}: expected object`);
                const id = str(e.id, `${ep}.id`);
                if (!WORD_ID_PATTERN.test(id)) throw new ContentValidationError(`${ep}.id: invalid "${id}"`);
                if (ids.has(id)) throw new ContentValidationError(`${ep}.id: duplicate "${id}"`);
                ids.add(id);
                const type = str(e.type, `${ep}.type`);
                if (!includes(WORD_TYPES, type)) throw new ContentValidationError(`${ep}.type: unknown "${type}"`);
                return {
                  id,
                  word: str(e.word, `${ep}.word`),
                  type,
                  fa: str(e.fa, `${ep}.fa`),
                  example: str(e.example, `${ep}.example`),
                  exampleFa: str(e.exampleFa, `${ep}.exampleFa`),
                  pronunciationFa: str(e.pronunciationFa, `${ep}.pronunciationFa`),
                };
              }),
            };
          }),
        };
      }),
    };
  });
  const source = raw.source;
  if (!isObject(source)) throw new ContentValidationError('vocabulary.source: expected object');
  return {
    schemaVersion: 1,
    contentVersion: str(raw.contentVersion, 'contentVersion'),
    source: {
      legacyCommit: str(source.legacyCommit, 'source.legacyCommit'),
      legacyDataSha256: str(source.legacyDataSha256, 'source.legacyDataSha256'),
    },
    categories,
  };
}

const KINDS = ['symbol', 'persian', 'plain'] as const;

export function validateTechnicalInfoDataset(raw: unknown, knownIds: ReadonlySet<string>): TechnicalInfoDataset {
  if (!isObject(raw) || raw.schemaVersion !== 1) throw new ContentValidationError('technical info: unsupported schemaVersion');
  return {
    schemaVersion: 1,
    entries: arr(raw.entries, 'entries').map((e, i) => {
      const p = `technicalInfo[${i}]`;
      if (!isObject(e)) throw new ContentValidationError(`${p}: expected object`);
      const entryIds = arr(e.entryIds, `${p}.entryIds`).map((id, j) => {
        const s = str(id, `${p}.entryIds[${j}]`);
        if (!knownIds.has(s)) throw new ContentValidationError(`${p}.entryIds[${j}]: unknown id "${s}"`);
        return s;
      });
      let formula: { label: string; value: string } | null = null;
      if (e.formula !== null) {
        if (!isObject(e.formula)) throw new ContentValidationError(`${p}.formula: expected object or null`);
        formula = { label: str(e.formula.label, `${p}.formula.label`), value: str(e.formula.value, `${p}.formula.value`) };
      }
      return {
        legacyWord: str(e.legacyWord, `${p}.legacyWord`),
        entryIds,
        formula,
        rows: arr(e.rows, `${p}.rows`).map((r, j) => {
          const rp = `${p}.rows[${j}]`;
          if (!isObject(r)) throw new ContentValidationError(`${rp}: expected object`);
          const kind = str(r.kind, `${rp}.kind`);
          if (!includes(KINDS, kind)) throw new ContentValidationError(`${rp}.kind: unknown "${kind}"`);
          return { key: str(r.key, `${rp}.key`), value: str(r.value, `${rp}.value`), kind };
        }),
      };
    }),
  };
}
