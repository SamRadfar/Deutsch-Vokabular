import { Check, CircleAlert, Cloud, CopyX, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { Category } from '../../../models/vocabulary';
import { Dialog } from '../../../components/Dialog/Dialog';
import type { AiClient } from '../../ai/aiClient';
import type { AiLevel } from '../../../../ai-worker/src/contract';
import { CategoryDestinationPicker } from '../../categories/CategoryDestinationPicker';
import { destinationError, placementOf, type Destination } from '../../categories/catalog';
import { DIRECT_SUBTAB } from '../../categories/model';
import { useCategories } from '../../categories/useCategories';
import type { DuplicateIndex } from '../duplicates';
import { ARTICLES } from '../model';
import type { PersonalSnapshot, PersonalVocabulary } from '../personalVocabulary';
import { entryWord, GENERATE_COUNTS, GENERATE_LEVELS, runGeneration, type GenerationProgress, type GenerationResult } from './generation';
import { buildImport, checkRow, draftRows, type DraftRow } from './importPlan';
import './generate.css';

interface Props {
  ai: AiClient | null;
  vocab: PersonalVocabulary;
  snapshot: PersonalSnapshot;
  categories: readonly Category[];
  duplicates: DuplicateIndex;
  onClose(): void;
  /** After the import: show the new category in "my words". */
  /** After the import: the main category the words went to (null = no category). */
  onImported(mainId: string | null): void;
}

type Step = 'form' | 'generating' | 'preview' | 'done';

const TYPE_LABEL: Record<string, string> = { n: 'اسم', v: 'فعل', a: 'صفت', au: 'عبارت', x: 'سایر' };

/** «ساخت واژه با هوش مصنوعی»: topic → generate → review/edit → import → sync. */
export function AiVocabularyGenerator({ ai, vocab, snapshot, categories, duplicates, onClose, onImported }: Props) {
  const uid = useId();
  const cats = useCategories(categories);
  const [step, setStep] = useState<Step>('form');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState<number>(50);
  const [level, setLevel] = useState<AiLevel>('B1-B2');
  const [instructions, setInstructions] = useState('');
  /** Where the words go — nothing is created before «وارد کردن». */
  const [dest, setDest] = useState<Destination>({ kind: 'newMain', name: '', subName: '' });
  /** Use the AI's subcategories (when no subcategory is chosen): each becomes a real subcategory. */
  const [aiSubs, setAiSubs] = useState(true);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [result, setResult] = useState<Omit<GenerationResult, 'entries'> | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'regenerate' | 'more'>(null);
  const [imported, setImported] = useState<{ ids: string[]; mainId: string | null; mainName: string | null; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** The imported words are written to this device's storage (IndexedDB) — null while writing. */
  const [stored, setStored] = useState<boolean | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A new main category without a name takes the topic as its name.
  const effectiveDest: Destination = dest.kind === 'newMain' && !dest.name.trim() ? { ...dest, name: topic.trim() } : dest;
  const destError = destinationError(effectiveDest, cats.catalog);
  /** AI subcategories apply when the words go to a main category without a chosen subcategory. */
  const aiSubsApply = (effectiveDest.kind === 'newMain' && !effectiveDest.subName.trim()) || (effectiveDest.kind === 'existing' && effectiveDest.subId === null);

  const checks = useMemo(() => new Map(rows.map((r) => [r.id, checkRow(r, duplicates)])), [rows, duplicates]);
  const selected = rows.filter((r) => r.selected);
  const dupCount = rows.filter((r) => checks.get(r.id)!.duplicates.length).length;
  const invalidSelected = selected.filter((r) => Object.keys(checks.get(r.id)!.errors).length).length;

  const generate = async (mode: 'new' | 'more' | 'regenerate') => {
    if (!ai) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const replacing = mode === 'regenerate' ? rows.filter((r) => r.selected) : [];
    const want = mode === 'new' ? count : mode === 'more' ? Math.max(0, count - rows.length) : replacing.length;
    if (!want) return;
    if (mode === 'new') { setStep('generating'); setProgress({ collected: 0, target: want, batches: 0 }); } else setBusy(mode);
    const known = mode === 'new' ? [] : [...rows.map((r) => entryWord(r.entry)), ...removed];
    const subs = mode === 'new' ? [] : [...new Set(rows.map((r) => r.entry.subcategory).filter(Boolean))];
    const out = await runGeneration(ai, { topic: topic.trim(), level, count: want, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }, {
      signal: ctrl.signal, avoid: known, subcategories: subs,
      onProgress: (p) => { if (mode === 'new') setProgress(p); },
    });
    abort.current = null;
    const fresh = draftRows(out.entries, duplicates);
    setResult({ rejected: out.rejected, mock: out.mock, model: out.model, remainingToday: out.remainingToday, stoppedBy: out.stoppedBy });
    if (mode === 'new') {
      setRows(fresh);
      if (!fresh.length) { setStep('form'); setFormError(out.stoppedBy?.message ?? 'هیچ واژهٔ معتبری ساخته نشد؛ موضوع را دقیق‌تر بنویسید و دوباره امتحان کنید.'); return; }
      setStep('preview');
    } else if (mode === 'more') {
      setRows((r) => [...r, ...fresh]);
    } else {
      // Replace the selected rows in place, in order; rows without a replacement stay.
      setRows((current) => {
        const queue = [...fresh];
        return current.map((r) => (r.selected && queue.length ? queue.shift()! : r));
      });
    }
    setBusy(null);
  };

  const start = () => {
    setFormError(null);
    if (!topic.trim()) { setFormError('موضوع را بنویسید (مثلاً «Kleidung und Mode» یا «پزشکی»).'); return; }
    if (destError) { setFormError(destError); return; }
    void generate('new');
  };

  const update = (id: string, patch: Partial<DraftRow['entry']>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, entry: { ...r.entry, ...patch } } : r)));
  const toggle = (id: string, on: boolean) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, selected: on } : r)));
  const removeRows = (ids: ReadonlySet<string>) => {
    setRemoved((x) => [...x, ...rows.filter((r) => ids.has(r.id)).map((r) => entryWord(r.entry))]);
    setRows((rs) => rs.filter((r) => !ids.has(r.id)));
  };

  const doImport = () => {
    setImportError(null);
    if (destError) { setImportError(destError); return; }
    // Only now are new categories created — the same call finds them again on a retry (no duplicates).
    const placed = cats.apply(effectiveDest);
    if (!placed.ok) { setImportError(placed.error); return; }
    const mainId = placed.mainId;
    const subIds = new Map<string, string>();
    if (cats.store && mainId && aiSubs && aiSubsApply) {
      for (const name of new Set(rows.filter((r) => r.selected && r.entry.subcategory.trim()).map((r) => r.entry.subcategory.trim()))) {
        const sub = cats.store.ensure(name, mainId, cats.builtInKeys);
        if (sub.ok) subIds.set(name, sub.category.id);
      }
    }
    const placementFor = (row: DraftRow) => {
      if (!mainId || !placed.placement) return null;
      if (placed.placement.subtab !== DIRECT_SUBTAB || !subIds.size) return placed.placement;
      return placementOf(mainId, subIds.get(row.entry.subcategory.trim()) ?? null);
    };
    const plan = buildImport(rows, placementFor, Date.now());
    if (!plan.words.length) return;
    // Applied at once (in memory, queued for the cloud); existing ids are never overwritten (idempotent).
    const persisted = vocab.addMany(plan.words);
    const main = mainId ? cats.catalog.find((m) => m.id === mainId)?.name ?? (effectiveDest.kind === 'newMain' ? effectiveDest.name : null) : null;
    setImported({ ids: plan.words.map((w) => w.id), mainId, mainName: main, skipped: plan.invalid.length });
    setStep('done');
    persisted.then(() => setStored(true), () => setStored(false));
  };

  const title = 'ساخت واژه با هوش مصنوعی';
  const close = () => { abort.current?.abort(); onClose(); };

  // ── done ──────────────────────────────────────────────────────────────────
  if (step === 'done' && imported) {
    const states = imported.ids.map((id) => (snapshot.sync.mode === 'cloud' ? snapshot.sync.stateOf(id) : 'local'));
    const present = imported.ids.filter((id) => snapshot.byId.has(id)).length;
    const synced = states.filter((s) => s === 'synced').length;
    const failed = states.filter((s) => s === 'failed').length;
    return (
      <Dialog title={title} onClose={close} size="lg">
        <div className="gen-done" data-testid="gen-done">
          <p className="gen-done__big"><Check aria-hidden="true" /> {present} واژه به «واژه‌های من»{imported.mainName ? <> در دستهٔ «<bdi>{imported.mainName}</bdi>»</> : null} اضافه شد.</p>
          <p className="gen-sync" role="status" data-testid="gen-stored">
            {stored === null ? 'در حال ذخیره روی این دستگاه…' : stored && snapshot.saved ? 'روی این دستگاه ذخیره شد.' : 'ذخیره روی این دستگاه ناموفق بود؛ واژه‌ها فقط تا بستن صفحه می‌مانند.'}
          </p>
          {imported.skipped ? <p className="rv-notice">{imported.skipped} ردیف به‌خاطر خطای اعتبارسنجی وارد نشد.</p> : null}
          {snapshot.sync.mode === 'cloud' ? (
            <p className="gen-sync" role="status" data-testid="gen-sync"><Cloud aria-hidden="true" /> همگام‌سازی با حساب: <bdi>{synced} / {imported.ids.length}</bdi>{synced < imported.ids.length && !failed ? ' — در حال ارسال…' : ''}</p>
          ) : (
            <p className="gen-sync" role="status">روی این دستگاه ذخیره شد؛ پس از فعال شدن همگام‌سازی ابری ارسال می‌شود.</p>
          )}
          {failed ? (
            <p className="rv-notice rv-notice--error" role="alert">{failed} واژه به حساب ارسال نشد. <button type="button" className="pw-retry" onClick={() => vocab.retryFailed()}>تلاش دوباره</button></p>
          ) : null}
          <p className="gen-done__hint">این واژه‌ها در جستجو، مرور با فلش‌کارت، تمرین تلفظ و آمار هم هستند. در مرور و تلفظ، دستهٔ {imported.mainName ? `«${imported.mainName}»` : '«واژه‌های من»'} را انتخاب کنید.</p>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={() => { onImported(imported.mainId); onClose(); }}>نمایش واژه‌ها</button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ── generating ────────────────────────────────────────────────────────────
  if (step === 'generating' && progress) {
    return (
      <Dialog title={title} onClose={close} size="lg" busy={false}>
        <div className="gen-progress" data-testid="gen-progress">
          <p role="status">در حال ساخت واژه‌های «<bdi>{topic}</bdi>»… <bdi>{progress.collected} / {progress.target}</bdi></p>
          <progress max={progress.target} value={progress.collected} aria-label="پیشرفت ساخت واژه‌ها" />
          <p className="gen-hint">هوش مصنوعی واژه‌ها را در دسته‌های ۱۵تایی می‌سازد؛ هر دسته چند ثانیه طول می‌کشد. هر چه ساخته شود، پیش از ذخیره به شما نشان داده می‌شود.</p>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => abort.current?.abort()}>توقف و نمایش واژه‌های ساخته‌شده</button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ── preview ───────────────────────────────────────────────────────────────
  if (step === 'preview') {
    const allOn = rows.length > 0 && rows.every((r) => r.selected);
    return (
      <Dialog title={title} onClose={close} size="lg" description={`«${topic}» · ${GENERATE_LEVELS.find((l) => l.value === level)?.label ?? ''} — همه را پیش از ذخیره بررسی کنید.`}>
        <div className="gen-preview" data-testid="gen-preview">
          <p className={`gen-ai-note${result?.mock ? ' is-mock' : ''}`} role="note">
            <Sparkles aria-hidden="true" />
            {result?.mock
              ? 'پیشنهاد آزمایشی — سرویس محلی توسعه، نه هوش مصنوعی واقعی.'
              : 'ساخته‌شده با هوش مصنوعی؛ ممکن است اشتباه داشته باشد (حرف تعریف، معنی، مثال). پیش از ذخیره بررسی و در صورت نیاز ویرایش کنید.'}
            {result?.model ? <span className="gen-model" dir="ltr">{result.model}</span> : null}
          </p>
          {result?.stoppedBy ? (
            <p className="rv-notice rv-notice--error" role="alert" data-testid="gen-stopped">
              {rows.length < count ? `فقط ${rows.length} از ${count} واژه ساخته شد: ` : ''}{result.stoppedBy.message}
            </p>
          ) : null}

          <div className="gen-toolbar">
            <label className="rv-check">
              <input type="checkbox" checked={allOn} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.currentTarget.checked })))} />
              همه
            </label>
            <span className="gen-counts" data-testid="gen-counts">
              <bdi>{selected.length}</bdi> از <bdi>{rows.length}</bdi> انتخاب‌شده
              {dupCount ? <> · <CopyX aria-hidden="true" /> {dupCount} تکراری</> : null}
              {result?.rejected ? <> · {result.rejected} ردیف نامعتبر کنار گذاشته شد</> : null}
            </span>
            <button type="button" className="fc-tool" disabled={!selected.length || !!busy} onClick={() => { void generate('regenerate'); }}>
              <RefreshCw aria-hidden="true" className={busy === 'regenerate' ? 'gen-spin' : undefined} /> ساخت دوبارهٔ انتخاب‌شده‌ها
            </button>
            <button type="button" className="fc-tool" disabled={!selected.length || !!busy} onClick={() => removeRows(new Set(selected.map((r) => r.id)))}>
              <Trash2 aria-hidden="true" /> حذف انتخاب‌شده‌ها
            </button>
            {rows.length < count ? (
              <button type="button" className="fc-tool" disabled={!!busy || !ai} onClick={() => { void generate('more'); }}>
                <Wand2 aria-hidden="true" className={busy === 'more' ? 'gen-spin' : undefined} /> ساخت {count - rows.length} واژهٔ باقی‌مانده
              </button>
            ) : null}
          </div>

          <ol className="gen-rows" aria-label="واژه‌های ساخته‌شده">
            {rows.map((r, i) => {
              const c = checks.get(r.id)!;
              const errs = Object.values(c.errors);
              return (
                <li key={r.id} className={`gen-row${r.selected ? ' is-selected' : ''}${c.duplicates.length ? ' is-dup' : ''}${errs.length ? ' is-invalid' : ''}`} data-testid="gen-row">
                  <div className="gen-row__head">
                    <input type="checkbox" checked={r.selected} onChange={(e) => toggle(r.id, e.currentTarget.checked)} aria-label={`انتخاب ${entryWord(r.entry)}`} />
                    <span className="gen-row__n">{i + 1}</span>
                    <select value={r.entry.type === 'n' ? r.entry.article ?? 'der' : ''} disabled={r.entry.type !== 'n'} aria-label="حرف تعریف"
                      onChange={(e) => update(r.id, { article: e.currentTarget.value as 'der' | 'die' | 'das' })}>
                      {r.entry.type === 'n' ? ARTICLES.map((a) => <option key={a} value={a}>{a}</option>) : <option value="">—</option>}
                    </select>
                    <input className="gen-row__lemma" value={r.entry.lemma} lang="de" dir="ltr" aria-label="واژهٔ آلمانی"
                      onChange={(e) => update(r.id, { lemma: e.currentTarget.value })} />
                    <select value={r.entry.type} aria-label="نوع واژه"
                      onChange={(e) => { const type = e.currentTarget.value as DraftRow['entry']['type']; update(r.id, { type, article: type === 'n' ? r.entry.article ?? 'die' : null }); }}>
                      {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {r.entry.level ? <span className="gen-level" dir="ltr">{r.entry.level}</span> : null}
                    <button type="button" className="gen-row__del" aria-label={`حذف ${entryWord(r.entry)}`} onClick={() => removeRows(new Set([r.id]))}><Trash2 /></button>
                  </div>
                  <div className="gen-row__grid">
                    <input value={r.entry.fa} lang="fa" dir="rtl" aria-label="معنی فارسی" onChange={(e) => update(r.id, { fa: e.currentTarget.value })} />
                    <input value={r.entry.subcategory} lang="de" dir="ltr" aria-label="زیرمجموعه" placeholder="Unterthema" onChange={(e) => update(r.id, { subcategory: e.currentTarget.value })} />
                    <textarea value={r.entry.example} lang="de" dir="ltr" rows={2} aria-label="جملهٔ مثال" onChange={(e) => update(r.id, { example: e.currentTarget.value })} />
                    <textarea value={r.entry.exampleFa} lang="fa" dir="rtl" rows={2} aria-label="ترجمهٔ مثال" onChange={(e) => update(r.id, { exampleFa: e.currentTarget.value })} />
                  </div>
                  {c.duplicates.length ? (
                    <p className="gen-row__dup" data-testid="gen-dup">
                      <CopyX aria-hidden="true" /> تکراری: <bdi lang="de" dir="ltr">{c.duplicates[0]!.word}</bdi> ({c.duplicates[0]!.where}) — به‌طور پیش‌فرض وارد نمی‌شود.
                    </p>
                  ) : null}
                  {c.articleHint ? (
                    <p className="gen-row__dup" data-testid="gen-article-hint">
                      <CircleAlert aria-hidden="true" /> حرف تعریف را بررسی کنید: این پایانه معمولاً «<bdi lang="de">{c.articleHint}</bdi>» دارد.
                    </p>
                  ) : null}
                  {errs.length ? <p className="gen-row__err"><CircleAlert aria-hidden="true" /> {errs[0]}</p> : null}
                </li>
              );
            })}
          </ol>

          <CategoryDestinationPicker value={dest} onChange={setDest} catalog={cats.catalog}
            newMainHint={<>بدون نام، نام دسته همان موضوع می‌شود{topic.trim() ? <> («<bdi>{topic.trim()}</bdi>»)</> : null}.</>} />
          {aiSubsApply ? (
            <label className="rv-check">
              <input type="checkbox" checked={aiSubs} onChange={(e) => setAiSubs(e.currentTarget.checked)} />
              زیرمجموعه‌های پیشنهادی هوش مصنوعی را بساز (در صورت نیاز)
            </label>
          ) : null}
          {importError ? <p className="rv-notice rv-notice--error" role="alert">{importError}</p> : null}

          <div className="dialog__actions dialog__footer">
            <button type="button" className="btn" onClick={close}>انصراف (هیچ چیز ذخیره نمی‌شود)</button>
            <button type="button" className="btn btn--primary" data-testid="gen-import" disabled={!selected.length || invalidSelected > 0 || !!busy}
              onClick={doImport}>
              <Check aria-hidden="true" /> وارد کردن {selected.length} واژه
            </button>
          </div>
          {invalidSelected ? <p className="rv-notice rv-notice--error" role="alert">{invalidSelected} ردیف انتخاب‌شده خطا دارد؛ آن را اصلاح یا حذف کنید.</p> : null}
        </div>
      </Dialog>
    );
  }

  // ── form ──────────────────────────────────────────────────────────────────
  return (
    <Dialog title={title} onClose={close} size="lg" description="موضوع، تعداد و سطح را انتخاب کنید؛ واژه‌ها پیش از ذخیره برای بررسی نشان داده می‌شوند.">
      <form className="gen-form" data-testid="gen-form" onSubmit={(e) => { e.preventDefault(); start(); }}>
        {!ai ? (
          <p className="rv-notice rv-notice--error" role="alert" data-testid="gen-not-configured">
            سرویس هوش مصنوعی برای این نسخه هنوز راه‌اندازی نشده است؛ پس از راه‌اندازی، این بخش فعال می‌شود.
          </p>
        ) : null}
        <div className="pw-field">
          <label htmlFor={`${uid}-topic`}>موضوع</label>
          <input id={`${uid}-topic`} value={topic} onChange={(e) => setTopic(e.currentTarget.value)} maxLength={80}
            placeholder="مثلاً Kleidung und Mode، معماری، پزشکی، سفر" autoComplete="off" required />
        </div>
        <fieldset className="gen-choices">
          <legend>تعداد واژه</legend>
          {GENERATE_COUNTS.map((n) => (
            <label key={n} className={`gen-chip${count === n ? ' is-selected' : ''}`}>
              <input type="radio" name={`${uid}-count`} value={n} checked={count === n} onChange={() => setCount(n)} /> {n}
            </label>
          ))}
        </fieldset>
        <fieldset className="gen-choices">
          <legend>سطح زبان</legend>
          {GENERATE_LEVELS.map((l) => (
            <label key={l.value} className={`gen-chip${level === l.value ? ' is-selected' : ''}`}>
              <input type="radio" name={`${uid}-level`} value={l.value} checked={level === l.value} onChange={() => setLevel(l.value)} /> <bdi>{l.label}</bdi>
            </label>
          ))}
        </fieldset>
        <CategoryDestinationPicker value={dest} onChange={setDest} catalog={cats.catalog}
            newMainHint={<>بدون نام، نام دسته همان موضوع می‌شود{topic.trim() ? <> («<bdi>{topic.trim()}</bdi>»)</> : null}.</>} />
          {aiSubsApply ? (
            <label className="rv-check">
              <input type="checkbox" checked={aiSubs} onChange={(e) => setAiSubs(e.currentTarget.checked)} />
              زیرمجموعه‌های پیشنهادی هوش مصنوعی را بساز (در صورت نیاز)
            </label>
          ) : null}
        <div className="pw-field">
          <label htmlFor={`${uid}-ins`}>توضیح بیشتر (اختیاری)</label>
          <textarea id={`${uid}-ins`} value={instructions} onChange={(e) => setInstructions(e.currentTarget.value)} maxLength={300} rows={2}
            placeholder="مثلاً: بیشتر واژه‌های روزمره، بدون اصطلاحات عامیانه" />
        </div>
        <p className="gen-hint">
          فقط موضوع، سطح و توضیح شما به سرویس هوش مصنوعی فرستاده می‌شود — نه واژه‌های ذخیره‌شدهٔ شما. ساخت {count} واژه حدود {Math.max(1, Math.round((Math.ceil(count / 15) * 25) / 2 / 60))} دقیقه طول می‌کشد.
          {result?.remainingToday !== null && result?.remainingToday !== undefined ? ` سهم باقی‌ماندهٔ امروز: ${result.remainingToday} واژه.` : ''}
        </p>
        {formError ? <p className="rv-notice rv-notice--error" role="alert">{formError}</p> : null}
        <div className="dialog__actions dialog__footer">
          <button type="button" className="btn" onClick={close}>انصراف</button>
          <button type="submit" className="btn btn--primary" disabled={!ai}><Wand2 aria-hidden="true" /> ساخت واژه‌ها</button>
        </div>
      </form>
    </Dialog>
  );
}
