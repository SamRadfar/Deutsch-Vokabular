import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AudioLines, BookOpenText, ChartColumn, Layers, Star, type LucideIcon } from 'lucide-react';

/** The top-level sections. Vocabulary categories are secondary navigation inside "words". */
export const SECTIONS = ['words', 'mine', 'review', 'shadowing', 'progress'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SectionMeta {
  label: string;
  /** Line icon (lucide); emojis are not used as UI icons. */
  icon: LucideIcon;
  title: string;
  /** Navigation group in the sidebar. */
  group: 'learn' | 'personal';
}

export const SECTION_META: Record<Section, SectionMeta> = {
  words: { label: 'واژه‌ها', icon: BookOpenText, title: 'واژه‌ها', group: 'learn' },
  mine: { label: 'واژه‌های من', icon: Star, title: 'واژه‌های من', group: 'personal' },
  review: { label: 'مرور', icon: Layers, title: 'مرور با فلش‌کارت', group: 'learn' },
  shadowing: { label: 'تلفظ', icon: AudioLines, title: 'تمرین تلفظ', group: 'learn' },
  progress: { label: 'پیشرفت', icon: ChartColumn, title: 'پیشرفت یادگیری', group: 'personal' },
};

/** Sidebar groups, in display order. */
export const SECTION_GROUPS: ReadonlyArray<{ id: SectionMeta['group']; label: string; sections: readonly Section[] }> = [
  { id: 'learn', label: 'یادگیری', sections: ['words', 'review', 'shadowing'] },
  { id: 'personal', label: 'شخصی', sections: ['mine', 'progress'] },
];

/** `#/review` → "review"; anything unknown (including no hash) → "words". */
export function parseSection(hash: string): Section {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (SECTIONS as readonly string[]).includes(name) ? (name as Section) : 'words';
}

export const sectionHref = (s: Section) => (s === 'words' ? '#/' : `#/${s}`);

const BASE_TITLE = import.meta.env.VITE_FIREBASE_ENV === 'production' ? 'Deutsch Vokabular' : 'Deutsch Vokabular 2.0 (Preview)';

/**
 * The active section lives in the URL hash, so the browser's back button and links work, and a
 * reload stays in the same section. Hash routing needs no server rewrites on any static host.
 */
export function useSection() {
  const section = useSyncExternalStore(
    (onChange) => { window.addEventListener('hashchange', onChange); return () => window.removeEventListener('hashchange', onChange); },
    () => parseSection(window.location.hash),
    () => 'words' as Section,
  );

  useEffect(() => {
    document.title = `${SECTION_META[section].title} · ${BASE_TITLE}`;
  }, [section]);

  const navigate = useCallback((s: Section) => {
    if (parseSection(window.location.hash) === s) return;
    window.location.hash = sectionHref(s);
  }, []);

  return { section, navigate };
}
