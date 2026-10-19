import type {
  Category, CategoryKey, TechnicalInfo, TechnicalInfoDataset, VocabularyDataset, VocabularyEntry, WordId,
} from '../../models/vocabulary';
import { validateTechnicalInfoDataset, validateVocabularyDataset } from './validate';

/** Read-only access to the vocabulary content of the signed-in account (its library). */
export interface VocabularyRepository {
  readonly dataset: VocabularyDataset;
  readonly categories: readonly Category[];
  readonly totalEntries: number;
  getCategory(key: CategoryKey): Category | undefined;
  getEntry(id: WordId): VocabularyEntry | undefined;
  getTechnicalInfo(id: WordId): TechnicalInfo | undefined;
}

export function createVocabularyRepository(
  dataset: VocabularyDataset,
  technicalInfo: TechnicalInfoDataset,
): VocabularyRepository {
  const entries = new Map<WordId, VocabularyEntry>();
  for (const c of dataset.categories)
    for (const s of c.subtabs)
      for (const g of s.groups)
        for (const e of g.entries) entries.set(e.id, e);

  const infoByEntry = new Map<WordId, TechnicalInfo>();
  for (const info of technicalInfo.entries) for (const id of info.entryIds) infoByEntry.set(id, info);

  return {
    dataset,
    categories: dataset.categories,
    totalEntries: entries.size,
    getCategory: (key) => dataset.categories.find((c) => c.key === key),
    getEntry: (id) => entries.get(id),
    getTechnicalInfo: (id) => infoByEntry.get(id),
  };
}

/** Validates raw library content (vocabulary + technical info) and builds the repository. */
export function createRepositoryFromRaw(rawVocabulary: unknown, rawTechnicalInfo: unknown): VocabularyRepository {
  const dataset = validateVocabularyDataset(rawVocabulary);
  const ids = new Set<string>();
  for (const c of dataset.categories) for (const s of c.subtabs) for (const g of s.groups) for (const e of g.entries) ids.add(e.id);
  return createVocabularyRepository(dataset, validateTechnicalInfoDataset(rawTechnicalInfo, ids));
}

/** An account without a library: no built-in categories (personal words only). */
export const EMPTY_REPOSITORY: VocabularyRepository = createVocabularyRepository(
  { schemaVersion: 1, contentVersion: '', source: '', categories: [] } as unknown as VocabularyDataset,
  { schemaVersion: 1, entries: [] } as unknown as TechnicalInfoDataset,
);
