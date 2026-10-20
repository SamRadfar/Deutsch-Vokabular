import { Download, Lock, Smartphone, Trash2 } from 'lucide-react';
import { formatMegabytes, type OnDeviceVoiceState } from '../../audio/useOnDeviceVoice';
import { VOICE_TOTAL_BYTES } from '../../audio/voiceAssets';
import type { PlaybackMode as Mode } from '../settings';

interface Props {
  mode: Mode;
  onMode(mode: Mode): void;
  voice: OnDeviceVoiceState;
  onDownload(): void;
  onCancel(): void;
  onRemove(): void;
}

const ERROR_TEXT: Record<string, string> = {
  network: 'دانلود ناموفق بود (اتصال اینترنت). دوباره تلاش کنید؛ بخش‌های کامل‌شده دوباره دانلود نمی‌شوند.',
  integrity: 'فایل دانلودشده با نسخهٔ معتبر یکی نبود و ذخیره نشد. دوباره تلاش کنید.',
  storage: 'فضای ذخیره‌سازی مرورگر کافی نیست یا در دسترس نیست (مثلاً در حالت خصوصی).',
  aborted: 'دانلود لغو شد.',
  unknown: 'دانلود صدا ناموفق بود. دوباره تلاش کنید.',
};

const TOTAL_MB = formatMegabytes(VOICE_TOTAL_BYTES);

/** Choice between live browser speech and the locked-screen audio session, plus the voice download. */
export function PlaybackMode({ mode, onMode, voice, onDownload, onCancel, onRemove }: Props) {
  return (
    <fieldset className="sh-playback">
      <legend>حالت پخش</legend>
      <label className={`sh-playback__opt${mode === 'speech' ? ' is-selected' : ''}`}>
        <input type="radio" name="sh-playback" value="speech" checked={mode === 'speech'} onChange={() => onMode('speech')} />
        <Smartphone aria-hidden="true" />
        <span>
          <strong>صدای مرورگر</strong>
          <small>فوری شروع می‌شود؛ با قفل‌شدن صفحه یا رفتن به برنامهٔ دیگر متوقف می‌شود.</small>
        </span>
      </label>
      <label className={`sh-playback__opt${mode === 'audio' ? ' is-selected' : ''}`}>
        <input type="radio" name="sh-playback" value="audio" checked={mode === 'audio'} onChange={() => onMode('audio')} />
        <Lock aria-hidden="true" />
        <span>
          <strong>پخش با صفحهٔ قفل</strong>
          <small>جلسه پیش از شروع روی همین دستگاه به یک فایل صوتی تبدیل می‌شود؛ با قفل صفحه ادامه دارد و از صفحهٔ قفل کنترل می‌شود.</small>
        </span>
      </label>

      {mode === 'audio' ? (
        <div className="sh-voice" data-testid="sh-voice" data-state={voice.kind}>
          {voice.kind === 'checking' ? <p>در حال بررسی صدای آلمانی…</p> : null}
          {voice.kind === 'unsupported' ? (
            <p className="rv-notice rv-notice--error" role="alert">این مرورگر ذخیره‌سازی لازم برای صدای روی دستگاه را ندارد. از Chrome یا Safari به‌روز استفاده کنید.</p>
          ) : null}
          {voice.kind === 'missing' || voice.kind === 'error' ? (
            <>
              <p>
                برای این حالت، صدای آلمانی رایگان «Thorsten» (حدود <span dir="ltr">{TOTAL_MB} MB</span>، فقط یک بار) روی همین دستگاه ذخیره می‌شود.
                فقط فایل‌های عمومی صدا دانلود می‌شوند؛ واژه‌ها و جمله‌های شما از دستگاه خارج نمی‌شوند. بهتر است با Wi-Fi دانلود کنید.
              </p>
              {voice.kind === 'error' ? <p className="rv-notice rv-notice--error" role="alert">{ERROR_TEXT[voice.reason]}</p> : null}
              <button type="button" className="fc-tool sh-voice__btn" onClick={onDownload}>
                <Download aria-hidden="true" /> دانلود صدای آلمانی · <bdi>{TOTAL_MB} MB</bdi>
              </button>
            </>
          ) : null}
          {voice.kind === 'downloading' ? (
            <>
              <p role="status">
                در حال دانلود صدا… <span dir="ltr">{formatMegabytes(voice.loaded)} / {formatMegabytes(voice.total)} MB</span>
              </p>
              <progress max={voice.total} value={voice.loaded} aria-label="پیشرفت دانلود صدا" />
              <button type="button" className="fc-tool" onClick={onCancel}>لغو دانلود</button>
            </>
          ) : null}
          {voice.kind === 'ready' ? (
            <p className="sh-voice__ready">
              صدای آلمانی روی این دستگاه آماده است.
              <button type="button" className="sh-voice__remove" onClick={onRemove} title="حذف صدای ذخیره‌شده از این دستگاه">
                <Trash2 aria-hidden="true" /> حذف
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
