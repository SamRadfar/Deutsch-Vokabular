import { describe, expect, it } from 'vitest';
import { createSession, currentCard, sessionReducer, summarize, type SessionAction, type SessionState } from '../../../src/features/review/session';

const ids = ['dv_000000000a', 'dv_000000000b', 'dv_000000000c'];
const run = (state: SessionState, ...actions: SessionAction[]) => actions.reduce(sessionReducer, state);
const know = { type: 'answer', result: 'know' } as const;
const again = { type: 'answer', result: 'again' } as const;

describe('flashcard session state', () => {
  it('starts on the first card, front side up, nothing answered', () => {
    const s = createSession(ids);
    expect(s).toEqual({ cards: ids, index: 0, flipped: false, answers: {}, finished: false });
    expect(currentCard(s)).toBe(ids[0]);
  });

  it('copies the deck (later changes to the caller’s array do not leak in)', () => {
    const deck = [...ids];
    const s = createSession(deck);
    deck.pop();
    expect(s.cards).toHaveLength(3);
  });

  it('an empty deck is finished immediately', () => {
    expect(createSession([]).finished).toBe(true);
  });

  it('flip toggles the side; moving to another card shows its front', () => {
    let s = run(createSession(ids), { type: 'flip' });
    expect(s.flipped).toBe(true);
    s = run(s, { type: 'next' });
    expect([s.index, s.flipped]).toEqual([1, false]);
    s = run(s, { type: 'flip' }, { type: 'previous' });
    expect([s.index, s.flipped]).toEqual([0, false]);
  });

  it('next and previous stop at the ends', () => {
    expect(run(createSession(ids), { type: 'previous' }).index).toBe(0);
    expect(run(createSession(ids), { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' }).index).toBe(2);
  });

  it('an answer is stored for the current card and advances', () => {
    const s = run(createSession(ids), { type: 'flip' }, know);
    expect(s.answers).toEqual({ [ids[0]!]: 'know' });
    expect([s.index, s.flipped, s.finished]).toEqual([1, false, false]);
  });

  it('answering every card finishes the session', () => {
    const s = run(createSession(ids), know, again, know);
    expect(s.finished).toBe(true);
    expect(currentCard(s)).toBeUndefined();
  });

  it('skipped cards come back before the session finishes', () => {
    // skip card 0, answer 1 and 2 → back to 0
    let s = run(createSession(ids), { type: 'next' }, know, know);
    expect([s.finished, s.index]).toEqual([false, 0]);
    s = run(s, again);
    expect(s.finished).toBe(true);
    expect(s.answers[ids[0]!]).toBe('again');
  });

  it('going back and answering again replaces the earlier answer (no double counting)', () => {
    let s = run(createSession(ids), know, { type: 'previous' });
    expect(s.index).toBe(0);
    s = run(s, again);
    expect(s.answers).toEqual({ [ids[0]!]: 'again' });
    expect(s.index).toBe(1);
    expect(summarize(s)).toMatchObject({ known: 0, again: 1, unanswered: 2 });
  });

  it('End Session finishes early; further actions do nothing', () => {
    const s = run(createSession(ids), know, { type: 'end' });
    expect(s.finished).toBe(true);
    expect(run(s, know, { type: 'next' }, { type: 'flip' })).toBe(s);
    expect(summarize(s)).toEqual({ total: 3, known: 1, again: 0, unanswered: 2, percent: 100, againIds: [] });
  });

  it('summary: counts, percentage of answered cards, unknown cards in session order', () => {
    const s = run(createSession(ids), again, know, again);
    expect(summarize(s)).toEqual({ total: 3, known: 1, again: 2, unanswered: 0, percent: 33, againIds: [ids[0], ids[2]] });
    expect(summarize(createSession(ids)).percent).toBe(0);
  });

  it('restart = a new session: no answer, position, side or finished flag survives (legacy V3)', () => {
    const finished = run(createSession(ids), { type: 'flip' }, again, know, again);
    expect(finished.finished).toBe(true);
    const restarted = createSession(finished.cards);
    expect(restarted).toEqual({ cards: ids, index: 0, flipped: false, answers: {}, finished: false });
  });

  it('repeating the unknown cards shows exactly those cards again and they can be answered', () => {
    const first = run(createSession(ids), again, know, again);
    const repeat = createSession(summarize(first).againIds);
    expect(repeat.cards).toEqual([ids[0], ids[2]]);
    expect(currentCard(repeat)).toBe(ids[0]);
    const done = run(repeat, know, know);
    expect(summarize(done)).toMatchObject({ total: 2, known: 2, again: 0, percent: 100 });
  });
});
