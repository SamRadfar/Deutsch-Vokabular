import type { TechnicalInfo, VocabularyEntry } from '../../../models/vocabulary';
import { WordTypeBadge } from './WordTypeBadge';
import { TechnicalInfoPanel, TechnicalInfoToggle } from './TechnicalInfoPanel';
import {
  ExampleTranslation, GermanExample, GermanWord, PersianMeaning, PersianPronunciation, WordSpeech,
} from './EntryFields';
import type { EntryListProps } from './VocabularyTable';

/** Mobile layout (≤ 640px): grouped cards, same fields as the table (legacy card grid). */
export function VocabularyCards({ groups, getTechnicalInfo, openInfoId, onToggleInfo, caption }: EntryListProps) {
  return (
    <div className="vcards" data-caption={caption}>
      {groups.map((group, gi) => (
        <section key={`${gi}-${group.label}`} className="vcards__group" aria-label={group.label}>
          <h3 className="grp-heading">{group.label}</h3>
          <ul className="vcards__list">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <VocabularyCard
                  entry={entry}
                  info={getTechnicalInfo(entry.id)}
                  infoOpen={openInfoId === entry.id}
                  onToggleInfo={() => onToggleInfo(entry.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface CardProps {
  entry: VocabularyEntry;
  info: TechnicalInfo | undefined;
  infoOpen: boolean;
  onToggleInfo(): void;
}

export function VocabularyCard({ entry, info, infoOpen, onToggleInfo }: CardProps) {
  return (
    <>
      <article className="vcard" data-entry-id={entry.id} aria-label={entry.word}>
        <div className="vcard__word"><GermanWord entry={entry} /></div>
        <div className="vcard__type">
          <WordTypeBadge type={entry.type} />
          {info ? <TechnicalInfoToggle entryId={entry.id} open={infoOpen} onToggle={onToggleInfo} /> : null}
        </div>
        <div className="vcard__fa"><PersianMeaning entry={entry} /></div>
        <div className="vcard__ex"><GermanExample entry={entry} /></div>
        <div className="vcard__tr"><ExampleTranslation entry={entry} /></div>
        <div className="vcard__pr"><PersianPronunciation entry={entry} /></div>
        <div className="vcard__spk"><WordSpeech entry={entry} /></div>
      </article>
      {info && infoOpen ? <TechnicalInfoPanel entryId={entry.id} info={info} /> : null}
    </>
  );
}
