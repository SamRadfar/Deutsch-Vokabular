import { ArrowLeftRight, Check, FolderPlus, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Category } from '../../models/vocabulary';
import { Dialog } from '../../components/Dialog/Dialog';
import type { PersonalWord } from '../personal/model';
import type { PersonalVocabulary } from '../personal/personalVocabulary';
import { CategoryDestinationPicker } from './CategoryDestinationPicker';
import { applyDestination, countWords, destinationError, type CatalogMain, type CatalogSub, type Destination } from './catalog';
import { CATEGORY_NAME_MAX, NAME_ERROR_TEXT, type NameError } from './model';
import { useCategories } from './useCategories';
import './categories.css';

interface Props {
  /** The library's categories (read-only). */
  builtIn: readonly Category[];
  vocab: PersonalVocabulary;
  words: readonly PersonalWord[];
  onClose(): void;
}

type Target = { main: CatalogMain; sub: CatalogSub | null };
type Panel =
  | { kind: 'rename'; target: Target; name: string; error: string | null }
  | { kind: 'addSub'; main: CatalogMain; name: string; error: string | null }
  | { kind: 'move'; target: Target; dest: Destination; error: string | null }
  | { kind: 'delete'; target: Target; dest: Destination; error: string | null }
  | null;

const errText = (e: NameError | 'invalid-parent' | 'not-found') => (e in NAME_ERROR_TEXT ? NAME_ERROR_TEXT[e as NameError] : 'این کار انجام نشد.');

