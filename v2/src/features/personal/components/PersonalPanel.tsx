import { Cloud, HardDrive, Plus, Sparkles, TriangleAlert, Upload } from 'lucide-react';
import '../personal.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, WordType } from '../../../models/vocabulary';
import { categoryName } from '../../../models/vocabulary';
import { Dialog } from '../../../components/Dialog/Dialog';
import { EmptyState } from '../../../components/EmptyState/EmptyState';
import { useProgress } from '../../progress/ProgressProvider';
import { flattenCards } from '../../review/deck';
import { fold, queryTerms } from '../../search/normalize';
import { createDuplicateIndex } from '../duplicates';
import { displayWord, type PersonalWord, type PersonalWordInput } from '../model';
import { usePersonal } from '../usePersonal';
import { describeSync } from '../../account/SyncStatusIndicator';
import type { PersonalSnapshot } from '../personalVocabulary';
import { PersonalWordCard } from './PersonalWordCard';
import { WordForm } from './WordForm';
import { useAiClient } from '../../ai/AiProvider';

// The legacy import (parsers, backup handling) is only loaded when the user opens it.
const LegacyImportDialog = lazy(() => import('./LegacyImportDialog').then((m) => ({ default: m.LegacyImportDialog })));

interface Props {
  categories: readonly Category[];
  /** Word to scroll to and focus (from search "show in list"). */
  focusId: string | null;
  onFocused(): void;
  onOpenReview(): void;
  onOpenShadowing(): void;
}

type StatusFilter = 'all' | 'learned' | 'unlearned' | 'incomplete' | 'duplicates';

/** Where the words are and whether the cloud has them (never claims "synced" before the server confirmed). */
function storageLine(s: PersonalSnapshot): { tone: 'ok' | 'busy' | 'warn' | 'error'; text: string; detail?: string } {
  if (!s.saved) return { tone: 'error', text: 'ذخیره روی این دستگاه ناموفق بود؛ تغییرات فقط تا بستن صفحه می‌مانند.' };
  const { status } = s.sync;
  if (s.sync.mode === 'local') {
    return {
      tone: 'warn',
      text: 'روی همین دستگاه برای حساب شما ذخیره می‌شود — همگام‌سازی ابری هنوز فعال نیست.',
      ...(status.pendingCount ? { detail: `${status.pendingCount} تغییر برای ارسال پس از فعال شدن همگام‌سازی نگه داشته شده است.` } : {}),
    };
  }
  const d = describeSync(status);
  const prefix = d.tone === 'ok' ? 'همگام با حساب شما: ' : '';
  return { tone: d.tone, text: `${prefix}${d.text}`, ...(d.detail ? { detail: d.detail } : {}) };
}
type Editing = { mode: 'new'; ai?: boolean } | { mode: 'edit'; word: PersonalWord; ai?: boolean } | null;

const TYPE_FILTER: Array<{ value: 'all' | WordType; label: string }> = [
  { value: 'all', label: 'همهٔ انواع' }, { value: 'n', label: 'اسم' }, { value: 'v', label: 'فعل' },
  { value: 'a', label: 'صفت' }, { value: 'au', label: 'عبارت' }, { value: 'x', label: 'سایر' },
];

