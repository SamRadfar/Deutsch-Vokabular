# Data Migration Specification (legacy → v2)

Status: **specification only (Phase 1).** Nothing in this document has been
implemented. No user data has been read, copied or modified.

Inputs are described in [`DATA_CONTRACTS.md`](DATA_CONTRACTS.md). The target
architecture is in [`adr/0001-target-architecture.md`](adr/0001-target-architecture.md).

## 1. Principles

1. **Never destroy legacy data.** During the transition, v2 never writes, renames or
   deletes any legacy `localStorage` key and never writes to `syncCodes/*` in
   Firestore. Legacy data is the rollback path.
2. **Never lose a tick.** The first import is a union. A learned mark is never
   removed by a migration.
3. **Idempotent.** Running the migration twice gives the same result. A migration
   record stores a hash of the inputs and the counts.
4. **Explainable.** Anything that cannot be mapped is archived with its original
   key, not dropped. A summary (imported / archived / skipped) is shown to the user.
5. **Secrets stay out.** `dvok5_apikey` is never copied, exported, synced or logged.

## 2. Stable word ids (prerequisite)

The legacy identity `mainKey::word` is not unique (DQ-1) and breaks when content is
edited. v2 introduces stable ids:

- **Minting:** once, from the frozen baseline order
  (`tests/fixtures/baseline/progress-keys.json`), e.g. `arch-bau-0001`. The id is
  then stored **in the content file** next to the entry and is never recomputed from
  position again. Editing a word's text or moving it later keeps its id.
- **Legacy index:** a generated, committed file maps each legacy key to ids:
  `legacyKeyIndex: Record<"mainKey::word", WordId[]>`. The 5 colliding keys map to
  2 ids each, which reproduces today's coupled behaviour exactly. 994 keys map to 999 ids.
- **Content checks:** a test asserts that every baseline row has exactly one id,
  that ids are unique, and that the legacy index covers all 994 keys.

## 3. Local migration (per device, on first v2 start)

Precondition: v2 is served from the **same origin** as the legacy app, so it can
read the legacy `localStorage`.

### Step 0: Backup

Before anything is interpreted, copy the raw string values of `dvok6`, `dvok5`,
`dvok5_custom`, `dvok5_pron_settings`, `dvok5_pron_exposure`,
`dvok5_pron_selected_tabs`, `dvok_theme` and `dvok_sync_code` into a v2 backup
record (IndexedDB, with a timestamp). Offer **"Download backup (JSON)"** in the UI.
The API key is excluded.

### Step 1: Parse defensively

Each key is parsed on its own. A malformed value (bad JSON, wrong type) is archived
raw and reported. It never aborts the other keys.

### Step 2: Map

| Legacy | Rule | v2 target |
|---|---|---|
| `dvok6` | For every `key: true`, look up `legacyKeyIndex[key]` and mark every id learned (`source: 'legacy-dvok6'`). Unknown keys go to the **orphan archive** with their original key. Relocation candidates (same word text, other category: 7 of the 39 removed words) are listed for the product owner to decide on. **No silent remapping.** | `progress[wordId].learned = true` |
| `dvok5` | Only if `dvok6` has **no** checks (the same rule as the legacy banner, because a non-empty `dvok6` means the user started over deliberately). Count the entries and select the historical map with that `checkboxCount` (490 / 733 / 822, `tests/fixtures/legacy/dvok5-index-maps.json`). Convert `index → progress key`, then apply the `dvok6` rule. An unknown count archives the blob raw and reports it. If `dvok6` is non-empty, `dvok5` is archived and offered as an optional manual import. | same as `dvok6` |
| `dvok5_custom` | Keep `id`, all fields, `status` and `checked`. A placement whose `main/tab` no longer exists goes to an "Unsorted" bucket and is not dropped. Text is stored raw and **escaped when rendered**. | `customWords[id]` |
| `dvok5_pron_settings` | Validate the ranges (`rate ∈ {0.55, 0.85, 1.2}`, `1 ≤ pause ≤ 8`, `repeat ∈ {once, twice, twotwo}`). Invalid values fall back to defaults and are reported. | `settings.pronunciation` |
| `dvok5_pron_exposure` | Kept keyed by word text (its current semantics). Counters are not split per id. | `exposureByText` |
| `dvok5_pron_selected_tabs` | Filter to existing category keys. | `settings.pronunciation.selectedCategories` |
| `dvok_theme` | Device preference, not synced. | device settings |
| `dvok_sync_code` | Used only to offer the optional read-only legacy cloud import (§4). | — |
| `dvok5_apikey` | **Not migrated.** Once server-side AI exists, the UI tells the user that the key is no longer needed and offers a button to delete it. Deletion is the user's action. | — |

