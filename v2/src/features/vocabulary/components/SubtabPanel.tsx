import { useEffect, useState } from 'react';
import type { Subtab, TechnicalInfo } from '../../../models/vocabulary';
import { EmptyState } from '../../../components/EmptyState/EmptyState';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { countSubtab, percent } from '../../progress/stats';
import { WordTypeLegend } from './WordTypeBadge';
import { VocabularyTable } from './VocabularyTable';
import { VocabularyCards } from './VocabularyCards';
import type { EntryProgress } from './LearnedCheckbox';

export const MOBILE_QUERY = '(max-width: 640px)';

interface Props {
  subtab: Subtab;
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
  progress?: EntryProgress | undefined;
  learned?: ReadonlySet<string> | undefined;
}

export const countEntries = (subtab: Subtab) => subtab.groups.reduce((n, g) => n + g.entries.length, 0);

/** Section header, legend and the subtab's vocabulary (table on desktop, cards on mobile). */
export function SubtabPanel({ subtab, getTechnicalInfo, progress, learned }: Props) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);
  const total = countEntries(subtab);
  const counts = learned ? countSubtab(subtab, learned) : null;

  // Legacy behaviour: one drawer at a time; closes on an outside tap or Escape.
  useEffect(() => {
    if (!openInfoId) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-info-region]')) setOpenInfoId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenInfoId(null); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openInfoId]);

  const listProps = {
    groups: subtab.groups,
    getTechnicalInfo,
    openInfoId,
    onToggleInfo: (id: string) => setOpenInfoId((cur) => (cur === id ? null : id)),
    caption: `${subtab.label} — ${total} Wörter`,
    progress,
  };

  return (
    <>
      <div className="sinfo">
        <div>
          <h2 className="sinfo__title">{subtab.label}</h2>
          {subtab.fa ? <p className="sinfo__fa" lang="fa" dir="rtl">{subtab.fa}</p> : null}
        </div>
        {counts ? (
          <span className="sinfo__progress" data-testid="subtab-progress">
            <span className="mpo" role="progressbar" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.learned} aria-label={`${subtab.label}: ${counts.learned} von ${counts.total} gelernt`}>
              <span className="mpi" style={{ width: `${percent(counts)}%` }} />
            </span>
            <span>{counts.learned}/{counts.total}</span>
          </span>
        ) : (
          <span className="sinfo__count">{total} Wörter</span>
        )}
      </div>
      {total === 0 ? (
        <EmptyState title="هنوز واژه‌ای در این بخش وجود ندارد" description="این زیرمجموعه در نسخهٔ فعلی خالی است." />
      ) : (
        <>
          <WordTypeLegend />
          {mobile ? <VocabularyCards {...listProps} /> : <VocabularyTable {...listProps} />}
        </>
      )}
    </>
  );
}
