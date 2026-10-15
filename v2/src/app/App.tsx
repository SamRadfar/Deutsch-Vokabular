import { Header } from '../components/Header/Header';
import { useTheme } from '../hooks/useTheme';
import { PronunciationProvider } from '../features/pronunciation/PronunciationProvider';
import type { SpeechService } from '../features/pronunciation/speechService';
import { MainNavigation, MAIN_TABS_PREFIX } from '../features/vocabulary/components/MainNavigation';
import { CategoryView } from '../features/vocabulary/components/CategoryView';
import { useVocabularyNavigation } from '../features/vocabulary/useVocabularyNavigation';
import { panelElementId, tabElementId } from '../components/TabList/TabList';
import { getVocabularyRepository, type VocabularyRepository } from '../services/content/vocabularyRepository';

interface Props {
  repository?: VocabularyRepository;
  speechService?: SpeechService;
}

/** Application shell: header with category navigation, then the active category. */
export function App({ repository = getVocabularyRepository(), speechService }: Props) {
  const { theme, toggle } = useTheme();
  const nav = useVocabularyNavigation(repository.categories);
  const category = nav.activeCategory;

  return (
    <PronunciationProvider {...(speechService ? { service: speechService } : {})}>
      <Header
        totalEntries={repository.totalEntries}
        theme={theme}
        onToggleTheme={toggle}
        navigation={<MainNavigation categories={repository.categories} activeKey={category.key} onSelect={nav.selectCategory} />}
      />
      <main className="mcontent">
        <div
          role="tabpanel"
          id={panelElementId(MAIN_TABS_PREFIX, category.key)}
          aria-labelledby={tabElementId(MAIN_TABS_PREFIX, category.key)}
        >
          <CategoryView
            key={category.key}
            category={category}
            activeSubtabId={nav.activeSubtabId}
            onSelectSubtab={nav.selectSubtab}
            getTechnicalInfo={repository.getTechnicalInfo}
          />
        </div>
      </main>
    </PronunciationProvider>
  );
}
