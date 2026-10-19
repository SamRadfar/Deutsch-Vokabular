import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Dialog } from '../../../components/Dialog/Dialog';
import type { LegacyStorageSnapshot } from '../../../models/legacy';
import type { VocabularyRepository } from '../../../services/content/vocabularyRepository';
import { useProgress } from '../ProgressProvider';
import { createMigrationContext, planMigration, previewMigration } from './plan';
import type { LibraryExtras } from '../../library/libraryService';
import { readLegacySnapshot } from './snapshot';
import { backupToSnapshot, createBackup, hasLegacyProgress, hashSnapshot, parseBackup } from './backup';
import { analyzeImport, engineLookup, findPreviousImport, runImport, type ImportOutcome } from './importer';
import type { MigrationPlan, MigrationPreview } from './types';
import './migration.css';

type Source = { kind: 'same-origin' | 'backup-file'; snapshot: LegacyStorageSnapshot; warnings: string[] };
type Step =
  | { step: 'source'; error: string | null }
  | { step: 'preview'; source: Source; plan: MigrationPlan; preview: MigrationPreview; hash: string; previous: 'completed' | 'queued' | null }
  | { step: 'importing' }
  | { step: 'result'; outcome: ImportOutcome };

const MAX_LISTED = 15;

/** Explicit, previewed, non-destructive import of legacy progress into the signed-in account. */
export function MigrationDialog({ repository, loadExtras, onClose }: {
  repository: VocabularyRepository;
  /** The library's id registry and legacy maps (loaded only for this dialog). */
  loadExtras(): Promise<LibraryExtras | null>;
  onClose(): void;
}) {
  const progress = useProgress();
  const [state, setState] = useState<Step>({ step: 'source', error: null });
  const [confirmed, setConfirmed] = useState(false);

  // Same-origin legacy data (only when v2 is served from the legacy app's origin).
  const sameOrigin = useMemo(() => {
    try { return readLegacySnapshot(window.localStorage); } catch { return null; }
  }, []);
  const sameOriginAvailable = !!sameOrigin && hasLegacyProgress(sameOrigin);

  const wordOf = (id: string) => repository.getEntry(id)?.word ?? id;

  async function analyse(source: Source) {
    if (progress.status !== 'ready') return;
    const extras = await loadExtras().catch(() => null);
    if (!extras) { setState({ step: 'source', error: 'داده‌های لازم برای انتقال از کتابخانهٔ شما بارگذاری نشد (اینترنت را بررسی کنید).' }); return; }
    const ctx = createMigrationContext(repository, extras.idRegistry, extras.dvok5Maps);
    const plan = planMigration(source.snapshot, ctx);
    const preview = previewMigration(plan, ctx);
    const hash = await hashSnapshot(source.snapshot);
    const previous = await findPreviousImport({ uid: progress.uid, engine: progress.engine, account: progress.account, inputHash: hash });
    setConfirmed(false);
    setState({ step: 'preview', source, plan, preview, hash, previous });
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { setState({ step: 'source', error: parsed.error }); return; }
    const snapshot = backupToSnapshot(parsed.backup);
    if (!hasLegacyProgress(snapshot)) { setState({ step: 'source', error: 'در این فایل هیچ پیشرفت قدیمی (dvok6 یا dvok5) پیدا نشد.' }); return; }
    await analyse({ kind: 'backup-file', snapshot, warnings: parsed.warnings });
  }

  function downloadBackup(snapshot: LegacyStorageSnapshot, kind: Source['kind']) {
    const backup = createBackup(snapshot, kind === 'same-origin' ? 'same-origin' : 'unknown');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `deutsch-vokabular-legacy-backup-${backup.createdAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function startImport() {
    if (state.step !== 'preview' || progress.status !== 'ready') return;
    const { plan, hash, source } = state;
    setState({ step: 'importing' });
    try {
      const outcome = await runImport({
        uid: progress.uid, engine: progress.engine, account: progress.account, inputHash: hash,
        source: source.kind, contentVersion: repository.dataset.contentVersion, plan,
      });
      setState({ step: 'result', outcome });
    } catch {
      setState({ step: 'source', error: 'انتقال ناموفق بود. داده‌های قدیمی دست‌نخورده‌اند؛ دوباره امتحان کنید.' });
    }
  }

  useEffect(() => { if (progress.status === 'unavailable') onClose(); }, [progress.status, onClose]);

  const busy = state.step === 'importing';
  return (
    <Dialog title="انتقال پیشرفت از نسخهٔ قدیمی" onClose={onClose} busy={busy}>
      {state.step === 'source' ? (
        <div className="mig">
          <p>
            پیشرفت نسخهٔ قدیمی (تیک‌های «یادگرفتم») به حساب شما <strong>اضافه</strong> می‌شود. داده‌های نسخهٔ قدیمی
            هیچ‌وقت تغییر نمی‌کنند یا پاک نمی‌شوند. پیش از وارد کردن، پیش‌نمایش کامل را می‌بینید.
          </p>
          {sameOriginAvailable ? (
            <div className="mig__box">
              <p>داده‌های نسخهٔ قدیمی در همین مرورگر پیدا شد.</p>
              <button type="button" className="btn btn--primary" onClick={() => void analyse({ kind: 'same-origin', snapshot: sameOrigin!, warnings: [] })}>
                بررسی داده‌های این مرورگر
              </button>
            </div>
          ) : (
            <p className="mig__note">
              در این نشانی، داده‌های نسخهٔ قدیمی قابل خواندن نیست (حافظهٔ مرورگر به دامنه وابسته است). از نسخهٔ قدیمی
              یک فایل پشتیبان JSON تهیه کنید و آن را اینجا انتخاب کنید (راهنما: docs/MIGRATION_GUIDE.md).
            </p>
          )}
          <label className="mig__file">
            <span>انتخاب فایل پشتیبان (JSON)</span>
            <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} data-testid="migration-file" />
          </label>
          {state.error ? <p className="mig__error" role="alert">{state.error}</p> : null}
          <div className="dialog__actions"><button type="button" className="btn" onClick={onClose}>بستن</button></div>
        </div>
      ) : null}

      {state.step === 'preview' && progress.status === 'ready' ? (
        <PreviewStep
          state={state}
          analysis={analyzeImport(state.plan, engineLookup(progress.engine))}
          wordOf={wordOf}
          confirmed={confirmed}
          onConfirm={setConfirmed}
          onDownload={() => downloadBackup(state.source.snapshot, state.source.kind)}
          onImport={() => void startImport()}
          onBack={() => setState({ step: 'source', error: null })}
        />
      ) : null}

      {state.step === 'importing' ? <p role="status">در حال وارد کردن و همگام‌سازی… (این پنجره را نبندید)</p> : null}

      {state.step === 'result' ? (
        <div className="mig" role="status">
          <ResultText outcome={state.outcome} />
          <div className="dialog__actions"><button type="button" className="btn btn--primary" onClick={onClose}>بستن</button></div>
        </div>
      ) : null}
    </Dialog>
  );
}

function ResultText({ outcome }: { outcome: ImportOutcome }) {
  switch (outcome.status) {
    case 'already-imported':
      return <p>این داده قبلاً به حساب شما منتقل شده است؛ چیزی دوباره وارد نشد.</p>;
    case 'completed':
      return <p>انتقال کامل شد: {outcome.imported} واژه اضافه و توسط سرور تأیید شد ({outcome.verified} از {outcome.imported}).</p>;
    case 'queued':
      return <p>{outcome.queued} واژه در صف ارسال است (آفلاین یا اتصال کند). پس از همگام‌سازی، دوباره همین فایل/داده را باز کنید تا ثبت نهایی انجام شود.</p>;
    case 'incomplete':
      return <p role="alert">فقط {outcome.verified} از {outcome.queued} واژه تأیید شد (احتمالاً در دستگاه دیگری تغییر کرده‌اند). سابقهٔ انتقال ثبت نشد؛ می‌توانید دوباره بررسی کنید.</p>;
  }
}

function List({ ids, wordOf }: { ids: readonly string[]; wordOf(id: string): string }) {
  if (!ids.length) return null;
  return (
    <ul className="mig__list" lang="de" dir="ltr">
      {ids.slice(0, MAX_LISTED).map((id) => <li key={id}>{wordOf(id)}</li>)}
      {ids.length > MAX_LISTED ? <li lang="fa" dir="rtl">و {ids.length - MAX_LISTED} مورد دیگر…</li> : null}
    </ul>
  );
}

function PreviewStep({ state, analysis, wordOf, confirmed, onConfirm, onDownload, onImport, onBack }: {
  state: Extract<Step, { step: 'preview' }>;
  analysis: ReturnType<typeof analyzeImport>;
  wordOf(id: string): string;
  confirmed: boolean;
  onConfirm(v: boolean): void;
  onDownload(): void;
  onImport(): void;
  onBack(): void;
}) {
  const { plan, preview, previous, source } = state;
  const blocked = previous === 'completed';
  const n = analysis.toImport.length;
  const dvok5Text: Record<string, string> = {
    absent: 'ندارد',
    'no-checks': 'بدون تیک',
    imported: `خوانده شد (نسخهٔ ${plan.dvok5.status === 'imported' ? plan.dvok5.checkboxCount : ''} ردیفی)`,
    'deferred-dvok6-has-checks': 'نادیده گرفته شد، چون تیک‌های جدیدتر (dvok6) وجود دارد',
    unrecognized: 'قالب شناخته نشد — وارد نمی‌شود',
    invalid: 'خراب — وارد نمی‌شود',
  };
  return (
    <div className="mig" data-testid="migration-preview">
      {source.warnings.map((w) => <p key={w} className="mig__warn">{w}</p>)}
      {blocked ? <p className="mig__warn" role="alert">این داده قبلاً به حساب شما منتقل شده است. ورود دوباره غیرفعال است.</p> : null}
      {previous === 'queued' ? <p className="mig__warn">این داده قبلاً در صف انتقال قرار گرفته است؛ با ادامه، فقط همگام‌سازی و ثبت نهایی انجام می‌شود.</p> : null}
      <dl className="mig__stats">
        <div><dt>واژه‌های یادگرفتهٔ قابل تطبیق</dt><dd>{preview.learnedEntries}</dd></div>
        <div><dt>وارد می‌شود</dt><dd data-testid="mig-to-import">{n}</dd></div>
        <div><dt>از قبل در حساب شما یادگرفته</dt><dd>{analysis.alreadyLearned.length}</dd></div>
        <div><dt>تعارض (در حساب شما «یادنگرفته» ثبت شده؛ بازنویسی نمی‌شود)</dt><dd data-testid="mig-conflicts">{analysis.conflicts.length}</dd></div>
        <div><dt>کلیدهای مبهم (واژهٔ تکراری در یک دسته)</dt><dd>{preview.ambiguousKeys}</dd></div>
        <div><dt>واژه‌های حذف‌شده (یتیم؛ وارد نمی‌شود)</dt><dd data-testid="mig-orphans">{preview.orphanedKeys}</dd></div>
        <div><dt>دادهٔ قدیمی‌تر (dvok5)</dt><dd>{dvok5Text[preview.dvok5]}</dd></div>
      </dl>
      {analysis.conflicts.length ? (<><h3 className="mig__h">تعارض‌ها</h3><List ids={analysis.conflicts} wordOf={wordOf} /></>) : null}
      {plan.ambiguous.length ? (
        <>
          <h3 className="mig__h">کلیدهای مبهم — هر دو ردیف علامت می‌خورد (مانند نسخهٔ قدیمی)</h3>
          <List ids={plan.ambiguous.map((a) => a.candidateIds[0]!)} wordOf={wordOf} />
        </>
      ) : null}
      {plan.orphans.length ? (
        <>
          <h3 className="mig__h">واژه‌هایی که دیگر وجود ندارند (وارد نمی‌شوند)</h3>
          <ul className="mig__list" lang="de" dir="ltr">
            {plan.orphans.slice(0, MAX_LISTED).map((o) => (
              <li key={o.legacyKey}>{o.legacyKey}{o.relocationCandidates.length ? ' ↪ ' + o.relocationCandidates.map(wordOf).join(', ') + ' (فقط اطلاع)' : ''}</li>
            ))}
            {plan.orphans.length > MAX_LISTED ? <li lang="fa" dir="rtl">و {plan.orphans.length - MAX_LISTED} مورد دیگر…</li> : null}
          </ul>
        </>
      ) : null}
      <p className="mig__note">
        واژه‌های شخصی ({preview.customWords.total}) و تنظیمات تلفظ در این مرحله منتقل نمی‌شوند و در نسخهٔ قدیمی دست‌نخورده می‌مانند.
        {preview.apiKeyPresent ? ' کلید API هرگز منتقل نمی‌شود.' : ''}
      </p>
      {preview.potentialDataLoss.length ? (
        <p className="mig__warn">موارد زیر وارد نمی‌شوند: {preview.potentialDataLoss.map((i) => i.code).join('، ')}</p>
      ) : null}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onDownload}>دانلود پشتیبان (JSON، بدون اطلاعات محرمانه)</button>
      </div>
      {!blocked ? (
        <label className="mig__confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.currentTarget.checked)} />
          <span>تأیید می‌کنم که {n} واژه به‌عنوان «یادگرفته» به حساب من اضافه شود.</span>
        </label>
      ) : null}
      <div className="dialog__actions">
        <button type="button" className="btn btn--primary" disabled={blocked || !confirmed} onClick={onImport} data-testid="mig-import">
          وارد کردن {n} واژه
        </button>
        <button type="button" className="btn" onClick={onBack}>بازگشت</button>
      </div>
    </div>
  );
}
