# Shadowing and pronunciation practice (Phase 4B)

Branch: `feature/pro-v2-shadowing`. Code: `v2/src/features/shadowing/`. The app does **not**
record, analyse or score the learner's voice. Shadowing here means listening to German text and
repeating it aloud during the pause that follows.

## 1. What the user gets

The new main tab **«🗣 تلفظ»** has three screens.

| Screen | Content |
|---|---|
| Setup | Mode (all · unlearned · learned · review again; personal modes need sign-in), several categories (chips with counts, "all"/"none"), words per session (5–50, default 30 like the legacy app), word repeats (1–4), sentence repeats (0–3), pause (1–8 s in 0.5 s steps, the legacy range), speech rate (0.55–1.2), Persian translation on/off. Shows completed sessions, practised words and practice time for a signed-in user, plus warnings when TTS is unsupported or no German voice is installed. |
| Session | Category and subtab, German word, word type, Persian pronunciation, Persian meaning (optional), German example sentence and its translation (optional). The word or sentence being spoken is highlighted with an equaliser and `aria-current`. A phase line says "listen: word (1 of 2)" or "now repeat the word aloud", with a countdown bar for the learner pause. Controls: ⏮ previous, ⏹ stop (back to the start of the word), ▶/⏸ play / pause / resume, ⏭ next, end session; quick rate and translation toggles; a wake-lock indicator. |
| Summary | Practised / skipped / total / duration, whether the history was saved, «دور تازه» (new weighted round), «تکرار همین واژه‌ها», «تنظیمات تمرین». |

Keyboard: `Space` play/pause, `←`/`→` previous/next word, `Esc` stop, `T` translation. Keys use
`KeyboardEvent.code` and are ignored in form fields, menus and dialogs and while the tab is hidden.

### Sequence per word (`plan.ts`)

```
word ×wordRepeats:      🔊 word      → 🗣 pause (pauseSec)
sentence ×exampleRepeats: 🔊 sentence → 🗣 pause (pauseSec + the time the sentence took, ≤ 15 s)
→ next word
```

Changes to the rate apply from the next utterance. Changes to the repeats apply from the next word.

## 2. Legacy behaviour and defects

| Legacy (`index.html` `:3721–4108`) | v2 |
|---|---|
| Only **ticked** words, read from the rendered table (DOM) | Modes all / unlearned / learned / review again over the content model |
| Only the word is spoken; no example sentence, no phonetic or translation toggle | Word and sentence with separate repeat counts; Persian pronunciation; translation can be hidden |
| Repeat presets once / twice / "2+2" (two words back to back, then one pause) | 1–4 repeats, **each followed by a pause**; "2+2" ≈ 4 repeats |
| Optional "now repeat" message | The phase line always says whose turn it is, with a countdown |
| `pronSkip()` / quick pause→play start a **second loop** while the first is still awaiting: overlapping speech, double index increments | Generation token; exactly one utterance or one timer at any time (unit- and browser-tested) |
| A fallback `setTimeout` per utterance is never cleared; it resolves early while the voice is still speaking | One watchdog per utterance, cleared on end; an expired watchdog cancels the speech |
| No German voice chosen in `pronSpeak()` | The shared speech service picks a German voice and waits for voices that load asynchronously (≤ 1.5 s) |
| V6: `pronOpen()` **removes** `#pron-status` → later calls throw | No DOM manipulation; state lives in the player snapshot |
| `alert()` for empty selections | Inline messages; the start button is disabled |
| Exposure keyed by **word text** in `localStorage`, synced via the legacy `syncCodes` | Keyed by stable word id in IndexedDB, per account (§5) |
| Pauses when the page is hidden; wake lock | Kept, and also pauses when the user leaves the tab |

## 3. Engine (`player.ts`)

`ShadowingPlayer` is pure TypeScript. Speech, timers, clock and wake lock are injected.

- **One thing at a time.** Each step is either an utterance or a timer. Every transition increments
  a generation counter, and callbacks of an older generation are ignored. Examples: an "interrupted"
  error from a cancelled utterance, a cleared timer, a wake lock granted after pausing.
- **Pause and resume.** A pause during speech cancels it, and resume re-speaks that utterance. A
  pause during a learner pause keeps the remaining time; the countdown continues from there.
- **Cleanup.** Stop, next, previous, end and dispose all cancel speech, clear the timer and release
  the wake lock. `dispose()` runs on unmount and on account switch. Tests check that no timers
  remain.
- **Errors.**
  - `not-allowed` (autoplay policy): pause with a message.
  - Other errors skip the utterance; three in a row pause.
  - The watchdog ends utterances that never report back.
- **Voices.** If the voice list is still empty (Chrome loads it asynchronously), the start waits
  for `voiceschanged`, at most 1.5 s. Without a German voice the setup warns; the browser may then
  use another voice. Unsupported TTS disables the start.
- **Wake lock.** `navigator.wakeLock` (Chromium, Safari 16.4+), held only while playing. The browser
  releases it when the page is hidden; elsewhere the session runs without it and the UI says so.
- **Background.** The session pauses when the page is hidden or the tab is left. Browsers throttle
  timers and may stop speech in the background, so silent background playback is not attempted.

## 4. Browser limitations (not fixable in the app)

- **Voices and quality** depend on browser and operating system. Some voices are online and need a
  network. **Offline speech is not guaranteed.**
- **Rate** is a request; engines clamp or ignore extreme values.
- **iOS Safari** allows speech only after a user gesture. The first word starts inside the start
  tap. Speech stops when the screen locks.
- **Background tabs**: playback pauses (§3).
- Automated tests use a deterministic speech mock. **Real voices were not tested automatically.**

## 5. Data

| Data | Where | Synced |
|---|---|---|
| Settings and selection (`dv2.pref.shadowing.v1`) | `localStorage`; device preference, no account data | No |
| Exposure per word (`shadowing-exposure` store, keyed `[uid, wordId]`) | IndexedDB **version 3** (additive upgrade from v1/v2, tested) | No |
| Totals (`meta` → `shadowing:stats:v1`) | IndexedDB, per uid | No |
| Learned progress / flashcard data | unchanged | unchanged |

Signed out: practice works, nothing is stored (ADR 0003 R2). Firestore schema and Security Rules are
**unchanged**. Shadowing writes nothing to Firestore (tested). Syncing exposure would need a
schema and rules change; it could share the proposed `users/{uid}/reviews` collection
(`REVIEW_DESIGN.md` §6) and needs approval.
