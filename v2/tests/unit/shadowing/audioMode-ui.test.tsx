// Shadowing "پخش با صفحهٔ قفل" (locked-screen audio session) through the real app UI. The on-device
// voice is replaced by a tone generator and Cache Storage by a flag (jsdom has neither WebAssembly
// workers nor media playback); the real pipeline is checked by scripts/audio-check.mjs.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { DEFAULT_PREFERENCES, type ShadowingPreferences } from '../../../src/features/shadowing/settings';
import { fakeSpeech, mockMatchMedia } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';

const voiceState = vi.hoisted(() => ({ downloaded: false, synthesized: [] as string[], disposed: 0 }));

vi.mock('../../../src/features/audio/voiceAssets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/features/audio/voiceAssets')>();
  return {
    ...real,
    voiceStorageSupported: () => true,
    voiceDownloaded: async () => voiceState.downloaded,
    downloadVoice: async (onProgress: (p: { loaded: number; total: number }) => void) => {
      onProgress({ loaded: real.VOICE_TOTAL_BYTES / 2, total: real.VOICE_TOTAL_BYTES });
      voiceState.downloaded = true;
    },
    removeVoice: async () => { voiceState.downloaded = false; },
  };
});

vi.mock('../../../src/features/audio/neuralVoice', () => ({
  openNeuralVoice: async () => ({
    sampleRate: 1000,
    synthesize: async (text: string) => {
      voiceState.synthesized.push(text);
      return Float32Array.from({ length: 400 }, (_, i) => 0.3 * Math.sin(i));
    },
    dispose: () => { voiceState.disposed++; },
  }),
}));

const storePrefs = (p: Partial<ShadowingPreferences>) =>
  localStorage.setItem('dv2.pref.shadowing.v1', JSON.stringify({ ...DEFAULT_PREFERENCES, ...p }));

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockMatchMedia(() => false);
  voiceState.downloaded = false;
  voiceState.synthesized = [];
  voiceState.disposed = 0;
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:session');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

async function openShadowing() {
  const user = userEvent.setup();
  const speech = fakeSpeech();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={speech} />);
  await vi.waitFor(() => { if (!document.querySelector('.shell')) throw new Error('library not shown yet'); }, { timeout: 10_000 });
  await user.click(screen.getByRole('link', { name: 'تلفظ' }));
  await vi.waitFor(() => screen.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' }));
  return { user, speech };
}

describe('shadowing — locked-screen audio mode', () => {
  it('needs the one-time voice download, then prepares the session on the device and plays it as media', async () => {
    storePrefs({ playback: 'audio', size: 5, categories: ['fitness'] });
    const { user, speech } = await openShadowing();

    expect(screen.getByRole('radio', { name: /پخش با صفحهٔ قفل/ })).toBeChecked();
    const start = await vi.waitFor(() => screen.getByRole('button', { name: 'آماده‌سازی جلسه (5 واژه)' }), { timeout: 5000 });
    await vi.waitFor(() => expect(screen.getByTestId('sh-voice')).toHaveAttribute('data-state', 'missing'));
    expect(start).toBeDisabled();
    expect(screen.getByText(/واژه‌ها و جمله‌های شما از دستگاه خارج نمی‌شوند/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /دانلود صدای آلمانی/ }));
    await vi.waitFor(() => expect(screen.getByTestId('sh-voice')).toHaveAttribute('data-state', 'ready'));
    expect(start).toBeEnabled();

    await user.click(start);
    await vi.waitFor(() => screen.getByTestId('sh-lockmode'), { timeout: 5000 });
    expect(voiceState.synthesized.length).toBeGreaterThanOrEqual(5); // words (+ examples), each once
    expect(voiceState.disposed).toBe(1); // the model is released once the audio exists
    expect(speech.speak).not.toHaveBeenCalled(); // no live browser speech in this mode
    expect(screen.getByLabelText('سرعت')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'پخش' }));
    expect(play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'توقف موقت' })).toBeInTheDocument();

    // Locking the screen hides the page: an audio session keeps playing.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByRole('button', { name: 'توقف موقت' })).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('live speech mode stays the default and still pauses when the page is hidden', async () => {
    storePrefs({ size: 5, categories: ['fitness'] });
    const { user } = await openShadowing();
    expect(screen.getByRole('radio', { name: /صدای مرورگر/ })).toBeChecked();
    expect(screen.queryByTestId('sh-voice')).toBeNull();
    await user.click(await vi.waitFor(() => screen.getByRole('button', { name: 'شروع تمرین (5 واژه)' }), { timeout: 5000 }));
    expect(screen.getByRole('button', { name: 'توقف موقت' })).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByRole('button', { name: 'ادامه' })).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
});
