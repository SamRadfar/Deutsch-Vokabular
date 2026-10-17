# Personal vocabulary (Phase 5A)

Branch: `feature/pro-v2-personal-vocabulary`. Code: `v2/src/features/personal/`.

## 1. Analysis: legacy app and compatibility risks

**Legacy custom words** (`index.html` `:3485–3717`, `localStorage["dvok5_custom"]`):

```
{ id: "cw"+Date.now(), main, tab, word, sentence, type: n|v|a|x, fa, ex, exFa, pr,
  status: "pending"|"ready", checked: boolean }
```

- Words were added with «+» into a chosen category/subtab and shown there as the group
  «Meine Wörter · واژه‌های من».
- The meaning, example and pronunciation were filled in by the Anthropic API, called from the
  browser with the user's own key.
- Without a key or network the word stayed `pending` (no meaning).
- The words were synced only through the unauthenticated `syncCodes` document.

| Risk | Handling |
|---|---|
| R1 `type: "x"` means «Ausdruck» here, but «unclassified» in the built-in data (DQ-2) | Mapped to `au` on import; unknown codes → `x` |
| R2 `pending` words have no meaning | Imported as **incomplete** (badge «ناقص», filter), never dropped |
| R3 A placement (`main/tab`) may no longer exist | Imported without placement (shown only in «واژه‌های من»), never dropped |
| R4 The legacy app renders `word` unescaped (XSS, S2) | Text is stored raw and rendered as React text everywhere (tested with `<b>`/`<img onerror>`) |
| R5 The same word added twice, or already built in | Duplicates are reported; nothing is merged or deleted automatically (§6) |
| R6 Ids `cw<timestamp>` are not unique across devices | New ids `pw_` + 20 random hex; the legacy id is kept as `legacyId` |
| R7 The legacy API key in `localStorage` | Never read or imported; no AI calls in this phase |
| R8 **The deployed rules accept only `dv_` ids for progress** | The learned flag of a personal word is stored in the personal record and never sent to the sync engine (tested) |
| R9 Review/shadowing logs validated `dv_` ids only | They now accept `dv_` and `pw_` ids |

## 2. Data model (`model.ts`, schema version 1)

```ts
interface PersonalWord {
  schemaVersion: 1;
  id: string;                  // "pw_" + 20 hex (80 random bits) — disjoint from built-in "dv_" + 10 hex
  article: 'der'|'die'|'das'|null;   // nouns only
  lemma: string;               // 1–120, the word or phrase without article
  type: 'n'|'v'|'a'|'au'|'x';
  grammar: string;             // ≤ 200, e.g. "Plural: die Wände" or "ging, gegangen"
  fa: string;                  // ≤ 200, required in the form (empty only for incomplete imports)
  example: string; exampleFa: string;   // ≤ 400 each
  pronunciationFa: string;     // ≤ 200
  placement: { category; subtab } | null;  // optional: also shown inside that subtab
  learned: boolean;            // local (see R8)
  createdAt: number; updatedAt: number;
  source: 'manual'|'legacy-import';
  legacyId: string|null;       // idempotent import
}
```

- **Validation:** Persian messages per field.
  - The German word must contain a letter and no Persian script.
  - A noun typed as «die Wand» gets its article split off.
  - Control characters are removed and whitespace is collapsed.
  - Lengths are capped.
- **Display:** `toEntry()` turns a personal word into the built-in `VocabularyEntry` shape, so all
  existing components render it.

## 3. Integration (no second learning engine)

| Tool | How personal words take part |
|---|---|
| Search | The index covers built-in + personal words; the category filter offers «⭐ واژه‌های من». «نمایش در فهرست» opens the word's placement or «واژه‌های من» and focuses it |
| Browse | Placed words appear as «Meine Wörter · واژه‌های من» in their subtab (legacy behaviour); content objects are not modified |
| TTS | Same `WordSpeech` / `GermanExample` buttons |
| Flashcards | Same deck/session/outcome code; scope «⭐ واژه‌های من». «Know» marks the word learned **locally** |
| Shadowing | Same player; chip «⭐ واژه‌های من»; exposure counts per id |
| Dashboard | A separate «واژه‌های من» card (count, learned), labelled device-local. The overall 999 figures stay the synced built-in progress |

