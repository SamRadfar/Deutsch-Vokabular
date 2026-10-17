import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header/Header';
import { useTheme } from '../hooks/useTheme';
import { PronunciationProvider } from '../features/pronunciation/PronunciationProvider';
import type { SpeechService } from '../features/pronunciation/speechService';
import type { CategoryKey } from '../models/vocabulary';
import { MainNavigation } from '../features/vocabulary/components/MainNavigation';
import { ReviewPanel } from '../features/review/components/ReviewPanel';
import { ShadowingPanel } from '../features/shadowing/components/ShadowingPanel';
import { WordsSection, type WordsSearchState } from '../features/search/WordsSection';
import { filtersActive, NO_FILTERS } from '../features/search/searchIndex';
import { Dashboard } from '../features/dashboard/Dashboard';
import { PersonalPanel } from '../features/personal/components/PersonalPanel';
import { mergeLearned, routeLearned, usePersonal } from '../features/personal/usePersonal';
import { isPersonalId } from '../features/personal/model';
import { PrimaryNav } from '../components/PrimaryNav/PrimaryNav';
import { OfflineBanner } from '../components/OfflineBanner/OfflineBanner';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MOBILE_QUERY } from '../features/vocabulary/components/SubtabPanel';
import { useSection, type Section } from './sections';
import type { EntryProgress } from '../features/vocabulary/components/LearnedCheckbox';
import { useVocabularyNavigation } from '../features/vocabulary/useVocabularyNavigation';
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
  const { section, navigate } = useSection();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [search, setSearch] = useState<WordsSearchState>({ query: '', filters: NO_FILTERS });
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [focusPersonalId, setFocusPersonalId] = useState<string | null>(null);
  const { vocab: personalVocab, snapshot: personal } = usePersonal();
  // Practice panels stay mounted once opened, so a running session survives a look at another section.
  const [mounted, setMounted] = useState<ReadonlySet<Section>>(() => new Set([section]));
  useEffect(() => { setMounted((m) => (m.has(section) ? m : new Set([...m, section]))); }, [section]);
  // A session belongs to one account: switching or signing out starts the practice sections afresh.
  const owner = progress.status === 'unavailable' ? 'signed-out' : progress.uid;

  const ready = progress.status === 'ready' ? progress : null;
  // Built-in learned words are synced (Firestore); personal words keep their flag locally.
  const learned = useMemo(() => (ready ? mergeLearned(ready.view.learned, personal) : undefined), [ready, personal]);
  const learnedCount = ready ? countCategories(repository.categories, ready.view.learned).learned : null;

  const entryProgress = useMemo<EntryProgress | undefined>(() => {
    if (!ready) return undefined;
    return {
      isLearned: (id) => (isPersonalId(id) ? personal?.byId.get(id)?.learned ?? false : ready.view.learned.has(id)),
      stateOf: (id) => (isPersonalId(id) ? 'synced' : ready.view.stateOf(id)),
      setLearned: routeLearned((id, value) => { void ready.engine.setLearned(id, value); }, personalVocab),
    };
  }, [ready, personal, personalVocab]);

  /** Search "show in list" for a personal word: its category placement, otherwise "my words". */
  const showPersonal = useCallback((id: string) => {
    const w = personal?.byId.get(id);
    const placement = w?.placement;
    const category = placement ? repository.getCategory(placement.category as CategoryKey) : undefined;
    if (placement && category?.subtabs.some((s) => s.id === placement.subtab)) {
      nav.show(category.key, placement.subtab);
      setFocusEntryId(id);
      return;
    }
    setFocusPersonalId(id);
    navigate('mine');
  }, [personal, repository, nav.show, navigate]);

  /** Category tabs (and dashboard rows): browsing a category leaves search mode. */
  const selectCategory = useCallback((key: string) => {
    setFocusEntryId(null);
    setSearch((s) => (s.query || filtersActive(s.filters) ? { query: '', filters: NO_FILTERS } : s));
    nav.selectCategory(key as CategoryKey);
    navigate('words');
  }, [nav.selectCategory, navigate]);

  const closeMigration = useCallback(() => setMigrationOpen(false), []);
  const primaryNav = <PrimaryNav active={section} onNavigate={navigate} variant={mobile ? 'bottom' : 'top'} />;

  return (
    <>
      <Header
        totalEntries={repository.totalEntries}
        learnedCount={learnedCount}
        environmentLabel={environmentLabel}
        theme={theme}
        onToggleTheme={toggle}
        primaryNav={mobile ? null : primaryNav}
        account={(
          <>
            <SyncStatusIndicator />
            <AccountControl totalEntries={repository.totalEntries} learnedCount={learnedCount} onOpenMigration={() => setMigrationOpen(true)} />
          </>
        )}
        navigation={section === 'words'
          ? <MainNavigation categories={repository.categories} activeId={category.key} onSelect={selectCategory} />
          : null}
      />
      <OfflineBanner signedIn={progress.status !== 'unavailable'} />
      <AuthErrorBanner />
      <main className={`mcontent${mobile ? ' mcontent--bottom-nav' : ''}`} id="main" tabIndex={-1}>
        {section === 'words' ? (
          <WordsSection
            categories={repository.categories}
            category={category}
            activeSubtabId={nav.activeSubtabId}
            onSelectSubtab={nav.selectSubtab}
            onShow={nav.show}
            onShowPersonal={showPersonal}
            getTechnicalInfo={repository.getTechnicalInfo}
            progress={entryProgress}
            learned={learned}
            search={search}
            onSearch={setSearch}
            focusEntryId={focusEntryId}
            onFocusEntry={setFocusEntryId}
          />
        ) : null}
        {section === 'mine' ? (
          <PersonalPanel
            key={owner}
            categories={repository.categories}
            focusId={focusPersonalId}
            onFocused={() => setFocusPersonalId(null)}
            onOpenReview={() => navigate('review')}
            onOpenShadowing={() => navigate('shadowing')}
          />
        ) : null}
        {mounted.has('review') ? (
          <div hidden={section !== 'review'} data-section="review">
            <ReviewPanel key={owner} categories={repository.categories} active={section === 'review'} />
          </div>
        ) : null}
        {mounted.has('shadowing') ? (
          <div hidden={section !== 'shadowing'} data-section="shadowing">
            <ShadowingPanel key={owner} categories={repository.categories} active={section === 'shadowing'} />
          </div>
        ) : null}
        {section === 'progress' ? (
          <Dashboard
            categories={repository.categories}
            onOpenCategory={selectCategory}
            onOpenReview={() => navigate('review')}
            onOpenShadowing={() => navigate('shadowing')}
            onOpenPersonal={() => navigate('mine')}
          />
        ) : null}
      </main>
      {mobile ? primaryNav : null}
      {migrationOpen && ready ? (
        <Suspense fallback={<p className="visually-hidden" role="status">در حال بارگذاری…</p>}>
          <MigrationDialog repository={repository} onClose={closeMigration} />
        </Suspense>
      ) : null}
    </>
  );
}
