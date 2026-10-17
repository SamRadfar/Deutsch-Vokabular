import { useId, useMemo, useState, type ChangeEvent } from 'react';
import type { Category } from '../../../models/vocabulary';
import { Dialog } from '../../../components/Dialog/Dialog';
import { readLegacySnapshot } from '../../progress/migration/snapshot';
import { backupToSnapshot, parseBackup } from '../../progress/migration/backup';
import type { DeckCard } from '../../review/deck';
import { countImport, planLegacyImport, wordsToImport, type ImportStatus } from '../legacyImport';
import { displayWord } from '../model';
import type { PersonalVocabulary } from '../personalVocabulary';

interface Props {
  categories: readonly Category[];
  builtIn: readonly DeckCard[];
  vocab: PersonalVocabulary;
  onClose(): void;
}

type Source = { kind: 'same-origin' | 'file'; raw: string | null; label: string };

const STATUS_TEXT: Record<ImportStatus, string> = {
  new: 'منتقل می‌شود',
  incomplete: 'منتقل می‌شود (بدون معنی — بعداً کامل کنید)',
  'already-imported': 'قبلاً منتقل شده — رد می‌شود',
  'duplicate-personal': 'در «واژه‌های من» وجود دارد — رد می‌شود',
  'duplicate-builtin': 'در واژه‌های داخلی وجود دارد',
  invalid: 'قابل انتقال نیست',
};

function readSameOrigin(): string | null {
  try { return readLegacySnapshot(window.localStorage).dvok5_custom; } catch { return null; }
}

/**
 * Preview-first import of legacy custom words. The legacy data (localStorage of the old app on
 * the same origin, or a backup file) is only READ; nothing is written until the user confirms.
 */
export function LegacyImportDialog({ categories, builtIn, vocab, onClose }: Props) {
  const fileId = useId();
  const sameOrigin = useMemo(readSameOrigin, []);
  const [source, setSource] = useState<Source | null>(() => (sameOrigin ? { kind: 'same-origin', raw: sameOrigin, label: 'دادهٔ نسخهٔ قدیمی در همین مرورگر' } : null));
  const [fileError, setFileError] = useState<string | null>(null);
  const [includeBuiltIn, setIncludeBuiltIn] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => (source ? planLegacyImport(source.raw, {
    categories, builtIn, existing: vocab.getSnapshot().words, now: Date.now(),
  }) : null), [source, categories, builtIn, vocab]);
  const counts = plan ? countImport(plan) : null;
  const toImport = plan ? wordsToImport(plan, { includeBuiltInDuplicates: includeBuiltIn }) : [];

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { setFileError(parsed.error); return; }
    setSource({ kind: 'file', raw: backupToSnapshot(parsed.backup).dvok5_custom, label: `فایل پشتیبان: ${file.name}` });
  };

  const run = async () => {
    setBusy(true);
    await vocab.addMany(toImport);
    setBusy(false);
    setDone(toImport.length);
  };

  return (
    <Dialog title="انتقال واژه‌های شخصی از نسخهٔ قدیمی" onClose={onClose} busy={busy}>
      {done !== null ? (
        <>
          <p role="status">{done} واژه به «واژه‌های من» اضافه شد. دادهٔ نسخهٔ قدیمی دست‌نخورده باقی ماند؛ انتقال دوباره، واژه‌های منتقل‌شده را تکرار نمی‌کند.</p>
          <div className="dialog__actions"><button type="button" className="btn btn--primary" onClick={onClose}>بستن</button></div>
        </>
      ) : (
        <>
          <p>واژه‌هایی که در نسخهٔ قدیمی با «+» اضافه کرده بودید (dvok5_custom) را می‌توانید اینجا بیاورید. ابتدا پیش‌نمایش را ببینید؛ چیزی از نسخهٔ قدیمی حذف یا تغییر نمی‌کند.</p>
          {!sameOrigin ? (
            <p className="pw-note">در این مرورگر دادهٔ نسخهٔ قدیمی پیدا نشد (هر نشانی اینترنتی حافظهٔ جداگانه دارد). از فایل پشتیبانی استفاده کنید که در «انتقال پیشرفت» ساخته‌اید.</p>
          ) : null}
          <div className="pw-field">
            <label htmlFor={fileId}>فایل پشتیبان نسخهٔ قدیمی (JSON)</label>
            <input id={fileId} type="file" accept="application/json,.json" onChange={onFile} />
            {fileError ? <p className="pw-err" role="alert">{fileError}</p> : null}
          </div>

          {plan && counts ? (
            <div className="pw-import" data-testid="pw-import-preview">
              <p className="pw-import__src">منبع: {source!.label}</p>
              {plan.unreadable ? <p className="pw-err" role="alert">دادهٔ واژه‌های شخصی قابل خواندن نیست ({plan.unreadable}).</p> : null}
              {!plan.unreadable && plan.items.length === 0 ? <p>در این منبع واژهٔ شخصی‌ای وجود ندارد.</p> : null}
              {plan.items.length ? (
                <>
                  <ul className="pw-import__counts">
                    <li>منتقل می‌شود: <b data-testid="pw-import-new">{counts.new + counts.incomplete}</b>{counts.incomplete ? ` (${counts.incomplete} بدون معنی)` : ''}</li>
                    <li>قبلاً منتقل شده: <b>{counts['already-imported']}</b></li>
                    <li>تکراری در «واژه‌های من»: <b>{counts['duplicate-personal']}</b></li>
                    <li>تکراری با واژه‌های داخلی: <b>{counts['duplicate-builtin']}</b></li>
                    {counts.invalid || plan.malformed ? <li>نامعتبر: <b>{counts.invalid + plan.malformed}</b></li> : null}
                  </ul>
                  {counts['duplicate-builtin'] ? (
                    <label className="rv-check">
                      <input type="checkbox" checked={includeBuiltIn} onChange={(e) => setIncludeBuiltIn(e.currentTarget.checked)} />
                      واژه‌هایی را هم که در فهرست داخلی هستند منتقل کن (با معنی و مثال خودتان)
                    </label>
                  ) : null}
                  <details className="pw-import__list">
                    <summary>جزئیات ({plan.items.length} واژه)</summary>
                    <ul>
                      {plan.items.map((i) => (
                        <li key={i.legacy.id} data-status={i.status}>
                          <span lang="de" dir="ltr">{i.word ? displayWord(i.word) : i.legacy.word}</span>
                          {' — '}<span>{i.legacy.fa || '…'}</span>
                          {' · '}<small>{i.status === 'duplicate-builtin' && includeBuiltIn ? STATUS_TEXT.new : STATUS_TEXT[i.status]}{i.unsorted && i.word ? ' · بدون دسته' : ''}{i.reason ? ` (${i.reason})` : ''}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>انصراف</button>
            <button type="button" className="btn btn--primary" onClick={run} disabled={busy || toImport.length === 0}>
              {toImport.length ? `انتقال ${toImport.length} واژه` : 'واژه‌ای برای انتقال نیست'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
