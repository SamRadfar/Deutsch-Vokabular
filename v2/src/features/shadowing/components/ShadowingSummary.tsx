import { useEffect, useRef } from 'react';
import type { PlayerSnapshot } from '../player';
import { formatDuration } from './format';

interface Props {
  snap: PlayerSnapshot;
  saving: boolean;
  onNewRound(): void;
  onRepeat(): void;
  onSettings(): void;
}

export function ShadowingSummary({ snap, saving, onNewRound, onRepeat, onSettings }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const practiced = snap.completedIds.length;
  const duration = snap.startedAt !== null && snap.finishedAt !== null ? snap.finishedAt - snap.startedAt : 0;

  return (
    <section className="fc-summary sh-summary" aria-labelledby="sh-summary-title" lang="fa" dir="rtl">
      <p className="fc-summary__emoji" aria-hidden="true">{snap.endedEarly ? '👋' : '🎉'}</p>
      <h2 id="sh-summary-title" ref={heading} tabIndex={-1}>{snap.endedEarly ? 'جلسه پایان یافت' : 'دور تمرین تمام شد!'}</h2>
      <dl className="fc-stats">
        <div className="fc-stat fc-stat--know"><dt>تمرین‌شده</dt><dd data-testid="sh-summary-done">{practiced}</dd></div>
        <div className="fc-stat"><dt>ردشده</dt><dd data-testid="sh-summary-skipped">{snap.total - practiced}</dd></div>
        <div className="fc-stat"><dt>کل</dt><dd>{snap.total}</dd></div>
        <div className="fc-stat"><dt>مدت</dt><dd><span dir="ltr">{formatDuration(duration)}</span></dd></div>
      </dl>
      <p className={`fc-note${saving ? '' : ' fc-note--warn'}`} role="status">
        {saving
          ? 'سابقهٔ تمرین روی همین دستگاه ذخیره شد؛ واژه‌هایی که کمتر تمرین کرده‌اید در دورهای بعد زودتر می‌آیند.'
          : 'سابقهٔ این تمرین ذخیره نشد؛ برای ذخیره وارد حساب شوید.'}
      </p>
      <div className="fc-summary__actions">
        <button type="button" className="fc-primary" onClick={onNewRound}>دور تازه با واژه‌های جدید</button>
        <button type="button" className="fc-secondary" onClick={onRepeat}>تکرار همین واژه‌ها ({snap.total})</button>
        <button type="button" className="fc-secondary" onClick={onSettings}>تنظیمات تمرین</button>
      </div>
    </section>
  );
}
