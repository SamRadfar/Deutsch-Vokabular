// Small field renderers shared by the table row and the mobile card, so both layouts
// present identical text with identical language/direction markup.

import type { VocabularyEntry } from '../../../models/vocabulary';
import { PronunciationButton } from '../../pronunciation/PronunciationButton';
import { speechTextForWord } from '../../pronunciation/speechService';

export const GermanWord = ({ entry }: { entry: VocabularyEntry }) => (
  <span className="v-word" lang="de" dir="ltr">{entry.word}</span>
);

export const PersianMeaning = ({ entry }: { entry: VocabularyEntry }) => (
  <span className="v-fa" lang="fa" dir="rtl">{entry.fa}</span>
);

export const GermanExample = ({ entry }: { entry: VocabularyEntry }) => (
  <span className="v-ex" lang="de" dir="ltr">
    {entry.example}
    <PronunciationButton speechKey={`${entry.id}:example`} text={entry.example} label={`Beispiel anhören: ${entry.word}`} variant="example" />
  </span>
);

export const ExampleTranslation = ({ entry }: { entry: VocabularyEntry }) => (
  <span className="v-tr" lang="fa" dir="rtl">{entry.exampleFa}</span>
);

export const PersianPronunciation = ({ entry }: { entry: VocabularyEntry }) => (
  <span className="v-pr" lang="fa" dir="rtl">{entry.pronunciationFa}</span>
);

export const WordSpeech = ({ entry }: { entry: VocabularyEntry }) => (
  <PronunciationButton speechKey={`${entry.id}:word`} text={speechTextForWord(entry.word)} label={`Aussprache anhören: ${entry.word}`} />
);
