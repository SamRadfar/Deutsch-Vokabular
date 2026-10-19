import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { DEFAULT_PREFERENCES, type ShadowingPreferences } from '../../../src/features/shadowing/settings';
import { STATS_META_KEY } from '../../../src/features/shadowing/model';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';

const repo = getVocabularyRepository();

beforeEach(() => {
  mockMatchMedia(() => false);
  // Fake timers that also move with real time, so Testing Library's waitFor keeps working.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const storePrefs = (p: Partial<ShadowingPreferences>) =>
  localStorage.setItem('dv2.pref.shadowing.v1', JSON.stringify({ ...DEFAULT_PREFERENCES, ...p }));
const tab = () => screen.getByRole('link', { name: 'تلفظ' });
/** The shadowing section, once shown. */
const shadowingShown = () => vi.waitFor(() => screen.queryByTestId('sh-stage') ?? screen.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' }));
const button = (name: string | RegExp) => screen.getByRole('button', { name });
/** The start button, once the account's practice history has loaded. */
const startButton = () => vi.waitFor(() => button('شروع تمرین (5 واژه)'), { timeout: 5000 });
const phase = () => screen.getByTestId('sh-phase').textContent;
const count = () => screen.getByTestId('sh-count').textContent;
const currentEntry = () => repo.getEntry(screen.getByTestId('sh-stage').getAttribute('data-entry-id')!)!;

/** The library owner signed in (the vocabulary exists only inside an account). */
async function setup(speech = fakeSpeech(), restored: typeof ALICE = ALICE) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const env = createFakeServices({ restored });
  const view = render(<App services={env.services} speechService={speech} />);
  await vi.waitFor(() => { if (!document.querySelector('.shell')) throw new Error('library not shown yet'); }, { timeout: 10_000 });
  return { user, speech, env, view };
}

describe('shadowing — setup and preferences', () => {
  it('offers the tab, explains that nothing is recorded or scored, and remembers settings', async () => {
    const { user, view } = await setup();
    await user.click(tab());
    await shadowingShown();
    expect(screen.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' })).toBeInTheDocument();
    expect(screen.getByText(/صدای شما ضبط یا ارزیابی نمی‌شود/)).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: /یادنگرفته‌ها/ })).toBeEnabled()); // signed in: all modes

    const slider = screen.getByRole('slider', { name: /مکث برای تکرار شما/ });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '8');
    fireEvent.change(slider, { target: { value: '6.5' } });
    await user.selectOptions(screen.getByLabelText('سرعت گفتار'), '0.55');
    await user.selectOptions(screen.getByLabelText('تکرار هر واژه'), '3');
    await user.selectOptions(screen.getByLabelText('تکرار جملهٔ مثال'), '0');
    await user.click(screen.getByRole('checkbox', { name: 'نمایش ترجمهٔ فارسی' }));
    await user.click(button('هیچ‌کدام'));
    expect(button('واژه‌ای برای تمرین نیست')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Fitness/ }));
    expect(JSON.parse(localStorage.getItem('dv2.pref.shadowing.v1')!)).toMatchObject({
      pauseSec: 6.5, rate: 0.55, wordRepeats: 3, exampleRepeats: 0, showTranslation: false, categories: ['fitness'],
    });

    view.unmount();
    await setup();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(tab());
    await shadowingShown();
    expect(screen.getByLabelText('سرعت گفتار')).toHaveValue('0.55');
    expect(screen.getByLabelText('تکرار هر واژه')).toHaveValue('3');
    expect(screen.getByText('6.5 ثانیه')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Fitness/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Dreame/ })).not.toBeChecked();
  });

  it('without speech synthesis the session cannot start and says why', async () => {
    const { user } = await setup(fakeSpeech(false));
    await user.click(tab());
    await shadowingShown();
    expect(screen.getByRole('alert')).toHaveTextContent('پشتیبانی نمی‌کند');
    expect(button(/شروع تمرین/)).toBeDisabled();
  });

  it('warns when no German voice is installed', async () => {
    const { user } = await setup(fakeSpeech(true, 'missing'));
    await user.click(tab());
    await shadowingShown();
    expect(screen.getByText(/صدای آلمانی روی این دستگاه پیدا نشد/)).toBeInTheDocument();
    expect(button(/شروع تمرین/)).toBeEnabled();
  });
});

