import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShadowingPlayer, watchdogMs, type PlayerOptions, type ShadowingItem } from '../../../src/features/shadowing/player';
import { DEFAULT_PREFERENCES, type ShadowingSettings } from '../../../src/features/shadowing/settings';
import type { WakeLockPort } from '../../../src/features/shadowing/wakeLock';
import { fakeSpeech } from '../../helpers/dom';

const items: ShadowingItem[] = [
  { id: 'dv_000000000a', word: 'die Wand', example: 'Die Wand ist weiß.' },
  { id: 'dv_000000000b', word: 'das Dach', example: 'Das Dach ist dicht.' },
  { id: 'dv_000000000c', word: 'der Balken', example: '' },
];

let settings: ShadowingSettings;
beforeEach(() => {
  vi.useFakeTimers();
  settings = { ...DEFAULT_PREFERENCES, wordRepeats: 2, exampleRepeats: 1, pauseSec: 2, rate: 0.85 };
});
afterEach(() => vi.useRealTimers());

function setup(opts: Partial<PlayerOptions> = {}, list = items) {
  const speech = fakeSpeech();
  const completed: string[] = [];
  const finished = vi.fn();
  const player = new ShadowingPlayer(list, {
    speech,
    settings: () => settings,
    onItemCompleted: (id) => completed.push(id),
    onFinished: finished,
    ...opts,
  });
  const spoken = () => vi.mocked(speech.speak).mock.calls.map((c) => c[0]);
  const snap = () => player.getSnapshot();
  /** Let the current utterance take `ms` and end normally. */
  const say = (ms = 500) => { vi.advanceTimersByTime(ms); speech.finish(); };
  return { speech, player, completed, finished, spoken, snap, say };
}

