import { Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openNeuralVoice } from '../../audio/neuralVoice';
import type { OnDeviceVoiceState } from '../../audio/useOnDeviceVoice';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { renderSession, silentWav } from '../audioSession/render';

/** A neutral sample sentence (no vocabulary of the user). */
export const SOUND_TEST_TEXT = 'Guten Tag! Das ist ein Test der deutschen Aussprache.';

type DeviceTest = 'idle' | 'preparing' | 'playing' | 'done' | 'failed' | 'blocked';

const DEVICE_TEXT: Record<DeviceTest, string> = {
  idle: '',
  preparing: 'در حال ساخت صدا روی دستگاه…',
  playing: 'در حال پخش…',
  done: 'پخش شد. اگر صدایی نشنیدید، بلندی صدا و خروجی صدا را بررسی کنید.',
  failed: 'ساخت یا پخش صدا روی این دستگاه ناموفق بود.',
  blocked: 'مرورگر پخش را مسدود کرد؛ دوباره روی دکمه بزنید.',
};

/** Real audible check of both playback paths, with what the device offers (for support and testing). */
export function SoundTest({ voice }: { voice: OnDeviceVoiceState }) {
  const { service, toggle, speakingKey } = usePronunciation();
  const [info, setInfo] = useState(() => service.voiceInfo());
  const [device, setDevice] = useState<DeviceTest>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setInfo(service.voiceInfo());
    return service.onVoicesChanged(() => setInfo(service.voiceInfo()));
  }, [service]);
  useEffect(() => () => {
    audio.current?.pause();
    if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
  }, []);

  const playDevice = async () => {
    // Created inside the click so the later play() is allowed (iOS autoplay rules).
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.pause();
    if (el.src) URL.revokeObjectURL(el.src);
    el.src = URL.createObjectURL(silentWav());
    void el.play().catch(() => {}); // activates the element within this gesture
    setDevice('preparing');
    try {
      const v = await openNeuralVoice();
      try {
        const rendered = await renderSession([{ id: 'sound-test' as never, word: SOUND_TEST_TEXT, example: '' }],
          { wordRepeats: 1, exampleRepeats: 0, pauseSec: 1, rate: 1 }, v, { leadInMs: 200 });
        URL.revokeObjectURL(el.src);
        el.src = URL.createObjectURL(rendered.wav);
      } finally {
        v.dispose();
      }
      el.onended = () => setDevice('done');
      setDevice('playing');
      await el.play();
    } catch (e) {
      setDevice((e as { name?: string })?.name === 'NotAllowedError' ? 'blocked' : 'failed');
    }
  };

  const speaking = speakingKey === 'sound-test';
  return (
    <details className="sh-soundtest" data-testid="sound-test">
      <summary>آزمایش صدا</summary>
      <p className="sh-soundtest__info">
        {!service.supported
          ? 'این مرورگر گفتار ندارد.'
          : info.selected
            ? <>صدای مرورگر: <span dir="ltr" lang="de">{info.selected.name} ({info.selected.lang})</span>{info.german.length > 1 ? ` — ${info.german.length} صدای آلمانی` : ''}</>
            : info.total === 0 ? 'فهرست صداهای مرورگر هنوز بارگذاری نشده است.' : 'صدای آلمانی روی این دستگاه نصب نیست.'}
      </p>
      <button type="button" className="fc-tool" onClick={() => toggle('sound-test', SOUND_TEST_TEXT)} aria-pressed={speaking}>
        <Volume2 aria-hidden="true" /> {speaking ? 'توقف' : 'نمونه با صدای مرورگر'}
      </button>
      {voice.kind === 'ready' ? (
        <>
          <button type="button" className="fc-tool" onClick={() => { void playDevice(); }} disabled={device === 'preparing'}>
            <Volume2 aria-hidden="true" /> نمونه با صدای روی دستگاه
          </button>
          {device !== 'idle' ? <p role="status" className="sh-soundtest__status">{DEVICE_TEXT[device]}</p> : null}
        </>
      ) : null}
      <p className="sh-soundtest__hint" lang="de" dir="ltr">{SOUND_TEST_TEXT}</p>
    </details>
  );
}
