// Read-only helpers for extracting data from the legacy single-file app (index.html).
//
// Nothing here executes the application. Only the object literals assigned to
// `const DATA` and `const BAUTECHNIK_INFO` are located with a string-aware brace
// scanner and evaluated in an empty `vm` context.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

/** Read a source file and normalise line endings (Windows checkouts use CRLF). */
export function readSource(path) {
  return normaliseEol(readFileSync(path, 'utf8'));
}

export function normaliseEol(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Return the source text of the object literal assigned by `const <name> = { ... }`.
 * Skips braces inside strings, template literals and comments.
 */
export function findObjectLiteral(src, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`);
  const m = decl.exec(src);
  if (!m) throw new Error(`Declaration of ${name} not found`);
  const start = m.index + m[0].length - 1; // position of the opening brace
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i, ch); continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Unterminated object literal for ${name}`);
}

function skipString(src, i, quote) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === quote) return j;
    if (quote !== '`' && src[j] === '\n') throw new Error(`Unterminated string at offset ${i}`);
  }
  throw new Error(`Unterminated string at offset ${i}`);
}

/** Evaluate an object literal in an empty context and return a plain JSON value. */
export function evaluateLiteral(literal) {
  const value = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 2000 });
  return JSON.parse(JSON.stringify(value));
}

export function extractData(src) {
  return evaluateLiteral(findObjectLiteral(src, 'DATA'));
}

export function extractBautechnikInfo(src) {
  return evaluateLiteral(findObjectLiteral(src, 'BAUTECHNIK_INFO'));
}

export function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Characters that would make the browser's `textContent` differ from the raw word string. */
export const HTML_SENSITIVE = /[<>&]/;

/**
 * Every built-in vocabulary row in the order the legacy app renders it
 * (Object.keys(DATA) → tabs → groups → rows), which is also the order of the
 * `.vchk:not(.cchk)` checkboxes in the DOM.
 *
 * `progressKey` reproduces legacy `rowKey()`: `mainKey + '::' + wordCell.textContent.trim()`.
 * The cell is filled via innerHTML, so the equality with `word.trim()` only holds while no
 * word contains HTML-sensitive characters; the baseline tests assert that.
 */
export function listRows(data) {
  const rows = [];
  for (const mainKey of Object.keys(data)) {
    data[mainKey].tabs.forEach((tab, tabIndex) => {
      tab.groups.forEach((group, groupIndex) => {
        group.rows.forEach((row, rowIndex) => {
          const word = row[0];
          rows.push({
            domIndex: rows.length,
            mainKey,
            tabId: tab.id,
            tabIndex,
            groupIndex,
            rowIndex,
            word,
            type: row[1],
            progressKey: `${mainKey}::${String(word).trim()}`,
          });
        });
      });
    });
  }
  return rows;
}

/** Legacy `TYPE_MAP` keys (index.html, render engine). */
export const LEGACY_TYPE_KEYS = ['n', 'v', 'a', 'au', 's'];

export function computeStats(data, info) {
  const rows = listRows(data);
  const typeCounts = {};
  for (const r of rows) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;

  const categories = Object.keys(data).map((mainKey) => {
    const section = data[mainKey];
    const tabs = section.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      groups: tab.groups.length,
      words: tab.groups.reduce((n, g) => n + g.rows.length, 0),
    }));
    return {
      mainKey,
      label: section.label,
      theme: section.theme,
      tabs,
      words: tabs.reduce((n, t) => n + t.words, 0),
    };
  });

  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.progressKey)) byKey.set(r.progressKey, []);
    byKey.get(r.progressKey).push(`${r.tabId}#${r.groupIndex}.${r.rowIndex}`);
  }
  const progressKeyCollisions = [...byKey]
    .filter(([, locs]) => locs.length > 1)
    .map(([key, locations]) => ({ key, locations }));

  const sections = new Map();
  for (const r of rows) {
    if (!sections.has(r.word)) sections.set(r.word, new Set());
    sections.get(r.word).add(r.mainKey);
  }
  const crossCategoryWords = [...sections]
    .filter(([, s]) => s.size > 1)
    .map(([word, s]) => ({ word, mainKeys: [...s] }));

  const bautechnikWords = new Set(rows.filter((r) => r.mainKey === 'bautechnik').map((r) => r.word));
  const infoKeys = Object.keys(info || {});

  return {
    totals: {
      categories: categories.length,
      subtabs: categories.reduce((n, c) => n + c.tabs.length, 0),
      emptySubtabs: categories.flatMap((c) => c.tabs.filter((t) => t.words === 0).map((t) => `${c.mainKey}/${t.id}`)),
      groups: categories.reduce((n, c) => n + c.tabs.reduce((m, t) => m + t.groups, 0), 0),
      words: rows.length,
      uniqueProgressKeys: byKey.size,
    },
    typeCounts,
    typesOutsideLegacyTypeMap: Object.keys(typeCounts).filter((t) => !LEGACY_TYPE_KEYS.includes(t)),
    categories,
    progressKeyCollisions,
    crossCategoryWords,
    bautechnikInfo: {
      entries: infoKeys.length,
      displayed: infoKeys.filter((k) => bautechnikWords.has(k)).length,
      neverDisplayed: infoKeys.filter((k) => !bautechnikWords.has(k)),
    },
  };
}
