# Firebase integration validation (Phase 3B)

Branch: `chore/pro-v2-firebase-validation`.

**Status: ⏸ waiting for external configuration.** No real Firebase project is configured (there
is no `v2/.env.local`), so **real Google sign-in and real Cloud Firestore have not been tested**.
Everything that can be checked locally has been checked (§2–§6). The live protocol (§7) is ready
for when the product owner has completed `FIREBASE_SETUP.md`.

## 1. Result legend

| Label | Meaning |
|---|---|
| **Real** | Verified against a real Firebase project with a real Google account |
| **Emulator** | Verified with the real Firebase SDK against the Auth/Firestore emulators (fake Google accounts) |
| **Mock** | Verified with in-memory test doubles (fake auth service / fake cloud) |
| **Not tested** | Not verified by any means |

## 2. Environment safeguards (implemented)

`v2/src/services/firebase/config.ts` (12 unit tests):

- `VITE_FIREBASE_ENV` (`emulator | development | production`) is **required**.
- The legacy production project (`deutsch-wortschatz-c7a11`) is refused in every environment.
- Emulator mode requires `VITE_FIREBASE_USE_EMULATORS=true` **and** a `demo-` project id; `demo-`
  projects cannot reach real Google services. Emulator flags and `demo-` ids are refused outside
  emulator mode.
- Development requires a project id marked `-dev`. **Production is refused** until approved
  (`PRODUCTION_APPROVED = false`).
- Mixed configurations are detected (auth domain, bucket and sender id vs. project/app id), as
  are malformed real keys.
- Values that look like secrets are refused, including refresh tokens. Diagnostics name variables,
  **never values**.
- The header badge always shows the active backend (`emulator` / `dev: <project-id>`).
- Rules deployment: `npm run rules:deploy:dev -- --project <id>` refuses the legacy project,
  `demo-` and non-`-dev` ids, runs the emulator rules tests first, and deploys only with an
  explicit `--confirm`. There is no default `.firebaserc` project.

## 3. "First sign-in hangs" — root cause and fix

Phase 3 described this as an emulator cold start and hid it behind a test warm-up. **That
explanation was wrong.** The investigation:

| Experiment | Result |
|---|---|
| Wait 45 s after emulator start before the first sign-in | Still hung → not time-based |
| Inspect the popup at the moment of the hang | Still open with the form filled → nothing was "finished" |
| Popup readiness (scripts, form handler) | Ready; no error in the popup |
| Auth iframe in the app page before the click | **Absent** on desktop |
| `getRedirectResult()` pre-initialisation | No effect (iframe still absent) |
| Mobile project alone on a fresh emulator | **All passed**, including the first sign-in |
| Firebase SDK source | Initialises the popup resolver eagerly only on mobile/Safari/iOS (`_shouldInitProactively`) |

**Cause:** the popup hands its result to an auth iframe in the app page. On desktop that iframe
is created only when the popup opens, so a fast sign-in on a cold connection can finish first, and
the result is dropped. A real user on a slow network (e.g. via VPN) could hit the same window.

**Fix (`eagerPopupResolver`):** desktop now initialises like mobile. The member is internal, so a
unit test against the **browser** SDK build fails if an upgrade removes it. After the fix, the
emulator browser suite passed **3 of 3 runs with no warm-up and no harness waits** (before:
1–2 desktop failures per run). Whether this ever occurs with real Google sign-in: **Not tested**.

## 4. Cost findings (fixed)

| Finding | Before | After |
|---|---|---|
| Full read of the progress collection on every app start | Up to 999 reads per device and session (Spark: 50 K reads/day in total) | **Incremental** listener (`updatedAt > newest local server time`); a full read only without a local copy or every 7 days. Emulator, real SDK: restart = **1 read instead of 6** |
| Profile document rewritten on every session start | 1 write per session | Written only when name or photo changes |
| `clientUpdatedAt` unbounded | Any integer | Rules: `0 ≤ x < 1e13` |

