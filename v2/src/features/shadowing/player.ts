// Shadowing playback engine (pure TypeScript: speech, timers, clock and wake lock are injected).
//
// Correctness rules (the legacy loop broke all of them, see docs/SHADOWING_DESIGN.md §2):
//  - Exactly one thing runs at a time: one utterance OR one timer. Every transition increments a
//    generation counter; callbacks of an older generation (a cancelled utterance reporting
//    "interrupted", a cleared timer, a late wake-lock grant) are ignored. No overlapping speech,
//    no second loop after a quick pause/resume or skip.
//  - pause() during speech re-speaks that utterance on resume; pause() during a learner pause
//    resumes the remaining time.
//  - Every exit path (pause, stop, next/previous, end, dispose) cancels speech, clears the timer and
//    releases the wake lock. dispose() also drops all listeners.
//  - Speech errors never stall a session: a watchdog ends utterances that never report back;
//    "not-allowed" (autoplay policy) pauses with a message; three failures in a row pause.

import type { WordId } from '../../models/vocabulary';
import type { SpeechService } from '../pronunciation/speechService';
import { pauseDuration, planItem, type Step } from './plan';
import type { ShadowingSettings } from './settings';
import type { WakeLockHandle, WakeLockPort } from './wakeLock';

export interface ShadowingItem {
  id: WordId;
  word: string;
  example: string;
}

export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'finished';

/** Why playback paused by itself (mapped to Persian text by the UI). */
export type PlayerNotice = 'background' | 'left' | 'blocked' | 'speech-failed' | 'unsupported';

