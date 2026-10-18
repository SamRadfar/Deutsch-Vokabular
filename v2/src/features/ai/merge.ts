// Review step between an AI suggestion and the form. Nothing is taken over silently:
//  - empty fields are pre-selected ("fill"),
//  - fields the user already filled are NOT selected when the suggestion differs ("replace" needs
//    an explicit tick),
//  - identical values are shown as "same" and need no action.
// Applying only changes the form; saving remains the user's separate click.

import type { AiFields } from '../../../ai-worker/src/contract';
import { cleanText, type PersonalWordInput } from '../personal/model';

export type AiField = keyof AiFields;

export const AI_FIELD_LABELS: Record<AiField, string> = {
  lemma: 'واژهٔ آلمانی',
  article: 'حرف تعریف',
  type: 'نوع واژه',
  fa: 'معنی فارسی',
  grammar: 'اطلاعات دستوری',
  example: 'جملهٔ مثال',
  exampleFa: 'ترجمهٔ مثال',
  pronunciationFa: 'تلفظ',
};
/** Display order of the review rows. */
export const AI_FIELD_ORDER: readonly AiField[] = ['lemma', 'article', 'type', 'fa', 'grammar', 'example', 'exampleFa', 'pronunciationFa'];
const TYPE_LABELS: Record<string, string> = { n: 'اسم', v: 'فعل', a: 'صفت', au: 'عبارت', x: 'سایر' };

export interface ReviewRow {
  field: AiField;
  label: string;
  /** Display text (type as a Persian label). */
  current: string;
  suggested: string;
  /** fill = the field is empty; replace = the user has a different value; same = nothing to do. */
  kind: 'fill' | 'replace' | 'same';
  /** Pre-selected? Only "fill" rows. */
  preselected: boolean;
}

const raw = (v: PersonalWordInput, field: AiField): string =>
  field === 'article' ? v.article ?? '' : field === 'type' ? v.type : cleanText(v[field]);

/**
 * @param typeIsDefault the word type was never chosen by the user (new word): then it counts as
 *   empty and the suggested type is pre-selected.
 */
export function reviewRows(current: PersonalWordInput, s: AiFields, opts: { typeIsDefault: boolean }): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const field of AI_FIELD_ORDER) {
    if (field === 'article' && s.type !== 'n') continue; // articles only for nouns
    const sug = field === 'article' ? s.article ?? '' : String(s[field]);
    if (!sug) continue; // nothing suggested for this field
    const cur = raw(current, field);
    const empty = field === 'type' ? opts.typeIsDefault : !cur;
    const kind: ReviewRow['kind'] = cur === sug ? 'same' : empty ? 'fill' : 'replace';
    const label = (t: string) => (field === 'type' ? TYPE_LABELS[t] ?? t : t);
    rows.push({ field, label: AI_FIELD_LABELS[field], current: label(cur), suggested: label(sug), kind, preselected: kind === 'fill' });
  }
  return rows;
}

/** The form values after taking over exactly the selected fields. */
export function applySelected(current: PersonalWordInput, s: AiFields, selected: ReadonlySet<AiField>): PersonalWordInput {
  const next: PersonalWordInput = { ...current };
  for (const field of selected) {
    if (field === 'article') next.article = s.article;
    else if (field === 'type') next.type = s.type;
    else next[field] = s[field];
  }
  if (next.type !== 'n') next.article = null;
  return next;
}

/** Fields of a saved word that are still empty (for "complete with AI"). */
export function missingFields(w: Pick<PersonalWordInput, 'fa' | 'grammar' | 'example' | 'exampleFa' | 'pronunciationFa' | 'type' | 'article'>): AiField[] {
  const out: AiField[] = [];
  if (w.type === 'n' && !w.article) out.push('article');
  for (const f of ['fa', 'grammar', 'example', 'exampleFa', 'pronunciationFa'] as const) if (!w[f]) out.push(f);
  return out;
}

/** What is sent for "complete": the user's current values (the worker fills only empty ones). */
export function existingForRequest(v: PersonalWordInput): Partial<AiFields> {
  const c = (t: string, max: number) => cleanText(t).slice(0, max);
  return {
    article: v.type === 'n' ? v.article : null,
    lemma: c(v.lemma, 120), type: v.type, grammar: c(v.grammar, 200), fa: c(v.fa, 200),
    example: c(v.example, 400), exampleFa: c(v.exampleFa, 400), pronunciationFa: c(v.pronunciationFa, 200),
  };
}
