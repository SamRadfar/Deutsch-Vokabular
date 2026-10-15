# Deutsch Vokabular 2.0: development preview (`v2/`)

React 19 + TypeScript 7 (strict) + Vite 8 + Firebase 13. Vocabulary browsing (public) plus, since
Phase 3, **Google sign-in, personal learned-word progress, offline-capable cross-device sync and
an explicit legacy migration**. It is not deployed. The production app is still the legacy root
`index.html` (flashcards, pronunciation training, custom words remain there).

Without Firebase configuration the app runs browse-only. Configure: `cp .env.example .env.local`
and follow [`../docs/FIREBASE_SETUP.md`](../docs/FIREBASE_SETUP.md).

## Commands (run inside `v2/`)

| Task | Command |
|---|---|
| Install exact locked dependencies | `npm ci` |
| Install the browser for Playwright (once, ~120 MB) | `npx playwright install chromium` |
| Development server (hot reload) | `npm run dev`, then open the printed URL (default <http://localhost:5173/>) |
| Type check | `npm run typecheck` |
| Unit + component tests (Vitest, jsdom) | `npm test` |
| Browser tests (Playwright; builds and previews automatically) | `npm run test:e2e` |
| Firestore rules + real-SDK sync tests on the emulators (Java 21+) | `npm run test:emulator` |
| Browser tests against the emulators (Java 21+) | `npm run test:e2e:emulator` |
| Production build → `v2/dist/` | `npm run build` |
| Preview the production build | `npm run preview`, then open <http://localhost:4173/> |
| Absolute base path, e.g. for GitHub Pages | `V2_BASE=/Deutsch-Vokabular/ npm run build` (default `./` works under any sub-path) |

The Phase 1 baseline checks still run from the repository root with `npm test`.

## Structure

```
src/
  app/App.tsx                     application shell (header, navigation, active category)
  components/                     generic UI: Header, TabList (ARIA tabs), ThemeToggle, EmptyState
  features/
    vocabulary/                   navigation state hook + table/cards/badges/technical info, ✓ checkbox
    pronunciation/                Web Speech service, provider, PronunciationButton
    auth/                         AuthService (Firebase adapter), AuthProvider state machine, Persian errors
    account/                      header account menu, sync status, error banner
    progress/                     model, IndexedDB store, sync engine, Firestore adapters, provider, stats
    progress/migration/           legacy parsing/plan (Phase 2) + backup, importer, MigrationDialog
  services/firebase/              public config (VITE_FIREBASE_*), lazy SDK initialisation
  data/
    vocabulary/                   versioned content (*.v1.json) + immutable id registry
    legacy/                       historical dvok5 index maps
  models/                         TypeScript types for content and legacy formats
  services/content/               validation, repository, legacy round-trip, id indexes
  services/preferences.ts         v2 preference keys (dv2.pref.theme.v1)
  hooks/                          useTheme, useMediaQuery
  styles/                         tokens (legacy colours), base, layout
scripts/generate-content.mjs      one-time legacy → v2 content converter
tests/unit/                       Vitest (data integrity, ids, migration, components, security, speech)
tests/e2e/                        Playwright (desktop + Pixel 7 Chromium against `vite preview`)
tests/emulator/                   rules + sync tests on the Firebase emulators
tests/e2e-emulator/               Playwright against an emulator-configured build
firestore.rules, firebase.json    Security Rules (NOT deployed) and emulator config
```

Dependency direction: `app → features/components → services/hooks → models/data`. Features do
not import each other except `vocabulary → pronunciation`.

## Visible differences from the legacy UI (intentional)

| Difference | Reason |
|---|---|
| ✓ column and progress bars appear **only when signed in** (Phase 3); no "🔄 مرور" tab, no ↺ / 🔗 buttons, no "+" button | Review, reset, code-based sync and custom words remain in the legacy app. Sync is now account-based. |
| Header: «ورود با گوگل» / account avatar menu and a sync status indicator | Phase 3 sign-in. |
| "v2 preview" badge in the header; word counter shows "156 Wörter" instead of "0/156" | Marks the preview. No progress exists yet. |
| The Bauphysik main tab now shows its blue accent when active | Legacy CSS selector bug (`[data-theme="bauphysik"] .mbtn.active` never matches). |
| The dark-mode table header stays dark and readable | Legacy uses `--tp` (near-white in dark mode) as the header background, which makes the white header text unreadable. |
| Words of type `x` show "x" on a neutral grey badge instead of Nomen colours | Avoids implying "Nomen". The data is unchanged (DQ-2). |
| Empty subtabs (BÖ1–BÖ4) show a short Persian message instead of an empty table | Readability. |
| Group headers span the full table width | Legacy spans 7 of 8 columns. |
| Larger touch targets on mobile (tabs, 🔊 buttons ≥ 32 px) | Accessibility. |
| Keyboard navigation (arrow keys, Home, End, Escape), visible focus, screen-reader labels | Accessibility. |
| The technical-info drawer appears without the height animation and respects reduced motion | The drawer is rendered only when open. |

## Known limitations

- Fonts (Inter, Vazir) still load from Google Fonts and jsDelivr, as in the legacy app.
  Without network access the system fonts are used.
- There is no PWA/service worker yet: the app shell is not available offline, but progress changes made while offline are queued and synced later.
- Real Google sign-in has not been verified in automated tests (emulator only); see FIREBASE_SETUP.md §5.
- TTS quality depends on the German voices installed on the device.
