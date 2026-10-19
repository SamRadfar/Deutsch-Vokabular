// The original content files (src/data/…) as one source. NOT used by the app: the vocabulary belongs
// to the owner's account and is loaded from Firestore after sign-in (features/library). This module
// is the source for the owner import (scripts/library-import.mjs), the tests and emulator seeding.
// scripts/build-production.mjs fails if any of this content appears in the production bundle.

import rawVocabulary from '../../data/vocabulary/vocabulary.v1.json';
import rawTechnicalInfo from '../../data/vocabulary/technical-info.v1.json';
import rawIdRegistry from '../../data/vocabulary/id-registry.v1.json';
import rawDvok5Maps from '../../data/legacy/dvok5-index-maps.v1.json';
import type { IdRegistry } from '../../models/legacy';
import type { Dvok5MapSet } from '../../features/progress/migration/dvok5Maps';
import { createMigrationContext, type MigrationContext } from '../../features/progress/migration/plan';
import { createRepositoryFromRaw, type VocabularyRepository } from './vocabularyRepository';

export const bundledContent = {
  vocabulary: rawVocabulary,
  technicalInfo: rawTechnicalInfo,
  idRegistry: rawIdRegistry,
  dvok5Maps: rawDvok5Maps,
} as const;

export const bundledIdRegistry = rawIdRegistry as IdRegistry;
export const bundledDvok5Maps = rawDvok5Maps as Dvok5MapSet;

let repository: VocabularyRepository | undefined;

/** The original 999-entry content, validated once (tests and seeding). */
export function getBundledRepository(): VocabularyRepository {
  return (repository ??= createRepositoryFromRaw(rawVocabulary, rawTechnicalInfo));
}

/** Migration context over the original content (tests). */
export function bundledMigrationContext(): MigrationContext {
  return createMigrationContext(getBundledRepository(), bundledIdRegistry, bundledDvok5Maps);
}
