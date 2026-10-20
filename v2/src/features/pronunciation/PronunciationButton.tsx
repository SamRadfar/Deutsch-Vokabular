import { LoaderCircle, Volume1, Volume2 } from 'lucide-react';
import { usePronunciation } from './PronunciationProvider';
import './PronunciationButton.css';

interface Props {
  /** Unique key of what is spoken (e.g. `${entryId}:word`). */
  speechKey: string;
  text: string;
  /** Accessible label, e.g. "Aussprache: die Außenwand". */
  label: string;
  variant?: 'word' | 'example';
}

export function PronunciationButton({ speechKey, text, label, variant = 'word' }: Props) {
  const { supported, speakingKey, speakingPhase, toggle } = usePronunciation();
  const speaking = speakingKey === speechKey;
  const loading = speaking && speakingPhase === 'loading';
  const unsupportedLabel = 'پخش صدا در این مرورگر پشتیبانی نمی‌شود';
  return (
    <button
      type="button"
      className={`speak-btn${variant === 'example' ? ' speak-btn--example' : ''}${speaking ? (loading ? ' is-loading' : ' is-speaking') : ''}`}
      data-phase={speaking ? speakingPhase ?? 'playing' : undefined}
      onClick={() => toggle(speechKey, text)} /* unsupported: the provider explains why nothing plays */
      aria-disabled={supported ? undefined : true}
      aria-label={supported ? (speaking ? `${label} (stop)` : label) : unsupportedLabel}
      aria-pressed={supported ? speaking : undefined}
      title={supported ? label : unsupportedLabel}
    >
      {loading ? <LoaderCircle className="speak-btn__spin" /> : speaking ? <Volume1 /> : <Volume2 />}
    </button>
  );
}
