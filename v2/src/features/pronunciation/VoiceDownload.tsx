import { Download, Trash2 } from 'lucide-react';
import { formatMegabytes, useOnDeviceVoice } from '../audio/useOnDeviceVoice';
import { VOICE_TOTAL_BYTES } from '../audio/voiceAssets';

const ERROR_TEXT: Record<string, string> = {
  network: 'دانلود ناموفق بود (اتصال اینترنت). دوباره تلاش کنید؛ بخش‌های کامل‌شده دوباره دانلود نمی‌شوند.',
  integrity: 'فایل دانلودشده با نسخهٔ معتبر یکی نبود و ذخیره نشد. دوباره تلاش کنید.',
  storage: 'فضای ذخیره‌سازی مرورگر کافی نیست یا در دسترس نیست (مثلاً در حالت خصوصی).',
  aborted: 'دانلود لغو شد.',
  unknown: 'دانلود صدا ناموفق بود. دوباره تلاش کنید.',
};

const TOTAL_MB = formatMegabytes(VOICE_TOTAL_BYTES);

/** Download / remove the on-device German voice (shared by sound settings and shadowing). */
export function VoiceDownload() {
  const { state: voice, download, cancel, remove } = useOnDeviceVoice();
  return (
    <div className="sh-voice" data-testid="sh-voice" data-state={voice.kind}>
      {voice.kind === 'checking' ? <p>در حال بررسی صدای آلمانی…</p> : null}
      {voice.kind === 'unsupported' ? (
        <p className="rv-notice rv-notice--error" role="alert">این مرورگر ذخیره‌سازی لازم برای صدای روی دستگاه را ندارد. از Chrome یا Safari به‌روز (نه حالت خصوصی) استفاده کنید.</p>
      ) : null}
      {voice.kind === 'missing' || voice.kind === 'error' ? (
        <>
          <p>
            صدای آلمانی رایگان «Thorsten» (حدود <bdi>{TOTAL_MB} MB</bdi>، فقط یک بار) روی همین دستگاه ذخیره می‌شود.
            فقط فایل‌های عمومی صدا دانلود می‌شوند؛ واژه‌ها و جمله‌های شما از دستگاه خارج نمی‌شوند. بهتر است با Wi-Fi دانلود کنید.
          </p>
          {voice.kind === 'error' ? <p className="rv-notice rv-notice--error" role="alert">{ERROR_TEXT[voice.reason]}</p> : null}
          <button type="button" className="fc-tool sh-voice__btn" onClick={() => { void download(); }}>
            <Download aria-hidden="true" /> دانلود صدای آلمانی · <bdi>{TOTAL_MB} MB</bdi>
          </button>
        </>
      ) : null}
      {voice.kind === 'downloading' ? (
        <>
          <p role="status">
            در حال دانلود صدا… <bdi>{formatMegabytes(voice.loaded)} / {formatMegabytes(voice.total)} MB</bdi>
          </p>
          <progress max={voice.total} value={voice.loaded} aria-label="پیشرفت دانلود صدا" />
          <button type="button" className="fc-tool" onClick={cancel}>لغو دانلود</button>
        </>
      ) : null}
      {voice.kind === 'ready' ? (
        <p className="sh-voice__ready">
          صدای آلمانی روی این دستگاه آماده است.
          <button type="button" className="sh-voice__remove" onClick={() => { void remove(); }} title="حذف صدای ذخیره‌شده از این دستگاه">
            <Trash2 aria-hidden="true" /> حذف
          </button>
        </p>
      ) : null}
    </div>
  );
}
