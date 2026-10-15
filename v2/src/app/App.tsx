import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Header } from '../components/Header/Header';
import { useTheme } from '../hooks/useTheme';
import { PronunciationProvider } from '../features/pronunciation/PronunciationProvider';
import type { SpeechService } from '../features/pronunciation/speechService';
import type { CategoryKey } from '../models/vocabulary';
import { MainNavigation, MAIN_TABS_PREFIX, REVIEW_TAB_ID, SHADOWING_TAB_ID } from '../features/vocabulary/components/MainNavigation';
import { ReviewPanel } from '../features/review/components/ReviewPanel';
import { ShadowingPanel } from '../features/shadowing/components/ShadowingPanel';
import { CategoryView } from '../features/vocabulary/components/CategoryView';
import type { EntryProgress } from '../features/vocabulary/components/LearnedCheckbox';
import { useVocabularyNavigation } from '../features/vocabulary/useVocabularyNavigation';
import { panelElementId, tabElementId } from '../components/TabList/TabList';
import { getVocabularyRepository, type VocabularyRepository } from '../services/content/vocabularyRepository';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProgressProvider, useProgress } from '../features/progress/ProgressProvider';
import { countCategories } from '../features/progress/stats';
import { AccountControl } from '../features/account/AccountControl';
import { AuthErrorBanner } from '../features/account/AuthErrorBanner';
import { SyncStatusIndicator } from '../features/account/SyncStatusIndicator';
import { createAppServices, type AppServices } from './services';

interface Props {
  repository?: VocabularyRepository;
  speechService?: SpeechService;
  /** Injected in tests; defaults to Firebase (or browse-only when unconfigured). */
  services?: AppServices;
}

// Migration code, the id registry and historical maps are only needed when the dialog opens.
const MigrationDialog = lazy(() => import('../features/progress/migration/MigrationDialog').then((m) => ({ default: m.MigrationDialog })));

let defaultServices: AppServices | undefined;

/** Composition root: content, identity, personal progress and speech providers. */
export function App({ repository = getVocabularyRepository(), speechService, services }: Props) {
  const resolved = services ?? (defaultServices ??= createAppServices());
  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of repository.categories) for (const s of c.subtabs) for (const g of s.groups) for (const e of g.entries) ids.add(e.id);
    return ids;
  }, [repository]);

  return (
    <AuthProvider service={resolved.auth} {...(resolved.authUnavailable ? { unavailable: resolved.authUnavailable } : {})}>
      <ProgressProvider services={resolved.progress} knownIds={knownIds}>
        <PronunciationProvider {...(speechService ? { service: speechService } : {})}>
          <AppContent repository={repository} environmentLabel={resolved.environmentLabel} />
        </PronunciationProvider>
      </ProgressProvider>
    </AuthProvider>
  );
}

function AppContent({ repository, environmentLabel }: { repository: VocabularyRepository; environmentLabel: string | undefined }) {
  const { theme, toggle } = useTheme();
  const nav = useVocabularyNavigation(repository.categories);
  const category = nav.activeCategory;
  const progress = useProgress();
  const [migrationOpen, setMigrationOpen] = useState(false);
  /** null = a vocabulary category; otherwise the practice tab that is open. */
  const [practiceTab, setPracticeTab] = useState<typeof REVIEW_TAB_ID | typeof SHADOWING_TAB_ID | null>(null);
  // Practice panels stay mounted once opened, so a running session survives a look at another tab.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const selectMainTab = useCallback((id: string) => {
    if (id === REVIEW_TAB_ID || id === SHADOWING_TAB_ID) {
      setPracticeTab(id);
      setMounted((m) => (m.has(id) ? m : new Set([...m, id])));
    } else {
      setPracticeTab(null);
      nav.selectCategory(id as CategoryKey);
    }
  }, [nav.selectCategory]);
  // A session belongs to one account: switching or signing out starts the practice tabs afresh.
  const reviewOwner = progress.status === 'unavailable' ? 'signed-out' : progress.uid;

  const ready = progress.status === 'ready' ? progress : null;
  const learned = ready?.view.learned;
  const learnedCount = learned ? countCategories(repository.categories, learned).learned : null;

  const entryProgress = useMemo<EntryProgress | undefined>(() => {
    if (!ready) return undefined;
    return {
      isLearned: (id) => ready.view.learned.has(id),
      stateOf: (id) => ready.view.stateOf(id),
      setLearned: (id, value) => { void ready.engine.setLearned(id, value); },
    };
  }, [ready]);

  const closeMigration = useCallback(() => setMigrationOpen(false), []);

  return (
    <>
      <Header
        totalEntries={repository.totalEntries}
        learnedCount={learnedCount}
        environmentLabel={environmentLabel}
        theme={theme}
        onToggleTheme={toggle}
        account={(
          <>
            <SyncStatusIndicator />
            <AccountControl totalEntries={repository.totalEntries} learnedCount={learnedCount} onOpenMigration={() => setMigrationOpen(true)} />
          </>
        )}
        navigation={<MainNavigation categories={repository.categories} activeId={practiceTab ?? category.key} onSelect={selectMainTab} />}
      />
      <AuthErrorBanner />
      <main className="mcontent">
        {practiceTab ? null : (
          <div role="tabpanel" id={panelElementId(MAIN_TABS_PREFIX, category.key)} aria-labelledby={tabElementId(MAIN_TABS_PREFIX, category.key)}>
            <CategoryView
              key={category.key}
              category={category}
              activeSubtabId={nav.activeSubtabId}
              onSelectSubtab={nav.selectSubtab}
              getTechnicalInfo={repository.getTechnicalInfo}
              progress={entryProgress}
              learned={learned}
            />
          </div>
        )}
        {mounted.has(REVIEW_TAB_ID) ? (
          <div role="tabpanel" id={panelElementId(MAIN_TABS_PREFIX, REVIEW_TAB_ID)} aria-labelledby={tabElementId(MAIN_TABS_PREFIX, REVIEW_TAB_ID)} hidden={practiceTab !== REVIEW_TAB_ID}>
            <ReviewPanel key={reviewOwner} categories={repository.categories} active={practiceTab === REVIEW_TAB_ID} />
          </div>
        ) : null}
        {mounted.has(SHADOWING_TAB_ID) ? (
          <div role="tabpanel" id={panelElementId(MAIN_TABS_PREFIX, SHADOWING_TAB_ID)} aria-labelledby={tabElementId(MAIN_TABS_PREFIX, SHADOWING_TAB_ID)} hidden={practiceTab !== SHADOWING_TAB_ID}>
            <ShadowingPanel key={reviewOwner} categories={repository.categories} active={practiceTab === SHADOWING_TAB_ID} />
          </div>
        ) : null}
      </main>
      {migrationOpen && ready ? (
        <Suspense fallback={<p className="visually-hidden" role="status">در حال بارگذاری…</p>}>
          <MigrationDialog repository={repository} onClose={closeMigration} />
        </Suspense>
      ) : null}
    </>
  );
}
