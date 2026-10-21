// Bilingual shadowing (German + Persian): the exact playback order, the live player with two voices,
// the prepared (lock-screen) audio file and the settings preview. Real audible output is checked
// separately (scripts/audio-check.mjs, devices); these tests pin down the ORDER and the timing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planItem, wantsPersian, type Step } from '../../../src/features/shadowing/plan';
import { ShadowingPlayer, type ShadowingItem } from '../../../src/features/shadowing/player';
import { renderSession, type Synthesizer } from '../../../src/features/shadowing/audioSession/render';
import { DEFAULT_PREFERENCES, sanitizePreferences, type ShadowingPreferences } from '../../../src/features/shadowing/settings';
import { previewLines } from '../../../src/features/shadowing/components/SequenceSettings';
import { fakeSpeech } from '../../helpers/dom';

const WAND = {
  word: 'die Außenwand', fa: 'دیوار خارجی',
  example: 'Die Außenwand muss gut gedämmt sein.', exampleFa: 'دیوار خارجی باید به‌خوبی عایق‌بندی شود.',
};
/** The owner's acceptance example. */
const ACCEPT: ShadowingPreferences = {
  ...DEFAULT_PREFERENCES, wordRepeats: 3, faMeaningRepeats: 1, exampleRepeats: 2, faExample: true, faExampleRepeats: 1, deFaDelaySec: 1, pauseSec: 0,
};

const describeSteps = (steps: Step[]) => steps.map((s) => (s.kind === 'speak' ? `${s.lang}:${s.text}` : `pause ${s.baseMs}${s.purpose === 'learner' ? ' (you)' : ''}`));

