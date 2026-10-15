import type { LegacyData, LegacyTechnicalInfo } from '../../models/legacy';
import type { TechnicalInfoDataset, TechnicalValueKind, VocabularyDataset } from '../../models/vocabulary';

/**
 * Convert v2 content back to the exact legacy shape. Used to prove that the migration
 * preserved every field and the original order (compared with the Phase 1 fixtures).
 */
export function toLegacyData(dataset: VocabularyDataset): LegacyData {
  const out: LegacyData = {};
  for (const c of dataset.categories) {
    out[c.key] = {
      label: c.label,
      theme: c.theme,
      tabs: c.subtabs.map((t) => ({
        id: t.id,
        icon: t.icon,
        label: t.label,
        fa: t.fa,
        groups: t.groups.map((g) => ({
          label: g.label,
          rows: g.entries.map((e) => [e.word, e.type, e.fa, e.example, e.exampleFa, e.pronunciationFa]),
        })),
      })),
    };
  }
  return out;
}

const LEGACY_CLASS: Record<TechnicalValueKind, string> = { symbol: 'sym', persian: 'fa', plain: '' };

export function toLegacyTechnicalInfo(dataset: TechnicalInfoDataset): LegacyTechnicalInfo {
  const out: LegacyTechnicalInfo = {};
  for (const e of dataset.entries) {
    out[e.legacyWord] = {
      formula: e.formula ? { lbl: e.formula.label, val: e.formula.value } : null,
      kv: e.rows.map((r) => ({ key: r.key, val: r.value, cls: LEGACY_CLASS[r.kind] })),
    };
  }
  return out;
}
