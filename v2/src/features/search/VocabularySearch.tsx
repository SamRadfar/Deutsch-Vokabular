import { Search, SlidersHorizontal } from 'lucide-react';
import { forwardRef, useId, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MOBILE_QUERY } from '../vocabulary/components/SubtabPanel';
import type { Category } from '../../models/vocabulary';
import { categoryName } from '../../models/vocabulary';
import { filtersActive, type SearchFilters, type StatusFilter } from './searchIndex';
import { PERSONAL_KEY, PERSONAL_LABEL } from '../review/deck';

interface Props {
  query: string;
  filters: SearchFilters;
  categories: readonly Category[];
  /** Number of personal words; the category filter offers "my words" when there are any. */
  personalCount: number;
  /** Learned/unlearned filters need the signed-in user's progress. */
  statusAvailable: boolean;
  /** Number of results (null while browsing without search or filters). */
  resultCount: number | null;
  onQuery(query: string): void;
  onFilters(filters: SearchFilters): void;
  onReset(): void;
}

const STATUS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'همه' },
  { value: 'learned', label: 'یادگرفته' },
  { value: 'unlearned', label: 'یادنگرفته' },
];

/** Search field + filters. Purely controlled; the results are rendered by the words section. */
export const VocabularySearch = forwardRef<HTMLInputElement, Props>(function VocabularySearch(
  { query, filters, categories, personalCount, statusAvailable, resultCount, onQuery, onFilters, onReset }, inputRef,
) {
  const ids = { q: useId(), cat: useId(), sub: useId(), hint: useId(), filters: useId() };
  const category = filters.category === 'all' || filters.category === PERSONAL_KEY ? null : categories.find((c) => c.key === filters.category) ?? null;
  const active = query.trim() !== '' || filtersActive(filters);
  const activeFilters = [filters.category !== 'all', filters.subtab !== 'all', filters.status !== 'all'].filter(Boolean).length;
  // Phones: the filters fold away behind a button so the words start right below the search field.
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [open, setOpen] = useState(false);
  const showFilters = !mobile || open;

  return (
    <search className="vsearch" lang="fa" dir="rtl" aria-label="جستجو و فیلتر واژه‌ها">
      <div className="vsearch__row">
        <label htmlFor={ids.q} className="visually-hidden">جستجوی واژه</label>
        <Search className="vsearch__icon" />
        <input
          ref={inputRef}
          id={ids.q}
          className="vsearch__input"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); onQuery(''); } }}
          placeholder="جستجو: واژهٔ آلمانی، معنی فارسی یا جملهٔ مثال"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-describedby={ids.hint}
        />
        <span id={ids.hint} className="visually-hidden">کلید / برای رفتن به جستجو، Escape برای پاک کردن</span>
      </div>
      {mobile ? (
        <div className="vsearch__bar">
          <button type="button" className="vsearch__toggle" aria-expanded={open} aria-controls={ids.filters} onClick={() => setOpen((o) => !o)}>
            <SlidersHorizontal />فیلترها{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          {active ? <button type="button" className="vsearch__reset" onClick={onReset}>پاک کردن</button> : null}
        </div>
      ) : null}
      <div className="vsearch__filters" id={ids.filters} hidden={!showFilters}>
        <label className="vsearch__field">
          <span>دسته</span>
          <select id={ids.cat} value={filters.category}
            onChange={(e) => onFilters({ ...filters, category: e.currentTarget.value as SearchFilters['category'], subtab: 'all' })}>
            <option value="all">همهٔ دسته‌ها</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{categoryName(c.label)}</option>)}
            {personalCount > 0 || filters.category === PERSONAL_KEY ? <option value={PERSONAL_KEY}>{PERSONAL_LABEL}</option> : null}
          </select>
        </label>
        <label className="vsearch__field">
          <span>زیرمجموعه</span>
          <select id={ids.sub} value={filters.subtab} disabled={!category} onChange={(e) => onFilters({ ...filters, subtab: e.currentTarget.value })}>
            <option value="all">{category ? 'همهٔ زیرمجموعه‌ها' : filters.category === PERSONAL_KEY ? '—' : 'ابتدا دسته را انتخاب کنید'}</option>
            {category?.subtabs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <div className={`vsearch__status${statusAvailable ? '' : ' is-disabled'}`} role="radiogroup" aria-label="وضعیت یادگیری">
          {STATUS.map((s) => (
            <label key={s.value} className={`vsearch__seg${filters.status === s.value ? ' is-selected' : ''}`}>
              <input type="radio" name="vsearch-status" value={s.value} checked={filters.status === s.value} disabled={!statusAvailable}
                onChange={() => onFilters({ ...filters, status: s.value })} />
              {s.label}
            </label>
          ))}
        </div>
        {active && !mobile ? <button type="button" className="vsearch__reset" onClick={onReset}>پاک کردن جستجو و فیلترها</button> : null}
        {!statusAvailable ? <p className="vsearch__note">فیلتر «یادگرفته / یادنگرفته» پس از ورود به حساب فعال می‌شود.</p> : null}
      </div>
      <p className="vsearch__count" role="status" aria-live="polite" data-testid="search-count">
        {resultCount === null ? '' : resultCount === 0 ? 'نتیجه‌ای پیدا نشد' : `${resultCount} واژه پیدا شد`}
      </p>
    </search>
  );
});
