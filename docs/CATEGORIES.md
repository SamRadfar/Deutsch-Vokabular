# Categories (V2)

One category system for every workflow: «افزودن واژه», «ساخت واژه با هوش مصنوعی», editing and moving
words, «مدیریت دسته‌بندی‌ها», the words browser, search, flashcards, shadowing (incl. PiP) and
statistics.

## Model

| | |
|---|---|
| Built-in main categories | the library's categories (`arch`, `fitness`, …). Read-only, never written by the app. |
| Own main categories | `users/{uid}/categories/{uc_…}` with `parentId: null` |
| Own subcategories | `parentId` = an own main id **or** a built-in key (a sub "inside" a built-in category is an own document; the library is not modified) |
| Depth | two levels only (a subcategory cannot have children) |
| Ids | `uc_` + 20 hex, random (`newCategoryId`); rename keeps the id |

Document fields: `schemaVersion, id, name (1–60), parentId, sort, deleted, createdAt,
clientUpdatedAt, updatedAt (server time), opId, deviceId`. Deletion is a tombstone (`deleted: true`)
so other devices learn about it; the rules forbid real deletes.

A word's placement (unchanged `customWords` schema): `{ category, subtab }` where `category` is a
built-in key or an own main id and `subtab` is a built-in subtab id, an own sub id, or `_`
(directly in the main category).

Names are unique per parent after folding case, whitespace, umlauts and ß; the same name under
different parents is allowed.

## Code

`v2/src/features/categories/`

- `model.ts`: ids, name validation and Persian messages
- `categoryStore.ts`: local-first store on the shared `DocSyncEngine` (IndexedDB queue → Firestore)
- `catalog.ts`: `buildCatalog` (built-in + own), placements, `Destination` with `destinationError` (no writes) and `applyDestination` (creates on commit, idempotent), `browseCategories` (words-browser tabs)
- `CategoryDestinationPicker.tsx`: the shared control with the four options
- `CategoryManager.tsx`: «مدیریت دسته‌بندی‌ها»
- `migration.ts`: compatibility for the first generator version (below)

Nothing is created while a form is open or a preview is shown. Categories are created when the user
saves or imports, and cancelling creates nothing. The AI generator creates the destination and, when
no subcategory is chosen, one subcategory per AI-suggested subcategory of the imported rows.

Deleting a category never deletes words. The user moves them to another destination or leaves them
uncategorised («واژه‌های من»). A deleted category stays a tombstone: recreating one with a known id
gets a fresh id, because the rules never revive a tombstone.

After an AI import, «نمایش در زبانهٔ دسته» opens the words browser on the destination tab.
«پیشرفت» lists your own main categories with their word and learned counts.

## Compatibility

The first generator version stored own categories as `placement.category = "my:<name>"`. After
loading, `migrateLegacyCollections` creates real categories with **deterministic** ids
(`stableCategoryId("legacy:<name>")`) and a deterministic `createdAt` (the oldest word of the
group), so every device writes identical documents. It then reassigns those
words.

The migration is non-destructive and idempotent:
- Nothing is deleted.
- Only the placement of `my:` words changes.
- A second run finds nothing to do.

The 999-word library and its progress are not touched.

## Cloud sync switch

Category sync needs the `categories` block of `v2/firestore.rules` on the target project.

- **Emulator:** always on.
- **Real project:** on only with `VITE_CATEGORY_SYNC=true` in the build env, after those rules are deployed.

Until then, categories are kept on the device. Words with `uc_` placements still sync; on another
device their category shows as «دستهٔ نامشخص» until category sync is enabled.

## Tests

- **Unit:** `tests/unit/categories/*`, `tests/unit/personal/generate.test.ts`, `generator-ui.test.tsx`
- **Rules:** `tests/emulator/categories.rules.test.ts`
- **Sync:** `tests/emulator/categorySync.emulator.test.ts`, covering two devices, reload, offline and isolation
- **Browser:** `tests/e2e-emulator/categories.spec.ts`
