// What the session is doing right now, in words (shared by the session screen and the floating card).

import type { PlayerSnapshot } from './player';
import type { Lang, Step, StepTarget } from './plan';

export type PhaseKind = 'listen' | 'turn' | 'gap' | 'paused' | 'idle';

export interface Phase {
  kind: PhaseKind;
  /** Language being spoken (speak steps only). */
  lang: Lang | null;
  text: string;
}

export const TARGET_TEXT: Record<StepTarget, string> = {
  word: 'واژه',
  meaning: 'معنی فارسی',
  example: 'جمله',
  exampleFa: 'ترجمهٔ فارسی جمله',
};

export const LANG_BADGE: Record<Lang, string> = { de: 'DE', fa: 'FA' };

const count = (step: Step) => (step.of > 1 ? ` (${step.repetition} از ${step.of})` : '');
const cycle = (step: Step) => (step.kind === 'speak' && step.cycles && step.cycles > 1 && step.target === 'meaning' ? ` · دور ${step.cycle} از ${step.cycles}` : '');

export function describePhase(snap: PlayerSnapshot): Phase {
  const step = snap.step;
  if (snap.status === 'idle') return { kind: 'idle', lang: null, text: 'آماده — برای شروع روی پخش بزنید' };
  if (snap.status === 'paused') return { kind: 'paused', lang: null, text: 'متوقف شده' };
  if (!step) return { kind: 'idle', lang: null, text: '' };
  if (step.kind === 'speak') {
    return { kind: 'listen', lang: step.lang, text: `گوش کن: ${TARGET_TEXT[step.target]}${count(step)}${cycle(step)}` };
  }
  if (step.purpose === 'gap') return { kind: 'gap', lang: null, text: 'مکث کوتاه…' };
  const what = step.target === 'word' ? 'واژه' : step.target === 'exampleFa' ? 'ترجمه' : 'جمله';
  return { kind: 'turn', lang: null, text: `حالا تو ${what} را بلند تکرار کن${count(step)}` };
}

/** The text that is being spoken right now (for highlighting), or null. */
export function speakingTarget(snap: PlayerSnapshot): StepTarget | null {
  return snap.status === 'playing' && snap.step?.kind === 'speak' ? snap.step.target : null;
}

/** A learner pause with a visible countdown ("your turn"). */
export function isYourTurn(snap: PlayerSnapshot): boolean {
  return snap.step?.kind === 'pause' && snap.step.purpose === 'learner' && snap.pauseMs !== null && snap.status !== 'idle';
}
