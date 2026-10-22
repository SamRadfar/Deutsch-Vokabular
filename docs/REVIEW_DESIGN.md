# Flashcard review (Phase 4A)

Branch: `feature/pro-v2-flashcards`. Code: `v2/src/features/review/`.

## 1. What the user gets

The new main tab **«🔄 مرور»** has three screens:

| Screen | Content |
|---|---|
| Setup | Mode (all · unlearned · learned · review again), category (all or one of the 7), session size (10/20/30/50/all; default 30 like the legacy app), auto-speak toggle. Counts per mode and per category. Signed out: only "all" (practice without saving), with a note. |
| Session | German word, word type, category/subtab and German example on the front (🔊 for word and example). Persian meaning, Persian pronunciation and example translation on the back. Flip by tapping the card or with «نمایش معنی». «بلد نیستم» / «بلدم», «قبلی» / «بعدی», «پایان جلسه», «شروع دوباره». Progress bar and ✓/✗ tally. |
| Summary | Known / don't know / unanswered / percentage, the list of unknown words, and three actions: repeat the unknown cards, restart the same session, set up a new session. |

Input methods:

| Input | Action |
|---|---|
| Tap / click on the card, `Space`, `Enter` | Flip |
| Swipe right / left (touch, pen, mouse; ≥ 80 px) | Know / don't know (legacy gestures) |
| `→` / `←` | Next / previous (the page is LTR, like the main tabs) |
| `2` / `1` (also on the numpad) | Know / don't know |
| `S` | Speak the word (like the 🔊 button) |
| `Esc` | End the session |

Keys use `KeyboardEvent.code`, so they work with a Persian keyboard layout too. They are ignored
in form fields, menus and dialogs, and while the review tab is hidden. Space and Enter on a focused
button keep their native meaning.

## 2. Structure (no duplicated logic)

| Module | Kind | Responsibility |
|---|---|---|
| `deck.ts` | pure | Which words: modes × category scope over the content model (never the DOM), Fisher–Yates shuffle, session size |
| `session.ts` | pure reducer | Card order, position, side, answers, finished flag; `summarize()` |
| `outcome.ts` | pure | What an answer changes in the user's data (§3) |
| `model.ts` / `reviewLog.ts` | data | Device-local review records per uid, observable |
| `useFlashcardSession.ts` | hook | The single code path for buttons, keys and swipes |
| `components/*` | UI | Setup, session, card, summary |

Every session, including restart and repeat, is created by `createSession()`. No field can survive
from an earlier session.

## 3. Persistence policy

- **"Know"** on a word that is not learned marks it learned through the existing progress sync. That
  is one Firestore write per word: `users/{uid}/progress/{wordId}`, `origin: "toggle"`, exactly like
  ticking the checkbox. Words that are already learned are not written again.
- **"Don't know"** never removes a learned mark that existed before the session. Review results do
  not overwrite existing progress.
- The only "un-learn" is a correction within the same session: answering "know" and then changing
  that card to "don't know" undoes the mark this session made.
- **Every answer** goes into the device-local review log: last result, time, and know/again
  counters. The **"review again"** list is the set of words whose last answer was "don't know". A
  later "know" removes the word from it.
- Signed out: practice only. Nothing is saved, which is consistent with ADR 0003 R2 (no guest mode).
- Offline: the review log is local, and "know" marks queue in the existing offline queue.

## 4. Local storage change (additive)

IndexedDB `deutsch-vokabular-v2` goes from version 1 to version 2 and adds the object store
`review-state`, keyed `[uid, wordId]` and partitioned by uid like the other stores.

- The upgrade only adds a store; existing progress, pending changes and meta data are kept (unit
  test).
- An older tab releases its connection on `versionchange`, so it does not block the upgrade.
- Answers are merged inside one transaction, so two tabs never lose counts.

## 5. Firestore: unchanged

No schema, rules or deployment change. The only cloud writes are the existing progress documents.
Cost: at most one write per newly learned word, so a session of 30 cards costs at most 30 writes.
The Spark limit is 20,000 writes per day.

## 6. Proposal (not implemented, needs approval): cloud-synced review state and SRS

Today the review-again list does **not** follow the user to another device. Syncing it, and later
spaced repetition, needs a new per-user collection. It would be:

```
users/{uid}/reviews/{wordId}
  schemaVersion: 1
  wordId: string            // == document id, dv_ + 10 hex
  lastResult: 'know' | 'again'
  knowCount, againCount: int (0..100000)
  box: int (1..5)           // Leitner box (SRS step)
  dueAt: timestamp | null   // next review date
  updatedAt: request.time   // server order, as for progress
  clientUpdatedAt, opId, deviceId   // same meaning as in progress
```

- Rules: owner-only read/write, exact field set, value ranges, no deletes, mirroring
  `validProgress`.
- Separate from `progress` on purpose: a review answer must not change the learned flag or its
  last-writer-wins order.
- Cost: one write per answer (a 30-card session = 30 writes), still far below the Spark limit.
- Migration: the local `review-state` records would be uploaded once.

This requires a rules change and an emulator-tested deployment to the dev project, so it is
deliberately **not** part of Phase 4A.

## 7. Legacy defects fixed in v2

| Legacy | Defect | v2 |
|---|---|---|
| V2 | ✗/✓ and 🔊 call the undefined `fcAnswer` / `fcSpeak` | One `answer()` path for buttons, keys and swipes, and the speak button reuses the pronunciation provider (unit and browser tests) |
| V3 | «مرور دوباره» leaves the card scene hidden | Repeat and restart create a fresh session; tests assert that the card is visible and shows the expected cards |
| — | Session reset: hidden elements and counters were restored only by «برگشت»; review reads ticked rows from the DOM | State lives in a reducer; restart resets every field (test); decks are built from data |
| V11 | Dead second flashcard modal with duplicate ids | Not ported |
| — | Know/don't know had no effect on progress | §3 |

The legacy app itself is unchanged.

## Floating flashcard (Document Picture-in-Picture)

During a session, «پنجره شناور» opens a small (≈ 340 × 420) always-on-top window in Chrome / Edge on
desktop. The window stays visible when the main browser is minimized.

**One session.** The card is rendered into the window with a React portal from the running
`useFlashcardSession`.
- The window and the page share the card, the side, the order and the answers.
- «بلدم» / «دوباره» call the same `session.answer` (existing review backend and learned semantics), so nothing is counted twice.
- «قبلی» / «بعدی» never rate a card.
- The card never advances by itself.

**Keyboard** works only while the window has focus, on its own document:
- Space / Enter: flip.
- ← →: previous / next.
- 1: «دوباره».
- 2: «بلدم».

**Lifecycle**
- Closing the window keeps the session; reopening shows the current card.
- At the end of the session, the window shows the result.
- Going back to the setup closes the window.
- The panel is keyed by account, so sign-out or an account switch closes the window at once.

**Shared infrastructure.** `features/floating` (`documentPip.ts`, `useFloatingWindow.ts`) serves
Shadowing and Review. A page has one PiP window, and opening it for one feature replaces the other
feature's window; that feature's session keeps running in the page. Browsers without Document PiP
get a clear explanation.

**Tests**
- `tests/e2e/review-floating.spec.ts`, using a real PiP window in Chromium.
- `tests/desktop/pip-desktop.spec.ts`, on real Windows with Chrome and Edge: the main window minimized, the floating window topmost, no focus stealing.
