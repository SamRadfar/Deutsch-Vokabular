import { Layers, Lock } from 'lucide-react';
import { useId } from 'react';
import {
  modeAvailable, REVIEW_MODES, SESSION_SIZES, selectCards,
  type DeckCard, type DeckProgress, type PracticeCategoryKey, type ReviewMode, type ReviewScope,
} from '../deck';
import type { ReviewBackend } from '../useReviewBackend';
import type { SubScope } from '../../categories/practiceSubs';

export interface SetupChoice {
  mode: ReviewMode;
  scope: ReviewScope;
  size: number | null;
  autoSpeak: boolean;
  /** Subcategory of the chosen main category; null = all subcategories. */
  subtab: string | null;
}

interface Props {
  cards: readonly DeckCard[];
  /** Built-in categories, plus "my words" when the user has personal words. */
  scopes: ReadonlyArray<{ key: PracticeCategoryKey; label: string }>;
  /** Subcategories of the chosen category ([] = no subcategory selector). */
  subs: readonly SubScope[];
  backend: ReviewBackend;
  choice: SetupChoice;
  onChange(choice: SetupChoice): void;
  onStart(): void;
}

const MODE_TEXT: Record<ReviewMode, { title: string; desc: string; empty: string }> = {
  all: { title: 'همهٔ واژه‌ها', desc: 'ترکیبی تصادفی از همهٔ واژه‌ها', empty: 'در این دسته واژه‌ای نیست.' },
  unlearned: { title: 'یادنگرفته‌ها', desc: 'واژه‌هایی که هنوز تیک نخورده‌اند', empty: 'همهٔ واژه‌های این دسته را یاد گرفته‌ای!' },
  learned: { title: 'یادگرفته‌ها', desc: 'تکرار واژه‌هایی که بلدی', empty: 'هنوز واژه‌ای در این دسته یاد نگرفته‌ای.' },
  again: { title: 'مرور دوباره', desc: 'واژه‌هایی که آخرین بار بلد نبودی', empty: 'فهرست «مرور دوباره» خالی است.' },
};

