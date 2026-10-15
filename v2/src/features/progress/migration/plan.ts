// Pure transformation: legacy snapshot → migration plan → preview. No I/O, no side effects.
// Rules: docs/MIGRATION_SPEC.md. Nothing is executed against real storage in Phase 2.

import type { LegacyProgressKey, LegacyStorageSnapshot } from '../../../models/legacy';
import { CATEGORY_KEYS, type CategoryKey, type WordId } from '../../../models/vocabulary';
import { buildLegacyKeyIndex, buildWordTextIndex } from '../../../services/content/idRegistry';
import { getVocabularyRepository, type VocabularyRepository } from '../../../services/content/vocabularyRepository';
import { dvok5Maps, findDvok5Map, verifyDvok5MapsUnambiguous, type Dvok5MapSet } from './dvok5Maps';
import {
  parseCustomWords, parseDvok5, parseDvok6, parseExposure, parsePronSettings, parseStringArray,
} from './parse';
import type {
  AmbiguousMapping, Dvok5Status, LearnedMark, LegacySource, MigrationIssue, MigrationPlan, MigrationPreview,
  OrphanedKey, PlannedCustomWord,
} from './types';

export interface MigrationContext {
  repository: VocabularyRepository;
  legacyKeyIndex: ReadonlyMap<LegacyProgressKey, readonly WordId[]>;
  wordTextIndex: ReadonlyMap<string, readonly WordId[]>;
  dvok5Maps: Dvok5MapSet;
}

export function defaultMigrationContext(): MigrationContext {
  return {
    repository: getVocabularyRepository(),
    legacyKeyIndex: buildLegacyKeyIndex(),
    wordTextIndex: buildWordTextIndex(),
    dvok5Maps,
  };
}

const wordOf = (key: LegacyProgressKey) => key.slice(key.indexOf('::') + 2);

