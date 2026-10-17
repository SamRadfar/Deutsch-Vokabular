// Search folding for German and Persian text, with a position map back to the original string so
// matches can be highlighted exactly (as React text — never as HTML).
//
// German: case-insensitive; ß → ss; accents/umlauts folded to the base letter (ä → a), and a
// second "transliterated" form (ä → ae, ö → oe, ü → ue) so both "Aussenwand"/"Außenwand" and
// "Uebung"/"Übung"/"Ubung" match.
// Persian/Arabic: Arabic yeh/kaf → Persian ی/ک; hamza and madda forms of alef → ا; ة → ه; ؤ → و;
// ئ → ی; diacritics (harakat), tatweel and zero-width non-joiners removed; Persian/Arabic digits → 0-9.

export interface Folded {
  /** Folded text. */
  text: string;
  /** For each character of `text`, the index of the original character it came from. */
  map: number[];
}

const PERSIAN: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'ؤ': 'و',
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
};
const REMOVED = /[ً-ٰٟـ‌‍‎‏­]/; // harakat, superscript alef, tatweel, ZWNJ/ZWJ, marks, soft hyphen
const COMBINING = /[̀-ͯ]/g;
const TRANSLIT: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' };

function foldChar(ch: string, translit: boolean): string {
  if (REMOVED.test(ch)) return '';
  const p = PERSIAN[ch];
  if (p) return p;
  const code = ch.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0); // Persian digits
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660); // Arabic-Indic digits
  const lower = ch.toLowerCase();
  if (lower === 'ß') return 'ss'; // also ẞ (its lower case is ß)
  if (translit && TRANSLIT[lower]) return TRANSLIT[lower]!;
  if (/\s/.test(lower)) return ' ';
  return lower.normalize('NFD').replace(COMBINING, '');
}

/** Folds `input`; `translit` selects the ä→ae form instead of ä→a. Runs of whitespace collapse to one space. */
export function fold(input: string, translit = false): Folded {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of input) { // by code point
    const out = foldChar(ch, translit);
    for (const c of out) {
      if (c === ' ' && (text.length === 0 || text.endsWith(' '))) continue;
      text += c;
      map.push(i);
    }
    i += ch.length;
  }
  if (text.endsWith(' ')) { text = text.slice(0, -1); map.pop(); }
  return { text, map };
}

/** Folded query terms (whitespace separated, empty terms dropped). */
export function queryTerms(query: string): string[] {
  return fold(query).text.split(' ').filter(Boolean);
}

/** Original [start, end) range (UTF-16 indices of `original`) of a match at folded [from, from + length). */
export function originalRange(f: Folded, original: string, from: number, length: number): [number, number] {
  const start = f.map[from]!;
  const lastOrig = f.map[from + length - 1]!;
  // Include every UTF-16 unit of the last original character (a surrogate pair counts as one).
  return [start, lastOrig + ((original.codePointAt(lastOrig) ?? 0) > 0xffff ? 2 : 1)];
}
