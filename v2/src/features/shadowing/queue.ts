// Which words a shadowing session plays, in which order. Ported from the legacy pronBuildQueue():
// words heard less often are preferred (weight 3 for never, 2 for fewer than 3 times, 1 otherwise),
// then the batch is shuffled again so the preferred words are not always first.
// Exposure is keyed by stable word id here (the legacy app keyed it by the word text).

import type { WordId } from '../../models/vocabulary';
import { inPracticeScope, selectCards, shuffle, type DeckCard, type DeckProgress, type PracticeCategoryKey, type ReviewMode } from '../review/deck';

export function exposureWeight(count: number): number {
  return count <= 0 ? 3 : count < 3 ? 2 : 1;
}

/** `subtab` (one main category selected) narrows the words to that subcategory; null = all of them. */
export function selectShadowingCards(
  cards: readonly DeckCard[], mode: ReviewMode, categories: ReadonlySet<PracticeCategoryKey>, progress: DeckProgress, subtab: string | null = null,
): DeckCard[] {
  const keys = [...categories];
  const sub = categories.size === 1 ? subtab : null;
  return selectCards(cards, mode, 'all', progress)
    .filter((c) => categories.has(c.categoryKey) || keys.some((k) => inPracticeScope(c, k)))
    .filter((c) => sub === null || c.subtabId === sub);
}

export function buildShadowingQueue(
  selected: readonly DeckCard[],
  exposure: ReadonlyMap<WordId, number>,
  size: number,
  random: () => number = Math.random,
): DeckCard[] {
  const weighted: DeckCard[] = [];
  for (const c of selected) {
    const w = exposureWeight(exposure.get(c.entry.id) ?? 0);
    for (let i = 0; i < w; i++) weighted.push(c);
  }
  const seen = new Set<WordId>();
  const batch: DeckCard[] = [];
  for (const c of shuffle(weighted, random)) {
    if (seen.has(c.entry.id)) continue;
    seen.add(c.entry.id);
    batch.push(c);
    if (batch.length >= size) break;
  }
  return shuffle(batch, random);
}
