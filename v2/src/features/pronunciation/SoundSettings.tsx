import { Bell, Copy, Cpu, Globe } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog/Dialog';
import { sharedMediaOutput } from '../audio/mediaOutput';
import { isAppleMobile, type VoicePreference } from '../audio/routedSpeech';
import { useOnDeviceVoice } from '../audio/useOnDeviceVoice';
import { toneWav } from '../shadowing/audioSession/render';
import { usePronunciation } from './PronunciationProvider';
import type { SpeechService } from './speechService';
import { VoiceDownload } from './VoiceDownload';

/** A neutral sample sentence (no vocabulary of the user). */
export const SOUND_TEST_TEXT = 'Guten Tag! Das ist ein Test der deutschen Aussprache.';

type TestId = 'tone' | 'browser' | 'device';
/** What really happened, with times since the tap (ms). */
type TestLog = string[];

const PREF_TEXT: Record<VoicePreference, { title: string; sub: string }> = {
  auto: { title: 'خودکار (پیشنهادی)', sub: 'روی iPhone و iPad صدای دستگاه (اگر دانلود شده)، در بقیهٔ دستگاه‌ها صدای مرورگر؛ اگر صدای مرورگر کار نکند، صدای دستگاه.' },
  browser: { title: 'صدای مرورگر', sub: 'فوری و بدون دانلود. روی iPhone در حالت بی‌صدا شنیده نمی‌شود.' },
  device: { title: 'صدای آلمانی دستگاه', sub: 'روی همین دستگاه ساخته و مثل موسیقی پخش می‌شود (با کلید بی‌صدا هم). اولین پخش چند ثانیه طول می‌کشد.' },
};

function standalone(): boolean {
  try { return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true; } catch { return false; }
}

