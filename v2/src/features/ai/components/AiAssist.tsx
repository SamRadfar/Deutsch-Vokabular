import '../ai.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOnline } from '../../../components/OfflineBanner/OfflineBanner';
import type { AiMode, AiRequest } from '../../../../ai-worker/src/contract';
import { displayWord, type PersonalWordInput } from '../../personal/model';
import type { AiSuggestion } from '../aiClient';
import { useAiClient } from '../AiProvider';
import { applySelected, existingForRequest, reviewRows, type AiField } from '../merge';

interface Props {
  /** Current form values (suggestions are compared against them). */
  value: PersonalWordInput;
  /** New word whose type the user has not chosen yet. */
  typeIsDefault: boolean;
  /** Editing a saved word: "complete" is the default mode. */
  isEdit: boolean;
  /** Request "complete" once on open (the user clicked «✨ تکمیل» on a word). */
  autoRun?: boolean;
  /** Focus the AI input on open (the user chose "new word with AI"). */
  autoFocus?: boolean;
  /** Takes the reviewed values into the FORM — never saves. */
  onApply(next: PersonalWordInput, fields: readonly AiField[]): void;
}

const MODES: Array<{ value: AiMode; label: string }> = [
  { value: 'from-german', label: 'از واژهٔ آلمانی' },
  { value: 'from-persian', label: 'از معنی فارسی' },
  { value: 'complete', label: 'تکمیل جاهای خالی' },
];
const KIND: Record<'fill' | 'replace' | 'same', string> = { fill: 'خالی است', replace: 'جایگزینِ مقدار شما', same: 'یکسان' };

/**
 * «✨ پیشنهاد با هوش مصنوعی» inside the word form. Asks the AI worker for one entry, shows a review
 * table (empty fields pre-selected, existing values only with an explicit tick) and puts the
 * chosen values into the form. Saving stays the form's own button.
 */
