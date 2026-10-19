import { describe, expect, it } from 'vitest';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { learningOverview, reviewActivity } from '../../../src/features/dashboard/stats';
import { parseSection, sectionHref } from '../../../src/app/sections';
import type { ReviewRecord } from '../../../src/features/review/model';

const repo = getVocabularyRepository();
const arch = repo.categories[0]!;
const archIds = arch.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id)));
const fitnessId = repo.getCategory('fitness')!.subtabs[0]!.groups[0]!.entries[0]!.id;

describe('learning overview', () => {
  it('nothing learned: 999 total, 0 %', () => {
    const o = learningOverview(repo.categories, new Set());
    expect(o).toMatchObject({ total: 999, learned: 0, remaining: 999, percent: 0 });
    expect(o.categories.map((c) => c.total).reduce((a, b) => a + b)).toBe(999);
    expect(o.categories.map((c) => c.key)).toEqual(repo.categories.map((c) => c.key));
  });

  it('counts per category and overall; ignores ids that are not built-in content', () => {
    const learned = new Set([...archIds.slice(0, 10), fitnessId, 'dv_ffffffffff']);
    const o = learningOverview(repo.categories, learned);
    expect(o).toMatchObject({ total: 999, learned: 11, remaining: 988, percent: 1 });
    expect(o.categories.find((c) => c.key === 'arch')).toMatchObject({ learned: 10, total: archIds.length, percent: Math.round((10 / archIds.length) * 100) });
    expect(o.categories.find((c) => c.key === 'fitness')!.learned).toBe(1);
    expect(o.categories.find((c) => c.key === 'dreame')).toMatchObject({ learned: 0, percent: 0 });
  });

  it('everything learned: 100 %', () => {
    const all = new Set(repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id)))));
    const o = learningOverview(repo.categories, all);
    expect(o).toMatchObject({ learned: 999, remaining: 0, percent: 100 });
    expect(o.categories.every((c) => c.percent === 100 || c.total === 0)).toBe(true);
  });
});

describe('review activity (device-local records only)', () => {
  const rec = (wordId: string, lastResult: 'know' | 'again', at: number, know: number, again: number): ReviewRecord =>
    ({ wordId, lastResult, lastReviewedAt: at, knowCount: know, againCount: again });

  it('sums answers, counts the review-again list and finds the latest review', () => {
    const known = new Set(archIds);
    const records = new Map([
      [archIds[0]!, rec(archIds[0]!, 'know', 100, 2, 1)],
      [archIds[1]!, rec(archIds[1]!, 'again', 300, 0, 1)],
      ['dv_ffffffffff', rec('dv_ffffffffff', 'again', 999, 5, 5)], // not content: ignored
    ]);
    expect(reviewActivity(records, known)).toEqual({ reviewedWords: 2, knowAnswers: 2, againAnswers: 2, againList: 1, lastReviewedAt: 300 });
  });

  it('no records: zeros and no date (nothing invented)', () => {
    expect(reviewActivity(new Map(), new Set(archIds))).toEqual({ reviewedWords: 0, knowAnswers: 0, againAnswers: 0, againList: 0, lastReviewedAt: null });
  });
});

describe('section routes', () => {
  it('parses hash routes and falls back to the words section', () => {
    expect(['', '#', '#/', '#/words', '#/nope', '#main'].map(parseSection)).toEqual(['words', 'words', 'words', 'words', 'words', 'words']);
    expect(['#/review', '#review', '#/shadowing', '#/progress', '#/progress?x=1'].map(parseSection)).toEqual(['review', 'review', 'shadowing', 'progress', 'progress']);
    expect(sectionHref('words')).toBe('#/');
    expect(sectionHref('progress')).toBe('#/progress');
  });
});
