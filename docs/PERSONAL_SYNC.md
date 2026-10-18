# Personal vocabulary cloud sync (Phase 5A.1)

Branch: `feature/pro-v2-personal-sync`. **Status (2026-10-18): rules deployed to
`deutsch-vokabular-v2-dev` after the product owner's approval (ruleset `1defcc66…`, released
14:25 UTC, identical to `v2/firestore.rules`); client switch enabled in the git-ignored
`v2/.env.local`. Live tests with real accounts (§7 step 8) are pending.**

Deployment record:
- Pre-checks: live = commit `84c9af9`; the diff adds only `customWords` and comments.
- Tests: emulator 48/48 (twice); dry run OK; CLI permissions 7/7.
- Deploy: `released rules firestore.rules to cloud.firestore`.
- Post-checks:
  - Live source identical to the file (same SHA-256).
  - Google Rules engine (`projects.test`): 25/25, i.e. 14 existing cases plus 11 customWords cases
    (owner allowed; other user and anonymous denied; deletes denied; empty create denied; unknown
    path denied).
  - Unauthenticated REST reads of customWords, progress and syncCodes: all 403.
- Data: existing user data unchanged (read-only check).
- Note: the header comment of the deployed file still says "awaits the product owner's approval".
  That is a cosmetic wording fix for the next reviewed rules deployment (changing it now would make
  live ≠ file).

## 1. Risks found before implementation

| # | Risk | Resolution |
|---|---|---|
| K1 | Whole-document last-writer-wins would let a stale offline edit **resurrect** a word deleted on another device | Rules: a tombstone is final. Client: the rejected edit is kept as a new word ("conflict copy") and the user is told (§3) |
| K2 | The legacy import on two devices would create two documents per word (random ids) | Deterministic id = `pw_` + SHA-256(`dvok5_custom:<legacyId>`)[0..20]; the second device updates the same document. `createdAt` from the legacy id is deterministic too (0 if unknown) |
| K3 | The live dev project runs the Phase 3 rules (no `customWords`); writes would be rejected | `VITE_PERSONAL_WORDS_SYNC` (default **off**; always on with the emulators). While off, changes stay queued on the device and are uploaded when it is switched on |
| K4 | Phase 5A words live in the device-only store `personal-words` | One-time takeover per account into the sync queue (marker in meta); the old store is kept untouched as a backup |
| K5 | A second sync engine would duplicate subtle logic | The Phase 3 progress engine was generalised (`DocSyncEngine<V>`); progress is a thin layer with **unchanged** storage and Firestore formats, verified by all existing progress tests |

## 2. Architecture

```
PersonalVocabulary ──► DocSyncEngine<CustomWordValue> ──► IndexedDB v5: custom-confirmed / custom-pending (per uid)
      (UI API)              (same engine as progress)  └─► Firestore users/{uid}/customWords/{wordId}   (when enabled)
ProgressSyncEngine ──► DocSyncEngine<ProgressValue>   ──► IndexedDB progress-confirmed / progress-pending (unchanged)
                                                       └─► Firestore users/{uid}/progress/{wordId}       (unchanged)
```

- **Shared engine** (`features/sync/docSyncEngine.ts`):
  - Pending overlay over the confirmed copy.
  - Per-document last-writer-wins in **server commit order**.
  - Stale-snapshot guard (server time + opId); own echoes recognised by opId.
  - Retry with backoff for transient errors.
  - Permanent errors stay queued as "failed", never dropped.
  - Incremental listener (`updatedAt >` newest local server time, full read every 7 days).
  - Offline queue in IndexedDB.
- **Local-only mode:** `remote: null` gives the same queue without network.
- **Document:**
  `{ schemaVersion: 1, id, article, lemma, type, grammar, fa, example, exampleFa, pronunciationFa, placement, learned, deleted, source, legacyId, createdAt, clientUpdatedAt, updatedAt (server), opId, deviceId }`.
- **Account isolation:** one engine per uid, created on sign-in and stopped on sign-out or account
  switch. Every IndexedDB read is a uid key range; the rules allow only the owner.

## 3. Offline and conflict behaviour

| Situation | Result |
|---|---|
| Create, edit or delete offline | Applied locally at once, queued in IndexedDB, uploaded automatically after reconnection (also after a reload) |
| Same word edited on two devices | The later write in server order wins on **all** devices (deterministic). Field-level merge is not done (documented limitation) |
| Deleted on A, edited (offline) on B | The rules reject B's write (tombstone is final). B keeps the edit as a **new word**, drops the rejected change, and shows «… در دستگاه دیگری حذف شده بود؛ ویرایش شما … نگه داشته شد» |
| Undo after delete | Brings the content back as a new word (the tombstone stays final) |
| Interrupted upload / transient error | Retried with backoff; the op id makes repeats idempotent |
| Duplicate snapshot delivery | Ignored by the stale guard (same server time + opId) |
| Rejected write (e.g. rules not deployed, invalid data) | The word stays on the device, marked «در ابر ذخیره نشد»; the status shows the error and «تلاش دوباره» |
| Local IndexedDB write fails | Reported at once («ذخیره روی این دستگاه ناموفق بود»); the change lives in memory for the page |
| Sign-out / account switch | The engine stops; the other account sees nothing (stores partitioned by uid) |