### Step 3: Commit

Write the v2 store in one transaction with:

```json
{ "schemaVersion": 1, "migration": { "from": "legacy", "at": "<iso>", "inputHash": "<sha256>",
  "counts": { "learned": 0, "orphans": 0, "custom": 0, "archived": 0 } } }
```

If an identical `inputHash` has already been migrated, skip. If the inputs changed
(for example, the user kept using the legacy app), migrate again as a union.

## 4. Cloud migration (when Google sign-in arrives, Phase 2+)

1. **First sign-in on a device:** merge the local v2 data into `users/{uid}`.
   - Learned marks: union (first merge only).
   - Custom words: keyed by `id`. On a conflict, the later `updatedAt` wins (legacy
     entries without timestamps lose to cloud entries that have them).
   - Settings: the cloud value wins if it exists. Otherwise the local value is used.
2. **Optional legacy cloud import:** if `dvok_sync_code` exists, or the user enters a
   code, read `syncCodes/{code}` **once, read-only**, normalise it with the same
   rules as §3 and union-merge it. v2 never writes or deletes `syncCodes`
   documents. Retiring them is a separate, later decision.
3. **After migration:** progress is stored per word
   (`users/{uid}/progress/{wordId}` with `updatedAt`), and later edits use per-word
   last-writer-wins instead of the legacy whole-blob replacement.

## 5. Rollback

| Layer | How to roll back |
|---|---|
| Code | `main` is unchanged until the product owner approves a merge. The tag `backup-before-claude-code` marks the pre-refactor state. GitHub Pages serves `main`, so a rollback means redeploying the previous commit. |
| Local data | Legacy keys are untouched (§1), so the legacy app keeps working with them. Changes made in v2 after migration are not visible to the legacy app. This divergence is accepted and documented in the UI. The JSON backup can restore any state. |
| Cloud data | `syncCodes/*` is untouched. `users/*` is new and can be deleted without affecting legacy sync. |
| Service worker | The legacy `sw.js` never installs today (V1). A v2 service worker must use a new cache name and must not intercept a preserved legacy copy if one is kept. A rollback deploy must ship a service worker that unregisters or replaces the v2 one. |

**Transition option for the product owner:** keep the legacy app reachable on the
same origin (for example `/Deutsch-Vokabular/legacy/`) for a fixed period. It shares
`localStorage` with v2, so users can fall back without losing data.

## 6. Migration test plan (to implement with the migration, Phase 2)

All fixtures are **synthetic**. They never contain real user data or keys.

- `dvok6` with normal keys, with each of the 5 colliding keys (expect 2 ids),
  with orphan keys from the removed subtab (expect them archived), and malformed JSON.
- `dvok5` blobs of exactly 490, 733 and 822 entries (expect the correct map),
  another length (expect it archived), and `dvok5` + non-empty `dvok6` (expect no
  automatic import).
- Custom words with HTML in their fields (expect stored raw and rendered escaped),
  with a non-existent tab (expect "Unsorted"), and with `pending` status.
- Out-of-range pronunciation settings.
- Idempotency: running twice gives an identical store. Changed input gives a union.
- A property test: for any synthetic legacy state, the set of learned built-in rows
  in the legacy app equals the set of learned ids in v2, including collision coupling.
