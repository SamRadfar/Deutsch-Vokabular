// The practice sequence for one vocabulary item (pure). Bilingual order (v2.0.2):
//
//   word cycle × wordRepeats:
//     German word → [German→Persian delay] → Persian meaning × faMeaningRepeats → learner pause
//   German example × exampleRepeats (each followed by a learner pause, extended by the sentence length)
//   [German→Persian delay] → Persian example translation × faExampleRepeats → learner pause
//
// The examples come only after ALL word cycles. Persian parts are skipped when their count is 0,
// when the text is empty, or when no Persian voice is available (`persian: false`). With
// pauseSec = 0 there are no learner pauses at all (back-to-back playback).

import type { ShadowingSettings } from './settings';

export type Lang = 'de' | 'fa';
/** What is spoken: the German word, its Persian meaning, the German example, its Persian translation. */
export type StepTarget = 'word' | 'meaning' | 'example' | 'exampleFa';

export type Step =
  | {
    kind: 'speak'; target: StepTarget; lang: Lang; text: string;
    /** Repetition of THIS text within its block (e.g. the 2nd Persian meaning after one German word). */
    repetition: number; of: number;
    /** Word cycle (German word + its Persian meanings): 1-based cycle index and total, for word/meaning steps. */
    cycle?: number; cycles?: number;
  }
  | {
    kind: 'pause'; target: StepTarget;
    /** 'learner' = the learner repeats aloud ("your turn"); 'gap' = the short German→Persian delay. */
    purpose: 'learner' | 'gap';
    repetition: number; of: number; baseMs: number; extendBySpeech: boolean;
  };

export interface ShadowingText {
  /** German word including its article (the article is part of what is learned). */
  word: string;
  /** German example sentence; empty = none. */
  example: string;
  /** Persian meaning and example translation (empty = none). */
  fa?: string;
  exampleFa?: string;
}

/** The Persian settings are optional: left out = German only (and no German→Persian delay). */
export type PlanSettings = Pick<ShadowingSettings, 'wordRepeats' | 'exampleRepeats' | 'pauseSec'>
  & Partial<Pick<ShadowingSettings, 'faMeaningRepeats' | 'faExample' | 'faExampleRepeats' | 'deFaDelaySec'>>;

/** Pause between two Persian repetitions of the same text (so they do not run together). */
export const FA_REPEAT_GAP_MS = 400;

export function planItem(item: ShadowingText, s: PlanSettings, opts: { persian?: boolean } = {}): Step[] {
  const persian = opts.persian ?? true;
  const steps: Step[] = [];
  const learnerMs = Math.round(s.pauseSec * 1000);
  const delayMs = Math.round((s.deFaDelaySec ?? 0) * 1000);
  const learner = (target: StepTarget, repetition: number, of: number, extendBySpeech: boolean) => {
    if (learnerMs > 0) steps.push({ kind: 'pause', purpose: 'learner', target, repetition, of, baseMs: learnerMs, extendBySpeech });
  };
  const gap = (target: StepTarget, ms: number) => {
    if (ms > 0) steps.push({ kind: 'pause', purpose: 'gap', target, repetition: 1, of: 1, baseMs: ms, extendBySpeech: false });
  };
  const persianBlock = (target: 'meaning' | 'exampleFa', text: string, times: number, extra: { cycle?: number; cycles?: number } = {}) => {
    gap(target, delayMs);
    for (let k = 1; k <= times; k++) {
      if (k > 1) gap(target, FA_REPEAT_GAP_MS);
      steps.push({ kind: 'speak', target, lang: 'fa', text, repetition: k, of: times, ...extra });
    }
  };

  const fa = (item.fa ?? '').trim();
  const meanings = persian && fa ? Math.max(0, s.faMeaningRepeats ?? 0) : 0;
  const cycles = Math.max(1, s.wordRepeats);
  for (let r = 1; r <= cycles; r++) {
    steps.push({ kind: 'speak', target: 'word', lang: 'de', text: item.word, repetition: r, of: cycles, cycle: r, cycles });
    if (meanings) persianBlock('meaning', fa, meanings, { cycle: r, cycles });
    learner('word', r, cycles, false);
  }

  if (item.example.trim()) {
    const examples = Math.max(0, s.exampleRepeats);
    for (let e = 1; e <= examples; e++) {
      steps.push({ kind: 'speak', target: 'example', lang: 'de', text: item.example, repetition: e, of: examples });
      learner('example', e, examples, true);
    }
    const exFa = (item.exampleFa ?? '').trim();
    const faTimes = persian && s.faExample && exFa ? Math.max(0, s.faExampleRepeats ?? 0) : 0;
    if (examples > 0 && faTimes > 0) {
      persianBlock('exampleFa', exFa, faTimes);
      learner('exampleFa', 1, 1, false);
    }
  }
  return steps;
}

/** Upper bound for one pause step (a long sentence must not stall the session). */
export const MAX_PAUSE_MS = 15_000;

export function pauseDuration(step: Extract<Step, { kind: 'pause' }>, lastSpeechMs: number): number {
  return Math.min(step.baseMs + (step.extendBySpeech ? Math.max(0, lastSpeechMs) : 0), MAX_PAUSE_MS);
}

/** Whether the settings ask for any Persian speech (→ the Persian voice is needed). */
export function wantsPersian(s: Pick<ShadowingSettings, 'faMeaningRepeats' | 'faExample' | 'faExampleRepeats' | 'exampleRepeats'>): boolean {
  return s.faMeaningRepeats > 0 || (s.faExample && s.faExampleRepeats > 0 && s.exampleRepeats > 0);
}