/** «مدیریت دسته‌بندی‌ها»: the account's categories next to the read-only library categories. */
export function CategoryManager({ builtIn, vocab, words, onClose }: Props) {
  const uid = useId();
  const cats = useCategories(builtIn);
  const { store, catalog, builtInKeys } = cats;
  const counts = useMemo(() => countWords(words), [words]);
  const libraryCount = useMemo(() => new Map(builtIn.map((c) => [c.key as string, c.subtabs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.entries.length, 0), 0)])), [builtIn]);
  const [newMain, setNewMain] = useState('');
  const [mainError, setMainError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const wordsIn = (t: Target) => words.filter((w) => w.placement?.category === t.main.id && (!t.sub || w.placement.subtab === t.sub.id)).map((w) => w.id);
  const label = (t: Target) => (t.sub ? `${t.main.name} › ${t.sub.name}` : t.main.name);

  if (!store) return null;

  const createMain = () => {
    const r = store.create(newMain, null, builtInKeys);
    if (!r.ok) { setMainError(errText(r.error)); return; }
    setNewMain(''); setMainError(null); setNotice(`دستهٔ «${r.category.name}» ساخته شد.`);
  };

  /** Moves the words of a target to a destination; returns an error text or null. */
  const moveWords = async (t: Target, dest: Destination, deleting: boolean): Promise<string | null> => {
    if (dest.kind === 'existing' && dest.mainId === t.main.id && (deleting ? !t.sub || dest.subId === t.sub.id : dest.subId === (t.sub?.id ?? null))) {
      return deleting ? 'مقصد نباید همان دسته‌ای باشد که حذف می‌شود.' : 'مقصد همان دستهٔ فعلی است.';
    }
    if (dest.kind === 'newSub' && deleting && !t.sub && dest.mainId === t.main.id) return 'مقصد نباید داخل دسته‌ای باشد که حذف می‌شود.';
    const err = destinationError(dest, catalog);
    if (err) return err;
    const r = applyDestination(dest, store, builtInKeys);
    if (!r.ok) return r.error;
    await vocab.reassign(wordsIn(t), r.placement);
    return null;
  };

  const confirm = async () => {
    if (!panel) return;
    if (panel.kind === 'rename') {
      const id = panel.target.sub?.id ?? panel.target.main.id;
      const r = store.rename(id, panel.name);
      if (!r.ok) { setPanel({ ...panel, error: errText(r.error) }); return; }
      setNotice(`نام به «${r.category.name}» تغییر کرد.`);
    } else if (panel.kind === 'addSub') {
      const r = store.create(panel.name, panel.main.id, builtInKeys);
      if (!r.ok) { setPanel({ ...panel, error: errText(r.error) }); return; }
      setNotice(`زیرمجموعهٔ «${r.category.name}» در «${panel.main.name}» ساخته شد.`);
    } else if (panel.kind === 'move') {
      const n = wordsIn(panel.target).length;
      const err = await moveWords(panel.target, panel.dest, false);
      if (err) { setPanel({ ...panel, error: err }); return; }
      setNotice(`${n} واژه منتقل شد.`);
    } else {
      const n = wordsIn(panel.target).length;
      if (n) {
        const err = await moveWords(panel.target, panel.dest, true);
        if (err) { setPanel({ ...panel, error: err }); return; }
      }
      store.remove(panel.target.sub?.id ?? panel.target.main.id);
      setNotice(`«${label(panel.target)}» حذف شد${n ? `؛ ${n} واژه ${panel.dest.kind === 'none' ? 'بدون دسته ماند' : 'منتقل شد'}` : ''}.`);
    }
    setPanel(null);
  };

  const actions = (t: Target, own: boolean) => {
    const n = t.sub ? counts.get(`${t.main.id}|${t.sub.id}`) ?? 0 : counts.get(t.main.id) ?? 0;
    return (
      <>
        <span className="catm__count" title="واژه‌های شما در این دسته" data-testid="catm-count">{n}</span>
        {!t.sub ? (
          <button type="button" className="catm__btn" onClick={() => setPanel({ kind: 'addSub', main: t.main, name: '', error: null })}>
            <Plus aria-hidden="true" /> زیرمجموعه
          </button>
        ) : null}
        {own ? (
          <button type="button" className="catm__btn" aria-label={`تغییر نام ${label(t)}`} onClick={() => setPanel({ kind: 'rename', target: t, name: t.sub?.name ?? t.main.name, error: null })}>
            <Pencil aria-hidden="true" /> تغییر نام
          </button>
        ) : null}
        {n ? (
          <button type="button" className="catm__btn" aria-label={`انتقال واژه‌های ${label(t)}`} onClick={() => setPanel({ kind: 'move', target: t, dest: { kind: 'existing', mainId: catalog[0]?.id ?? '', subId: null }, error: null })}>
            <ArrowLeftRight aria-hidden="true" /> انتقال واژه‌ها
          </button>
        ) : null}
        {own ? (
          <button type="button" className="catm__btn catm__btn--danger" aria-label={`حذف ${label(t)}`} onClick={() => setPanel({ kind: 'delete', target: t, dest: { kind: 'none' }, error: null })}>
            <Trash2 aria-hidden="true" /> حذف
          </button>
        ) : null}
      </>
    );
  };

  const panelFor = (t: Target | null, main: CatalogMain) => {
    if (!panel) return null;
    const matches = panel.kind === 'addSub' ? !t && panel.main.id === main.id
      : (panel.target.main.id === main.id && (panel.target.sub?.id ?? null) === (t?.sub?.id ?? null) && !!t);
    if (!matches) return null;
    const n = panel.kind === 'move' || panel.kind === 'delete' ? wordsIn(panel.target).length : 0;
    return (
      <div className="catm__panel" data-testid="catm-panel">
        {panel.kind === 'rename' || panel.kind === 'addSub' ? (
          <div className="catm__edit">
            <input value={panel.name} maxLength={CATEGORY_NAME_MAX} dir="auto" autoFocus aria-label={panel.kind === 'rename' ? 'نام تازه' : `نام زیرمجموعهٔ جدید در ${main.name}`}
              onChange={(e) => setPanel({ ...panel, name: e.currentTarget.value, error: null })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirm(); } }} />
          </div>
        ) : null}
        {panel.kind === 'move' ? (
          <CategoryDestinationPicker legend={`انتقال ${n} واژه از «${label(panel.target)}» به`} value={panel.dest} onChange={(dest) => setPanel({ ...panel, dest, error: null })} catalog={catalog} />
        ) : null}
        {panel.kind === 'delete' ? (
          <>
            <p>«{label(panel.target)}»{!panel.target.sub && panel.target.main.subs.some((s) => !s.builtIn) ? ' و زیرمجموعه‌هایش' : ''} حذف شود؟ هیچ واژه‌ای حذف نمی‌شود.</p>
            {n ? <CategoryDestinationPicker legend={`${n} واژهٔ این دسته کجا بروند؟`} value={panel.dest} onChange={(dest) => setPanel({ ...panel, dest, error: null })} catalog={catalog} /> : null}
          </>
        ) : null}
        {panel.error ? <p className="cat-dest__error" role="alert">{panel.error}</p> : null}
        <div className="catm__row">
          <button type="button" className={`btn ${panel.kind === 'delete' ? 'btn--danger' : 'btn--primary'}`} onClick={() => { void confirm(); }}>
            <Check aria-hidden="true" /> {panel.kind === 'rename' ? 'ذخیرهٔ نام' : panel.kind === 'addSub' ? 'ساخت زیرمجموعه' : panel.kind === 'move' ? 'انتقال' : 'حذف دسته'}
          </button>
          <button type="button" className="btn" onClick={() => setPanel(null)}><X aria-hidden="true" /> انصراف</button>
        </div>
      </div>
    );
  };

  return (
    <Dialog title="مدیریت دسته‌بندی‌ها" onClose={onClose} size="lg"
      description="دسته‌های اصلی و زیرمجموعه‌های خودتان را بسازید، نامشان را عوض کنید یا واژه‌ها را جابه‌جا کنید. دسته‌های کتابخانه قفل‌اند، ولی می‌توانید در آن‌ها زیرمجموعهٔ خودتان بسازید.">
      <div className="catm" data-testid="category-manager">
        <div className="catm__new">
          <div className="pw-field">
            <label htmlFor={`${uid}-new`}>دسته اصلی جدید</label>
            <input id={`${uid}-new`} value={newMain} maxLength={CATEGORY_NAME_MAX} dir="auto" placeholder="مثلاً Reisen"
              onChange={(e) => { setNewMain(e.currentTarget.value); setMainError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createMain(); } }} />
          </div>
          <button type="button" className="btn btn--primary" onClick={createMain}><FolderPlus aria-hidden="true" /> ساخت دسته</button>
        </div>
        {mainError ? <p className="cat-dest__error" role="alert">{mainError}</p> : null}
        <p className="visually-hidden" role="status" aria-live="polite">{notice ?? ''}</p>
        {notice ? <p className="catm__sync" data-testid="catm-notice">{notice}</p> : null}

        <ul className="catm__list" aria-label="دسته‌ها">
          {catalog.map((main) => {
            const own = main.subs.filter((s) => !s.builtIn);
            const lib = main.subs.filter((s) => s.builtIn);
            return (
              <li key={main.id} className="catm__main" data-testid="catm-main" data-id={main.id}>
                <div className="catm__row">
                  <span className="catm__name" dir="auto">{main.name}</span>
                  {main.builtIn ? <span className="catm__lock"><Lock aria-hidden="true" /> کتابخانه · {libraryCount.get(main.id) ?? 0}</span> : null}
                  {actions({ main, sub: null }, !main.builtIn)}
                </div>
                {panelFor({ main, sub: null }, main)}
                {panelFor(null, main)}
                {own.length || lib.length ? (
                  <ul className="catm__subs">
                    {own.map((sub) => (
                      <li key={sub.id} className="catm__sub" data-testid="catm-sub" data-id={sub.id}>
                        <div className="catm__row"><span className="catm__name" dir="auto">{sub.name}</span>{actions({ main, sub }, true)}</div>
                        {panelFor({ main, sub }, main)}
                      </li>
                    ))}
                    {lib.length ? (
                      <li className="catm__sub">
                        <details>
                          <summary className="catm__lock"><Lock aria-hidden="true" /> {lib.length} زیرمجموعهٔ کتابخانه</summary>
                          <ul className="catm__subs">
                            {lib.map((sub) => (
                              <li key={sub.id} className="catm__sub">
                                <div className="catm__row"><span className="catm__name" dir="auto">{sub.name}</span>{actions({ main, sub }, false)}</div>
                                {panelFor({ main, sub }, main)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="catm__sync">
          {cats.snapshot?.sync.mode === 'cloud' ? 'دسته‌ها با حساب شما همگام می‌شوند.' : 'دسته‌ها روی همین دستگاه ذخیره می‌شوند؛ همگام‌سازی ابری دسته‌ها پس از فعال شدن انجام می‌شود.'}
          {' '}واژه‌های بدون دسته در «واژه‌های من» می‌مانند.
        </p>
      </div>
    </Dialog>
  );
}