export function ReviewSetup({ cards, scopes, subs, backend, choice, onChange, onStart }: Props) {
  const ids = { scope: useId(), sub: useId(), size: useId(), speak: useId() };
  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  const countFor = (mode: ReviewMode, scope: ReviewScope = choice.scope, subtab: string | null = choice.subtab) =>
    selectCards(cards, mode, scope, progress, scope === 'all' ? null : subtab).length;
  const available = modeAvailable(choice.mode, progress);
  const selected = available ? countFor(choice.mode) : 0;
  const sessionCount = choice.size === null ? selected : Math.min(selected, choice.size);
  const set = (patch: Partial<SetupChoice>) => onChange({ ...choice, ...patch });

  return (
    <section className="rv-setup" aria-labelledby="rv-title" lang="fa" dir="rtl">
      <div className="rv-hero page-head">
        <span className="rv-hero__icon"><Layers /></span>
        <div className="page-head__text">
          <p className="page-head__eyebrow"><span>تمرین</span><span>فلش‌کارت</span></p>
          <h2 id="rv-title" className="page-head__title">مرور با فلش‌کارت</h2>
          <p className="page-head__sub rv-hero__sub">واژهٔ آلمانی را ببین، معنی را به خاطر بیاور، کارت را برگردان و بگو بلد بودی یا نه.</p>
        </div>
      </div>

      <div className="rv-layout">
        <div className="rv-main">
          {backend.status === 'ready' ? (
            <div className="rv-stats">
              <div className="rv-stat"><span className="rv-stat__n">{countFor('learned', 'all')}</span><span className="rv-stat__l">یادگرفته</span></div>
              <div className="rv-stat"><span className="rv-stat__n">{countFor('unlearned', 'all')}</span><span className="rv-stat__l">یادنگرفته</span></div>
              <div className="rv-stat"><span className="rv-stat__n">{countFor('again', 'all')}</span><span className="rv-stat__l">برای مرور دوباره</span></div>
            </div>
          ) : (
            <p className="rv-notice" role="note">
              {backend.status === 'loading'
                ? 'در حال بارگذاری پیشرفت شما…'
                : 'وارد حساب نشده‌اید: می‌توانید تمرین کنید، ولی نتیجه‌ها ذخیره نمی‌شوند. حالت‌های «یادنگرفته»، «یادگرفته» و «مرور دوباره» پس از ورود فعال می‌شوند.'}
            </p>
          )}

          <fieldset className="rv-modes">
            <legend>کدام واژه‌ها؟</legend>
            {REVIEW_MODES.map((mode) => {
              const enabled = modeAvailable(mode, progress);
              const n = enabled ? countFor(mode) : null;
              return (
                <label key={mode} className={`rv-mode${choice.mode === mode ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}`}>
                  <input type="radio" name="rv-mode" value={mode} checked={choice.mode === mode} disabled={!enabled} onChange={() => set({ mode })} />
                  <span className="rv-mode__title">{MODE_TEXT[mode].title}</span>
                  <span className="rv-mode__count" aria-label={n === null ? 'پس از ورود' : `${n} واژه`}>{n === null ? <Lock /> : n}</span>
                  <span className="rv-mode__desc">{MODE_TEXT[mode].desc}</span>
                </label>
              );
            })}
          </fieldset>
        </div>

        <div className="rv-side">
          <p className="rv-side__title">تنظیمات جلسه</p>
          <div className="rv-options">
            <div className="rv-field">
              <label htmlFor={ids.scope}>دسته</label>
              <select id={ids.scope} value={choice.scope} onChange={(e) => set({ scope: e.currentTarget.value as ReviewScope, subtab: null })}>
                <option value="all">همهٔ دسته‌ها</option>
                {scopes.map((c) => <option key={c.key} value={c.key}>{c.label}{available ? ` (${countFor(choice.mode, c.key, null)})` : ''}</option>)}
              </select>
            </div>
            {choice.scope !== 'all' && subs.length ? (
              <div className="rv-field">
                <label htmlFor={ids.sub}>زیرمجموعه</label>
                <select id={ids.sub} value={choice.subtab ?? ''} onChange={(e) => set({ subtab: e.currentTarget.value || null })}>
                  <option value="">همه زیرمجموعه‌ها{available ? ` (${countFor(choice.mode, choice.scope, null)})` : ''}</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.label}{available ? ` (${countFor(choice.mode, choice.scope, s.id)})` : ''}</option>)}
                </select>
              </div>
            ) : null}
            <div className="rv-field">
              <label htmlFor={ids.size}>تعداد کارت در جلسه</label>
              <select id={ids.size} value={choice.size === null ? 'all' : String(choice.size)}
                onChange={(e) => set({ size: e.currentTarget.value === 'all' ? null : Number(e.currentTarget.value) })}>
                {SESSION_SIZES.map((n) => <option key={n ?? 'all'} value={n ?? 'all'}>{n ?? 'همه'}</option>)}
              </select>
            </div>
            <label className="rv-check" htmlFor={ids.speak}>
              <input id={ids.speak} type="checkbox" checked={choice.autoSpeak} onChange={(e) => set({ autoSpeak: e.currentTarget.checked })} />
              تلفظ خودکار واژه هنگام برگرداندن کارت
            </label>
          </div>

          {available && selected === 0 ? <p className="rv-empty" role="status">{MODE_TEXT[choice.mode].empty}</p> : null}
          <button type="button" className="fc-primary rv-start" onClick={onStart} disabled={sessionCount === 0}>
            {sessionCount > 0 ? `شروع مرور (${sessionCount} کارت)` : 'کارتی برای مرور نیست'}
          </button>
        </div>
      </div>
    </section>
  );
}
