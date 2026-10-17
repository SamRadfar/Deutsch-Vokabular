import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** The four top-level sections. Vocabulary categories are secondary navigation inside "words". */
export const SECTIONS = ['words', 'review', 'shadowing', 'progress'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_META: Record<Section, { label: string; icon: string; title: string }> = {
  words: { label: 'واژه‌ها', icon: '📚', title: 'واژه‌ها' },
  review: { label: 'مرور', icon: '🔄', title: 'مرور با فلش‌کارت' },
  shadowing: { label: 'تلفظ', icon: '🗣', title: 'تمرین تلفظ' },
  progress: { label: 'پیشرفت', icon: '📊', title: 'پیشرفت یادگیری' },
};

/** `#/review` → "review"; anything unknown (including no hash) → "words". */
export function parseSection(hash: string): Section {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (SECTIONS as readonly string[]).includes(name) ? (name as Section) : 'words';
}

export const sectionHref = (s: Section) => (s === 'words' ? '#/' : `#/${s}`);

const BASE_TITLE = 'Deutsch Vokabular 2.0 (Preview)';

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