## 5. Cross-browser results (Emulator)

`E2E_BROWSERS=all npm run test:e2e:emulator`, 7 scenarios × 6 projects:

| Project | Engine | Result |
|---|---|---|
| desktop-chromium | Chromium | ✅ |
| mobile-chromium | Chromium, Pixel 7 **emulation** | ✅ |
| desktop-edge | **installed Microsoft Edge** | ✅ |
| desktop-firefox | Playwright Firefox | ✅ |
| desktop-webkit | Playwright WebKit (approximates Safari; **not Safari**) | ✅ after the two fixes below |
| mobile-webkit-iphone | WebKit, iPhone 13 **emulation** | ✅ after the two fixes below |

WebKit findings, both investigated with measurements:

1. **"… due to access control checks"** page errors on Firestore's `Listen`/`Write` channels. They
   occur **only at the moment of a reload or navigation** (none during use or 10 s idle), and state
   is correct afterwards. This is WebKit reporting aborted cross-origin streaming requests. The test
   tolerates exactly that message. Real Safari: **Not tested**.
2. A test bug: the two-device test never closed its extra browser contexts. Their live connections
   occupied the emulator's HTTP/1.1 per-host connection slots, and the next WebKit test could not
   connect. Fixed by closing the contexts. Real Firestore uses HTTP/2 multiplexing.

Physical devices (Android, iPhone): **Not tested** (none available). Emulation is not a device test.

## 6. Security audit

Rules (`v2/firestore.rules`), re-reviewed:

| Check | Status |
|---|---|
| Deny by default (no rule for other paths, including `syncCodes`) | ✅ tested |
| uid isolation: read/write only `users/{request.auth.uid}/**` | ✅ tested (other user, unauthenticated) |
| Schema validation: exact field sets, types, word-id format, path = `wordId` | ✅ tested |
| Unauthorised fields (email, extra keys) rejected | ✅ tested |
| `updatedAt == request.time` (server timestamps) | ✅ tested |
| No client deletes (progress, user doc, migration records) | ✅ tested |
| Migration records create-only, id = SHA-256 = `inputHash` | ✅ tested |
| No listing of `users` | ✅ tested |

Emulator: 23 rules tests and 5 real-SDK sync tests pass. A mutation run against permissive rules
fails 22 of the 23 rules tests; the one that passes is "owner can write own data", which is
expected.

Known risks and recommendations (nothing enabled automatically):

- **Abuse and cost:** rules cannot rate-limit. A signed-in user can write many documents into
  their own collection (≤ 1 per word id format, cost only, no data exposure).
  → Enable **App Check** (reCAPTCHA Enterprise or v3; no cost within provider quotas) in
  *monitoring* mode first, then enforce for Firestore.
  → Restrict the browser **API key** by HTTP referrer (Google Cloud Console → Credentials).
- **Usage monitoring:** Firebase Console → *Usage and billing* (Firestore reads/writes per day).
  **Spark has no billing account, so quotas stop service instead of charging.** Budget alerts only
  exist with a billing account (Blaze); if Blaze is ever enabled, set a budget with email alerts
  first.
- **Read/write volume:** incremental sync (§4); one listener per signed-in tab; writes coalesce per
  word.
- **Legacy project:** its rules are unreviewed (possibly open). Separate issue, not touched.
- **Shared devices:** after sign-out, the account's IndexedDB partition stays on the device
  (`SYNC_DESIGN.md` §7). Open decision.

## 7. Live validation protocol (to run after `FIREBASE_SETUP.md`)

Prerequisites: a dev project configured; rules deployed to **that** project by the owner; and
`v2/.env.local` with `VITE_FIREBASE_ENV=development`. Then:

```bash
cd v2 && npm ci && npm run dev    # http://localhost:5173 — header badge must read "dev: <project-id>"
```

Use **dedicated test Google accounts** (e.g. `dv-test-a@…`, `dv-test-b@…`), not personal accounts
with real progress. Record the result of every step (pass/fail, browser, device, date).

