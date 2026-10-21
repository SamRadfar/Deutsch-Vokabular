// Compatibility: the first AI-generator version stored user categories as names inside the word
// ("my:<name>" + subcategory name). They become real account categories with DETERMINISTIC ids
// (every device computes the same ids → never duplicates), and the words are moved to those ids.
// Non-destructive and idempotent: nothing is deleted; a second run finds nothing to do.

import type { PersonalVocabulary } from '../personal/personalVocabulary';
import type { CategoryStore } from './categoryStore';
import { nameKey, stableCategoryId } from './model';
import { placementOf } from './catalog';

const LEGACY_PREFIX = 'my:';

export async function migrateLegacyCollections(personal: PersonalVocabulary, categories: CategoryStore): Promise<number> {
  const legacy = personal.getSnapshot().words.filter((w) => w.placement?.category.startsWith(LEGACY_PREFIX));
  if (!legacy.length) return 0;
  const groups = new Map<string, { name: string; subs: Map<string, { name: string; ids: string[] }> }>();
  for (const w of legacy) {
    const name = w.placement!.category.slice(LEGACY_PREFIX.length).trim() || 'Meine Wörter';
    const sub = w.placement!.subtab.trim();
    const g = groups.get(nameKey(name)) ?? groups.set(nameKey(name), { name, subs: new Map() }).get(nameKey(name))!;
    const s = g.subs.get(nameKey(sub)) ?? g.subs.set(nameKey(sub), { name: sub, ids: [] }).get(nameKey(sub))!;
    s.ids.push(w.id);
  }
  let moved = 0;
  for (const [mainKey, g] of groups) {
    const main = categories.ensure(g.name, null, new Set(), await stableCategoryId(`legacy:${mainKey}`));
    if (!main.ok) continue;
    for (const [subKey, s] of g.subs) {
      const sub = s.name ? categories.ensure(s.name, main.category.id, new Set(), await stableCategoryId(`legacy:${mainKey}/${subKey}`)) : null;
      moved += await personal.reassign(s.ids, placementOf(main.category.id, sub?.ok ? sub.category.id : null));
    }
  }
  return moved;
}