describe('shadowing — playback workflow', () => {
  it('word → your turn → word → example → your turn, with the spoken line highlighted', async () => {
    storePrefs({ wordRepeats: 2, exampleRepeats: 1, pauseSec: 2, size: 5 });
    const { user, speech } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    const entry = currentEntry();
    expect(count()).toBe('1 / 5');
    expect(speech.speak).toHaveBeenLastCalledWith(entry.word, expect.objectContaining({ rate: 0.85 }));
    expect(phase()).toContain('گوش کن: واژه (1 از 2)');
    expect(screen.getByTestId('sh-word')).toHaveClass('is-speaking');
    expect(screen.getByTestId('sh-word')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('sh-fa')).toHaveTextContent(entry.fa);
    expect(screen.getByTestId('sh-stage')).toHaveTextContent(entry.pronunciationFa);

    act(() => speech.finish());
    expect(phase()).toContain('حالا تو واژه را بلند تکرار کن (1 از 2)');
    expect(screen.getByTestId('sh-word')).not.toHaveClass('is-speaking');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(phase()).toContain('گوش کن: واژه (2 از 2)');
    act(() => speech.finish());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(speech.speak).toHaveBeenLastCalledWith(entry.example, expect.anything());
    expect(screen.getByTestId('sh-example')).toHaveClass('is-speaking');
    act(() => speech.finish());
    expect(phase()).toContain('حالا تو جمله را بلند تکرار کن');
  });

  it('pause / resume / stop / next / previous from buttons', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 2, size: 5 });
    const { user, speech } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    await user.click(button('توقف موقت'));
    expect(speech.cancel).toHaveBeenCalled();
    expect(phase()).toContain('متوقف شده');
    const calls = vi.mocked(speech.speak).mock.calls.length;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(calls); // silent while paused
    await user.click(button('ادامه'));
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(calls + 1);

    await user.click(button('واژهٔ بعدی'));
    expect(count()).toBe('2 / 5');
    expect(speech.speak).toHaveBeenLastCalledWith(currentEntry().word, expect.anything());
    await user.click(button('واژهٔ قبلی'));
    expect(count()).toBe('1 / 5');

    await user.click(button('توقف'));
    expect(phase()).toContain('آماده');
    expect(speech.speaking).toBe(false);
    expect(button('پخش')).toBeInTheDocument();
  });

  it('keyboard: Space plays/pauses, arrows switch words, T toggles the translation, Esc stops', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 2, size: 5 });
    const { user } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    (document.activeElement as HTMLElement).blur();
    await user.keyboard(' ');
    expect(phase()).toContain('متوقف شده');
    await user.keyboard(' ');
    expect(phase()).toContain('گوش کن');
    await user.keyboard('{ArrowRight}');
    expect(count()).toBe('2 / 5');
    await user.keyboard('{ArrowLeft}');
    expect(count()).toBe('1 / 5');
    await user.keyboard('t');
    expect(screen.queryByTestId('sh-fa')).toBeNull();
    await user.keyboard('t');
    expect(screen.getByTestId('sh-fa')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(phase()).toContain('آماده');
  });

  it('completes the session and records the practice for the signed-in user (device-local)', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 1, size: 5 });
    const { user, speech, env } = await setup(fakeSpeech(), ALICE);
    await waitForLearnedCheckboxes();
    await user.click(tab());
    await shadowingShown();
    expect(screen.getByRole('radio', { name: /یادنگرفته‌ها/ })).toBeEnabled();
    await user.click(await startButton());
    const practised: string[] = [];
    for (let i = 0; i < 5; i++) {
      practised.push(currentEntry().id);
      act(() => speech.finish());
      act(() => { vi.advanceTimersByTime(1000); });
    }
    expect(screen.getByRole('heading', { name: 'دور تمرین تمام شد!' })).toHaveFocus();
    expect(screen.getByTestId('sh-summary-done')).toHaveTextContent('5');
    expect(screen.getByTestId('sh-summary-skipped')).toHaveTextContent('0');
    await waitFor(async () => expect((await env.local.loadExposure(ALICE.uid)).map((r) => r.wordId).sort()).toEqual([...practised].sort()));
    await waitFor(async () => expect(await env.local.getMeta(ALICE.uid, STATS_META_KEY)).toMatchObject({ sessionsCompleted: 1, itemsPracticed: 5 }));
    expect(env.cloud.writeLog).toEqual([]); // nothing of this goes to Firestore

    await user.click(button('تنظیمات تمرین'));
    const stats = screen.getByText('جلسهٔ کامل').closest('.rv-stats') as HTMLElement;
    expect(within(stats).getByText('1')).toBeInTheDocument();
    expect(within(stats).getByText('5')).toBeInTheDocument();
  });

  it('ending early counts only fully played words; repeat and new round start fresh sessions', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 1, size: 5 });
    const { user, speech } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    act(() => speech.finish());
    act(() => { vi.advanceTimersByTime(1000); });
    await user.click(button('واژهٔ بعدی')); // skip word 2
    await user.click(button('پایان جلسه'));
    expect(screen.getByRole('heading', { name: 'جلسه پایان یافت' })).toBeInTheDocument();
    expect(screen.getByTestId('sh-summary-done')).toHaveTextContent('1');
    expect(screen.getByTestId('sh-summary-skipped')).toHaveTextContent('4');
    expect(screen.getByText(/سابقهٔ تمرین روی همین دستگاه ذخیره شد/)).toBeInTheDocument();
    await user.click(button('تکرار همین واژه‌ها (5)'));
    expect(count()).toBe('1 / 5');
    expect(phase()).toContain('گوش کن');
    await user.click(button('پایان جلسه'));
    await user.click(button('دور تازه با واژه‌های جدید'));
    expect(count()).toBe('1 / 5');
  });
});

