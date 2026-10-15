import rawRegistry from '../../data/vocabulary/id-registry.v1.json';
import type { IdRegistry, LegacyProgressKey } from '../../models/legacy';
import type { WordId } from '../../models/vocabulary';

/** The immutable id registry minted during the v1 content migration. */
export const idRegistry = rawRegistry as IdRegistry;

/**
 * legacy `mainKey::word` → every v2 id that legacy key covered.
 * 994 keys; the 5 colliding keys resolve to 2 ids each (the legacy UI showed both rows as
 * ticked, so a legacy tick genuinely applied to both). Order follows the baseline order.
 */
export function buildLegacyKeyIndex(registry: IdRegistry = idRegistry): ReadonlyMap<LegacyProgressKey, readonly WordId[]> {
  const index = new Map<LegacyProgressKey, WordId[]>();
  for (const e of registry.entries) {
    const list = index.get(e.legacyKey);
    if (list) list.push(e.id);
    else index.set(e.legacyKey, [e.id]);
  }
  return index;
}

/** legacy word text → ids of entries with exactly that text, across all categories. */
export function buildWordTextIndex(registry: IdRegistry = idRegistry): ReadonlyMap<string, readonly WordId[]> {
  const index = new Map<string, WordId[]>();
  for (const e of registry.entries) {
    const list = index.get(e.legacyWord);
    if (list) list.push(e.id);
    else index.set(e.legacyWord, [e.id]);
  }
  return index;
}
