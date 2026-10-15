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
  const { supported, speakingKey, toggle } = usePronunciation();
  const speaking = speakingKey === speechKey;
  const unsupportedLabel = 'پخش صدا در این مرورگر پشتیبانی نمی‌شود';
  return (
    <button
      type="button"
      className={`speak-btn${variant === 'example' ? ' speak-btn--example' : ''}${speaking ? ' is-speaking' : ''}`}
      onClick={() => toggle(speechKey, text)}
      disabled={!supported}
      aria-label={supported ? (speaking ? `${label} (stop)` : label) : unsupportedLabel}
      aria-pressed={supported ? speaking : undefined}
      title={supported ? label : unsupportedLabel}
    >
      <span aria-hidden="true">{speaking ? '🔉' : '🔊'}</span>
    </button>
  );
}
