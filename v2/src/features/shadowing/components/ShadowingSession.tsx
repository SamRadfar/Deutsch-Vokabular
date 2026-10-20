import { Mic, Pause, PictureInPicture2, Play, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { WordId } from '../../../models/vocabulary';
import { WordTypeBadge } from '../../vocabulary/components/WordTypeBadge';
import type { DeckCard } from '../../review/deck';
import type { PlayerNotice, PlayerSnapshot } from '../player';
import { RATES } from '../settings';

interface Controls {
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
  end(): void;
}

interface Props {
  snap: PlayerSnapshot;
  cardsById: ReadonlyMap<WordId, DeckCard>;
  order: readonly WordId[];
  controls: Controls;
  /** Keyboard shortcuts only while the shadowing tab is visible. */
  active: boolean;
  /** Pre-rendered audio session: plays with the screen locked; speed is fixed when it was prepared. */
  audioMode?: boolean;
  /** Floating player (Document Picture-in-Picture). */
  floating?: { open(): void; close(): void; state: 'closed' | 'pip' | 'inpage'; supported: boolean };
  rate: number;
  showTranslation: boolean;
  onRate(rate: number): void;
  onShowTranslation(show: boolean): void;
}

export const NOTICE_TEXT: Record<PlayerNotice, string> = {
  background: 'صفحه به پس‌زمینه رفت؛ پخش متوقف شد. برای ادامه روی پخش بزنید.',
  left: 'از تب تمرین خارج شدید؛ پخش متوقف شد.',
  blocked: 'مرورگر پخش خودکار صدا را مسدود کرد. برای ادامه دوباره روی پخش بزنید.',
  'speech-failed': 'پخش صدا چند بار ناموفق بود. صدای دستگاه و صدای آلمانی مرورگر را بررسی کنید و دوباره پخش را بزنید.',
  unsupported: 'این مرورگر از تبدیل متن به گفتار پشتیبانی نمی‌کند.',
};

const KEYS: Record<string, 'toggle' | 'next' | 'previous' | 'stop' | 'translation'> = {
  Space: 'toggle', ArrowRight: 'next', ArrowLeft: 'previous', Escape: 'stop', KeyT: 'translation',
};

function phaseText(snap: PlayerSnapshot): string {
  const step = snap.step;
  if (snap.status === 'idle') return 'آماده — برای شروع روی پخش بزنید';
  if (snap.status === 'paused') return 'متوقف شده';
  if (!step) return '';
  const what = step.target === 'word' ? 'واژه' : 'جمله';
  const rep = step.of > 1 ? ` (${step.repetition} از ${step.of})` : '';
  return step.kind === 'speak' ? `گوش کن: ${what}${rep}` : `حالا تو ${what} را بلند تکرار کن${rep}`;
}

export function ShadowingSession({ snap, cardsById, order, controls, active, audioMode = false, floating, rate, showTranslation, onRate, onShowTranslation }: Props) {
  const rateId = useId();
  const root = useRef<HTMLElement>(null);
  const card = cardsById.get(order[snap.index]!);
  const step = snap.step;
  const playing = snap.status === 'playing';
  const speakingWord = playing && step?.kind === 'speak' && step.target === 'word';
  const speakingExample = playing && step?.kind === 'speak' && step.target === 'example';
  const yourTurn = step?.kind === 'pause' && snap.pauseMs !== null && snap.status !== 'idle';

  useEffect(() => {
    root.current?.scrollIntoView?.({ block: 'start' });
    root.current?.querySelector<HTMLButtonElement>('.sh-main')?.focus({ preventScroll: true });
  }, []);

  const latest = useRef({ controls, snap, showTranslation, onShowTranslation });
  latest.current = { controls, snap, showTranslation, onShowTranslation };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const action = KEYS[e.code];
      if (!action || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, select, textarea, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (action === 'toggle' && target?.closest('button, a[href]')) return; // native button activation
      e.preventDefault();
      const { controls: c, snap: s } = latest.current;
      if (action === 'toggle') { if (s.status === 'playing') c.pause(); else c.play(); }
      else if (action === 'translation') latest.current.onShowTranslation(!latest.current.showTranslation);
      else c[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!card) return null;
  const { entry } = card;
  const mainLabel = playing ? 'توقف موقت' : snap.status === 'paused' ? 'ادامه' : 'پخش';

  return (
    <section ref={root} className="sh-session" data-category={card.theme} aria-label="جلسهٔ تمرین تلفظ" lang="fa" dir="rtl">
      <div className="fc-toolbar">
        <button type="button" className="fc-tool" onClick={controls.end}>پایان جلسه</button>
        {floating ? (
          <button type="button" className="fc-tool sh-float-btn" data-testid="floating-toggle"
            onClick={floating.state === 'closed' ? floating.open : floating.close} aria-pressed={floating.state !== 'closed'}
            title={floating.supported ? 'کارت کوچک همیشه‌رو، جدا از مرورگر (Picture-in-Picture)' : 'این مرورگر پنجرهٔ شناور ندارد؛ کارت داخل صفحه نمایش داده می‌شود'}>
            <PictureInPicture2 aria-hidden="true" /> {floating.state === 'closed' ? 'پنجره شناور' : 'بستن پنجره شناور'}
          </button>
        ) : null}
        <p className="fc-count" data-testid="sh-count"><span dir="ltr">{snap.index + 1} / {snap.total}</span></p>
        {audioMode ? (
          <span className="sh-wake sh-wake--active" data-testid="sh-lockmode">
            <span className="sh-wake__dot" aria-hidden="true" />
            پخش با صفحهٔ قفل
          </span>
        ) : (
          <span className={`sh-wake sh-wake--${snap.wakeLock}`} title="Screen Wake Lock">
            <span className="sh-wake__dot" aria-hidden="true" />
            {snap.wakeLock === 'active' ? 'صفحه روشن می‌ماند' : snap.wakeLock === 'unsupported' ? 'روشن‌ماندن صفحه پشتیبانی نمی‌شود' : 'صفحه ممکن است خاموش شود'}
          </span>
        )}
      </div>
      <div className="fc-progress" role="progressbar" aria-label="واژه‌های تمرین‌شده" aria-valuemin={0} aria-valuemax={snap.total}
        aria-valuenow={snap.completedIds.length} aria-valuetext={`${snap.completedIds.length} از ${snap.total} واژه تمرین شد`}>
        <span style={{ width: `${snap.total ? (snap.completedIds.length / snap.total) * 100 : 0}%` }} />
      </div>

      <div className={`sh-stage${playing ? ' is-playing' : ''}`} data-testid="sh-stage" data-entry-id={entry.id}>
        <p className="fc-meta" lang="de" dir="ltr">{card.categoryLabel} · {card.subtabLabel}</p>
        <p className={`sh-line sh-line--word${speakingWord ? ' is-speaking' : ''}`} data-testid="sh-word" aria-current={speakingWord ? 'true' : undefined}>
          <span className="sh-eq" aria-hidden="true"><span /><span /><span /></span>
          <span lang="de" dir="ltr">{entry.word}</span>
        </p>
        <div className="fc-row"><WordTypeBadge type={entry.type} /><span className="sh-pr" lang="fa" dir="rtl">{entry.pronunciationFa}</span></div>
        {showTranslation ? <p className="sh-fa" lang="fa" dir="rtl" data-testid="sh-fa">{entry.fa}</p> : null}
        {entry.example ? (
          <div className={`sh-line sh-line--example${speakingExample ? ' is-speaking' : ''}`} data-testid="sh-example" aria-current={speakingExample ? 'true' : undefined}>
            <span className="sh-eq" aria-hidden="true"><span /><span /><span /></span>
            <span lang="de" dir="ltr">{entry.example}</span>
          </div>
        ) : null}
        {entry.example && showTranslation ? <p className="sh-exfa" lang="fa" dir="rtl">{entry.exampleFa}</p> : null}
      </div>

      <div className={`sh-phase${yourTurn ? ' is-your-turn' : ''}${snap.status === 'paused' ? ' is-paused' : ''}`} data-testid="sh-phase">
        <p>{yourTurn ? <Mic /> : playing ? <Volume2 /> : null}{phaseText(snap)}</p>
        {yourTurn ? (
          <span className="sh-countdown" aria-hidden="true">
            {/* keyed: restarts with every pause; a negative delay continues a resumed pause */}
            <span key={`${snap.index}-${snap.stepIndex}-${snap.pauseElapsedMs}`}
              style={{ animationDuration: `${snap.pauseMs}ms`, animationDelay: `-${snap.pauseElapsedMs}ms`, animationPlayState: playing ? 'running' : 'paused' }} />
          </span>
        ) : null}
      </div>

      {snap.notice ? <p className="rv-notice sh-notice" role="status">{NOTICE_TEXT[snap.notice]}</p> : null}

      <div className="sh-controls" dir="ltr">
        <button type="button" className="sh-btn" onClick={controls.previous} aria-label="واژهٔ قبلی" title="واژهٔ قبلی"><SkipBack /></button>
        <button type="button" className="sh-btn" onClick={controls.stop} aria-label="توقف" title="توقف (برگشت به اول همین واژه)" disabled={snap.status === 'idle'}><Square /></button>
        <button type="button" className="sh-btn sh-main" onClick={playing ? controls.pause : controls.play} aria-label={mainLabel} title={mainLabel}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button type="button" className="sh-btn" onClick={controls.next} aria-label="واژهٔ بعدی" title="واژهٔ بعدی"><SkipForward /></button>
      </div>

      <div className="sh-quick">
        <label htmlFor={rateId}>سرعت</label>
        <select id={rateId} value={rate} onChange={(e) => onRate(Number(e.currentTarget.value))} disabled={audioMode}
          title={audioMode ? 'سرعت هنگام آماده‌سازی جلسه ثابت شده است' : undefined}>
          {RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label className="rv-check">
          <input type="checkbox" checked={showTranslation} onChange={(e) => onShowTranslation(e.currentTarget.checked)} />
          ترجمهٔ فارسی
        </label>
      </div>

      <p className="fc-keys">
        میان‌برها: <kbd>Space</kbd> پخش/توقف موقت · <kbd>←</kbd> <kbd>→</kbd> واژهٔ قبلی/بعدی · <kbd>Esc</kbd> توقف · <kbd>T</kbd> ترجمه
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{`واژهٔ ${snap.index + 1} از ${snap.total}: ${entry.word}`}</p>
    </section>
  );
}
