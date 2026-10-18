# V2 design system (UI/UX redesign)

The visual language follows the NEXORA reference: atmospheric dark surfaces with burgundy, ember and amber light, quiet translucent cards, hairline borders and inverse primary buttons. It is adapted to a German–Persian learning product, with Persian RTL as the primary layout and German set LTR.

This is a visual redesign only. Content, IDs, routes, storage and sync are unchanged.

## 1. Foundations (`v2/src/styles/tokens.css`)

| Group | Tokens |
|---|---|
| Fonts | `--fn` Inter Variable (Latin/German) and `--fp` Vazirmatn Variable (Persian). Both are self-hosted through `@fontsource-variable` under SIL OFL 1.1, with no external font requests |
| Type scale | `--fs-2xs` 11 · `xs` 12 · `sm` 13 · `md` 14 · `base` 15 · `lg` 17 · `xl` 20 · `2xl` 26 · `3xl` 32 · `display` 38 |
| Radius | `--r-xs` 6 · `sm` 8 · `md` 10 · `lg` 14 · `xl` 18 · `pill` |
| Spacing | `--sp-1` … `--sp-10` (4 → 40px) |
| Motion | `--dur-1/2/3` (120/200/320ms) with `--ease`. `prefers-reduced-motion` disables animations globally |
| Surfaces | `--bg` (sidebar/page), `--panel`, `--sf` (translucent card), `--sf-solid`, `--sf-raised` (dialogs, menus), `--sfalt` (inset/inputs), `--sf-hover`, `--sf-active` |
| Text | `--tp` / `--ts` / `--tm`. Muted text stays ≥ 4.5:1 in both themes |
| Brand | `--brand` (ember text), `--brand-tint`, `--brand-grad` (burgundy → ember → amber), `--btn-pri-*` (inverse primary), `--focus` |
| Status | `--ok`, `--bad`, `--warn`, `--info`, each with a tint |
| Atmosphere | `--atmo` (frame gradient), `--grain-opacity`, `--grain-blend`, `--diagonal` |
| Categories | `--ac-*` per category (text-safe) and `--acg-*` gradients. `[data-category]` sets `--ac/--acl/--acg` |

Dark mode is the reference look. Light mode keeps the same structure on warm paper tones with soft rose and peach light.

## 2. Components (`v2/src/styles/components.css`)

- **Buttons.** `.btn` (secondary), `.btn--primary` (inverse), `.btn--accent`, `.btn--danger`, `.btn--ghost`, and the sizes `--sm`/`--lg`. Legacy button classes (`.fc-primary`, `.pwc__btn`, …) map onto the same variants, so every screen shares one system.
- **Icon button.** `.icon-btn`, plus a ghost variant.
- **Card and badges.** `.card`. `.badge` is an outlined pill with a status dot, in the variants `ok`, `warn`, `bad`, `accent` and `brand`.
- **Form controls.** Inputs, selects (with an RTL-aware chevron) and textareas share one look, with hover, focus ring and disabled states. The shared rules have zero specificity (`:where`), so feature styles can always adjust them.
- **Page header.** `.page-head`: an eyebrow with a brand dot, a display title, a description and actions. Every section uses it.
- **Tooltips.** `.tip` is a real `aria-hidden` element, shown in the collapsed sidebar. CSS generated content is deliberately not used, because it would be read as part of the name.
- **Dialog.** `Dialog` with `size="md"|"lg"`, a description, a close button, and a portal to `body`. On phones it becomes a bottom sheet, and long forms get a sticky footer.

## 3. Layout

- **Desktop (≥ 1024px).** The `Sidebar` sits on the right (RTL) and holds:
  - the brand;
  - the groups «یادگیری» (words, review, pronunciation) and «شخصی» (my words, progress), with counters;
  - a progress card;
  - the sync status and environment badge;
  - the theme toggle and the collapse control;
  - the profile row with its menu, which opens upwards.

  The sidebar collapses to an icon rail; the choice is stored in `dv2.pref.sidebar.v1`. Content lives in a rounded atmospheric frame. The page itself scrolls, and fixed strips mask the frame's outer gap.
- **Phones and tablets (< 1024px).** A compact app bar (brand, progress pill, theme, sync, account), the full-bleed atmosphere, and a bottom tab bar with 64px targets.
- **Icons.** Lucide (ISC) line icons at a single 1.75 stroke. Categories have their own icons (`features/vocabulary/categoryIcons.ts`). The content labels keep their emojis in the data, and `categoryName()` removes them for display.

## 4. Screens

Every section was restyled on the same system:
- Words: category pills, the search card, the subtab browser and table, and phone cards.
- Search results.
- Flashcards: setup with a settings side card, the card session and the summary.
- Shadowing: setup, the stage with transport controls, and the summary.
- Dashboard: overview ring, categories, actions and activity.
- My words: page header, toolbar and word cards.
- Word form (`lg` dialog): «اطلاعات اصلی» in a 12-column grid, «مثال، تلفظ و جایگاه», and the AI panel with its review table.
- Account menu and sign-in, sync and offline states, the migration dialog and empty states.

## 5. Verification

- Screenshots are captured with `npm run screenshots`. It runs Playwright against the emulator build at 1440, 1920, 390 and 430 px, in dark and light themes, for 15 screens, and writes them to `test-results/screenshots/`.
- The Vitest, Playwright and emulator suites and the production build all run green.