describe('exact playback order', () => {
  it('acceptance: DE→(1 s)→FA three times, then the German example twice, then the Persian example once', () => {
    expect(describeSteps(planItem(WAND, ACCEPT))).toEqual([
      'de:die Außenwand', 'pause 1000', 'fa:دیوار خارجی',
      'de:die Außenwand', 'pause 1000', 'fa:دیوار خارجی',
      'de:die Außenwand', 'pause 1000', 'fa:دیوار خارجی',
      'de:Die Außenwand muss gut gedämmt sein.',
      'de:Die Außenwand muss gut gedämmt sein.',
      'pause 1000', 'fa:دیوار خارجی باید به‌خوبی عایق‌بندی شود.',
    ]);
  });

  it('the learner pause (your turn) follows each word cycle and each example — never between German and Persian', () => {
    const steps = describeSteps(planItem(WAND, { ...ACCEPT, wordRepeats: 2, exampleRepeats: 1, pauseSec: 3 }));
    expect(steps).toEqual([
      'de:die Außenwand', 'pause 1000', 'fa:دیوار خارجی', 'pause 3000 (you)',
      'de:die Außenwand', 'pause 1000', 'fa:دیوار خارجی', 'pause 3000 (you)',
      'de:Die Außenwand muss gut gedämmt sein.', 'pause 3000 (you)',
      'pause 1000', 'fa:دیوار خارجی باید به‌خوبی عایق‌بندی شود.', 'pause 3000 (you)',
    ]);
  });

  it('Persian meaning × 2 after EACH German word (not in total); a short gap between the two', () => {
    const steps = describeSteps(planItem(WAND, { ...ACCEPT, wordRepeats: 2, faMeaningRepeats: 2, exampleRepeats: 0, deFaDelaySec: 0.5 }));
    expect(steps).toEqual([
      'de:die Außenwand', 'pause 500', 'fa:دیوار خارجی', 'pause 400', 'fa:دیوار خارجی',
      'de:die Außenwand', 'pause 500', 'fa:دیوار خارجی', 'pause 400', 'fa:دیوار خارجی',
    ]);
  });

  it('0 = off: no Persian meaning, no examples, no Persian example; no delay without Persian', () => {
    expect(describeSteps(planItem(WAND, { ...ACCEPT, faMeaningRepeats: 0, exampleRepeats: 0 }))).toEqual(['de:die Außenwand', 'de:die Außenwand', 'de:die Außenwand']);
    const noFaEx = describeSteps(planItem(WAND, { ...ACCEPT, wordRepeats: 1, faMeaningRepeats: 0, faExample: false }));
    expect(noFaEx).toEqual(['de:die Außenwand', 'de:Die Außenwand muss gut gedämmt sein.', 'de:Die Außenwand muss gut gedämmt sein.']);
    expect(describeSteps(planItem(WAND, { ...ACCEPT, wordRepeats: 1, faExampleRepeats: 0 })).filter((s) => s.includes('عایق'))).toEqual([]);
    expect(describeSteps(planItem(WAND, { ...ACCEPT, deFaDelaySec: 0, wordRepeats: 1, exampleRepeats: 0 }))).toEqual(['de:die Außenwand', 'fa:دیوار خارجی']);
  });

  it('no Persian voice or no Persian text → German only, the German order is unchanged', () => {
    const german = describeSteps(planItem(WAND, ACCEPT, { persian: false }));
    expect(german.every((s) => s.startsWith('de:'))).toBe(true);
    expect(german).toHaveLength(5);
    expect(describeSteps(planItem({ ...WAND, fa: '', exampleFa: '' }, ACCEPT)).every((s) => s.startsWith('de:'))).toBe(true);
  });

  it('settings: ranges 1–10 / 0–5 / 0–10 / 0–5, delays 0–3 s; out of range falls back', () => {
    const ok = sanitizePreferences({ wordRepeats: 10, faMeaningRepeats: 5, exampleRepeats: 10, faExample: true, faExampleRepeats: 5, deFaDelaySec: 0.5, pauseSec: 0, faRate: 0.7 });
    expect(ok).toMatchObject({ wordRepeats: 10, faMeaningRepeats: 5, exampleRepeats: 10, faExample: true, faExampleRepeats: 5, deFaDelaySec: 0.5, pauseSec: 0, faRate: 0.7 });
    const bad = sanitizePreferences({ wordRepeats: 11, faMeaningRepeats: 6, exampleRepeats: -1, faExample: 'yes', faExampleRepeats: 9, deFaDelaySec: 4 });
    expect(bad).toMatchObject({ wordRepeats: 2, faMeaningRepeats: 0, exampleRepeats: 1, faExample: false, faExampleRepeats: 1, deFaDelaySec: 1 });
    expect(wantsPersian(DEFAULT_PREFERENCES)).toBe(false); // existing users keep German-only sessions
    expect(wantsPersian(ACCEPT)).toBe(true);
  });

  it('the settings preview is built from the same plan and updates with every setting', () => {
    const text = (p: ShadowingPreferences) => previewLines(p).map((l) => (l.kind === 'next' ? 'NEXT' : l.parts.join(' → ')));
    expect(text(ACCEPT)).toEqual([
      'DE واژه → ⏱ 1 ثانیه → FA معنی',
      'DE واژه → ⏱ 1 ثانیه → FA معنی',
      'DE واژه → ⏱ 1 ثانیه → FA معنی',
      'DE مثال × 2',
      '⏱ 1 ثانیه → FA ترجمهٔ مثال',
      'NEXT',
    ]);
    expect(text({ ...ACCEPT, wordRepeats: 1, faMeaningRepeats: 2, exampleRepeats: 0 })).toEqual(['DE واژه → ⏱ 1 ثانیه → FA معنی × 2', 'NEXT']);
  });
});

