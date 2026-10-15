# Feature & Content Baseline (legacy app, commit `6763003`)

This is the reference for "nothing was lost" when v2 replaces the legacy app.
Content is pinned by automated tests. Behaviour is listed here and will be pinned by
Playwright parity tests in Phase 2. Line numbers refer to `index.html`.

## Content (automatically verified: `npm test`)

| Item | Value | Fixture |
|---|---|---|
| Categories (in order) | `arch`, `acad`, `bautechnik`, `bauphysik`, `fitness`, `anatomie`, `dreame` | `tests/fixtures/baseline/vocabulary.json` |
| Subtabs | 33, of which 4 are empty (`bauphysik/bo1`–`bo4`) | `stats.json` |
| Groups | 115 | `stats.json` |
| Vocabulary rows | 999 (994 unique progress keys) | `progress-keys.json` |
| Word types | n 817 · v 111 · a 42 · au 19 · x 10 | `stats.json` |
| Technical-info entries | 31 (17 displayed) | `bautechnik-info.json` |
| Vocabulary fingerprint | SHA-256 recorded in `meta.json` | `meta.json` |

Words per subtab:

| Category | Subtabs (words) | Total |
|---|---|---|
| arch | bau 156 · zng 29 · tga 21 · fas 17 · plng 26 | 249 |
| acad | studio 24 · jury 14 · theorie 25 · modell 20 · software 18 · uni 35 | 136 |
| bautechnik | tragwerk 35 · baustoff 38 · baukonstruktion 36 · ausbau 32 · tga2 32 · bauausfuehrung 30 | 203 |
| bauphysik | bo1 0 · bo2 0 · bo3 0 · bo4 0 · bo5 117 | 117 |
| fitness | training 66 · ernaehrung 41 | 107 |
| anatomie | oberkoerper 21 · unterkoerper 21 · skelett 40 | 82 |
| dreame | saugroboter 29 · staubsauger 16 · nass 11 · mahroboter 10 · haartrockner 11 · allgemein 28 | 105 |

## Features to preserve (behavioural baseline)

| # | Feature | Behaviour today | Where |
|---|---|---|---|
| F1 | Category / subtab navigation | 7 category tabs + "🔄 مرور". Subtabs show `done/total` counters. The active tab scrolls into view. | `init()` `:2933` |
| F2 | Vocabulary table | Columns ✓, Wort, Wortart, فارسی, Beispiel, ترجمه, تلفظ, 🔊. Groups are header rows. Below 640 px each row becomes a card. | `buildPanel()` `:2829`, CSS `:255` |
| F3 | Text-to-speech | 🔊 for the word (article stripped) and for the example. `de-DE`, rate 0.85. Clicking the same button again stops playback. | `speakWord()` `:3274` |
| F4 | Technical-info drawer | "اطلاعات فنی" accordion with formula and key/value rows. One open at a time, closes on an outside tap. | `toggleInfoDrawer()` `:3449` |
| F5 | Learned checkbox | Ticking marks the row and persists it to `dvok6`. Per-subtab progress bar and counter. The header shows the total word count. | `save()` `:3375`, `updateStats()` `:3338` |
| F6 | Reset | ↺ with confirmation clears built-in ticks. | `resetAll()` `:3399` |
| F7 | Review tab | Learned count, session size (≤ 30), the first 20 learned words, and empty-state text. | `renderReviewTab()` `:4132` |
| F8 | Flashcards | 30 random learned words. Tap flips the card and speaks the word. Swiping right/left means know/don't know. Dots and a progress bar. A result screen with emoji and percentage. | `startReview()` `:4198` … swipe `:4319` |
| F9 | Pronunciation / shadowing | Category chips with counts, speed (0.55 / 0.85 / 1.2), repeat mode (once / twice / 2+2), pause 1–8 s, shadowing prompt, laps of 30 words weighted by exposure (3/2/1), wake lock, auto-pause when the page is hidden. | `:3721–4108` |
| F10 | Custom words | "+" button, word plus optional context sentence, target category/subtab, AI generation of article form, type, translation, example, example translation and pronunciation. An offline/no-key "pending" queue processed when back online. Delete with confirmation. Shown under "Meine Wörter · واژه‌های من". | `:3485–3717` |
| F11 | Device sync | Create or enter a 6-digit code. Live updates of ticks, custom words and pronunciation settings. Disconnect. A diagnosis message when Google is blocked. | `:3027–3246` |
| F12 | Theme | Light/dark toggle. Defaults to `prefers-color-scheme`. Updates the `theme-color` meta tag. | `:3248–3272` |
| F13 | Legacy-data banner | A warning when old `dvok5` ticks exist and `dvok6` is empty. | `checkLegacyProgressData()` `:2998` |
| F14 | PWA metadata | Manifest (standalone, RTL Persian description, icons) and iOS meta tags. The service worker is registered, but its install fails today (see Known defects). | `manifest.json`, `sw.js` |

## Known defects (kept as-is in Phase 1, tracked as `todo` tests)

| ID | Defect | Test |
|---|---|---|
| V1 | `icon.png` is missing. `sw.js` `cache.addAll` fails, so the app has no offline support. The manifest and apple-touch icons are broken. | `known-defects.test.mjs` |
| V2 | The flashcard ✗/✓ and 🔊 buttons call the undefined `fcAnswer` and `fcSpeak`. Only tap and swipe work. | idem |
| V3 | "مرور دوباره" leaves the card scene hidden. | Playwright, Phase 2 |
| V4 | Reset does not sync, does not clear custom-word ticks and does not clear exposure. | Phase 2 |
| V5 | Connecting to an existing sync code overwrites local data without merging. | Phase 2 |
| V6 | `pronOpen()` removes `#pron-status` when no category is selected, so later calls throw. | Phase 2 |
| V7 | Progress-key collisions (DQ-1). | `known-defects.test.mjs` |
| V8 | Type `x` has no badge (DQ-2). | idem |
| V11 | A dead legacy flashcard modal with duplicate ids and undefined handlers. | idem |
| S1–S3 | Unauthenticated sync documents, unescaped `innerHTML` for custom/remote data, and the API key in `localStorage`. | Addressed by ADR 0001 |