describe('shadowing player — sequencing', () => {
  it('word, pause, word, pause, example, longer pause, then the next item', () => {
    const { player, spoken, snap, say, completed } = setup();
    player.play();
    expect(snap()).toMatchObject({ status: 'playing', index: 0, step: { kind: 'speak', target: 'word', repetition: 1, of: 2 } });
    expect(spoken()).toEqual(['die Wand']);
    say();
    expect(snap().step).toMatchObject({ kind: 'pause', target: 'word' });
    expect(snap().pauseMs).toBe(2000);
    vi.advanceTimersByTime(1999);
    expect(spoken()).toHaveLength(1); // still the learner's turn
    vi.advanceTimersByTime(1);
    expect(spoken()).toEqual(['die Wand', 'die Wand']);
    expect(snap().step).toMatchObject({ kind: 'speak', target: 'word', repetition: 2 });
    say();
    vi.advanceTimersByTime(2000);
    expect(spoken().at(-1)).toBe('Die Wand ist weiß.');
    say(1500); // the sentence took 1.5 s → the pause after it is 2 s + 1.5 s
    expect(snap().pauseMs).toBe(3500);
    vi.advanceTimersByTime(3499);
    expect(snap().index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(completed).toEqual(['dv_000000000a']);
    expect(snap()).toMatchObject({ index: 1, step: { kind: 'speak', target: 'word' } });
    expect(spoken().at(-1)).toBe('das Dach');
  });

  it('repetition counts come from the settings; examples can be switched off; items without example skip it', () => {
    settings = { ...settings, wordRepeats: 3, exampleRepeats: 0 };
    const { player, spoken, say } = setup({}, [items[0]!]);
    player.play();
    for (let i = 0; i < 3; i++) { say(); vi.advanceTimersByTime(2000); }
    expect(spoken()).toEqual(['die Wand', 'die Wand', 'die Wand']);

    settings = { ...settings, wordRepeats: 1, exampleRepeats: 3 };
    const b = setup({}, [items[2]!]); // no example sentence
    b.player.play();
    b.say(); vi.advanceTimersByTime(2000);
    expect(b.spoken()).toEqual(['der Balken']);
    expect(b.snap().status).toBe('finished');
  });

  it('the speech rate is read for every utterance (changes apply from the next one)', () => {
    const { player, speech, say } = setup();
    player.play();
    settings = { ...settings, rate: 1.2 };
    say(); vi.advanceTimersByTime(2000);
    expect(vi.mocked(speech.speak).mock.calls.map((c) => c[1]?.rate)).toEqual([0.85, 1.2]);
  });

  it('finishes after the last item with a summary callback; nothing keeps running', () => {
    settings = { ...settings, wordRepeats: 1, exampleRepeats: 0 };
    const { player, snap, say, finished, completed } = setup();
    player.play();
    for (let i = 0; i < 3; i++) { say(); vi.advanceTimersByTime(2000); }
    expect(snap()).toMatchObject({ status: 'finished', endedEarly: false, completedIds: items.map((i) => i.id) });
    expect(completed).toHaveLength(3);
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('shadowing player — pause, resume, stop', () => {
  it('pause during speech cancels it; resume says that utterance again', () => {
    const { player, speech, spoken, snap } = setup();
    player.play();
    player.pause();
    expect(speech.cancel).toHaveBeenCalled();
    expect(snap()).toMatchObject({ status: 'paused', step: { kind: 'speak', repetition: 1 } });
    expect(vi.getTimerCount()).toBe(0);
    player.play();
    expect(spoken()).toEqual(['die Wand', 'die Wand']);
    expect(snap().step).toMatchObject({ kind: 'speak', repetition: 1 });
  });

  it('pause during the learner pause keeps the remaining time', () => {
    const { player, spoken, snap, say } = setup();
    player.play();
    say();
    vi.advanceTimersByTime(1500);
    player.pause();
    expect(snap()).toMatchObject({ status: 'paused', pauseMs: 2000, pauseElapsedMs: 1500 });
    vi.advanceTimersByTime(60_000); // nothing happens while paused
    expect(spoken()).toHaveLength(1);
    player.play();
    expect(snap().pauseElapsedMs).toBe(1500);
    vi.advanceTimersByTime(499);
    expect(spoken()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(spoken()).toHaveLength(2);
  });

  it('a quick pause/resume never runs two sequences at once (legacy race)', () => {
    const { player, speech, spoken, say } = setup();
    player.play();
    player.pause();
    player.play();
    player.pause();
    player.play();
    // Only one utterance is pending; finishing it advances exactly one step.
    expect(speech.speaking).toBe(true);
    say();
    vi.advanceTimersByTime(2000);
    expect(spoken().filter((t) => t === 'die Wand')).toHaveLength(4); // 3 restarts of rep 1 + rep 2
    expect(player.getSnapshot().step).toMatchObject({ kind: 'speak', repetition: 2 });
  });

  it('stop cancels speech, clears timers and rewinds to the start of the current item', () => {
    const { player, speech, snap, say } = setup();
    player.play();
    say();
    player.stop();
    expect(snap()).toMatchObject({ status: 'idle', index: 0, stepIndex: 0 });
    expect(vi.getTimerCount()).toBe(0);
    expect(speech.speaking).toBe(false);
    player.play();
    expect(snap().step).toMatchObject({ kind: 'speak', repetition: 1 });
  });

  it('stale callbacks of a cancelled utterance are ignored', () => {
    const { player, speech, snap } = setup();
    player.play();
    const firstCall = vi.mocked(speech.speak).mock.calls[0]![1]!;
    player.next();
    firstCall.onEnd?.(); // late "end" of the old utterance
    expect(snap()).toMatchObject({ index: 1, stepIndex: 0, step: { kind: 'speak' } });
  });
});

describe('shadowing player — switching items', () => {
  it('next/previous while playing cancel the current item and continue with the new one', () => {
    const { player, spoken, snap, speech } = setup();
    player.play();
    player.next();
    expect(speech.cancel).toHaveBeenCalled();
    expect(snap()).toMatchObject({ status: 'playing', index: 1 });
    expect(spoken().at(-1)).toBe('das Dach');
    player.previous();
    expect(snap().index).toBe(0);
    expect(spoken().at(-1)).toBe('die Wand');
    player.previous(); // first item: restart it
    expect(snap()).toMatchObject({ index: 0, stepIndex: 0 });
  });

  it('while idle/paused, next/previous only move (no sound until play)', () => {
    const { player, spoken, snap } = setup();
    player.next();
    expect(snap()).toMatchObject({ status: 'idle', index: 1 });
    expect(spoken()).toEqual([]);
    player.play();
    player.pause();
    player.next();
    expect(snap()).toMatchObject({ status: 'paused', index: 2 });
    expect(spoken()).toEqual(['das Dach']);
  });

  it('skipped items are not counted as practised; next on the last item ends the session', () => {
    const { player, completed, snap, finished } = setup();
    player.play();
    player.next();
    player.next();
    player.next();
    expect(snap()).toMatchObject({ status: 'finished', endedEarly: true, completedIds: [] });
    expect(completed).toEqual([]);
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('end() finishes early; controls do nothing afterwards', () => {
    const { player, snap, spoken } = setup();
    player.play();
    player.end();
    expect(snap()).toMatchObject({ status: 'finished', endedEarly: true });
    player.play(); player.next(); player.previous(); player.stop();
    expect(snap().status).toBe('finished');
    expect(spoken()).toHaveLength(1);
  });
});

describe('shadowing player — speech problems', () => {
  it('unsupported speech: does not start, explains why', () => {
    const speech = fakeSpeech(false);
    const player = new ShadowingPlayer(items, { speech, settings: () => settings });
    player.play();
    expect(player.getSnapshot()).toMatchObject({ status: 'paused', notice: 'unsupported' });
  });

  it('autoplay blocked ("not-allowed"): pauses with a notice; play again retries the same step', () => {
    const { player, speech, snap, spoken } = setup();
    player.play();
    speech.fail('not-allowed');
    expect(snap()).toMatchObject({ status: 'paused', notice: 'blocked', stepIndex: 0 });
    player.play();
    expect(spoken()).toEqual(['die Wand', 'die Wand']);
    expect(snap().notice).toBeNull();
  });

  it('a single synthesis error skips that utterance; three in a row pause the session', () => {
    const { player, speech, snap } = setup();
    player.play();
    speech.fail('synthesis-failed');
    expect(snap()).toMatchObject({ status: 'playing', step: { kind: 'pause' } });
    vi.advanceTimersByTime(2000);
    speech.fail('synthesis-failed');
    vi.advanceTimersByTime(2000);
    speech.fail('synthesis-failed');
    expect(snap()).toMatchObject({ status: 'paused', notice: 'speech-failed' });
  });

  it('a watchdog ends an utterance that never reports back', () => {
    const { player, speech, snap } = setup();
    player.play();
    vi.advanceTimersByTime(watchdogMs('die Wand', 0.85));
    expect(speech.cancel).toHaveBeenCalled();
    expect(snap().step).toMatchObject({ kind: 'pause' });
  });

  it('waits for asynchronously loading voices before the first word (bounded)', async () => {
    const speech = fakeSpeech(true, 'unknown');
    let ready!: () => void;
    speech.whenVoicesReady = vi.fn(() => new Promise<void>((r) => { ready = r; }));
    const player = new ShadowingPlayer(items, { speech, settings: () => settings, voicesTimeoutMs: 1500 });
    player.play();
    expect(speech.whenVoicesReady).toHaveBeenCalledWith(1500);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(player.getSnapshot().status).toBe('playing');
    ready();
    await Promise.resolve();
    expect(speech.speak).toHaveBeenCalledWith('die Wand', expect.anything());
  });

  it('pausing while voices load cancels the delayed start', async () => {
    const speech = fakeSpeech(true, 'unknown');
    let ready!: () => void;
    speech.whenVoicesReady = () => new Promise<void>((r) => { ready = r; });
    const player = new ShadowingPlayer(items, { speech, settings: () => settings });
    player.play();
    player.pause();
    ready();
    await Promise.resolve();
    expect(speech.speak).not.toHaveBeenCalled();
  });
});

describe('shadowing player — wake lock and disposal', () => {
  function fakeWakeLock() {
    const handles: Array<{ release: ReturnType<typeof vi.fn> }> = [];
    let onReleased: (() => void) | undefined;
    const port: WakeLockPort = {
      supported: true,
      request: vi.fn(async (cb: () => void) => { onReleased = cb; const h = { release: vi.fn() }; handles.push(h); return h; }),
    };
    return { port, handles, systemRelease: () => onReleased?.() };
  }

  it('holds a screen wake lock while playing and releases it on pause/stop/finish', async () => {
    const wl = fakeWakeLock();
    const { player, snap } = setup({ wakeLock: wl.port });
    expect(snap().wakeLock).toBe('inactive');
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(snap().wakeLock).toBe('active');
    player.pause();
    expect(wl.handles[0]!.release).toHaveBeenCalledOnce();
    expect(snap().wakeLock).toBe('inactive');
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    wl.systemRelease(); // page hidden: the browser drops the lock
    expect(snap().wakeLock).toBe('inactive');
  });

  it('a lock granted after playback already paused is released at once', async () => {
    const wl = fakeWakeLock();
    const { player, snap } = setup({ wakeLock: wl.port });
    player.play();
    player.pause();
    await Promise.resolve();
    await Promise.resolve();
    expect(wl.handles[0]!.release).toHaveBeenCalledOnce();
    expect(snap().wakeLock).toBe('inactive');
  });

  it('reports "unsupported" without a Wake Lock API and still plays', () => {
    const { player, snap, spoken } = setup({ wakeLock: { supported: false, request: async () => null } });
    player.play();
    expect(snap().wakeLock).toBe('unsupported');
    expect(spoken()).toHaveLength(1);
  });

  it('dispose cancels speech, clears timers, releases the lock and silences listeners', async () => {
    const wl = fakeWakeLock();
    const { player, speech, say } = setup({ wakeLock: wl.port });
    const listener = vi.fn();
    player.subscribe(listener);
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    say();
    player.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(wl.handles[0]!.release).toHaveBeenCalled();
    listener.mockClear();
    player.play();
    vi.advanceTimersByTime(10_000);
    expect(listener).not.toHaveBeenCalled();
    expect(speech.speaking).toBe(false);
  });
});
