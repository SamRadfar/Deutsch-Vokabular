import { describe, expect, it, vi } from 'vitest';
import { applyOutcome, type OutcomeContext } from '../../../src/features/review/outcome';

const W = 'dv_00000000aa';

function context(learnedAtStart: string[] = []) {
  const learned = new Set(learnedAtStart);
  const setLearned = vi.fn((id: string, value: boolean) => { if (value) learned.add(id); else learned.delete(id); });
  const record = vi.fn();
  const ctx: OutcomeContext = {
    learned: { isLearned: (id) => learned.has(id), setLearned },
    record,
    markedBySession: new Set(),
  };
  return { ctx, learned, setLearned, record };
}

describe('review outcome policy', () => {
  it('"know" on an unlearned word marks it learned (one progress write) and records the answer', () => {
    const { ctx, setLearned, record, learned } = context();
    applyOutcome(ctx, W, 'know', undefined);
    expect(setLearned).toHaveBeenCalledExactlyOnceWith(W, true);
    expect(record).toHaveBeenCalledExactlyOnceWith(W, 'know');
    expect(learned.has(W)).toBe(true);
  });

  it('"know" on an already learned word writes no progress (no needless Firestore write)', () => {
    const { ctx, setLearned, record } = context([W]);
    applyOutcome(ctx, W, 'know', undefined);
    expect(setLearned).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
  });

  it('"don\'t know" never removes a learned mark that existed before the session', () => {
    const { ctx, setLearned, record, learned } = context([W]);
    applyOutcome(ctx, W, 'again', undefined);
    applyOutcome(ctx, W, 'know', 'again');
    applyOutcome(ctx, W, 'again', 'know');
    expect(setLearned).not.toHaveBeenCalled();
    expect(learned.has(W)).toBe(true);
    expect(record.mock.calls.map((c) => c[1])).toEqual(['again', 'know', 'again']);
  });

  it('correcting this session’s own "know" to "don\'t know" undoes only that mark', () => {
    const { ctx, setLearned, learned } = context();
    applyOutcome(ctx, W, 'know', undefined);
    applyOutcome(ctx, W, 'again', 'know');
    expect(setLearned.mock.calls).toEqual([[W, true], [W, false]]);
    expect(learned.has(W)).toBe(false);
    expect(ctx.markedBySession.size).toBe(0);
  });

  it('the same answer twice is recorded once', () => {
    const { ctx, record, setLearned } = context();
    applyOutcome(ctx, W, 'know', undefined);
    applyOutcome(ctx, W, 'know', 'know');
    expect(record).toHaveBeenCalledOnce();
    expect(setLearned).toHaveBeenCalledOnce();
  });

  it('signed out: nothing is saved anywhere', () => {
    const ctx: OutcomeContext = { learned: null, record: null, markedBySession: new Set() };
    expect(() => applyOutcome(ctx, W, 'know', undefined)).not.toThrow();
    expect(ctx.markedBySession.size).toBe(0);
  });
});