## 4. Persistence and account isolation

- **Store:** IndexedDB **v4** adds the store `personal-words`, keyed `[uid, id]`.
  - The upgrade only adds a store; v1–v3 data is kept (tested).
  - Every read is a key range on the uid; another account, or a uid prefix, never sees the words
    (tested).
- **Behaviour:**
  - Local-first: changes apply at once and are written serialised.
  - A failed write is reported («ذخیره … ناموفق بود») and the change stays in memory for the page.
  - Unreadable records are counted and left untouched.
- **Lifecycle:** like the sync engine, the store is created per uid and dropped on account switch
  or sign-out.
- **Deleting:**
  - Needs a confirmation dialog, then offers «بازگردانی» (undo) for 12 s.
  - Imports never delete anything.
- **Offline:** works the same on the same device (tested). Signed out, the section asks for sign-in
  (no guest data, ADR 0003 R2).
- **Cloud sync is not enabled.** Personal words do not reach other devices yet, and the UI says so
  («همگام‌سازی ابری هنوز فعال نیست»).

## 5. Proposed Firestore collection (NOT deployed, needs approval)

`v2/firestore.proposed.rules` contains the deployed rules unchanged, plus:

```
users/{uid}/customWords/{wordId}     wordId = "pw_" + 20 hex
  read: owner · create/update: owner + exact schema · delete: never (tombstone `deleted: true`)
  immutable on update: createdAt, source, legacyId · updatedAt == request.time
  fields: schemaVersion, id, article, lemma, type, grammar, fa, example, exampleFa, pronunciationFa,
          placement{category,subtab}|null, learned, deleted, source, legacyId, createdAt,
          clientUpdatedAt, updatedAt, opId, deviceId
```

- **Tested on the emulator only:**
  - `tests/emulator/customWords.rules.test.ts` (9 tests): isolation, schema, sizes, server time,
    immutable fields, no deletes.
  - `npm run test:emulator:proposed`: all 23 existing rules tests also pass against the proposed
    file, so the proposal weakens nothing.
- **Never deployed by the tooling:** `firebase.json` and `deploy-rules.mjs` only use
  `firestore.rules`, and a unit test fails if that changes.
- **Design notes for the sync implementation (after approval):**
  - Per-word last-writer-wins by server time, like progress.
  - Tombstones instead of deletes, so another device learns about a deletion.
  - The learned flag moves into the document.
  - One write per change. A full read happens only on the first sync; afterwards it is incremental
    by `updatedAt`, as for progress.
- **Cost (Spark):** a few writes per edited word. Rules cannot cap the *number* of documents; that
  is a quota risk only, with no data exposure (App Check recommended, `FIREBASE_VALIDATION.md` §6).

## 6. Legacy migration (`legacyImport.ts`, «انتقال از نسخهٔ قدیمی»)

- **Sources:** the legacy `localStorage` on the same origin, or the JSON backup file of the progress
  migration (`backup.ts`). Both are only **read**; the legacy data stays untouched (tested).
- **Preview first:** counts and a per-word list before anything is written:
  - new
  - incomplete
  - already imported (same `legacyId`) → skipped
  - duplicate of a personal word → skipped
  - duplicate of a built-in word → skipped unless the user ticks «… را هم منتقل کن»
  - invalid → reported
- **Idempotent:** a second import adds nothing (tested). The confirmed import is **one** IndexedDB
  transaction.
- **Field mapping:** `word` → article + lemma, `fa`, `ex` (or the legacy context sentence) →
  example, `exFa`, `pr`, `checked` → learned, `main/tab` → placement. The creation time is taken
  from the `cw<timestamp>` id.

## 7. Limitations

- No cloud sync of personal words until §5 is approved and deployed. The learned flag of personal
  words is device-local.
- No AI completion of incomplete words (Phase 5B).
- Duplicate detection compares the German word only (folded); meaning variants are not compared.
- Placement is a single category/subtab (as in the legacy app); there are no tags or own folders.
