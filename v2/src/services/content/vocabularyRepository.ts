import rawVocabulary from '../../data/vocabulary/vocabulary.v1.json';
import rawTechnicalInfo from '../../data/vocabulary/technical-info.v1.json';
import type {
  Category, CategoryKey, TechnicalInfo, TechnicalInfoDataset, VocabularyDataset, VocabularyEntry, WordId,
} from '../../models/vocabulary';
import { validateTechnicalInfoDataset, validateVocabularyDataset } from './validate';

/** Read-only access to the bundled, versioned vocabulary content. */
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

let defaultRepository: VocabularyRepository | undefined;

/** The bundled content, validated once on first use. */
export function getVocabularyRepository(): VocabularyRepository {
  if (!defaultRepository) {
    const dataset = validateVocabularyDataset(rawVocabulary);
    const ids = new Set<string>();
    for (const c of dataset.categories) for (const s of c.subtabs) for (const g of s.groups) for (const e of g.entries) ids.add(e.id);
    defaultRepository = createVocabularyRepository(dataset, validateTechnicalInfoDataset(rawTechnicalInfo, ids));
  }
  return defaultRepository;
}