export function AiAssist({ value, typeIsDefault, isEdit, autoRun = false, autoFocus = false, onApply }: Props) {
  const client = useAiClient();
  const online = useOnline();
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;
  const [mode, setMode] = useState<AiMode>(isEdit || autoRun ? 'complete' : 'from-german');
  // The AI inputs follow the form's word / meaning until the user types into them.
  const [ownWord, setWord] = useState<string | null>(null);
  const [ownFa, setFa] = useState<string | null>(null);
  const word = ownWord ?? (value.lemma ? displayWord(value) : '');
  const fa = ownFa ?? value.fa;
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiSuggestion | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<AiField>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rows = useMemo(() => (result ? reviewRows(value, result.fields, { typeIsDefault }) : []), [result, value, typeIsDefault]);

  const request = (m: AiMode): AiRequest | null => {
    if (m === 'from-german') return word.trim() ? { mode: m, word: word.trim().slice(0, 80), ...(context.trim() ? { context: context.trim().slice(0, 300) } : {}) } : null;
    if (m === 'from-persian') return fa.trim() ? { mode: m, fa: fa.trim().slice(0, 200), ...(context.trim() ? { context: context.trim().slice(0, 300) } : {}) } : null;
    return value.lemma.trim() ? { mode: m, existing: existingForRequest(value) } : null;
  };

  const run = async (m: AiMode) => {
    const req = request(m);
    if (!client || !req || busy) return;
    controller.current = new AbortController();
    setBusy(true); setError(null); setResult(null); setApplied(null);
    const r = await client.suggest(req, controller.current.signal);
    if (!alive.current) return;
    setBusy(false);
    controller.current = null;
    if (!r.ok) { if (r.code !== 'aborted') setError(r.message); return; }
    setResult(r.suggestion);
    setSelected(new Set(reviewRows(value, r.suggestion.fields, { typeIsDefault }).filter((x) => x.preselected).map((x) => x.field)));
  };

  // «✨ تکمیل» on a word card: one request when the form opens (guarded against StrictMode re-runs).
  useEffect(() => {
    if (autoRun && !started.current && client && online) { started.current = true; void run('complete'); }
    else if (autoFocus) {
      // After the dialog's own initial focus.
      const t = setTimeout(() => input.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (f: AiField, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(f); else n.delete(f); return n; });
  const apply = () => {
    if (!result) return;
    const chosen = rows.filter((r) => r.kind !== 'same' && selected.has(r.field)).map((r) => r.field);
    onApply(applySelected(value, result.fields, new Set(chosen)), chosen);
    setApplied(`${chosen.length.toLocaleString('fa-IR')} فیلد در فرم قرار گرفت. پیش از ذخیره بررسی کنید؛ تا «ذخیره» را نزنید چیزی ذخیره نمی‌شود.`);
    setResult(null);
  };

  if (!client) {
    return (
      <section className="ai ai--off" aria-label="پیشنهاد با هوش مصنوعی">
        <p>✨ پیشنهاد با هوش مصنوعی در این نسخه فعال نیست (سرویس آن راه‌اندازی نشده است). می‌توانید واژه را دستی وارد کنید.</p>
      </section>
    );
  }

  const req = request(mode);
  const actionable = rows.filter((r) => r.kind !== 'same');
  const chosenCount = actionable.filter((r) => selected.has(r.field)).length;

  return (
    <section className="ai" aria-labelledby={id('title')} data-testid="ai-assist">
      <div className="ai__head">
        <h3 id={id('title')} className="ai__title">✨ پیشنهاد با هوش مصنوعی</h3>
        <p className="ai__hint">پیشنهادها پیش از ذخیره به شما نشان داده می‌شوند و چیزی خودکار جایگزین نمی‌شود.</p>
      </div>

      <div className="ai__modes" role="radiogroup" aria-label="نوع پیشنهاد">
        {MODES.filter((m) => m.value !== 'complete' || value.lemma.trim()).map((m) => (
          <label key={m.value} className={`ai__mode${mode === m.value ? ' is-on' : ''}`}>
            <input type="radio" name={id('mode')} value={m.value} checked={mode === m.value} onChange={() => { setMode(m.value); setResult(null); setError(null); }} />
            {m.label}
          </label>
        ))}
      </div>

      {mode === 'from-german' ? (
        <div className="ai__inputs">
          <div className="pw-field">
            <label htmlFor={id('word')}>واژهٔ آلمانی برای پیشنهاد</label>
            <input ref={input} id={id('word')} value={word} onChange={(e) => setWord(e.currentTarget.value)} lang="de" dir="ltr" maxLength={80} autoComplete="off" spellCheck={false} placeholder="z. B. Nachhaltigkeit" />
          </div>
          <div className="pw-field">
            <label htmlFor={id('ctx')}>جمله‌ای که واژه را در آن دیدید (اختیاری)</label>
            <input id={id('ctx')} value={context} onChange={(e) => setContext(e.currentTarget.value)} lang="de" dir="ltr" maxLength={300} autoComplete="off" />
          </div>
        </div>
      ) : mode === 'from-persian' ? (
        <div className="ai__inputs">
          <div className="pw-field">
            <label htmlFor={id('fa')}>معنی فارسی برای یافتن واژهٔ آلمانی</label>
            <input ref={input} id={id('fa')} value={fa} onChange={(e) => setFa(e.currentTarget.value)} lang="fa" dir="rtl" maxLength={200} autoComplete="off" />
          </div>
        </div>
      ) : (
        <p className="ai__hint">فقط فیلدهای خالیِ «<bdi lang="de" dir="ltr">{displayWord(value)}</bdi>» پیشنهاد می‌شوند؛ مقدارهای شما دست‌نخورده می‌مانند.</p>
      )}

      <div className="ai__bar">
        <button type="button" className="fc-secondary ai__go" disabled={!online || busy || !req} onClick={() => void run(mode)}>
          {busy ? 'در حال دریافت پیشنهاد…' : '✨ دریافت پیشنهاد'}
        </button>
        {busy ? <button type="button" className="pwc__btn" onClick={() => controller.current?.abort()}>لغو</button> : null}
        {!online ? <span className="ai__note" role="status">برای پیشنهاد هوش مصنوعی به اینترنت نیاز است.</span> : null}
      </div>

      {error ? <p className="ai__error" role="alert">{error}</p> : null}
      {applied ? <p className="ai__applied" role="status">{applied}</p> : null}

      {result ? (
        <div className="ai__review" data-testid="ai-review">
          <p className={`ai__source${result.mock ? ' is-mock' : ''}`}>
            {result.mock ? 'پیشنهاد آزمایشی — از سرویس محلیِ بدون هوش مصنوعی واقعی' : 'پیشنهاد هوش مصنوعی — ممکن است اشتباه باشد؛ بررسی کنید'}
            {result.dailyLimit ? <span className="ai__quota"> · باقی‌ماندهٔ امروز: {result.remainingToday.toLocaleString('fa-IR')} از {result.dailyLimit.toLocaleString('fa-IR')}</span> : null}
          </p>
          {actionable.length === 0 ? <p className="ai__hint">پیشنهاد تازه‌ای نبود؛ همهٔ فیلدها با مقدارهای شما یکسان‌اند.</p> : null}
          <table className="ai__table">
            <caption className="visually-hidden">بررسی پیشنهادها</caption>
            <thead>
              <tr><th scope="col">انتخاب</th><th scope="col">فیلد</th><th scope="col">مقدار فعلی</th><th scope="col">پیشنهاد</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const de = r.field === 'lemma' || r.field === 'article' || r.field === 'grammar' || r.field === 'example';
                return (
                  <tr key={r.field} className={`ai__row ai__row--${r.kind}`} data-field={r.field}>
                    <td>
                      <input type="checkbox" checked={r.kind !== 'same' && selected.has(r.field)} disabled={r.kind === 'same'}
                        onChange={(e) => toggle(r.field, e.currentTarget.checked)} aria-label={`${r.label}: ${r.kind === 'replace' ? 'جایگزین شود' : 'استفاده شود'}`} />
                    </td>
                    <th scope="row">{r.label}<small className="ai__kind">{KIND[r.kind]}</small></th>
                    <td className="ai__cur" {...(de ? { lang: 'de', dir: 'ltr' } : {})}>{r.current || '—'}</td>
                    <td className="ai__sug" {...(de ? { lang: 'de', dir: 'ltr' } : {})}>{r.suggested}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="ai__bar">
            <button type="button" className="fc-primary" disabled={chosenCount === 0} onClick={apply}>
              قرار دادن {chosenCount.toLocaleString('fa-IR')} فیلد در فرم
            </button>
            <button type="button" className="pwc__btn" onClick={() => setResult(null)}>نادیده گرفتن پیشنهاد</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
