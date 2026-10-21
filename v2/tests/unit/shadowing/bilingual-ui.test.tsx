// Bilingual shadowing through the app UI: «ترتیب و تکرار تلفظ» settings, the live order preview,
// the Persian voice download, and a live session that speaks German and Persian in order with the
// right language badge and highlighting. Voices are fakes here (order and state); real audio is
// checked with scripts/audio-check.mjs and on devices.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { setOnDeviceVoiceStore } from '../../../src/features/audio/useOnDeviceVoice';
import { DEFAULT_PREFERENCES, type ShadowingPreferences } from '../../../src/features/shadowing/settings';
import { fakeSpeech, mockMatchMedia } from '../../helpers/dom';
import { ALICE, BOB } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';

const voices = vi.hoisted(() => ({ de: false, fa: false, downloads: [] as string[] }));
vi.mock('../../../src/features/audio/voiceAssets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/features/audio/voiceAssets')>();
  return {
    ...real,
    voiceStorageSupported: () => true,
    voiceDownloaded: async (_s: unknown, v: 'de' | 'fa' = 'de') => voices[v],
    voiceRemainingBytes: async (_s: unknown, v: 'de' | 'fa' = 'de') => (voices[v] ? 0 : real.voiceTotalBytes(v)),
    downloadVoice: async (onProgress: (p: { loaded: number; total: number }) => void, _sig: unknown, _s: unknown, v: 'de' | 'fa' = 'de') => {
      voices.downloads.push(v);
      onProgress({ loaded: 1, total: 2 });
      voices[v] = true;
    },
  };
});

const storePrefs = (p: Partial<ShadowingPreferences>) => localStorage.setItem('dv2.pref.shadowing.v1', JSON.stringify({ ...DEFAULT_PREFERENCES, ...p }));

beforeEach(() => {
  mockMatchMedia(() => false);
  voices.de = false; voices.fa = false; voices.downloads = [];
  setOnDeviceVoiceStore(null);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

async function open(persian = fakeSpeech()) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const speech = fakeSpeech();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={speech} persianService={persian} />);
  await vi.waitFor(() => { if (!document.querySelector('.shell')) throw new Error('library not shown yet'); }, { timeout: 10_000 });
  await user.click(screen.getByRole('link', { name: 'تلفظ' }));
  await vi.waitFor(() => screen.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' }));
  return { user, speech, persian };
}

describe('bilingual shadowing — settings and live session', () => {
  it('settings section with live preview; Persian needs the voice; the session speaks DE→FA in order with the FA badge', async () => {
    storePrefs({ size: 5, categories: ['fitness'], exampleRepeats: 0, pauseSec: 0 });
    const { user, speech, persian } = await open();
    const section = screen.getByTestId('sh-sequence');
    expect(within(section).getByText('ترتیب و تکرار تلفظ')).toBeInTheDocument();
    const preview = within(section).getByTestId('sh-preview');
    const faMeanings = () => [...preview.querySelectorAll('.sh-chip-step.is-fa')].filter((c) => c.textContent?.includes('معنی'));
    expect(preview.querySelectorAll('.sh-chip-step.is-de').length).toBeGreaterThan(0);
    expect(faMeanings()).toHaveLength(0);

    await user.selectOptions(within(section).getByLabelText('تکرار واژه آلمانی'), '3');
    await user.selectOptions(within(section).getByLabelText('تکرار معنی فارسی'), '1');
    // The preview follows at once: three DE→FA lines.
    expect(faMeanings()).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem('dv2.pref.shadowing.v1')!)).toMatchObject({ wordRepeats: 3, faMeaningRepeats: 1 });

    // Persian voice missing → explained, start disabled until downloaded.
    expect(await screen.findByTestId('sh-needs-fa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'شروع تمرین (5 واژه)' })).toBeDisabled();
    await user.click(within(section).getByRole('button', { name: /دانلود صدای فارسی/ }));
    await vi.waitFor(() => expect(within(section).queryByTestId('sh-voice-fa')).toBeNull());
    expect(voices.downloads).toEqual(['fa']);

    await user.click(screen.getByRole('button', { name: 'شروع تمرین (5 واژه)' }));
    expect(speech.speak).toHaveBeenCalledTimes(1); // German word first
    expect(screen.getByTestId('sh-lang')).toHaveTextContent('DE');
    act(() => speech.finish());
    act(() => { vi.advanceTimersByTime(1000); }); // German→Persian delay (default 1 s)
    expect(persian.speak).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sh-lang')).toHaveTextContent('FA');
    expect(screen.getByTestId('sh-fa')).toHaveClass('is-speaking');
    expect(screen.getByTestId('sh-phase')).toHaveTextContent('گوش کن: معنی فارسی');
    act(() => persian.finish());
    expect(speech.speak).toHaveBeenCalledTimes(2); // next German repetition
    expect(screen.getByTestId('sh-phase')).toHaveTextContent('واژه (2 از 3)');
  });

  it('account switch / sign-out: synthesized clips (private words) are dropped and playback stops', async () => {
    const persian = { ...fakeSpeech(), clearCache: vi.fn() };
    const speech = { ...fakeSpeech(), clearCache: vi.fn() };
    const env = createFakeServices({ restored: ALICE });
    render(<App services={env.services} speechService={speech} persianService={persian} />);
    await vi.waitFor(() => { if (!document.querySelector('.shell')) throw new Error('library not shown yet'); }, { timeout: 10_000 });
    const before = persian.clearCache.mock.calls.length;
    act(() => env.auth.switchUserExternally(BOB));
    await vi.waitFor(() => expect(persian.clearCache.mock.calls.length).toBeGreaterThan(before));
    expect(speech.clearCache).toHaveBeenCalled();
    expect(persian.cancel).toHaveBeenCalled();
  });
});