### 7.1 Authentication

| # | Step | Expected |
|---|---|---|
| A1 | First «ورود با گوگل» with test account A (desktop Chrome) | Google popup → account chooser → popup closes → avatar, name, email in the account menu |
| A2 | Reload | Still signed in without a popup (session restore) |
| A3 | Sign out, sign in again (returning user) | Same uid; same progress |
| A4 | Open the popup and close it manually | «ورود لغو شد.» and the button is usable again |
| A5 | Block popups for `localhost` in the browser settings, then sign in | Persian hint that the popup was blocked |
| A6 | Sign in with account B («Use another account») | B's name; **no** progress of A visible |
| A7 | Account without a photo / with a photo | Initial letter / avatar image |
| A8 | Firefox, Edge (desktop); Android Chrome and iPhone Safari via a staging URL (needs hosting approval) | Same as A1–A3 |
| A9 | Note any case where the popup closes but the app stays at «در حال ورود…» | Should not happen after the §3 fix; «لغو» must recover |

### 7.2 Firestore (single device)

| # | Step | Expected |
|---|---|---|
| F1 | After A1: Firestore Console → `users/<uid>` | `profile.displayName/photoURL`, `schemaVersion: 1`; **no email** |
| F2 | Tick 3 words | 3 docs `users/<uid>/progress/dv_…` with `learned: true`, server `updatedAt`, `origin: "toggle"`; status «ذخیره شد» |
| F3 | Untick 1 | The same doc has `learned: false` (not deleted) |
| F4 | Reload | The same 2 ticked |
| F5 | Sign out | No checkboxes; header without progress |

### 7.3 Scenario A — same account, two devices

Browser 1 (or device A): tick 10 words. Browser 2 (another browser or profile, same account):
the 10 appear without a reload. Untick 2 in browser 2 → browser 1 updates within seconds.

### 7.4 Scenario B — offline

DevTools → *Network* → *Offline*. Tick or untick 5 words → «آفلاین — 5 تغییر در انتظار», orange
markers. Reload while offline → the changes are still shown. Go online → «ذخیره شد»; the Firestore
Console shows the 5 changes.

### 7.5 Scenario C — account separation

Account A ticks words → sign out → account B: nothing ticked, header `0/999`. **Optional (developer
tools, test accounts only):** while signed in as B, try reading `users/<uid-A>/progress` from the
browser console → `permission-denied`. The emulator tests already prove this for the rules.

### 7.6 Scenario D — conflicts

Two browsers, same account, same word. (a) Both online: toggle in 1, then in 2 → both converge to
2's value. (b) Browser 2 offline: untick the word; browser 1 (online) ticks it; bring 2 online →
both end with 2's value (**server arrival order**, documented limitation, `SYNC_DESIGN.md` §4).
Browser 2 must **not** flip back while its change is pending.

### 7.7 Test data: identification and clean-up

- Test data lives only under `users/<test-uid>/…` in the **dev** project. The uids are shown in
  Authentication → *Users*.
- Every progress doc carries `deviceId` and `origin`, so migration-imported docs have
  `origin: "migration"`.
- Clean-up is a **manual owner action** in the Firebase Console: delete `users/<test-uid>`
  (including sub-collections) and the test users. Clients cannot delete; no script deletes data
  automatically.

## 8. Current status

| Item | Status |
|---|---|
| Code safeguards, fixes, documentation | ✅ done |
| Emulator validation (rules, sync, 6 browser projects) | ✅ |
| Firebase dev project | ⏸ waiting for owner |
| Rules deployed to the dev project | ⏸ waiting for approval |
| Real Google sign-in (§7.1) | ❌ Not tested |
| Real Firestore and scenarios A–D (§7.2–7.6) | ❌ Not tested |
| Physical Android / iPhone | ❌ Not tested |
| Production deployment | ❌ Not approved (out of scope) |
