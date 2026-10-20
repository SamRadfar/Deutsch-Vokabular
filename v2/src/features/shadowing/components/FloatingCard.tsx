import { Mic, Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { DeckCard } from '../../review/deck';
import type { PlayerSnapshot } from '../player';
import { NOTICE_TEXT } from './ShadowingSession';

export interface FloatingControls {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
}

interface Props {
  snap: PlayerSnapshot;
  card: DeckCard;
  controls: FloatingControls;
  showTranslation: boolean;
  /** In-page fallback (no Document PiP): says honestly that it is not always on top. */
  inPage?: boolean;
  inPageReason?: 'unsupported' | 'refused';
  onClose(): void;
}

function status(snap: PlayerSnapshot): { text: string; kind: 'listen' | 'turn' | 'paused' | 'idle' } {
  const step = snap.step;
  if (snap.status === 'idle') return { text: 'آماده', kind: 'idle' };
  if (snap.status === 'paused') return { text: 'متوقف', kind: 'paused' };
  if (!step) return { text: '', kind: 'idle' };
  const what = step.target === 'word' ? 'واژه' : 'جمله';
  const rep = step.of > 1 ? ` ${step.repetition}/${step.of}` : '';
  return step.kind === 'speak' ? { text: `گوش کن: ${what}${rep}`, kind: 'listen' } : { text: `نوبت تو: ${what}${rep}`, kind: 'turn' };
}

/** The compact vocabulary card of the floating player (Picture-in-Picture window or in-page). */
export function FloatingCard({ snap, card, controls, showTranslation, inPage = false, inPageReason, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ snap, controls });
  latest.current = { snap, controls };
  const playing = snap.status === 'playing';
  const step = snap.step;
  const st = status(snap);
  const speakingWord = playing && step?.kind === 'speak' && step.target === 'word';
  const speakingExample = playing && step?.kind === 'speak' && step.target === 'example';
  const yourTurn = step?.kind === 'pause' && snap.pauseMs !== null && snap.status !== 'idle';
  const { entry } = card;

  // Keyboard inside the floating window (its own document): Space, ←, →.
  useEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const { snap: s, controls: c } = latest.current;
      if (e.code === 'Space') { e.preventDefault(); if (s.status === 'playing') c.pause(); else c.play(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); c.next(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); c.previous(); }
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={root} className={`sh-float${inPage ? ' sh-float--inpage' : ''}`} data-category={card.theme} data-testid="floating-card"
      data-entry-id={entry.id} lang="fa" dir="rtl" role="region" aria-label="کارت شناور تمرین تلفظ">
      <div className="sh-float__top">
        <span className="sh-float__pos" dir="ltr" data-testid="floating-pos">{snap.index + 1} / {snap.total}</span>
        <span className={`sh-float__state sh-float__state--${st.kind}`} data-testid="floating-state">
          {st.kind === 'listen' ? <Volume2 aria-hidden="true" /> : st.kind === 'turn' ? <Mic aria-hidden="true" /> : null}
          {st.text}
        </span>
        {inPage ? <button type="button" className="sh-float__x" onClick={onClose} aria-label="بستن کارت شناور"><X /></button> : null}
      </div>
      <div className="sh-float__progress" role="progressbar" aria-label="واژه‌های تمرین‌شده" aria-valuemin={0} aria-valuemax={snap.total} aria-valuenow={snap.completedIds.length}>
        <span style={{ width: `${snap.total ? (snap.completedIds.length / snap.total) * 100 : 0}%` }} />
      </div>

      <div className="sh-float__body">
        <p className={`sh-float__word${speakingWord ? ' is-speaking' : ''}`} lang="de" dir="ltr" data-testid="floating-word">{entry.word}</p>
        <p className="sh-float__fa">{entry.fa}</p>
        {entry.example ? (
          <p className={`sh-float__ex${speakingExample ? ' is-speaking' : ''}`} lang="de" dir="ltr">{entry.example}</p>
        ) : null}
        {entry.example && showTranslation && entry.exampleFa ? <p className="sh-float__exfa">{entry.exampleFa}</p> : null}
      </div>

      <div className="sh-float__turn" aria-hidden="true">
        {yourTurn ? (
          <span key={`${snap.index}-${snap.stepIndex}-${snap.pauseElapsedMs}`}
            style={{ animationDuration: `${snap.pauseMs}ms`, animationDelay: `-${snap.pauseElapsedMs}ms`, animationPlayState: playing ? 'running' : 'paused' }} />
        ) : null}
      </div>

      {snap.notice ? <p className="sh-float__notice" role="status">{NOTICE_TEXT[snap.notice]}</p> : null}

      <div className="sh-float__controls" dir="ltr">
        <button type="button" onClick={controls.previous} aria-label="واژهٔ قبلی" title="واژهٔ قبلی"><SkipBack /></button>
        <button type="button" className="sh-float__main" onClick={playing ? controls.pause : controls.play}
          aria-label={playing ? 'توقف موقت' : 'پخش'} title={playing ? 'توقف موقت' : 'پخش'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button type="button" onClick={controls.next} aria-label="واژهٔ بعدی" title="واژهٔ بعدی"><SkipForward /></button>
      </div>

      {inPage ? (
        <p className="sh-float__fallback" role="note">
          {inPageReason === 'refused'
            ? 'مرورگر باز کردن پنجرهٔ شناور را نپذیرفت؛ این کارت فقط داخل همین صفحه است.'
            : 'این مرورگر «پنجرهٔ شناور» (Document Picture-in-Picture) ندارد؛ این کارت فقط داخل همین صفحه است و روی برنامه‌های دیگر نمی‌ماند. برای پنجرهٔ همیشه‌رو از Chrome یا Edge روی کامپیوتر استفاده کنید.'}
        </p>
      ) : null}
    </div>
  );
}
