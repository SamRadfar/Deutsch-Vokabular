# Personal progress: storage, synchronisation and conflict handling

Implements ADR 0003 (sign-in required for cloud features) and ADR 0004.
Code: `v2/src/features/progress/`.

## 1. Who owns which state

| State | Owner | Where | Lifetime |
|---|---|---|---|
| Built-in vocabulary | Repository (versioned content) | `v2/src/data/vocabulary/*.v1.json` | Shipped with the app; never copied to users |
| Server-confirmed progress | Firestore | `users/{uid}/progress/{wordId}` | Permanent; never deleted by clients |
| Device copy of confirmed progress | `ProgressSyncEngine` | IndexedDB `deutsch-vokabular-v2` → store `progress-confirmed`, key `[uid, wordId]` | Cache; refreshed by snapshots |
| Pending local changes | `ProgressSyncEngine` | IndexedDB → store `progress-pending`, key `[uid, wordId]` (one per word, latest wins) | Until the server confirms them; survives reloads, sign-out and account switches |
| Device / migration markers | `ProgressSyncEngine` | IndexedDB → store `meta`, key `[uid, key]`; device id under `['__device__', 'deviceId']` | Permanent per device |
| Identity | Firebase Auth | Firebase's own IndexedDB persistence | Until sign-out |
| What the UI shows | React (`ProgressProvider`) | Memory: **pending ?? confirmed ?? not learned** | Per render |

There is exactly **one** local source of truth for progress (the app's IndexedDB). Firestore runs
with a memory cache, so the SDK does not keep a second persistent copy that could disagree.

## 2. Identity and isolation

- Every record is keyed by the Firebase `uid`, never by email.
- IndexedDB reads are key ranges on `[uid, …]`, filtered again by uid. One engine instance
  serves exactly one uid and is stopped on sign-out or uid change.
- The UI renders personal data only for `auth = signed-in` **and** an engine whose uid equals the
  current uid. During `initializing` (session restore) nothing personal is shown.
- Signed-out users see no checkboxes and cannot reach cached progress through the app.
  The data stays on the device in that account's partition. On a **shared device**, a person
  with developer tools can read it (see §7).
- Server side: `firestore.rules` restricts `users/{uid}/**` to `request.auth.uid == uid`.

## 3. Write path

1. Click on ✓ → `engine.setLearned(wordId, learned)`: a new `PendingOp { opId, learned, … }`
   replaces any older pending op for that word, the UI updates **synchronously**, and the op
   is persisted to IndexedDB (serialised, in order).
2. `flush()` (online only) sends at most one in-flight write per word:
   `setDoc(users/{uid}/progress/{wordId}, { …, opId, deviceId, updatedAt: serverTimestamp() })`.
3. Write acknowledged → the op is marked `acked` (it stays pending until seen in a snapshot).
4. Snapshot shows the doc with our `opId` → confirmed copy updated, pending op removed. Only then
   does the status show «ذخیره شد».
5. Errors: transient errors (`unavailable`, …) retry with exponential backoff (2 s … 60 s).
   Permanent errors (`permission-denied`, `invalid-argument`, …) mark the word as **failed**
   (red marker plus «خطا در همگام‌سازی»). The change is kept, and «تلاش دوباره» re-queues it.

Rapid toggling coalesces: only the latest intention per word is sent, and an in-flight older op
cannot overwrite it.

## 4. Read path and conflict resolution

**Read cost.** The first sync on a device (or after 7 days) reads the user's whole progress
collection; afterwards the listener only queries documents with `updatedAt` newer than the newest
server time stored locally (`FIREBASE_VALIDATION.md` §4).

The listener (`onSnapshot`, metadata changes included) delivers **server-confirmed** documents
only. Latency-compensated local echoes (`hasPendingWrites`) are skipped. For each document:

1. **Stale guard:** if its server time is older than the confirmed copy (or it is the same op),
   it is ignored. This protects against out-of-order delivery.
2. Otherwise it becomes the confirmed copy.
3. If a pending op exists for the word:
   - same `opId` → our write is confirmed → drop the pending op;
   - pending op already `acked` and the snapshot is newer → the server state is newer than our
     write → adopt it (drop the pending op);
   - pending op not yet acked → **keep showing the local value**. A remote update never silently
     overwrites an unsynced local action.

**Strategy: per-word last-writer-wins by server commit order.** Firestore orders writes to a
document; `updatedAt` is `request.time` (enforced by the rules). Device clocks
(`clientUpdatedAt`) are stored for diagnostics only and never decide anything.

### Known limitation (documented and tested)

When two devices change the **same word while one or both are offline**, the change that
**reaches the server last** wins, even if it was made earlier in real time. Example: the phone
(offline) unmarks a word at 10:00, and the laptop (online) marks it at 10:05. When the phone
reconnects at 10:10, its older change lands last, so the word ends up *not learned* everywhere.
Fixing this would need per-word version vectors or explicit user conflict resolution. That is
out of scope; the convergence itself is guaranteed and tested.

## 5. Offline, reload, sign-out, account switching

| Situation | Behaviour |
|---|---|
| Offline | Changes go to the IndexedDB queue; status «آفلاین — N تغییر در انتظار». |
| Reconnect (`online` event) | Queue flushes; the listener resubscribes with backoff after errors. |
| Reload while offline | Pending ops are restored from IndexedDB and sent later. |
| Sign out with pending ops | Dialog: wait for sync, or keep on this device. The ops stay in the uid's partition and are sent at the next sign-in **of the same account**. They are never sent under another uid. |
| Account switch | The engine for uid A stops; a new engine for uid B starts with B's partition only. |
| IndexedDB blocked (strict private mode) | Memory fallback; status warns that offline changes are lost on close. |

## 6. Obsolete and unknown word ids

Progress documents whose `wordId` is not in the current content (future content removals, or
foreign writes) are **kept** (never deleted), excluded from statistics and reported in
`view.unknownLearnedIds`. Rules only accept ids of the form `dv_` + 10 hex characters.

## 7. Limitations and follow-ups

- Same-word multi-device offline edits: server arrival order wins (§4).
- Shared devices: signed-out users cannot see cached progress in the app, but the IndexedDB
  partition remains on the device. A "remove this account's data from this device" action is a
  possible follow-up (open decision).
- Rules cannot rate-limit; a signed-in user could create many documents in **their own**
  progress collection (cost only, no data exposure). App Check and budget alerts are recommended.
- Cross-tab coordination: two tabs of the same account each run an engine. They converge through
  the server, but two tabs offline at the same time follow the same limitation as two devices.

## 8. Tests

| Area | Where |
|---|---|
| Engine logic (fake cloud): optimistic updates, coalescing, stale snapshots, feedback loops, unknown ids, offline/reload/reconnect, transient/permanent errors, two devices, two accounts, in-flight race | `v2/tests/unit/progress/syncEngine.test.ts` |
| IndexedDB partitioning and persistence | `v2/tests/unit/progress/localStore.test.ts` |
| Real SDK + emulators: two devices of one account, offline/reconnect, foreign account denied, migration records | `v2/tests/emulator/sync.emulator.test.ts` |
| Browser (emulator build) | `v2/tests/e2e-emulator/auth-progress.spec.ts` |
