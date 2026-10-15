// Defensive parsers for legacy localStorage values. Each returns a tagged result and never
// throws, so one malformed key cannot prevent the others from being interpreted.

import type { LegacyCustomWord, LegacyPronSettings } from '../../../models/legacy';

export type Parsed<T> =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; value: T; warnings: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(raw: string | null): { ok: true; value: unknown } | { ok: false; reason: string } | null {
  if (raw === null) return null;
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
}

/** dvok6: Record<"mainKey::word", true>. Legacy loadState() treats any truthy value as checked. */
export function parseDvok6(raw: string | null): Parsed<string[]> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!isRecord(j.value)) return { status: 'invalid', reason: 'expected an object' };
  const warnings: string[] = [];
  const checked: string[] = [];
  for (const [key, v] of Object.entries(j.value)) {
    if (v !== true && v !== false) warnings.push(`non-boolean value for "${key}"`);
    if (v) checked.push(key);
  }
  return { status: 'ok', value: checked, warnings };
}

/** dvok5: Record<"<index>", boolean> with contiguous indexes 0..n-1 (one per checkbox). */
export function parseDvok5(raw: string | null): Parsed<{ entryCount: number; checkedIndexes: number[]; contiguous: boolean }> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!isRecord(j.value)) return { status: 'invalid', reason: 'expected an object' };
  const keys = Object.keys(j.value);
  const indexes = keys.map((k) => (/^(0|[1-9]\d*)$/.test(k) ? Number(k) : NaN));
  const contiguous = indexes.every((n) => Number.isInteger(n)) && new Set(indexes).size === keys.length
    && indexes.every((n) => n < keys.length);
  const warnings: string[] = [];
  const checkedIndexes: number[] = [];
  for (const [k, v] of Object.entries(j.value)) {
    if (typeof v !== 'boolean') warnings.push(`non-boolean value at index ${k}`);
    if (v) checkedIndexes.push(Number(k));
  }
  checkedIndexes.sort((a, b) => a - b);
  return { status: 'ok', value: { entryCount: keys.length, checkedIndexes, contiguous }, warnings };
}

const CUSTOM_STRING_FIELDS = ['id', 'main', 'tab', 'word', 'sentence', 'type', 'fa', 'ex', 'exFa', 'pr'] as const;

/** dvok5_custom: LegacyCustomWord[]. Invalid elements are counted, valid ones kept verbatim. */
export function parseCustomWords(raw: string | null): Parsed<{ words: LegacyCustomWord[]; invalid: number }> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!Array.isArray(j.value)) return { status: 'invalid', reason: 'expected an array' };
  const words: LegacyCustomWord[] = [];
  let invalid = 0;
  for (const item of j.value) {
    if (
      isRecord(item)
      && CUSTOM_STRING_FIELDS.every((f) => typeof item[f] === 'string')
      && (item.status === 'pending' || item.status === 'ready')
      && typeof item.checked === 'boolean'
      && (item.id as string).length > 0
      && (item.word as string).length > 0
    ) {
      words.push({
        id: item.id as string, main: item.main as string, tab: item.tab as string, word: item.word as string,
        sentence: item.sentence as string, type: item.type as string, fa: item.fa as string, ex: item.ex as string,
        exFa: item.exFa as string, pr: item.pr as string, status: item.status, checked: item.checked,
      });
    } else invalid++;
  }
  const ids = new Set<string>();
  const warnings: string[] = [];
  for (const w of words) {
    if (ids.has(w.id)) warnings.push(`duplicate custom word id "${w.id}"`);
    ids.add(w.id);
  }
  return { status: 'ok', value: { words, invalid }, warnings };
}

export const DEFAULT_PRON_SETTINGS: LegacyPronSettings = { repeat: 'twotwo', pause: 4, rate: 0.85, shadow: false };
const RATES = [0.55, 0.85, 1.2];

/** dvok5_pron_settings: out-of-range fields fall back to the legacy defaults, with a warning each. */
export function parsePronSettings(raw: string | null): Parsed<LegacyPronSettings> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!isRecord(j.value)) return { status: 'invalid', reason: 'expected an object' };
  const v = j.value;
  const warnings: string[] = [];
  const out: LegacyPronSettings = { ...DEFAULT_PRON_SETTINGS };
  if (v.repeat === 'once' || v.repeat === 'twice' || v.repeat === 'twotwo') out.repeat = v.repeat;
  else if (v.repeat !== undefined) warnings.push('repeat out of range → default');
  if (typeof v.pause === 'number' && v.pause >= 1 && v.pause <= 8) out.pause = v.pause;
  else if (v.pause !== undefined) warnings.push('pause out of range → default');
  if (typeof v.rate === 'number' && RATES.includes(v.rate)) out.rate = v.rate;
  else if (v.rate !== undefined) warnings.push('rate out of range → default');
  if (typeof v.shadow === 'boolean') out.shadow = v.shadow;
  else if (v.shadow !== undefined) warnings.push('shadow not boolean → default');
  return { status: 'ok', value: out, warnings };
}

/** dvok5_pron_exposure: Record<wordText, count>. Non-numeric or negative counts are dropped with a warning. */
export function parseExposure(raw: string | null): Parsed<Record<string, number>> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!isRecord(j.value)) return { status: 'invalid', reason: 'expected an object' };
  const out: Record<string, number> = {};
  const warnings: string[] = [];
  for (const [word, n] of Object.entries(j.value)) {
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[word] = n;
    else warnings.push(`invalid exposure count for "${word}"`);
  }
  return { status: 'ok', value: out, warnings };
}

export function parseStringArray(raw: string | null): Parsed<string[]> {
  const j = parseJson(raw);
  if (!j) return { status: 'absent' };
  if (!j.ok) return { status: 'invalid', reason: j.reason };
  if (!Array.isArray(j.value) || !j.value.every((x) => typeof x === 'string')) return { status: 'invalid', reason: 'expected string[]' };
  return { status: 'ok', value: j.value as string[], warnings: [] };
}
