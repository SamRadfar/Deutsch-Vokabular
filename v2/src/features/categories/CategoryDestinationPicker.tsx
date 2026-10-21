import { FolderPlus, FolderTree, FolderOpen, FolderX } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { CATEGORY_NAME_MAX } from './model';
import { destinationError, type CatalogMain, type Destination } from './catalog';
import './categories.css';

interface Props {
  value: Destination;
  onChange(d: Destination): void;
  catalog: readonly CatalogMain[];
  /** Legend of the group (default «دسته‌بندی»). */
  legend?: string;
  /** Extra hint under the "new main category" option (e.g. AI subcategories). */
  newMainHint?: ReactNode;
  /** Hide «بدون دسته‌بندی» (e.g. "move words to …" where "none" has its own button). */
  allowNone?: boolean;
}

const firstMain = (catalog: readonly CatalogMain[]) => catalog[0]?.id ?? '';

/**
 * The ONE category destination control of the app (word form, AI generator, category management):
 * add to an existing category (optionally a subcategory), create a subcategory in an existing
 * category (built-in or own), create a new main category (optionally with a first subcategory), or
 * no category. Nothing is created here — the caller commits with applyDestination() on save.
 */
export function CategoryDestinationPicker({ value, onChange, catalog, legend = 'دسته‌بندی', newMainHint, allowNone = true }: Props) {
  const id = useId();
  const f = (n: string) => `${id}-${n}`;
  const error = destinationError(value, catalog);
  const own = catalog.filter((m) => !m.builtIn);
  const lib = catalog.filter((m) => m.builtIn);
  const mainOptions = (
    <>
      {lib.length ? <optgroup label="دسته‌های اصلی کتابخانه">{lib.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup> : null}
      {own.length ? <optgroup label="دسته‌های من">{own.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup> : null}
    </>
  );
  const mainOf = (d: Destination) => (d.kind === 'existing' || d.kind === 'newSub' ? d.mainId : firstMain(catalog));
  const pick = (kind: Destination['kind']) => {
    const mainId = mainOf(value);
    if (kind === 'none') onChange({ kind: 'none' });
    else if (kind === 'existing') onChange({ kind: 'existing', mainId, subId: null });
    else if (kind === 'newSub') onChange({ kind: 'newSub', mainId, name: '' });
    else onChange({ kind: 'newMain', name: value.kind === 'newMain' ? value.name : '', subName: '' });
  };
  const radio = (kind: Destination['kind'], label: string, icon: ReactNode, disabled = false) => (
    <label className={`cat-dest__opt${value.kind === kind ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input type="radio" name={f('kind')} value={kind} checked={value.kind === kind} disabled={disabled} onChange={() => pick(kind)} />
      {icon}<span>{label}</span>
    </label>
  );
  const main = value.kind === 'existing' || value.kind === 'newSub' ? catalog.find((m) => m.id === value.mainId) : undefined;

  return (
    <fieldset className="cat-dest" data-testid="category-destination" data-kind={value.kind}>
      <legend>{legend}</legend>
      <div className="cat-dest__opts" role="presentation">
        {radio('existing', 'افزودن به دسته موجود', <FolderOpen aria-hidden="true" />, !catalog.length)}
        {radio('newSub', 'ساخت زیرمجموعه در دسته موجود', <FolderTree aria-hidden="true" />, !catalog.length)}
        {radio('newMain', 'دسته اصلی جدید', <FolderPlus aria-hidden="true" />)}
        {allowNone ? radio('none', 'بدون دسته‌بندی', <FolderX aria-hidden="true" />) : null}
      </div>

      {value.kind === 'existing' ? (
        <div className="cat-dest__fields">
          <div className="pw-field">
            <label htmlFor={f('main')}>دسته اصلی</label>
            <select id={f('main')} value={value.mainId} onChange={(e) => onChange({ kind: 'existing', mainId: e.currentTarget.value, subId: null })}>{mainOptions}</select>
          </div>
          <div className="pw-field">
            <label htmlFor={f('sub')}>زیرمجموعه</label>
            <select id={f('sub')} value={value.subId ?? ''} onChange={(e) => onChange({ ...value, subId: e.currentTarget.value || null })}>
              <option value="">— مستقیم در همین دسته —</option>
              {main?.subs.map((s) => <option key={s.id} value={s.id}>{s.name}{s.builtIn ? '' : ' (من)'}</option>)}
            </select>
          </div>
        </div>
      ) : null}

      {value.kind === 'newSub' ? (
        <div className="cat-dest__fields">
          <div className="pw-field">
            <label htmlFor={f('nsmain')}>در دسته اصلی</label>
            <select id={f('nsmain')} value={value.mainId} onChange={(e) => onChange({ ...value, mainId: e.currentTarget.value })}>{mainOptions}</select>
          </div>
          <div className="pw-field">
            <label htmlFor={f('nsname')}>نام زیرمجموعهٔ جدید</label>
            <input id={f('nsname')} value={value.name} maxLength={CATEGORY_NAME_MAX} autoComplete="off" dir="auto"
              onChange={(e) => onChange({ ...value, name: e.currentTarget.value })} placeholder="مثلاً Flughafen" />
          </div>
        </div>
      ) : null}

      {value.kind === 'newMain' ? (
        <div className="cat-dest__fields">
          <div className="pw-field">
            <label htmlFor={f('nmname')}>نام دسته اصلی جدید</label>
            <input id={f('nmname')} value={value.name} maxLength={CATEGORY_NAME_MAX} autoComplete="off" dir="auto"
              onChange={(e) => onChange({ ...value, name: e.currentTarget.value })} placeholder="مثلاً Reisen" />
          </div>
          <div className="pw-field">
            <label htmlFor={f('nmsub')}>نخستین زیرمجموعه (اختیاری)</label>
            <input id={f('nmsub')} value={value.subName} maxLength={CATEGORY_NAME_MAX} autoComplete="off" dir="auto"
              onChange={(e) => onChange({ ...value, subName: e.currentTarget.value })} />
          </div>
          {newMainHint ? <p className="cat-dest__hint">{newMainHint}</p> : null}
        </div>
      ) : null}

      {error && (value.kind !== 'newMain' || value.name.trim()) && (value.kind !== 'newSub' || value.name.trim()) ? (
        <p className="cat-dest__error" role="alert" data-testid="category-destination-error">{error}</p>
      ) : null}
    </fieldset>
  );
}
