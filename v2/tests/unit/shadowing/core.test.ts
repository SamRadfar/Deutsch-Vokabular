import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { CATEGORY_KEYS } from '../../../src/models/vocabulary';
import { flattenCards } from '../../../src/features/review/deck';
import { pauseDuration, planItem, MAX_PAUSE_MS } from '../../../src/features/shadowing/plan';
import { buildShadowingQueue, exposureWeight, selectShadowingCards } from '../../../src/features/shadowing/queue';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../../../src/features/shadowing/settings';
import { ShadowingLog } from '../../../src/features/shadowing/shadowingLog';
import { STATS_META_KEY } from '../../../src/features/shadowing/model';
import { createIndexedDbStore, createMemoryStore, openProgressDb, type ProgressLocalStore } from '../../../src/features/progress/localStore';
import { createWakeLockPort } from '../../../src/features/shadowing/wakeLock';
import { PREFERENCE_KEYS, readJsonPreference, writeJsonPreference } from '../../../src/services/preferences';

const cards = flattenCards(getVocabularyRepository().categories);
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const A = 'dv_00000000a1';

describe('practice plan per item', () => {
  it('word × n with a pause after each, then the example × m with extended pauses', () => {
    const steps = planItem({ word: 'die Wand', example: 'Die Wand ist weiß.' }, { wordRepeats: 2, exampleRepeats: 1, pauseSec: 3 });
    expect(steps.map((s) => `${s.kind}:${s.target}:${s.repetition}/${s.of}`)).toEqual([
      'speak:word:1/2', 'pause:word:1/2', 'speak:word:2/2', 'pause:word:2/2', 'speak:example:1/1', 'pause:example:1/1',
    ]);
    expect(steps[0]).toMatchObject({ text: 'die Wand' }); // the article is part of what is practised
    expect(steps[1]).toMatchObject({ baseMs: 3000, extendBySpeech: false });
    expect(steps[5]).toMatchObject({ baseMs: 3000, extendBySpeech: true });
  });

  it('no example sentence or 0 example repeats → words only; at least one word play', () => {
    expect(planItem({ word: 'x', example: '  ' }, { wordRepeats: 1, exampleRepeats: 3, pauseSec: 1 })).toHaveLength(2);
    expect(planItem({ word: 'x', example: 'Satz.' }, { wordRepeats: 0, exampleRepeats: 0, pauseSec: 1 })).toHaveLength(2);
  });

  it('pause after a sentence = base + its spoken duration, capped', () => {
    const [, wordPause] = planItem({ word: 'x', example: '' }, { wordRepeats: 1, exampleRepeats: 0, pauseSec: 2 });
    const exPause = planItem({ word: 'x', example: 'Satz.' }, { wordRepeats: 1, exampleRepeats: 1, pauseSec: 2 })[3]!;
    expect(pauseDuration(wordPause as never, 5000)).toBe(2000);
    expect(pauseDuration(exPause as never, 2400)).toBe(4400);
    expect(pauseDuration(exPause as never, 60_000)).toBe(MAX_PAUSE_MS);
  });
});

describe('session queue (legacy exposure weighting)', () => {
  it('weights 3 / 2 / 1 for never / fewer than 3 / more practised words', () => {
    expect([0, 1, 2, 3, 10].map(exposureWeight)).toEqual([3, 2, 2, 1, 1]);
  });

  it('selects by mode and several categories', () => {
    const p = { learned: new Set([cards[0]!.entry.id]), againIds: null };
    const cats = new Set(['arch', 'fitness'] as const);
    const all = selectShadowingCards(cards, 'all', cats, p);
    expect(all.every((c) => cats.has(c.categoryKey as never))).toBe(true);
    expect(selectShadowingCards(cards, 'learned', cats, p).map((c) => c.entry.id)).toEqual([cards[0]!.entry.id]);
    expect(selectShadowingCards(cards, 'again', cats, p)).toEqual([]); // needs the review list
    expect(selectShadowingCards(cards, 'all', new Set(), p)).toEqual([]);
  });

  it('a queue has unique words, at most `size`, and prefers words practised less', () => {
    const pool = cards.slice(0, 40);
    const exposure = new Map(pool.slice(0, 20).map((c) => [c.entry.id, 10])); // first 20: well practised
    let fresh = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const q = buildShadowingQueue(pool, exposure, 10, seeded(seed));
      expect(new Set(q.map((c) => c.entry.id)).size).toBe(10);
      fresh += q.filter((c) => !exposure.has(c.entry.id)).length;
    }
    expect(fresh / 500).toBeGreaterThan(0.6); // without weighting ≈ 0.5
    expect(buildShadowingQueue(pool.slice(0, 3), new Map(), 10)).toHaveLength(3);
  });
});

