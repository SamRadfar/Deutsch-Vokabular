import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render } from '@testing-library/react';
import { VocabularyTable } from '../../../src/features/vocabulary/components/VocabularyTable';
import { VocabularyCards } from '../../../src/features/vocabulary/components/VocabularyCards';
import { PronunciationProvider } from '../../../src/features/pronunciation/PronunciationProvider';
import type { TechnicalInfo, VocabularyGroup } from '../../../src/models/vocabulary';
import { fakeSpeech } from '../../helpers/dom';

declare global {
  interface Window { __xss?: number }
}

const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1</script>',
  '"><svg onload="window.__xss=1">',
  'javascript:window.__xss=1',
  '<b>bold</b> &amp; &lt;',
  '‮evil‬',
];

const groups: VocabularyGroup[] = [{
  label: PAYLOADS[1]!,
  entries: PAYLOADS.map((p, i) => ({
    id: `dv_${String(i).padStart(10, '0')}`,
    word: p, type: 'n', fa: p, example: p, exampleFa: p, pronunciationFa: p,
  })),
}];
const info: TechnicalInfo = {
  legacyWord: PAYLOADS[0]!, entryIds: [], formula: { label: PAYLOADS[0]!, value: PAYLOADS[2]! },
  rows: [{ key: PAYLOADS[1]!, value: PAYLOADS[0]!, kind: 'symbol' }],
};

afterEach(() => { delete window.__xss; });

describe.each([
  ['table', VocabularyTable],
  ['cards', VocabularyCards],
] as const)('malicious content in the %s layout', (_name, List) => {
  it('is rendered as inert text', () => {
    const { container } = render(
      <PronunciationProvider service={fakeSpeech()}>
        <List groups={groups} getTechnicalInfo={() => info} openInfoId={groups[0]!.entries[0]!.id} onToggleInfo={() => {}} caption="x" />
      </PronunciationProvider>,
    );
    // The app's own line icons (lucide) are the only SVGs; nothing from the payloads becomes markup.
    expect(container.querySelectorAll('img, script, svg:not(.lucide), b, iframe, object')).toHaveLength(0);
    for (const p of PAYLOADS) expect(container.textContent).toContain(p);
    expect(window.__xss).toBeUndefined();
    // No attribute anywhere carries an event handler or javascript: URL.
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('on')).toBe(false);
        if (['href', 'src', 'action'].includes(attr)) expect(el.getAttribute(attr)).not.toMatch(/^javascript:/i);
      }
    }
  });
});

describe('source policy', () => {
  const srcDir = resolve(__dirname, '../../../src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

  it('never uses raw HTML injection APIs', () => {
    const offenders = files(srcDir).filter((f) =>
      /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\b|\beval\(|new Function\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never writes legacy localStorage keys', () => {
    const offenders = files(srcDir).filter((f) => /setItem\(\s*['"]dvok|removeItem\(\s*['"]dvok/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