export function planMigration(snapshot: LegacyStorageSnapshot, ctx: MigrationContext = defaultMigrationContext()): MigrationPlan {
  const issues: MigrationIssue[] = [];
  const learned = new Map<WordId, LearnedMark>();
  const ambiguous: AmbiguousMapping[] = [];
  const orphans: OrphanedKey[] = [];

  const applyKeys = (keys: Iterable<LegacyProgressKey>, source: LegacySource) => {
    for (const key of keys) {
      const ids = ctx.legacyKeyIndex.get(key);
      if (!ids) {
        // The key is unknown, so any entry with the same word text lives in another category.
        const relocationCandidates = [...(ctx.wordTextIndex.get(wordOf(key)) ?? [])];
        if (!orphans.some((o) => o.legacyKey === key)) orphans.push({ legacyKey: key, source, relocationCandidates });
        continue;
      }
      if (ids.length > 1 && !ambiguous.some((a) => a.legacyKey === key)) {
        ambiguous.push({ legacyKey: key, source, candidateIds: [...ids], resolution: 'apply-to-all-candidates' });
      }
      for (const id of ids) {
        const mark = learned.get(id) ?? { id, sources: [], legacyKeys: [], ambiguous: false };
        if (!mark.sources.includes(source)) mark.sources.push(source);
        if (!mark.legacyKeys.includes(key)) mark.legacyKeys.push(key);
        mark.ambiguous ||= ids.length > 1;
        learned.set(id, mark);
      }
    }
  };

  // ── dvok6 (word-based progress) ──
  const dvok6 = parseDvok6(snapshot.dvok6);
  let dvok6Checked: string[] = [];
  if (dvok6.status === 'invalid') {
    issues.push({ severity: 'data-loss-risk', code: 'DVOK6_INVALID', message: `dvok6 could not be read (${dvok6.reason}); it is kept untouched for manual recovery.` });
  } else if (dvok6.status === 'ok') {
    dvok6Checked = dvok6.value;
    dvok6.warnings.forEach((w) => issues.push({ severity: 'warning', code: 'DVOK6_VALUE', message: w }));
    applyKeys(dvok6Checked, 'dvok6');
  }

  // ── dvok5 (index-based legacy progress) ──
  const dvok5Status = planDvok5(snapshot.dvok5, dvok6Checked.length, ctx, applyKeys, issues);

  // ── custom words ──
  const customParsed = parseCustomWords(snapshot.dvok5_custom);
  const customWords: PlannedCustomWord[] = [];
  let invalidCustomWordCount = 0;
  if (customParsed.status === 'invalid') {
    issues.push({ severity: 'data-loss-risk', code: 'CUSTOM_INVALID', message: `dvok5_custom could not be read (${customParsed.reason}).` });
  } else if (customParsed.status === 'ok') {
    invalidCustomWordCount = customParsed.value.invalid;
    customParsed.warnings.forEach((w) => issues.push({ severity: 'warning', code: 'CUSTOM_DUPLICATE_ID', message: w }));
    for (const w of customParsed.value.words) {
      const category = ctx.repository.getCategory(w.main as CategoryKey);
      const placement = category?.subtabs.some((s) => s.id === w.tab) ? { category: category.key, subtab: w.tab } : null;
      customWords.push({ legacy: w, placement });
    }
    if (invalidCustomWordCount) {
      issues.push({ severity: 'data-loss-risk', code: 'CUSTOM_ELEMENT_INVALID', message: 'Some custom words are malformed and cannot be imported automatically.', count: invalidCustomWordCount });
    }
    const unsorted = customWords.filter((w) => !w.placement).length;
    if (unsorted) issues.push({ severity: 'info', code: 'CUSTOM_UNSORTED', message: 'Custom words whose category/subtab no longer exists go to "Unsorted".', count: unsorted });
  }

  // ── settings, exposure, selected tabs, theme, sync code ──
  const pron = parsePronSettings(snapshot.dvok5_pron_settings);
  if (pron.status === 'invalid') issues.push({ severity: 'warning', code: 'PRON_INVALID', message: `Pronunciation settings unreadable (${pron.reason}); defaults will be used.` });
  if (pron.status === 'ok') pron.warnings.forEach((w) => issues.push({ severity: 'warning', code: 'PRON_VALUE', message: w }));

  const exposure = parseExposure(snapshot.dvok5_pron_exposure);
  if (exposure.status === 'invalid') issues.push({ severity: 'warning', code: 'EXPOSURE_INVALID', message: `Exposure counters unreadable (${exposure.reason}).` });
  if (exposure.status === 'ok') exposure.warnings.forEach((w) => issues.push({ severity: 'warning', code: 'EXPOSURE_VALUE', message: w }));

  const tabs = parseStringArray(snapshot.dvok5_pron_selected_tabs);
  let selectedCategories: MigrationPlan['selectedCategories'] = null;
  if (tabs.status === 'ok') {
    const kept = tabs.value.filter((t): t is CategoryKey => (CATEGORY_KEYS as readonly string[]).includes(t));
    selectedCategories = { kept, dropped: tabs.value.filter((t) => !kept.includes(t as CategoryKey)) };
  } else if (tabs.status === 'invalid') {
    issues.push({ severity: 'info', code: 'SELECTED_TABS_INVALID', message: `Selected pronunciation categories unreadable (${tabs.reason}).` });
  }

  const theme = snapshot.dvok_theme === 'light' || snapshot.dvok_theme === 'dark' ? snapshot.dvok_theme : null;
  const syncCode = { present: snapshot.dvok_sync_code !== null, valid: /^\d{6}$/.test(snapshot.dvok_sync_code ?? '') };

  if (orphans.length) {
    issues.push({
      severity: 'data-loss-risk', code: 'ORPHANED_PROGRESS',
      message: 'Ticks for words that no longer exist in the built-in vocabulary (e.g. the 39 words removed in 6763003). They are archived, not imported.',
      count: orphans.length,
    });
  }
  if (ambiguous.length) {
    issues.push({ severity: 'warning', code: 'AMBIGUOUS_LEGACY_KEY', message: 'A legacy key covered two entries; both are marked (as the legacy app displayed them).', count: ambiguous.length });
  }
  if (snapshot.dvok5_apikey_present) {
    issues.push({ severity: 'info', code: 'API_KEY_NOT_MIGRATED', message: 'An Anthropic API key exists on this device. It is never copied into v2.' });
  }

  const order = new Map<WordId, number>();
  let n = 0;
  for (const c of ctx.repository.categories) for (const s of c.subtabs) for (const g of s.groups) for (const e of g.entries) order.set(e.id, n++);

  return {
    schemaVersion: 1,
    contentVersion: ctx.repository.dataset.contentVersion,
    learned: [...learned.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    ambiguous,
    orphans,
    dvok5: dvok5Status,
    customWords,
    invalidCustomWordCount,
    pronunciation: pron.status === 'ok'
      ? { repeat: pron.value.repeat, pauseSeconds: pron.value.pause, rate: pron.value.rate, shadowing: pron.value.shadow }
      : null,
    selectedCategories,
    exposureByText: exposure.status === 'ok' ? exposure.value : {},
    theme,
    syncCode,
    apiKey: { present: snapshot.dvok5_apikey_present, migrated: false },
    issues,
  };
}

function planDvok5(
  raw: string | null,
  dvok6CheckedCount: number,
  ctx: MigrationContext,
  applyKeys: (keys: Iterable<LegacyProgressKey>, source: LegacySource) => void,
  issues: MigrationIssue[],
): Dvok5Status {
  const parsed = parseDvok5(raw);
  if (parsed.status === 'absent') return { status: 'absent' };
  if (parsed.status === 'invalid') {
    issues.push({ severity: 'data-loss-risk', code: 'DVOK5_INVALID', message: `dvok5 could not be read (${parsed.reason}); kept untouched.` });
    return { status: 'invalid', reason: parsed.reason };
  }
  const { entryCount, checkedIndexes, contiguous } = parsed.value;
  const unambiguity = verifyDvok5MapsUnambiguous(ctx.dvok5Maps);
  const map = contiguous && !unambiguity.length ? findDvok5Map(entryCount, ctx.dvok5Maps) : undefined;
  if (!map) {
    const reason = !contiguous ? 'indexes are not 0..n-1'
      : unambiguity.length ? `historical maps are ambiguous: ${unambiguity.join('; ')}`
        : `no historical version had ${entryCount} checkboxes`;
    if (checkedIndexes.length) {
      issues.push({ severity: 'data-loss-risk', code: 'DVOK5_UNRECOGNIZED', message: `dvok5 has ticks but cannot be mapped (${reason}); kept untouched.`, count: checkedIndexes.length });
    }
    return { status: 'unrecognized', entryCount, reason };
  }
  if (!checkedIndexes.length) return { status: 'no-checks', checkboxCount: map.checkboxCount };

  if (dvok6CheckedCount > 0) {
    issues.push({
      severity: 'warning', code: 'DVOK5_DEFERRED',
      message: 'Old index-based ticks exist, but newer word-based ticks also exist; old ticks are not merged automatically (user decision).',
      count: checkedIndexes.length,
    });
    return { status: 'deferred-dvok6-has-checks', checkboxCount: map.checkboxCount, checkedCount: checkedIndexes.length, matchedCommits: map.commits };
  }
  applyKeys(checkedIndexes.map((i) => map.keys[i]!), 'dvok5');
  return { status: 'imported', checkboxCount: map.checkboxCount, checkedCount: checkedIndexes.length, matchedCommits: map.commits };
}

/** Summarise a plan for review before migrating. */
export function previewMigration(plan: MigrationPlan, ctx: Pick<MigrationContext, 'wordTextIndex'> = defaultMigrationContext()): MigrationPreview {
  const from: Record<LegacySource, number> = { dvok6: 0, dvok5: 0 };
  for (const m of plan.learned) for (const s of m.sources) from[s]++;
  const exposureWords = Object.keys(plan.exposureByText);
  const matching = exposureWords.filter((w) => ctx.wordTextIndex.has(w)).length;
  const potentialDataLoss = plan.issues.filter((i) => i.severity === 'data-loss-risk');
  return {
    learnedEntries: plan.learned.length,
    learnedFrom: from,
    ambiguousKeys: plan.ambiguous.length,
    orphanedKeys: plan.orphans.length,
    dvok5: plan.dvok5.status,
    customWords: {
      total: plan.customWords.length,
      unsorted: plan.customWords.filter((w) => !w.placement).length,
      invalid: plan.invalidCustomWordCount,
      checked: plan.customWords.filter((w) => w.legacy.checked).length,
      pending: plan.customWords.filter((w) => w.legacy.status === 'pending').length,
    },
    exposure: { words: exposureWords.length, matchingBuiltInEntries: matching, withoutBuiltInEntry: exposureWords.length - matching },
    apiKeyPresent: plan.apiKey.present,
    potentialDataLoss,
    warnings: plan.issues.filter((i) => i.severity === 'warning'),
    info: plan.issues.filter((i) => i.severity === 'info'),
    safeToMigrate: potentialDataLoss.length === 0,
  };
}
