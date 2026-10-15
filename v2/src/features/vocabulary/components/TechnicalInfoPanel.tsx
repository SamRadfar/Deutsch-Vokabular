import type { TechnicalInfo } from '../../../models/vocabulary';
import './TechnicalInfoPanel.css';

export const technicalInfoElementId = (entryId: string) => `tech-info-${entryId}`;

export function TechnicalInfoToggle({ entryId, open, onToggle }: { entryId: string; open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`info-trigger${open ? ' is-open' : ''}`}
      aria-expanded={open}
      aria-controls={technicalInfoElementId(entryId)}
      onClick={onToggle}
      lang="fa"
      data-info-region=""
    >
      اطلاعات فنی
    </button>
  );
}

/** Formula and key/value facts (legacy "glass" drawer). Values are rendered as text only. */
export function TechnicalInfoPanel({ entryId, info }: { entryId: string; info: TechnicalInfo }) {
  return (
    <div className="info-drawer" id={technicalInfoElementId(entryId)} data-info-region="" role="region" aria-label="اطلاعات فنی">
      {info.formula ? (
        <div className="info-drawer__formula">
          <span className="info-drawer__formula-lbl" lang="fa" dir="rtl">{info.formula.label}</span>
          <span className="info-drawer__formula-val" dir="ltr">{info.formula.value}</span>
        </div>
      ) : null}
      <dl className="info-drawer__kv">
        {info.rows.map((r, i) => (
          <div className="info-drawer__row" key={`${r.key}-${i}`}>
            <dt className="info-drawer__key" lang="fa" dir="rtl">{r.key}</dt>
            <dd
              className={`info-drawer__val info-drawer__val--${r.kind}`}
              {...(r.kind === 'persian' ? { lang: 'fa', dir: 'rtl' } : { dir: 'ltr' })}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