describe('live player with two voices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('speaks each step with its voice in order, one at a time, and waits for each to finish', () => {
    const de = fakeSpeech();
    const fa = { ...fakeSpeech(), prefetch: vi.fn() };
    /** Both voices' calls, in the order they happened. */
    const order = () => [
      ...vi.mocked(de.speak).mock.calls.map((c, i) => [vi.mocked(de.speak).mock.invocationCallOrder[i]!, `de:${c[0]}`] as const),
      ...vi.mocked(fa.speak).mock.calls.map((c, i) => [vi.mocked(fa.speak).mock.invocationCallOrder[i]!, `fa:${c[0]}`] as const),
    ].sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const items: ShadowingItem[] = [{ id: 'dv_00000000a1', ...WAND }, { id: 'dv_00000000a2', word: 'das Dach', fa: 'سقف', example: '', exampleFa: '' }];
    const done = vi.fn();
    const player = new ShadowingPlayer(items, { speech: de, persian: fa, settings: () => ACCEPT, onFinished: done });
    player.play();
    // Drive the session: finish whichever engine is speaking; let pauses run.
    for (let i = 0; i < 60 && player.getSnapshot().status === 'playing'; i++) {
      const s = player.getSnapshot();
      if (s.step?.kind === 'speak') {
        expect(de.speaking && fa.speaking).toBe(false); // never two voices at once
        vi.advanceTimersByTime(300);
        (s.step.lang === 'fa' ? fa : de).finish();
      } else vi.advanceTimersByTime(s.pauseMs ?? 1000);
    }
    expect(order()).toEqual([
      'de:die Außenwand', 'fa:دیوار خارجی', 'de:die Außenwand', 'fa:دیوار خارجی', 'de:die Außenwand', 'fa:دیوار خارجی',
      'de:Die Außenwand muss gut gedämmt sein.', 'de:Die Außenwand muss gut gedämmt sein.', 'fa:دیوار خارجی باید به‌خوبی عایق‌بندی شود.',
      'de:das Dach', 'fa:سقف', 'de:das Dach', 'fa:سقف', 'de:das Dach', 'fa:سقف',
    ]);
    expect(done).toHaveBeenCalledOnce();
    // Persian clips of the current and the next item were prepared ahead.
    expect(fa.prefetch).toHaveBeenCalledWith(expect.arrayContaining(['دیوار خارجی', 'سقف']), ACCEPT.faRate);
    // The Persian speed applies to Persian, the German speed to German.
    expect(vi.mocked(fa.speak).mock.calls[0]![1]).toMatchObject({ rate: ACCEPT.faRate, lang: 'fa-IR' });
    expect(vi.mocked(de.speak).mock.calls[0]![1]).toMatchObject({ rate: ACCEPT.rate, lang: 'de-DE' });
  });

  it('pause during Persian, resume re-speaks that Persian part; stop cancels the Persian voice', () => {
    const de = fakeSpeech();
    const fa = fakeSpeech();
    const player = new ShadowingPlayer([{ id: 'dv_00000000a1', ...WAND }], { speech: de, persian: fa, settings: () => ACCEPT });
    player.play();
    de.finish();
    vi.advanceTimersByTime(1000); // German→Persian delay
    expect(player.getSnapshot().step).toMatchObject({ kind: 'speak', lang: 'fa', target: 'meaning', cycle: 1, cycles: 3 });
    player.pause();
    expect(fa.cancel).toHaveBeenCalled();
    player.play();
    expect(vi.mocked(fa.speak).mock.calls.map((c) => c[0])).toEqual(['دیوار خارجی', 'دیوار خارجی']);
    player.stop();
    expect(player.getSnapshot()).toMatchObject({ status: 'idle', stepIndex: 0 });
  });

  it('without a Persian voice the session plays German only (no stall)', () => {
    const de = fakeSpeech();
    const player = new ShadowingPlayer([{ id: 'dv_00000000a1', ...WAND }], { speech: de, persian: null, settings: () => ACCEPT });
    player.play();
    for (let i = 0; i < 10 && player.getSnapshot().status === 'playing'; i++) { de.finish(); vi.advanceTimersByTime(5000); }
    expect(vi.mocked(de.speak).mock.calls.map((c) => c[0])).toEqual(['die Außenwand', 'die Außenwand', 'die Außenwand', WAND.example, WAND.example]);
  });
});

