import { Lock, Smartphone } from 'lucide-react';
import { VoiceDownload } from '../../pronunciation/VoiceDownload';
import type { PlaybackMode as Mode } from '../settings';

interface Props {
  mode: Mode;
  onMode(mode: Mode): void;
}

/** Choice between live speech and the locked-screen audio session, plus the voice download. */
export function PlaybackMode({ mode, onMode }: Props) {
  return (
    <fieldset className="sh-playback">
      <legend>حالت پخش</legend>
      <label className={`sh-playback__opt${mode === 'speech' ? ' is-selected' : ''}`}>
        <input type="radio" name="sh-playback" value="speech" checked={mode === 'speech'} onChange={() => onMode('speech')} />
        <Smartphone aria-hidden="true" />
        <span>
          <strong>پخش زنده</strong>
          <small>فوری شروع می‌شود (با صدای انتخاب‌شده در «تنظیمات صدا»)؛ با قفل‌شدن صفحه یا رفتن به برنامهٔ دیگر متوقف می‌شود.</small>
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
      {mode === 'audio' ? <VoiceDownload /> : null}
    </fieldset>
  );
}