export interface PlayerSnapshot {
  readonly status: PlayerStatus;
  readonly index: number;
  readonly total: number;
  readonly stepIndex: number;
  readonly steps: readonly Step[];
  /** Current step (null when finished or before the first item). */
  readonly step: Step | null;
  /** An utterance is currently audible (between onstart and onend). */
  readonly speaking: boolean;
  /** Full length of the current learner pause (null when the current step is not a pause). */
  readonly pauseMs: number | null;
  /** How much of it had passed when it (re)started or was paused — drives the countdown bar. */
  readonly pauseElapsedMs: number;
  readonly completedIds: readonly WordId[];
  readonly notice: PlayerNotice | null;
  readonly wakeLock: 'active' | 'inactive' | 'unsupported';
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** Finished with "end session" before every item was played. */
  readonly endedEarly: boolean;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface PlayerOptions {
  speech: SpeechService;
  /** Read at every step, so rate changes apply from the next utterance and repeats from the next item. */
  settings: () => ShadowingSettings;
  timers?: Timers;
  now?: () => number;
  wakeLock?: WakeLockPort;
  onItemCompleted?: (id: WordId) => void;
  onFinished?: (snapshot: PlayerSnapshot) => void;
  /** How long a session start may wait for asynchronously loading voices. */
  voicesTimeoutMs?: number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** No onend after this long → the utterance is considered failed (some engines never report). */
export function watchdogMs(text: string, rate: number): number {
  return Math.max(4000, Math.round((text.length * 180) / Math.max(rate, 0.1)) + 3000);
}

const MAX_FAILURES = 3;

export class ShadowingPlayer {
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private gen = 0;
  private timer: unknown = null;
  private status: PlayerStatus = 'idle';
  private index = 0;
  private stepIndex = 0;
  private steps: Step[] = [];
  private speaking = false;
  private utterancePending = false;
  private speechStartedAt = 0;
  private lastSpeechMs = 0;
  /** Full length of the current pause step; kept across pause/resume. */
  private pauseFull: number | null = null;
  private pauseStartedAt = 0;
  private pauseElapsedAtStart = 0;
  /** Remaining pause time while paused (null = the step restarts from the beginning). */
  private pauseLeft: number | null = null;
  private failures = 0;
  private completedIds: WordId[] = [];
  private notice: PlayerNotice | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private endedEarly = false;
  private wake: WakeLockHandle | null = null;
  private wakeGen = 0;
  private wakeState: PlayerSnapshot['wakeLock'];
  private disposed = false;
  private snapshot: PlayerSnapshot;

  constructor(private readonly items: readonly ShadowingItem[], private readonly o: PlayerOptions) {
    this.timers = o.timers ?? defaultTimers;
    this.now = o.now ?? Date.now;
    this.wakeState = o.wakeLock?.supported ? 'inactive' : 'unsupported';
    this.steps = this.planFor(0);
    this.snapshot = this.build();
  }

  // ── observation ──────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  // ── controls ─────────────────────────────────────────────────────────────

  /** Start, or resume after a pause / stop. Call it from a user gesture (autoplay policies). */
  play(): void {
    if (this.disposed || this.status === 'playing' || this.status === 'finished') return;
    if (!this.items.length) { this.finish(false); return; }
    if (!this.o.speech.supported) { this.notice = 'unsupported'; this.status = 'paused'; this.emit(); return; }
    this.status = 'playing';
    this.notice = null;
    this.failures = 0;
    this.startedAt ??= this.now();
    this.acquireWakeLock();
    const g = ++this.gen;
    if (this.o.speech.germanVoice() === 'unknown') {
      // Voices still loading (Chrome): wait briefly so the first word is not read by a default voice.
      this.emit();
      void this.o.speech.whenVoicesReady(this.o.voicesTimeoutMs ?? 1500).then(() => { if (g === this.gen) this.runStep(); });
      return;
    }
    this.runStep();
  }

  pause(notice: PlayerNotice | null = null): void {
    if (this.status !== 'playing') return;
    const step = this.steps[this.stepIndex];
    this.pauseLeft = step?.kind === 'pause' && this.pauseFull !== null && this.timer !== null
      ? Math.max(0, this.pauseFull - this.pauseElapsedAtStart - (this.now() - this.pauseStartedAt))
      : null;
    this.halt();
    this.status = 'paused';
    this.notice = notice;
    this.releaseWakeLock();
    this.emit();
  }

  /** Stops playback and rewinds to the beginning of the current item. */
  stop(): void {
    if (this.status === 'finished') return;
    this.halt();
    this.stepIndex = 0;
    this.pauseLeft = null;
    this.pauseFull = null;
    this.status = 'idle';
    this.notice = null;
    this.releaseWakeLock();
    this.emit();
  }

  next(): void {
    if (this.status === 'finished') return;
    if (this.index >= this.items.length - 1) { this.end(); return; }
    this.moveTo(this.index + 1);
  }

  /** Previous item; on the first item it restarts that item. */
  previous(): void {
    if (this.status === 'finished') return;
    this.moveTo(Math.max(0, this.index - 1));
  }

  /** Ends the session now (summary). */
  end(): void {
    if (this.status === 'finished') return;
    this.finish(this.completedIds.length < this.items.length);
  }

  /** Releases everything; the player is unusable afterwards (component unmount). */
  dispose(): void {
    if (this.disposed) return;
    this.halt();
    this.releaseWakeLock();
    this.disposed = true;
    this.listeners.clear();
  }

  // ── engine ───────────────────────────────────────────────────────────────

  private planFor(index: number): Step[] {
    const item = this.items[index];
    return item ? planItem(item, this.o.settings()) : [];
  }

  private moveTo(index: number) {
    const wasPlaying = this.status === 'playing';
    this.halt();
    this.index = index;
    this.stepIndex = 0;
    this.pauseLeft = null;
    this.pauseFull = null;
    this.steps = this.planFor(index);
    if (wasPlaying) { this.gen++; this.runStep(); } else this.emit();
  }

  /** Cancels whatever runs; afterwards no callback of the current generation can fire. */
  private halt() {
    this.gen++;
    this.clearTimer();
    if (this.utterancePending) this.o.speech.cancel();
    this.utterancePending = false;
    this.speaking = false;
  }

  private clearTimer() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private runStep(): void {
    if (this.disposed || this.status !== 'playing') return;
    const step = this.steps[this.stepIndex];
    if (!step) { this.completeItem(); return; }
    const g = ++this.gen;
    if (step.kind === 'pause') {
      let ms: number;
      if (this.pauseLeft !== null && this.pauseFull !== null) { // resume
        ms = this.pauseLeft;
        this.pauseElapsedAtStart = this.pauseFull - this.pauseLeft;
      } else {
        this.pauseFull = pauseDuration(step, this.lastSpeechMs);
        ms = this.pauseFull;
        this.pauseElapsedAtStart = 0;
      }
      this.pauseLeft = null;
      this.pauseStartedAt = this.now();
      this.timer = this.timers.setTimeout(() => {
        if (g !== this.gen) return;
        this.timer = null;
        this.pauseFull = null;
        this.stepIndex++;
        this.runStep();
      }, ms);
      this.emit();
      return;
    }
    this.pauseLeft = null;
    this.pauseFull = null;
    const rate = this.o.settings().rate;
    let error: string | null = null;
    this.utterancePending = true;
    this.speechStartedAt = this.now();
    this.timer = this.timers.setTimeout(() => {
      if (g !== this.gen) return;
      this.timer = null;
      this.gen++; // the cancelled utterance's callbacks are now stale
      this.o.speech.cancel();
      this.utterancePending = false;
      this.afterSpeech('timeout');
    }, watchdogMs(step.text, rate));
    this.emit();
    this.o.speech.speak(step.text, {
      rate,
      onStart: () => {
        if (g !== this.gen) return;
        this.speaking = true;
        this.speechStartedAt = this.now();
        this.emit();
      },
      onError: (code) => { if (g === this.gen) error = code; },
      onEnd: () => {
        if (g !== this.gen) return;
        this.clearTimer();
        this.utterancePending = false;
        this.afterSpeech(error);
      },
    });
  }

  private afterSpeech(error: string | null) {
    this.speaking = false;
    if (error === 'not-allowed') { this.pause('blocked'); return; }
    if (error) {
      this.failures++;
      if (this.failures >= MAX_FAILURES) { this.pause('speech-failed'); return; }
      this.lastSpeechMs = 0;
    } else {
      this.failures = 0;
      this.lastSpeechMs = this.now() - this.speechStartedAt;
    }
    this.stepIndex++;
    this.runStep();
  }

  private completeItem() {
    const item = this.items[this.index];
    if (item) {
      this.completedIds = [...this.completedIds, item.id];
      this.o.onItemCompleted?.(item.id);
    }
    if (this.index >= this.items.length - 1) { this.finish(false); return; }
    this.index++;
    this.stepIndex = 0;
    this.steps = this.planFor(this.index);
    this.runStep();
  }

  private finish(early: boolean) {
    this.halt();
    this.status = 'finished';
    this.endedEarly = early;
    this.finishedAt = this.now();
    this.releaseWakeLock();
    this.emit();
    this.o.onFinished?.(this.snapshot);
  }

  // ── wake lock ────────────────────────────────────────────────────────────

  private acquireWakeLock() {
    const port = this.o.wakeLock;
    if (!port?.supported || this.wake) return;
    const g = ++this.wakeGen;
    void port.request(() => {
      if (g !== this.wakeGen) return;
      this.wake = null; // released by the browser (page hidden)
      this.wakeState = 'inactive';
      this.emit();
    }).then((handle) => {
      if (!handle) return;
      if (g !== this.wakeGen || this.status !== 'playing' || this.disposed) { handle.release(); return; }
      this.wake = handle;
      this.wakeState = 'active';
      this.emit();
    });
  }

  private releaseWakeLock() {
    this.wakeGen++;
    this.wake?.release();
    this.wake = null;
    if (this.wakeState === 'active') this.wakeState = 'inactive';
  }

  // ── snapshot ─────────────────────────────────────────────────────────────

  private emit() {
    if (this.disposed) return;
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): PlayerSnapshot {
    const step = this.status === 'finished' ? null : this.steps[this.stepIndex] ?? null;
    return {
      status: this.status,
      index: this.index,
      total: this.items.length,
      stepIndex: this.stepIndex,
      steps: this.steps,
      step,
      speaking: this.speaking,
      pauseMs: step?.kind === 'pause' ? this.pauseFull : null,
      pauseElapsedMs: this.status === 'paused' && this.pauseFull !== null && this.pauseLeft !== null
        ? this.pauseFull - this.pauseLeft : this.pauseElapsedAtStart,
      completedIds: this.completedIds,
      notice: this.notice,
      wakeLock: this.wakeState,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      endedEarly: this.endedEarly,
    };
  }
}
