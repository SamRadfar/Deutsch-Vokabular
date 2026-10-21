import { Download, Trash2 } from 'lucide-react';
import { formatMegabytes, onDeviceVoiceStore, useOnDeviceVoice } from '../audio/useOnDeviceVoice';
import { VOICES, type VoiceId } from '../audio/voiceAssets';

const ERROR_TEXT: Record<string, string> = {
  network: 'دانلود ناموفق بود (اتصال اینترنت). دوباره تلاش کنید؛ بخش‌های کامل‌شده دوباره دانلود نمی‌شوند.',
  integrity: 'فایل دانلودشده با نسخهٔ معتبر یکی نبود و ذخیره نشد. دوباره تلاش کنید.',
  storage: 'فضای ذخیره‌سازی مرورگر کافی نیست یا در دسترس نیست (مثلاً در حالت خصوصی).',
  aborted: 'دانلود لغو شد.',
  unknown: 'دانلود صدا ناموفق بود. دوباره تلاش کنید.',
};

const TEXT: Record<VoiceId, { lang: string; name: string }> = {
  de: { lang: 'آلمانی', name: 'Thorsten' },
  fa: { lang: 'فارسی', name: 'Amir' },
};

/** Download / remove one on-device voice (German or Persian; shared by sound settings and shadowing). */
export function VoiceDownload({ voice: id = 'de' }: { voice?: VoiceId }) {
  const { state: voice, download, cancel, remove } = useOnDeviceVoice(onDeviceVoiceStore(id));
  const t = TEXT[id];
  const mb = voice.kind === 'missing' || voice.kind === 'error' ? formatMegabytes(voice.bytes) : '';
  return (
    <div className="sh-voice" data-testid={id === 'de' ? 'sh-voice' : `sh-voice-${id}`} data-state={voice.kind}>
      {voice.kind === 'checking' ? <p>در حال بررسی صدای {t.lang}…</p> : null}
      {voice.kind === 'unsupported' ? (
        <p className="rv-notice rv-notice--error" role="alert">این مرورگر ذخیره‌سازی لازم برای صدای روی دستگاه را ندارد. از Chrome یا Safari به‌روز (نه حالت خصوصی) استفاده کنید.</p>
      ) : null}
      {voice.kind === 'missing' || voice.kind === 'error' ? (
        <>
          <p>
            صدای {t.lang} رایگان «{t.name}» (حدود <bdi>{mb} MB</bdi>، فقط یک بار) روی همین دستگاه ذخیره می‌شود و آفلاین هم کار می‌کند.
            فقط فایل‌های عمومی صدا دانلود می‌شوند؛ واژه‌ها و جمله‌های شما از دستگاه خارج نمی‌شوند. بهتر است با Wi-Fi دانلود کنید.
            <span className="sh-voice__license" dir="ltr"> {VOICES[id].license}</span>
          </p>
          {voice.kind === 'error' ? <p className="rv-notice rv-notice--error" role="alert">{ERROR_TEXT[voice.reason]}</p> : null}
          <button type="button" className="fc-tool sh-voice__btn" onClick={() => { void download(); }}>
            <Download aria-hidden="true" /> دانلود صدای {t.lang} · <bdi>{mb} MB</bdi>
          </button>
        </>
      ) : null}
      {voice.kind === 'downloading' ? (
        <>
          <p role="status">
            در حال دانلود صدای {t.lang}… <bdi>{formatMegabytes(voice.loaded)} / {formatMegabytes(voice.total)} MB</bdi>
          </p>
          <progress max={voice.total} value={voice.loaded} aria-label={`پیشرفت دانلود صدای ${t.lang}`} />
          <button type="button" className="fc-tool" onClick={cancel}>لغو دانلود</button>
        </>
      ) : null}
      {voice.kind === 'ready' ? (
        <p className="sh-voice__ready">
          صدای {t.lang} روی این دستگاه آماده است.
          <button type="button" className="sh-voice__remove" onClick={() => { void remove(); }} title={`حذف صدای ${t.lang} از این دستگاه`}>
            <Trash2 aria-hidden="true" /> حذف
          </button>
        </p>
      ) : null}
    </div>
  );
}