**Recovery after failed synchronisation.**
- Queued and failed changes survive reloads.
- «تلاش دوباره» (`retryFailed`) re-sends permanently failed writes.
- Transient failures retry automatically.
- Nothing is deleted locally until the server has confirmed it.
- The Phase 5A store `personal-words` remains as a backup.

## 4. Rules changes (`v2/firestore.rules`)

The `customWords` block was moved from the Phase 5A proposal into the real rules file; the
proposal file was removed (one source of truth). Compared with the deployed Phase 3 rules, the
**only** additions are this block and comments:

- read: owner only; delete: never.
- create: owner + `validCustomWord`, alive or directly as a tombstone.
- update: owner + `validCustomWord`, **only while `resource.data.deleted == false`** (tombstone
  final); `createdAt`, `source` and `legacyId` are immutable.
- `validCustomWord`:
  - exact field set; id `^pw_[0-9a-f]{20}$` equal to the document id
  - enums (article, type, source); size limits
  - placement map with exactly `{category, subtab}`
  - `updatedAt == request.time`; bounded `createdAt` / `clientUpdatedAt`; non-empty `opId` / `deviceId`

Progress, users, migrations and the closed `syncCodes` are unchanged.

## 5. Test results (emulator only; no real Firebase contact)

| Suite | Result |
|---|---|
| Vitest (unit + jsdom UI, incl. 12 new sync tests and the generic engine through all existing progress tests) | 324 / 324 |
| Emulator rules + sync (`npm run test:emulator`): 23 existing rules + 12 `customWords` rules + 5 progress sync + **8 personal sync with the real SDK** | 48 / 48 (3 consecutive runs) |
| Playwright production build (browse-only) | 54 passed, 4 skipped by design |
| Playwright emulator build (real SDK, IndexedDB), incl. two browsers with the same account | 27 passed, 1 skipped by design |
| TypeScript, production build | clean |

The personal sync scenarios are:
1. Create/edit/learned/delete across two devices, with the tombstone visible in the cloud.
2. Offline create, edit and delete, then reconnect.
3. Concurrent edits converge.
4. No resurrection, with a conflict copy.
5. Interrupted upload with retries, and no duplicates.
6. A reload uploads the queued changes.
7. Account isolation, including a direct read denied.
8. Phase 5A takeover, once only.

## 6. Limitations

- Concurrent edits to the *same* word: whole-word last-writer-wins (no field merge).
- An undo after delete and a conflict copy create a **new id**; flashcard and shadowing history of
  the old id is not carried over.
- Rules cannot limit the number of documents per user (cost only; App Check recommended).
- Device-local practice history (reviews, shadowing) is still not synced (`REVIEW_DESIGN.md` §6).
- No real-account test yet; this is part of §7.

## 7. Controlled deployment (only after explicit approval)

1. Review the change: `git diff 84c9af9 -- v2/firestore.rules` (Phase 3 file → now). It must show
   only the `customWords` block and comments.
2. `cd v2 && npm ci && npm run test:emulator` → 48/48.
3. `npx firebase login:list` → the owner account; never the legacy project.
4. Dry run: `npm run rules:deploy:dev -- --project deutsch-vokabular-v2-dev` (target checks +
   emulator tests, no cloud command).
5. Deploy: `npm run rules:deploy:dev -- --project deutsch-vokabular-v2-dev --confirm deutsch-vokabular-v2-dev`.
6. Verify read-only: the live ruleset equals `v2/firestore.rules`. Run `projects.test` cases for
   customWords (owner allowed; other user and anonymous denied; delete denied; un-delete denied).
   Check that an unauthenticated read is denied.
7. Enable the client: add `VITE_PERSONAL_WORDS_SYNC=true` to `v2/.env.local`, then restart
   `npm run dev`.
8. Manual check with test accounts:
   - Add a word in browser A and see it in browser B.
   - Edit offline (DevTools → Offline), reconnect, and check the result.
   - Delete in A and check that it disappears in B.
   - Check that a second account sees nothing.
9. **Rollback:**
   - Set `VITE_PERSONAL_WORDS_SYNC=false`. The words stay on the devices; changes queue again.
   - If needed, redeploy the previous rules: `git show 84c9af9:v2/firestore.rules > v2/firestore.rules`,
     run the deploy command, then restore the file. Cloud documents are never deleted.
