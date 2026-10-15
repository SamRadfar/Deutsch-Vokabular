import type { WordType } from '../../../models/vocabulary';

/** Legacy TYPE_MAP / TYPE_LABEL. `x` has no legacy label (DQ-2): its raw code is shown on a neutral badge. */
const TYPES: Record<WordType, { label: string; className: string }> = {
  n: { label: 'Nomen', className: 'tb--n' },
  v: { label: 'Verb', className: 'tb--v' },
  a: { label: 'Adjektiv', className: 'tb--a' },
  au: { label: 'Ausdruck', className: 'tb--au' },
  x: { label: 'x', className: 'tb--x' },
};

export function WordTypeBadge({ type }: { type: WordType }) {
  const t = TYPES[type];
  return (
    <span className={`tb ${t.className}`} lang="de" title={type === 'x' ? 'Wortart nicht klassifiziert (Legacy-Code „x“)' : undefined}>
      {t.label}
    </span>
  );
}

export function WordTypeLegend() {
  return (
    <div className="lgnd" aria-hidden="true">
      <span className="lgnd__lbl">Wortart ·</span>
      {(['n', 'v', 'a', 'au'] as const).map((t) => <WordTypeBadge key={t} type={t} />)}
    </div>
  );
}
