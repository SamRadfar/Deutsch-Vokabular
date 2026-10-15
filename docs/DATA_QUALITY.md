# Vocabulary Data-Quality Register

These issues exist in the built-in vocabulary at commit `6763003`. **None of them
has been corrected.** The baseline tests pin the current state on purpose. Fixing an
item is a content decision for the product owner. Once it is fixed, the baseline is
updated deliberately with `npm run baseline:update` and the diff is reviewed.

| ID | Issue | Evidence | Impact |
|---|---|---|---|
| DQ-1 | **Progress-key collisions.** The same word appears twice inside one category, so both rows share one `mainKey::word` key. | `acad::belegen` (theorie, uni), `acad::modellieren` (modell, software), `acad::rendern` (modell, software), `bautechnik::die Dreifachverglasung` (baustoff, baukonstruktion), `bauphysik::der Hebelarm` (twice in bo5) | Ticking one row ticks both after a reload. Unticking one copy is not persisted while the other is ticked. A migration must map one legacy key to two new ids. |
| DQ-2 | **Type `x` has no badge.** 10 rows use type `x`, which is not in `TYPE_MAP`. The badge shows the raw text "x" in Nomen colours. | bauphysik/bo5: `OK / UK`, `EG / OG / UG`. fitness/training: `einen Satz machen`, `maximales Gewicht`, `die Muskelmasse aufbauen`, `Fett verbrennen`. fitness/ernaehrung: `sich fit halten`, `fit werden`, `gesund bleiben`, `regelmäßig trainieren` | Display only. `x` is probably meant as "Ausdruck" (`au`). The custom-word schema uses `x` for that. |
| DQ-3 | **Empty subtabs.** `bauphysik/bo1` to `bo4` contain one group and zero rows. | stats fixture `emptySubtabs` | They show an empty table. They appear to be placeholders. |
| DQ-4 | **Missing Persian subtitles.** All 5 Bauphysik subtabs have `fa: ''`. | stats fixture | The subtitle line is blank. |
| DQ-5 | **Unescaped double quote in an example.** `dreame/allgemein` `die Testnote`: the example contains `"Sehr gut"`. | `index.html:2790` | The example's `data-word="…"` attribute is truncated, so TTS reads only "Das Gerät erhielt die Testnote ". |
| DQ-6 | **Orphaned technical-info entries.** 14 of 31 `BAUTECHNIK_INFO` entries never display because their words are not in the `bautechnik` category any more. | `der U-Wert`, `der R-Wert`, `die Wärmeleitfähigkeit`, `die Wärmedämmung`, `die Wärmebrücke`, `der Wärmeverlust`, `der Jahresheizwärmebedarf`, `das Passivhaus`, `der Taupunkt`, `der sd-Wert`, `das Schalldämmmaß (Rw)`, `der Dezibel (dB)`, `das Moment`, `das Trägheitsmoment` | Content that users cannot reach. Cause: the former `bautechnik/bauphysik` subtab (39 words) was removed in `6763003`. |
| DQ-7 | **Subtab id/label mismatch.** `fitness/ernaehrung` is labelled "Erholung & Verletzungen". | vocabulary fixture | Confusing for developers. Renaming the id is harmless to progress (ids are not part of the key), but must be done deliberately. |
| DQ-8 | **Mixed label language.** The first category is "🏛 Architecture" (English). The others are German. | vocabulary fixture | Cosmetic. |
| DQ-9 | **Cross-category duplicates.** 37 word strings appear in more than one category. | stats fixture `crossCategoryWords` | Not an error, but they are tracked as separate progress items, while exposure counts are shared by word text. |
| DQ-10 | **No structured grammar fields.** The article is embedded in the word string. Plural, gender, CEFR level and stable ids are absent. | schema | It limits future features such as article drills, level filters and SRS. A stable id must be introduced before progress can move to a new schema. |

Verified properties that currently hold (and are asserted):

- every row has 6 non-empty, trimmed string fields;
- no word contains `<`, `>` or `&`;
- subtab ids are unique across all categories;
- every category's `theme` equals its key.