/** The "⭐ واژه‌های من" section: the signed-in user's own words (device-local storage). */
export function PersonalPanel({ categories, focusId, onFocused, onOpenReview, onOpenShadowing }: Props) {
  const progress = useProgress();
  const ai = useAiClient();
  const { vocab, snapshot } = usePersonal();
  const builtIn = useMemo(() => flattenCards(categories), [categories]);
  const words = useMemo(() => snapshot?.words ?? [], [snapshot]);
  const duplicates = useMemo(() => createDuplicateIndex(builtIn, words), [builtIn, words]);

  const [editing, setEditing] = useState<Editing>(null);
  const [confirmDelete, setConfirmDelete] = useState<PersonalWord | null>(null);
  const [undo, setUndo] = useState<PersonalWord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | WordType>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);

  // The undo offer disappears after a while (the word is already deleted locally).
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 12_000);
    return () => clearTimeout(t);
  }, [undo]);

  // From search: bring the requested word into view.
  useEffect(() => {
    if (!focusId || !snapshot) return;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-personal-id="${focusId}"]`);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, snapshot]);

  const placementLabel = useCallback((w: PersonalWord) => {
    if (!w.placement) return null;
    const c = categories.find((x) => x.key === w.placement!.category);
    const s = c?.subtabs.find((x) => x.id === w.placement!.subtab);
    return c && s ? `${categoryName(c.label)} › ${s.label}` : null;
  }, [categories]);

  const terms = useMemo(() => queryTerms(query), [query]);
  const visible = useMemo(() => words.filter((w) => {
    if (type !== 'all' && w.type !== type) return false;
    if (status === 'learned' && !w.learned) return false;
    if (status === 'unlearned' && w.learned) return false;
    if (status === 'incomplete' && w.fa) return false;
    if (status === 'duplicates' && !duplicates.find(w.lemma, w.id).length) return false;
    if (!terms.length) return true;
    const hay = [displayWord(w), w.fa, w.example, w.exampleFa, w.grammar].map((t) => `${fold(t).text} ${fold(t, true).text}`).join(' ');
    return terms.every((t) => hay.includes(t));
  }), [words, type, status, terms, duplicates]);

  const toggleLearned = useCallback((id: string, learned: boolean) => vocab?.setLearned(id, learned), [vocab]);
  const onEdit = useCallback((word: PersonalWord) => setEditing({ mode: 'edit', word }), []);
  const onDelete = useCallback((word: PersonalWord) => setConfirmDelete(word), []);
  const onComplete = useCallback((word: PersonalWord) => setEditing({ mode: 'edit', word, ai: true }), []);

  if (progress.status === 'unavailable') {
    return (
      <section className="pw" aria-labelledby="pw-title" lang="fa" dir="rtl">
        <div className="page-head"><div className="page-head__text"><p className="page-head__eyebrow"><span>شخصی</span><span>واژه‌نامهٔ خودتان</span></p><h2 id="pw-title" className="page-head__title pw__title">واژه‌های من</h2></div></div>
        <EmptyState title="برای ساختن فهرست واژه‌های خودتان وارد حساب شوید"
          description="واژه‌های شخصی برای هر حساب جداگانه نگه داشته می‌شوند. ۹۹۹ واژهٔ داخلی بدون ورود هم در دسترس‌اند." />
      </section>
    );
  }
  if (!vocab || !snapshot) {
    return <section className="pw" lang="fa" dir="rtl"><p className="rv-notice" role="status">در حال بارگذاری واژه‌های شما…</p></section>;
  }

  const save = (input: PersonalWordInput) => {
    const result = editing?.mode === 'edit' ? vocab.update(editing.word.id, input) : vocab.add(input);
    if (!result.ok) return result.errors;
    setNotice(editing?.mode === 'edit' ? `«${displayWord(result.word)}» ذخیره شد.` : `«${displayWord(result.word)}» اضافه شد.`);
    setEditing(null);
    return null;
  };

  return (
    <section className="pw" aria-labelledby="pw-title" lang="fa" dir="rtl">
      <div className="pw__head page-head">
        <div className="page-head__text">
          <p className="page-head__eyebrow"><span>شخصی</span><span>واژه‌نامهٔ خودتان</span></p>
          <h2 id="pw-title" className="page-head__title pw__title">واژه‌های من <span className="pw__count">({words.length})</span></h2>
          {(() => {
            const line = storageLine(snapshot);
            return (
              <div className={`pw__storage pw__storage--${line.tone}`} data-testid="pw-storage" data-mode={snapshot.sync.mode} role="status" aria-live="polite">
                {line.tone === 'error' ? <TriangleAlert /> : snapshot.sync.mode === 'local' ? <HardDrive /> : <Cloud />}
                <span>{line.text}</span>
                {line.detail ? <span className="pw__storage-detail"> {line.detail}</span> : null}
                {snapshot.sync.status.failedCount > 0 ? (
                  <button type="button" className="pw-retry" onClick={() => vocab.retryFailed()}>تلاش دوباره</button>
                ) : null}
              </div>
            );
          })()}
          {snapshot.unreadable ? <p className="pw__storage is-error">{snapshot.unreadable} رکورد قابل خواندن نبود و دست‌نخورده باقی ماند.</p> : null}
        </div>
        <div className="page-head__actions pw__actions">
          <button type="button" className="fc-primary pw__add" onClick={() => setEditing({ mode: 'new' })}><Plus />افزودن واژه</button>
          {ai ? <button type="button" className="fc-secondary" onClick={() => setEditing({ mode: 'new', ai: true })}><Sparkles />افزودن با هوش مصنوعی</button> : null}
          <button type="button" className="fc-secondary" onClick={() => setImportOpen(true)}><Upload />انتقال از نسخهٔ قدیمی</button>
        </div>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">{notice ?? ''}</p>
      {snapshot.conflicts.map((c) => (
        <div key={c.copyId} className="pw-conflict" role="alert">
          <span>«<bdi lang="de" dir="ltr">{c.word}</bdi>» در دستگاه دیگری حذف شده بود؛ ویرایش شما از بین نرفت و به‌صورت واژهٔ تازه نگه داشته شد.</span>
          <button type="button" className="pw-undo__btn" onClick={() => vocab.dismissConflict(c.copyId)}>متوجه شدم</button>
        </div>
      ))}
      {undo ? (
        <div className="pw-undo" role="status">
          <span>«{displayWord(undo)}» حذف شد.</span>
          <button type="button" className="pw-undo__btn" onClick={() => { vocab.restore(undo); setUndo(null); setNotice(`«${displayWord(undo)}» بازگردانده شد.`); }}>بازگردانی</button>
        </div>
      ) : null}

      {words.length === 0 ? (
        <EmptyState title="هنوز واژه‌ای اضافه نکرده‌اید"
          description="واژه‌هایی را که در کلاس، کار یا متن‌ها می‌بینید اضافه کنید؛ در جستجو، فلش‌کارت و تمرین تلفظ هم ظاهر می‌شوند." />
      ) : (
        <>
          <div className="pw-filters">
            <label className="pw-filters__q">
              <span className="visually-hidden">جستجو در واژه‌های من</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="جستجو در واژه‌های من" />
            </label>
            <label>
              <span className="visually-hidden">نوع واژه</span>
              <select value={type} onChange={(e) => setType(e.currentTarget.value as 'all' | WordType)} aria-label="نوع واژه">
                {TYPE_FILTER.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label>
              <span className="visually-hidden">وضعیت</span>
              <select value={status} onChange={(e) => setStatus(e.currentTarget.value as StatusFilter)} aria-label="وضعیت">
                <option value="all">همه</option>
                <option value="learned">یادگرفته</option>
                <option value="unlearned">یادنگرفته</option>
                <option value="incomplete">ناقص (بدون معنی)</option>
                <option value="duplicates">تکراری</option>
              </select>
            </label>
            <p className="pw-filters__count" data-testid="pw-count">{visible.length} از {words.length}</p>
          </div>
          <div className="pw-practice">
            <button type="button" className="fc-secondary" onClick={onOpenReview}>مرور با فلش‌کارت</button>
            <button type="button" className="fc-secondary" onClick={onOpenShadowing}>تمرین تلفظ</button>
            <span className="pw-practice__hint">در مرور و تلفظ، دستهٔ «واژه‌های من» را انتخاب کنید.</span>
          </div>
          {visible.length ? (
            <ul className="pw-list" aria-label="فهرست واژه‌های من">
              {visible.map((w) => (
                <li key={w.id}>
                  <PersonalWordCard
                    word={w}
                    duplicates={duplicates.find(w.lemma, w.id)}
                    placementLabel={placementLabel(w)}
                    focused={focusId === w.id}
                    syncState={snapshot.sync.mode === 'cloud' ? snapshot.sync.stateOf(w.id) : 'synced'}
                    onToggleLearned={toggleLearned}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    {...(ai ? { onComplete } : {})}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="با این جستجو یا فیلتر واژه‌ای پیدا نشد" />
          )}
        </>
      )}

      {editing ? (
        <WordForm
          {...(editing.mode === 'edit' ? { word: editing.word, aiComplete: !!editing.ai } : { aiFocus: !!editing.ai })}
          categories={categories}
          duplicates={duplicates}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {confirmDelete ? (
        <Dialog title="حذف واژه" onClose={() => setConfirmDelete(null)}>
          <p>واژهٔ <bdi lang="de" dir="ltr">«{displayWord(confirmDelete)}»</bdi> از واژه‌های شما حذف شود؟ تا چند ثانیه پس از حذف می‌توانید آن را بازگردانید.</p>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>انصراف</button>
            <button type="button" className="btn btn--danger" onClick={() => {
              const removed = vocab.remove(confirmDelete.id);
              setConfirmDelete(null);
              if (removed) { setUndo(removed); setNotice(`«${displayWord(removed)}» حذف شد.`); }
            }}>حذف</button>
          </div>
        </Dialog>
      ) : null}

      {importOpen ? (
        <Suspense fallback={<p className="visually-hidden" role="status">در حال بارگذاری…</p>}>
          <LegacyImportDialog categories={categories} builtIn={builtIn} vocab={vocab} onClose={() => setImportOpen(false)} />
        </Suspense>
      ) : null}
      {focusId ? <FocusDone onDone={onFocused} /> : null}
    </section>
  );
}

/** Clears the one-time focus request after it was applied. */
function FocusDone({ onDone }: { onDone(): void }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, [onDone]);
  return null;
}