/** Sound settings and a real playback check of each output path (tone, browser speech, on-device voice). */
export function SoundSettings({ onClose }: { onClose(): void }) {
  const { routed, voicePreference, setVoicePreference, service } = usePronunciation();
  const { state: device } = useOnDeviceVoice();
  const [logs, setLogs] = useState<Partial<Record<TestId, TestLog>>>({});
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const running = useRef<TestId | null>(null);

  useEffect(() => service.onVoicesChanged(() => force((n) => n + 1)), [service]);
  useEffect(() => () => { routed?.cancel(); sharedMediaOutput().stop(); }, [routed]);

  const browser: SpeechService = routed?.browser ?? service;
  const info = browser.voiceInfo();
  const route = routed?.route() ?? 'browser';

  const run = (id: TestId) => {
    routed?.cancel();
    sharedMediaOutput().stop();
    running.current = id;
    const t0 = performance.now();
    const log = (line: string) => {
      if (running.current !== id && !line.startsWith('✖') && !line.startsWith('■')) return;
      setLogs((l) => ({ ...l, [id]: [...(l[id] ?? []), `${Math.round(performance.now() - t0)} ms · ${line}`] }));
    };
    setLogs((l) => ({ ...l, [id]: [] }));
    const handlers = {
      onStart: () => log('▶ پخش شروع شد'),
      onError: (code: string) => log(`✖ خطا: ${code}`),
      onEnd: () => log('■ پایان'),
    };
    if (id === 'tone') { sharedMediaOutput().play(toneWav(), handlers); log('در صف پخش (media)'); return; }
    const target = id === 'browser' ? browser : routed?.device;
    if (!target) return;
    target.speak(SOUND_TEST_TEXT, { rate: 0.9, ...handlers });
    log(id === 'device' ? 'در حال ساخت صدا روی دستگاه…' : 'به موتور گفتار مرورگر داده شد');
  };

  const report = () => JSON.stringify({
    app: `${String(import.meta.env.VITE_APP_VERSION ?? 'dev')} ${String(import.meta.env.VITE_APP_BUILD ?? '')}`.trim(),
    ua: navigator.userAgent,
    standalone: standalone(),
    appleMobile: isAppleMobile(),
    speechSynthesis: browser.supported,
    voices: info.total,
    germanVoices: info.german.map((v) => `${v.name} (${v.lang}${v.local ? '' : ', network'})`),
    browserVoice: info.selected?.name ?? null,
    audioSession: (navigator as { audioSession?: { type: string } }).audioSession?.type ?? 'n/a',
    deviceVoice: device.kind,
    preference: voicePreference,
    route,
    tests: logs,
  }, null, 1);

  const copy = async () => {
    try { await navigator.clipboard.writeText(report()); setCopied(true); } catch { setCopied(false); }
  };

  const Test = ({ id, icon, label, disabled = false }: { id: TestId; icon: ReactNode; label: string; disabled?: boolean }) => (
    <div className="snd-test">
      <button type="button" className="fc-tool" onClick={() => run(id)} disabled={disabled}>{icon} {label}</button>
      {logs[id]?.length ? <ol className="snd-test__log" data-testid={`snd-log-${id}`} dir="rtl">{logs[id]!.map((l, i) => <li key={i}>{l}</li>)}</ol> : null}
    </div>
  );

  return (
    <Dialog title="تنظیمات و آزمایش صدا" onClose={onClose} size="lg"
      description="صدای تلفظ را انتخاب کنید و هر مسیر پخش را جداگانه آزمایش کنید.">
      <div className="snd" data-testid="sound-settings">
        <fieldset className="sh-playback">
          <legend>صدای تلفظ</legend>
          {(['auto', 'browser', 'device'] as const).map((p) => (
            <label key={p} className={`sh-playback__opt${voicePreference === p ? ' is-selected' : ''}`}>
              <input type="radio" name="voice-pref" value={p} checked={voicePreference === p} onChange={() => setVoicePreference(p)} />
              {p === 'browser' ? <Globe aria-hidden="true" /> : <Cpu aria-hidden="true" />}
              <span><strong>{PREF_TEXT[p].title}</strong><small>{PREF_TEXT[p].sub}</small></span>
            </label>
          ))}
          <p className="snd__route" data-testid="snd-route">
            اکنون پخش با: <strong>{route === 'device' ? 'صدای آلمانی دستگاه' : 'صدای مرورگر'}</strong>
            {voicePreference === 'device' && device.kind !== 'ready' ? ' (تا دانلود صدا، صدای مرورگر)' : ''}
          </p>
        </fieldset>

        <VoiceDownload />

        <section className="snd__tests" aria-label="آزمایش پخش">
          <p className="snd__lead">هر دکمه را بزنید و بگویید کدام را <strong>واقعاً شنیدید</strong>. زمان‌ها رویدادهای واقعی مرورگر هستند.</p>
          <Test id="tone" icon={<Bell aria-hidden="true" />} label="۱. بوق آزمایشی (پخش media)" />
          <Test id="browser" icon={<Globe aria-hidden="true" />} label="۲. جملهٔ نمونه با صدای مرورگر" disabled={!browser.supported} />
          <Test id="device" icon={<Cpu aria-hidden="true" />} label="۳. جملهٔ نمونه با صدای دستگاه" disabled={device.kind !== 'ready' || !routed} />
          <p className="snd__hint" lang="de" dir="ltr">{SOUND_TEST_TEXT}</p>
          <p className="snd__hint">
            اگر «پخش شروع شد» و «پایان» دیده می‌شود ولی صدایی نشنیدید، خروجی صدا بی‌صداست: کلید بی‌صدای iPhone، بلندی صدا یا بلوتوث را بررسی کنید.
            اگر بوق شنیده می‌شود ولی صدای مرورگر نه، روی این دستگاه «صدای آلمانی دستگاه» را انتخاب کنید.
          </p>
        </section>

        <details className="snd__diag">
          <summary>اطلاعات فنی</summary>
          <ul dir="ltr">
            <li>speechSynthesis: {browser.supported ? 'yes' : 'no'} · voices {info.total} · German {info.german.length}</li>
            <li>browser voice: {info.selected ? `${info.selected.name} (${info.selected.lang})` : '—'}</li>
            <li>device voice: {device.kind} · route: {route} · preference: {voicePreference}</li>
            <li>standalone app: {standalone() ? 'yes' : 'no'} · iOS/iPadOS: {isAppleMobile() ? 'yes' : 'no'}</li>
          </ul>
          <button type="button" className="fc-tool" onClick={() => { void copy(); }}><Copy aria-hidden="true" /> {copied ? 'کپی شد' : 'کپی گزارش برای پشتیبانی'}</button>
        </details>
      </div>
    </Dialog>
  );
}
