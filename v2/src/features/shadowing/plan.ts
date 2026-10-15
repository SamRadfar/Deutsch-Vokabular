// The practice sequence for one vocabulary item (pure):
//   word × wordRepeats, each followed by a pause to repeat it aloud, then
//   example × exampleRepeats, each followed by a longer pause (extended by the time the sentence
//   took to say, so there is enough time to shadow it).

import type { ShadowingSettings } from './settings';

export type StepTarget = 'word' | 'example';

export type Step =
  | { kind: 'speak'; target: StepTarget; text: string; repetition: number; of: number }
  | { kind: 'pause'; target: StepTarget; repetition: number; of: number; baseMs: number; extendBySpeech: boolean };

export interface ShadowingText {
  /** German word including its article (the article is part of what is learned). */
  word: string;
  /** German example sentence; empty = none. */
  example: string;
}

export function planItem(item: ShadowingText, s: Pick<ShadowingSettings, 'wordRepeats' | 'exampleRepeats' | 'pauseSec'>): Step[] {
  const steps: Step[] = [];
  const baseMs = Math.round(s.pauseSec * 1000);
  const block = (target: StepTarget, text: string, times: number) => {
    for (let r = 1; r <= times; r++) {
      steps.push({ kind: 'speak', target, text, repetition: r, of: times });
      steps.push({ kind: 'pause', target, repetition: r, of: times, baseMs, extendBySpeech: target === 'example' });
    }
  };
  block('word', item.word, Math.max(1, s.wordRepeats));
  if (item.example.trim()) block('example', item.example, Math.max(0, s.exampleRepeats));
  return steps;
}

/** Upper bound for one pause step (a long sentence must not stall the session). */
export const MAX_PAUSE_MS = 15_000;

export function pauseDuration(step: Extract<Step, { kind: 'pause' }>, lastSpeechMs: number): number {
  return Math.min(step.baseMs + (step.extendBySpeech ? Math.max(0, lastSpeechMs) : 0), MAX_PAUSE_MS);
}
