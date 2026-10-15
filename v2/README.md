# Deutsch Vokabular 2.0: development preview (`v2/`)

React 19 + TypeScript 7 (strict) + Vite 8. This is a **preview of vocabulary browsing only**.
It is not deployed. The production app is still the legacy root `index.html`, which keeps all
learning features (ticks, flashcards, pronunciation training, custom words, sync).

## Commands (run inside `v2/`)

| Task | Command |
|---|---|
| Install exact locked dependencies | `npm ci` |
| Install the browser for Playwright (once, ~120 MB) | `npx playwright install chromium` |
| Development server (hot reload) | `npm run dev`, then open the printed URL (default <http://localhost:5173/>) |
| Type check | `npm run typecheck` |
| Unit + component tests (Vitest, jsdom) | `npm test` |
| Browser tests (Playwright; builds and previews automatically) | `npm run test:e2e` |
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
    vocabulary/                   navigation state hook + table/cards/badges/technical info
    pronunciation/                Web Speech service, provider, PronunciationButton
    progress/migration/           read-only legacy migration preparation (not used by the UI yet)
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
```

Dependency direction: `app → features/components → services/hooks → models/data`. Features do
not import each other except `vocabulary → pronunciation`.

## Visible differences from the legacy UI (intentional)

| Difference | Reason |
|---|---|
| No ✓ checkbox column, no progress bars, no "🔄 مرور" tab, no ↺ / 🔗 buttons, no "+" button | Progress, review, sync and custom words are out of scope for Phase 2 and remain in the legacy app. |
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
- There is no PWA/service worker yet, so the preview is not available offline.
- TTS quality depends on the German voices installed on the device.
