import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Category, WordType } from '../../../models/vocabulary';
import { Dialog } from '../../../components/Dialog/Dialog';
import { AiAssist } from '../../ai/components/AiAssist';
import type { DuplicateIndex } from '../duplicates';
import {
  ARTICLES, LIMITS, isValidInput, normalizeInput, validateInput,
  type Article, type FieldErrors, type PersonalWord, type PersonalWordInput,
} from '../model';

const TYPES: Array<{ value: WordType; label: string }> = [
  { value: 'n', label: 'اسم (Nomen)' },
  { value: 'v', label: 'فعل (Verb)' },
  { value: 'a', label: 'صفت (Adjektiv)' },
  { value: 'au', label: 'عبارت (Ausdruck)' },
  { value: 'x', label: 'سایر' },
];

const EMPTY: PersonalWordInput = {
  article: null, lemma: '', type: 'n', grammar: '', fa: '', example: '', exampleFa: '', pronunciationFa: '', placement: null,
};

interface Props {
  /** Edit an existing word; absent = new word. */
  word?: PersonalWord;
  categories: readonly Category[];
  duplicates: DuplicateIndex;
  onSave(input: PersonalWordInput): FieldErrors | null;
  onClose(): void;
  /** Open with an AI "complete" request (from «✨ تکمیل» on a word). */
  aiComplete?: boolean;
  /** Open with the focus in the AI input (from «✨ افزودن با هوش مصنوعی»). */
  aiFocus?: boolean;
}