describe('prepared (lock-screen) audio with two voices', () => {
  const SR = 1000;
  /** Each voice writes a constant level so its clips can be told apart in the file. */
  const voice = (level: number, calls: string[]): Synthesizer => ({
    sampleRate: SR,
    async synthesize(text, rate) { calls.push(`${text}@${rate}`); return new Float32Array(300).fill(level); },
  });

  it('lays out German and Persian in the configured order with real silence, each text synthesized once per language', async () => {
    const deCalls: string[] = [];
    const faCalls: string[] = [];
    const r = await renderSession([{ id: 'dv_00000000a1' as never, ...WAND }], { ...ACCEPT, rate: 0.85, faRate: 1.2 }, { de: voice(0.3, deCalls), fa: voice(0.6, faCalls) }, { leadInMs: 0 });
    expect(deCalls).toEqual(['die Außenwand@0.85', `${WAND.example}@0.85`]);
    expect(faCalls).toEqual(['دیوار خارجی@1.2', `${WAND.exampleFa}@1.2`]);
    const steps = r.items[0]!.steps;
    expect(steps.map((t) => (t.step.kind === 'speak' ? t.step.lang : 'pause'))).toEqual([
      'de', 'pause', 'fa', 'de', 'pause', 'fa', 'de', 'pause', 'fa', 'de', 'de', 'pause', 'fa',
    ]);
    // 1 s of real silence between German and Persian; the Persian clip follows exactly after it.
    expect(steps[1]!.end - steps[1]!.start).toBeCloseTo(1, 6);
    expect(steps[2]!.start).toBeCloseTo(steps[1]!.end, 6);
    const pcm = new Int16Array(await r.wav.arrayBuffer(), 44);
    const at = (t: number) => pcm[Math.round(t * SR) + 5]!;
    expect(at(steps[0]!.start)).toBeGreaterThan(0); // German audio
    expect(at(steps[1]!.start)).toBe(0); // silence
    expect(at(steps[2]!.start)).toBeGreaterThan(0); // Persian audio
  });

  it('without a Persian voice the file is German only', async () => {
    const r = await renderSession([{ id: 'dv_00000000a1' as never, ...WAND }], { ...ACCEPT, rate: 1 }, { de: voice(0.3, []), fa: null }, { leadInMs: 0 });
    expect(r.items[0]!.steps.every((t) => t.step.kind !== 'speak' || t.step.lang === 'de')).toBe(true);
  });
});

describe('floating card (Picture-in-Picture) shows the bilingual segment', () => {
  it('Persian meaning: FA badge, highlighted meaning, cycle number; Persian example highlighted', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const { FloatingCard } = await import('../../../src/features/shadowing/components/FloatingCard');
    const steps = planItem(WAND, ACCEPT);
    const snap = (stepIndex: number) => ({
      status: 'playing' as const, index: 0, total: 5, stepIndex, steps, step: steps[stepIndex]!, speaking: true, pauseMs: null, pauseElapsedMs: 0,
      completedIds: [], notice: null, wakeLock: 'unsupported' as const, startedAt: 0, finishedAt: null, endedEarly: false,
    });
    const card = { entry: { id: 'dv_00000000a1', type: 'n' as const, pronunciationFa: '', ...WAND }, categoryKey: 'arch' as const, categoryLabel: 'A', theme: 'arch', subtabId: 's', subtabLabel: 'S', order: 0 };
    const controls = { play() {}, pause() {}, next() {}, previous() {} };
    const view = render(createElement(FloatingCard, { snap: snap(5), card, controls, showTranslation: false, onClose() {} }));
    expect(screen.getByTestId('floating-lang')).toHaveTextContent('FA');
    expect(screen.getByTestId('floating-fa')).toHaveClass('is-speaking');
    expect(screen.getByTestId('floating-state')).toHaveTextContent('معنی فارسی · دور 2 از 3');
    view.rerender(createElement(FloatingCard, { snap: snap(steps.length - 1), card, controls, showTranslation: false, onClose() {} }));
    expect(screen.getByTestId('floating-exfa')).toHaveClass('is-speaking'); // shown while spoken, even with translations hidden
    cleanup();
  });
});
