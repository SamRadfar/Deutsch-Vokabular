# UI/UX, search and dashboard (Phase 4C)

Branch: `feature/pro-v2-ui-dashboard`.

## 1. Audit findings (before)

| # | Finding | Change |
|---|---|---|
| A1 | Nine equal tabs in one scrolling row; practice areas mixed with the seven categories. On phones only 2–3 were visible | Four **main sections** (واژه‌ها · مرور · تلفظ · پیشرفت). The categories are secondary tabs of the word section only (§2) |
| A2 | On phones the header used ~170 px: the title wrapped to two lines and the subtitle took two more | One compact line on phones: smaller icon, single-line title, no subtitle |
| A3 | No way to find a word across categories | Search and filters (§3) |
| A4 | Progress only as a header counter | Dashboard (§4) |
| A5 | Muted text `--tm` failed WCAG AA: 3.2–3.5:1 (light), 4.0:1 (dark). Category and review accents used as text in dark mode reached only ~3:1 | `--tm` is darker in light mode (#5d6b88, ≥ 4.85:1) and lighter in dark mode (#9096ab, ≥ 5.6:1). Dark-mode accent overrides reach ≥ 5:1. Answer colours: green #166534, red #b91c1c. The dialog button keeps a fixed dark blue for white text |
| A6 | No offline indication for signed-out users (the sync pill appears only when signed in) | Offline banner for everyone |
| A7 | No skip link, no page titles per view, no URL per view (the back button left the app) | Skip link; `document.title` per section; hash routes |
| A8 | Test infrastructure: a failing `*ByRole` query lists every role on the page. In jsdom that takes ~5 s for one category table, and `waitFor` repeats it on every DOM change | Expensive diagnostics are off in the test setup; a cheap wait helper is used for the signed-in state (`tests/helpers/dom.ts`). App behaviour is unchanged |

## 2. Navigation

- **Desktop:** the main sections are a segmented control in the header. The category tabs appear
  below it only in the word section.
- **Phones:** a fixed bottom tab bar (4 × ≥ 58 px, safe-area aware, opaque). The header holds only
  the brand line and, in the word section, the category tabs.
- **Hash routes:** `#/`, `#/review`, `#/shadowing`, `#/progress`. Back/forward, reload and deep
  links work on any static host. The skip link moves focus without changing the hash.
- **Sessions survive:** flashcard and shadowing panels stay mounted after their first visit, so a
  running session survives a look at another section. Shadowing still pauses when its section is
  left.

## 3. Search and filters (`features/search/`)

- **Fields:** German word, Persian meaning, German example, Persian example translation; all 999
  entries.
- **Folding (`normalize.ts`):**
  - Case-insensitive; ß ↔ ss; ä → a **and** ä → ae (both forms are indexed), and other accents.
  - Arabic ي/ك/ى → Persian ی/ک; hamza and madda forms of alef → ا; ة/ۀ → ه; ؤ → و; ئ → ی.
  - Harakat, tatweel and ZWNJ are removed; Persian and Arabic digits become 0–9.
  - A position map points every folded character back to the original, so highlights are exact.
- **Matching:** every query word must match (in any field). Ranking: exact word, word prefix, word
  contains, Persian meaning, example, example translation; ties keep content order.
- **Highlighting:** `<mark>` around React text nodes. User input never becomes HTML (tested with an
  `<img onerror>` query).
- **Filters:** category → subcategory, plus all / learned / unlearned. The status filter needs
  sign-in and is disabled otherwise, with an explanation. Filters combine with the query; one reset
  clears all; a live region announces the result count.
- **Learned state:** a word toggled in the result list stays visible until the filter changes, so
  it does not vanish under the cursor.
- **«نمایش در فهرست»:** opens the entry's category and subcategory, scrolls to it, highlights it and
  moves keyboard focus to it.
- **Keyboard:** `/` focuses the search; `Escape` clears it.
- **Phones:** the filters fold behind «فیلترها (n)», so the words follow directly below the search
  field.
- **Performance:** folding happens once when the index is built. A query scans 999 pre-folded
  entries (7 queries take < 200 ms in the jsdom test; the broadest query responds within 1.5 s in
  the browser test, including rendering). Input uses `useDeferredValue`; results come in pages of 50
  and memoised cards re-render only when their own learned or sync state changes.

## 4. Dashboard (`features/dashboard/`)

Only real data is shown. There are no streaks, goals or estimates.

| Block | Source | Scope |
|---|---|---|
| Total, learned, remaining, percent; ring and per-category bars | Bundled content + learned set | **Synced** (Firestore), with the current sync status |
| «تمرین روی همین دستگاه»: flashcard words reviewed, «بلدم» / «بلد نیستم» answers, review-again list, last review; shadowing sessions, practised words, practice time, last session | ReviewLog / ShadowingLog in IndexedDB | **This device only**, labelled as such |
| Quick access | Links to «مرور» and «تلفظ»; each category row opens that category | — |

- **Signed out:** totals and categories only, with an explanation. Nothing personal is shown and
  nothing is invented.
- **Loading:** a status line. If there is no local practice yet, an empty state says so.
- The dashboard causes **no Firestore reads**: it uses the sync engine's existing in-memory view.

## 5. Unchanged

- Firestore schema and rules, IndexedDB schema (still v3), vocabulary ids and content.
- The legacy `index.html`.
- Signed-out (guest) browsing and practice, flashcards, shadowing and migration behaviour.

## 6. Known limitations

- Search does not tolerate spelling mistakes (no fuzzy matching). Persian queries match on word
  parts, not on word stems.
- The URL hash holds only the section; category, subcategory and search are not part of the URL.
- The dashboard's device-local statistics differ per device by design. Cloud sync for them is the
  approval-gated proposal in `REVIEW_DESIGN.md` §6.
- Real devices (iPhone/Android) and screen readers (NVDA/VoiceOver) were not tested by hand.
  Accessibility is covered by roles, names, focus and contrast checks in automated tests.