/** Add / edit dialog. Validation messages are shown per field; duplicates only warn. */
export function WordForm({ word, categories, duplicates, onSave, onClose, aiComplete = false, aiFocus = false }: Props) {
  const [v, setV] = useState<PersonalWordInput>(() => (word ? {
    article: word.article, lemma: word.lemma, type: word.type, grammar: word.grammar, fa: word.fa, example: word.example,
    exampleFa: word.exampleFa, pronunciationFa: word.pronunciationFa, placement: word.placement,
  } : EMPTY));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  // A new word's type counts as "not chosen yet" until the user picks one (AI may then fill it).
  const [typeChosen, setTypeChosen] = useState(!!word);
  const form = useRef<HTMLFormElement>(null);
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;
  const set = (patch: Partial<PersonalWordInput>) => {
    const next = { ...v, ...patch };
    setV(next);
    if (submitted) setErrors(validateInput(normalizeInput(next)));
  };

  const dupes = useMemo(() => (v.lemma.trim() ? duplicates.find(normalizeInput(v).lemma, word?.id) : []), [v, duplicates, word]);
  const category = v.placement ? categories.find((c) => c.key === v.placement!.category) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const clean = normalizeInput(v);
    const found = validateInput(clean);
    const result = isValidInput(found) ? onSave(clean) : found;
    if (result) {
      setErrors(result);
      // Move focus to the first invalid field.
      const first = Object.keys(result)[0];
      if (first) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
    }
  };

  const field = (name: keyof PersonalWordInput) => ({
    id: id(name),
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? id(`${name}-err`) : undefined,
  });
  const err = (name: keyof PersonalWordInput) => (errors[name] ? <p id={id(`${name}-err`)} className="pw-err">{errors[name]}</p> : null);

  return (
    <Dialog title={word ? 'ویرایش واژه' : 'افزودن واژهٔ جدید'} onClose={onClose}>
      <form ref={form} className="pw-form" onSubmit={submit} noValidate>
        <AiAssist value={v} typeIsDefault={!typeChosen} isEdit={!!word} autoRun={aiComplete} autoFocus={aiFocus}
          onApply={(next, fields) => { if (fields.includes('type')) setTypeChosen(true); set(next); }} />
        <div className="pw-grid">
          <div className="pw-field">
            <label htmlFor={id('type')}>نوع واژه</label>
            <select {...field('type')} value={v.type} onChange={(e) => { setTypeChosen(true); set({ type: e.currentTarget.value as WordType }); }}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {v.type === 'n' ? (
            <div className="pw-field">
              <label htmlFor={id('article')}>حرف تعریف</label>
              <select {...field('article')} value={v.article ?? ''} onChange={(e) => set({ article: (e.currentTarget.value || null) as Article | null })} lang="de">
                <option value="">—</option>
                {ARTICLES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        <div className="pw-field">
          <label htmlFor={id('lemma')}>واژه یا عبارت آلمانی <span aria-hidden="true">*</span></label>
          <input {...field('lemma')} value={v.lemma} onChange={(e) => set({ lemma: e.currentTarget.value })} lang="de" dir="ltr"
            required maxLength={LIMITS.lemma} autoComplete="off" spellCheck={false} placeholder="z. B. Nachhaltigkeit" />
          {err('lemma')}
          {dupes.length ? (
            <div className="pw-dupes" role="status">
              <p>این واژه از قبل وجود دارد (چیزی حذف یا ادغام نمی‌شود؛ می‌توانید باز هم ذخیره کنید):</p>
              <ul>
                {dupes.slice(0, 5).map((d) => (
                  <li key={d.id}><span lang="de" dir="ltr">{d.word}</span> — {d.fa || '…'} <small>({d.kind === 'builtIn' ? d.where : 'واژه‌های من'})</small></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="pw-field">
          <label htmlFor={id('fa')}>معنی فارسی <span aria-hidden="true">*</span></label>
          <input {...field('fa')} value={v.fa} onChange={(e) => set({ fa: e.currentTarget.value })} dir="rtl" lang="fa" required maxLength={LIMITS.fa} autoComplete="off" />
          {err('fa')}
        </div>

        <div className="pw-field">
          <label htmlFor={id('grammar')}>اطلاعات دستوری (اختیاری)</label>
          <input {...field('grammar')} value={v.grammar} onChange={(e) => set({ grammar: e.currentTarget.value })} lang="de" dir="ltr"
            maxLength={LIMITS.grammar} autoComplete="off" placeholder={v.type === 'n' ? 'Plural: die …' : v.type === 'v' ? 'Präteritum, Perfekt: …' : ''} />
          {err('grammar')}
        </div>

        <div className="pw-field">
          <label htmlFor={id('example')}>جملهٔ مثال آلمانی (اختیاری)</label>
          <textarea {...field('example')} value={v.example} onChange={(e) => set({ example: e.currentTarget.value })} lang="de" dir="ltr" rows={2} maxLength={LIMITS.example} />
          {err('example')}
        </div>

        <div className="pw-field">
          <label htmlFor={id('exampleFa')}>ترجمهٔ فارسی مثال (اختیاری)</label>
          <textarea {...field('exampleFa')} value={v.exampleFa} onChange={(e) => set({ exampleFa: e.currentTarget.value })} lang="fa" dir="rtl" rows={2} maxLength={LIMITS.exampleFa} />
          {err('exampleFa')}
        </div>

        <div className="pw-field">
          <label htmlFor={id('pronunciationFa')}>تلفظ به خط فارسی (اختیاری)</label>
          <input {...field('pronunciationFa')} value={v.pronunciationFa} onChange={(e) => set({ pronunciationFa: e.currentTarget.value })} lang="fa" dir="rtl" maxLength={LIMITS.pronunciationFa} autoComplete="off" />
          {err('pronunciationFa')}
        </div>

        <div className="pw-grid">
          <div className="pw-field">
            <label htmlFor={id('placement')}>نمایش در دسته (اختیاری)</label>
            <select {...field('placement')} value={v.placement?.category ?? ''}
              onChange={(e) => {
                const c = categories.find((x) => x.key === e.currentTarget.value);
                set({ placement: c ? { category: c.key, subtab: c.subtabs[0]?.id ?? '' } : null });
              }}>
              <option value="">فقط در «واژه‌های من»</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          {category ? (
            <div className="pw-field">
              <label htmlFor={id('subtab')}>زیرمجموعه</label>
              <select id={id('subtab')} value={v.placement!.subtab} onChange={(e) => set({ placement: { category: category.key, subtab: e.currentTarget.value } })}>
                {category.subtabs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        <div className="dialog__actions pw-actions">
          <button type="button" className="btn" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn btn--primary">{word ? 'ذخیرهٔ تغییرات' : 'افزودن واژه'}</button>
        </div>
      </form>
    </Dialog>
  );
}
