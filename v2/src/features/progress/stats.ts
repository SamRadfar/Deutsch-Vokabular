import type { Category, Subtab } from '../../models/vocabulary';

export interface Count { learned: number; total: number }

/** Progress statistics from the data model (content + learned id set) — never from the DOM. */
export function countSubtab(subtab: Subtab, learned: ReadonlySet<string>): Count {
  let total = 0;
  let done = 0;
  for (const g of subtab.groups) for (const e of g.entries) { total++; if (learned.has(e.id)) done++; }
  return { learned: done, total };
}

export function countCategories(categories: readonly Category[], learned: ReadonlySet<string>): Count {
  let total = 0;
  let done = 0;
  for (const c of categories) for (const s of c.subtabs) { const n = countSubtab(s, learned); total += n.total; done += n.learned; }
  return { learned: done, total };
}

export const percent = ({ learned, total }: Count) => (total ? Math.round((learned / total) * 100) : 0);