describe('shadowing — cleanup', () => {
  it('leaving the tab pauses with a notice; the session is kept', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 2, size: 5 });
    const { user, speech } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    await user.click(button('واژهٔ بعدی'));
    await user.click(screen.getByRole('link', { name: 'واژه‌ها' }));
    expect(speech.speaking).toBe(false);
    const calls = vi.mocked(speech.speak).mock.calls.length;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(calls);
    await user.click(tab());
    await shadowingShown();
    expect(count()).toBe('2 / 5');
    expect(screen.getByText(/از تب تمرین خارج شدید/)).toBeInTheDocument();
  });

  it('a hidden page pauses playback (background)', async () => {
    storePrefs({ wordRepeats: 1, exampleRepeats: 0, pauseSec: 2, size: 5 });
    const { user } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(screen.getByText(/صفحه به پس‌زمینه رفت/)).toBeInTheDocument();
    expect(button('ادامه')).toBeInTheDocument();
  });

  it('unmounting the app mid-session cancels speech and leaves no timers', async () => {
    storePrefs({ wordRepeats: 2, exampleRepeats: 1, pauseSec: 2, size: 5 });
    const { user, speech, view } = await setup();
    await user.click(tab());
    await shadowingShown();
    await user.click(await startButton());
    act(() => speech.finish()); // now in a learner pause (a timer is pending)
    view.unmount();
    expect(speech.speaking).toBe(false);
    const calls = vi.mocked(speech.speak).mock.calls.length;
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(calls);
  });
});