describe('shadowing preferences', () => {
  it('defaults, and sanitises anything stored out of range', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ wordRepeats: 9, exampleRepeats: -1, pauseSec: 99, rate: 7, mode: 'x', categories: ['arch', 'nope', 'arch'], size: 3, showTranslation: 'yes' }))
      .toEqual({ ...DEFAULT_PREFERENCES, categories: ['arch'] });
    expect(sanitizePreferences({ pauseSec: 2.7, rate: 0.55, wordRepeats: 4, exampleRepeats: 0, showTranslation: false, mode: 'learned', size: 5 }))
      .toMatchObject({ pauseSec: 2.5, rate: 0.55, wordRepeats: 4, exampleRepeats: 0, showTranslation: false, mode: 'learned', size: 5, categories: [...CATEGORY_KEYS] });
  });

  it('round-trips through localStorage under its own versioned key', () => {
    const prefs = { ...DEFAULT_PREFERENCES, pauseSec: 6, rate: 1.2 };
    writeJsonPreference(PREFERENCE_KEYS.shadowing, prefs);
    expect(localStorage.getItem('dv2.pref.shadowing.v1')).not.toBeNull();
    expect(sanitizePreferences(readJsonPreference(PREFERENCE_KEYS.shadowing))).toEqual(prefs);
    localStorage.setItem('dv2.pref.shadowing.v1', '{broken');
    expect(sanitizePreferences(readJsonPreference(PREFERENCE_KEYS.shadowing))).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('shadowing history (device-local, per uid)', () => {
  it('counts practised items and sessions and survives a reload (IndexedDB)', async () => {
    const factory = new IDBFactory();
    const log = new ShadowingLog('alice', createIndexedDbStore(openProgressDb(factory)), () => 1000);
    await log.load();
    await log.recordItem(A);
    await log.recordItem(A);
    await log.recordSession(true, 65_000);
    await log.recordSession(false, 5_000);
    expect(log.getSnapshot().exposure.get(A)).toBe(2);

    const reloaded = new ShadowingLog('alice', createIndexedDbStore(openProgressDb(factory)));
    await reloaded.load();
    expect(reloaded.getSnapshot().exposure.get(A)).toBe(2);
    expect(reloaded.getSnapshot().stats).toEqual({ sessionsCompleted: 1, itemsPracticed: 2, practiceMs: 70_000, lastSessionAt: 1000 });

    const bob = new ShadowingLog('bob', createIndexedDbStore(openProgressDb(factory)));
    await bob.load();
    expect(bob.getSnapshot().exposure.size).toBe(0);
    expect(bob.getSnapshot().stats.itemsPracticed).toBe(0);
  });

  it('ignores invalid stored data and reports failing writes', async () => {
    const mem = createMemoryStore();
    await mem.setMeta('alice', STATS_META_KEY, { sessionsCompleted: -3, itemsPracticed: 'many' });
    const broken: ProgressLocalStore = {
      ...mem,
      loadExposure: async () => [{ wordId: 'bad', count: 1, lastPracticedAt: 1 }, { wordId: A, count: 2, lastPracticedAt: 1 }],
      recordExposure: async () => { throw new Error('quota'); },
    };
    const log = new ShadowingLog('alice', broken);
    await log.load();
    expect([...log.getSnapshot().exposure]).toEqual([[A, 2]]);
    expect(log.getSnapshot().stats.sessionsCompleted).toBe(0);
    await log.recordItem(A);
    expect(log.getSnapshot()).toMatchObject({ saved: false });
    expect(log.getSnapshot().exposure.get(A)).toBe(3); // kept in memory
  });
});

describe('wake lock port', () => {
  it('is unsupported without navigator.wakeLock', async () => {
    const port = createWakeLockPort({});
    expect(port.supported).toBe(false);
    expect(await port.request(() => {})).toBeNull();
  });

  it('requests a screen lock, forwards system releases, and swallows refusals', async () => {
    const listeners: Array<() => void> = [];
    const sentinel = { release: vi.fn(async () => {}), addEventListener: (_: 'release', l: () => void) => listeners.push(l) };
    const request = vi.fn(async () => sentinel);
    const port = createWakeLockPort({ wakeLock: { request } });
    const released = vi.fn();
    const handle = await port.request(released);
    expect(request).toHaveBeenCalledWith('screen');
    listeners[0]!();
    expect(released).toHaveBeenCalled();
    handle!.release();
    expect(sentinel.release).toHaveBeenCalled();
    const refusing = createWakeLockPort({ wakeLock: { request: async () => { throw new Error('NotAllowedError'); } } });
    expect(await refusing.request(() => {})).toBeNull();
  });
});
