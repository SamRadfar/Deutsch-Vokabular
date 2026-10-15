# Firebase setup for Deutsch Vokabular 2.0

Audience: the product owner, who has access to the Firebase/Google Cloud console.
Everything here is a **manual action**. The code never creates projects, enables providers,
changes rules or deploys anything by itself.

> **Public vs. secret.** The Firebase *web* configuration (API key, auth domain, project id,
> app id, …) is **public by design**. It is embedded in every browser bundle and only identifies
> the project. Protection comes from Firebase Authentication plus Firestore Security Rules.
> **Secrets** are service-account JSON files, private keys, OAuth *client secrets* and the
> Anthropic API key. They must never be put into the repository, a `.env` file used by Vite,
> documentation, chat messages or the browser.

## 0. Choose the Firebase project (decision needed)

| Option | Pros | Cons |
|---|---|---|
| **A. New project** for v2 (recommended), e.g. `deutsch-vokabular-v2` | Clean rules; no risk of breaking the legacy `syncCodes` sync; separate quotas and billing | A second project to maintain |
| B. Reuse the legacy project (`firebaseConfig` in `index.html`) | One project | The rules **must be merged** with the unknown legacy rules (§7). A mistake breaks the legacy app's sync |

Migration does **not** need the legacy project, because v2 imports from browser storage or a
JSON backup and never reads `syncCodes`.

## 1. Register the web app

1. Firebase Console → *Project settings* → *General* → *Your apps* → **Add app → Web**.
2. Give it a nickname (e.g. `v2-web`). Firebase Hosting is **not** needed now.
3. Copy the values from the displayed `firebaseConfig` into `v2/.env.local`, which is git-ignored.
   Use `v2/.env.example` as the template:

| Variable | From `firebaseConfig` | Public? |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` | yes |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` (e.g. `<project>.firebaseapp.com`) | yes |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` | yes |
| `VITE_FIREBASE_APP_ID` | `appId` | yes |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional) | `messagingSenderId` | yes |
| `VITE_FIREBASE_STORAGE_BUCKET` (optional) | `storageBucket` | yes |

Without these values the app runs in browse-only mode. «ورود با گوگل» then explains that sign-in
is not configured, and no progress checkbox is shown. Values that look like private keys or
client secrets are rejected at start-up.

**Recommended hardening:** in Google Cloud Console → *APIs & Services* → *Credentials*, restrict
the browser API key to HTTP referrers `http://localhost:*/*` and
`https://samradfar.github.io/*`.

## 2. Enable Google sign-in

1. Firebase Console → *Authentication* → *Get started* (first time) → *Sign-in method*.
2. **Google** → *Enable*. Set a *project support email* → *Save*.
3. Google Cloud Console → *Google Auth Platform / OAuth consent screen*: app name
   "Deutsch Vokabular" and a support email. The app only uses the default scopes
   (`openid`, `email`, `profile`), which need no Google verification. A logo or brand
   display may require brand verification.

## 3. Authorized domains

Firebase Console → *Authentication* → *Settings* → **Authorized domains**:

| Domain | When |
|---|---|
| `localhost` | Present by default; needed for `npm run dev` / `npm run preview` |
| `127.0.0.1` | Only if you open the dev server via the IP address |
| `samradfar.github.io` | Before any production use on GitHub Pages (Phase 4) |
| Any custom domain | If one is introduced later |

Signing in from a domain that is missing here fails with a clear Persian message
(`auth/unauthorized-domain`).

## 4. Create Cloud Firestore

1. Firebase Console → *Firestore Database* → **Create database**.
2. Choose a **location**. It cannot be changed later. Suggested: `europe-west3` (Frankfurt),
   near the users in Germany.
3. Start in **production mode** (deny all). Nothing works for clients until the reviewed rules
   are deployed (§7). That is the safe default.

Data layout written by v2 (details: `docs/SYNC_DESIGN.md`):

```
users/{uid}                     { schemaVersion, profile: { displayName, photoURL }, updatedAt }
users/{uid}/progress/{wordId}   { schemaVersion, wordId, learned, updatedAt, clientUpdatedAt, opId, deviceId, origin }
users/{uid}/migrations/{sha256} { schemaVersion, inputHash, source, legacyContentCommit, contentVersion, counts, status, completedAt }
```

No email address is stored in Firestore. Users are identified by the Firebase `uid`.

## 5. Local development with a real project (real Google account)

```bash
cd v2
cp .env.example .env.local      # then fill in the public values from §1
npm ci
npm run dev                     # http://localhost:5173/
```

Click «ورود با گوگل»; a real Google popup opens. This is the **only** way to verify real Google
OAuth. Automated tests use the emulator (§6) and do not prove it. The rules (§7) must be deployed
to that project, otherwise every progress read/write is denied (`permission-denied`, shown as a
sync error).

## 6. Firebase Emulator Suite (no real accounts, used by the tests)

Requirements: Node ≥ 22.12, **Java 21+** on `PATH` (e.g. Eclipse Temurin 21; on the
development machine a portable JRE lives in `C:\Users\safar\.local-tools\jdk-21…`).

```bash
cd v2
npm run test:emulator          # Firestore rules tests + real-SDK sync tests
npm run test:e2e:emulator      # browser tests against an emulator-configured build
```

Both use the demo project `demo-deutsch-vokabular`. `demo-` projects can never reach real
Google services. To click through the app manually against the emulators:

```bash
npx firebase emulators:start --only auth,firestore --project demo-deutsch-vokabular
# second terminal — run the app against the emulators instead of a real project:
VITE_FIREBASE_API_KEY=demo-api-key VITE_FIREBASE_AUTH_DOMAIN=demo-deutsch-vokabular.firebaseapp.com \
VITE_FIREBASE_PROJECT_ID=demo-deutsch-vokabular VITE_FIREBASE_APP_ID=demo-app \
VITE_FIREBASE_USE_EMULATORS=true npm run dev
```

The emulator shows its own fake Google account picker.

> Correction (validation phase): the Phase 3 note that the first emulator sign-in "completes in
> the popup but does not report back" was wrong. The popup stayed open because the app's auth
> iframe was not ready yet on **desktop** (Firebase initialises it lazily there). This is fixed in
> the app (`eagerPopupResolver`, docs/FIREBASE_VALIDATION.md §3); the test warm-up was removed.

## 7. Firestore Security Rules: review, merge, deploy (product owner)

The rules are in `v2/firestore.rules` and tested by `npm run test:emulator`
(isolation, schema validation, no deletes, create-only migration records).

**They are not deployed.** Deploying a rules file **replaces all rules of the project.**

* **Option A (new project):** review the file, then deploy:
  ```bash
  cd v2
  npx firebase login
  npx firebase deploy --only firestore:rules --project <your-project-id>
  ```
* **Option B (legacy project):** first export the currently deployed rules (Firebase Console →
  Firestore → *Rules*) and keep a copy. Then add the existing `syncCodes` block **unchanged**
  next to the `users/{uid}` block in `v2/firestore.rules`, extend
  `tests/emulator/firestore.rules.test.ts` so it asserts the legacy behaviour still works, run
  the tests, and only then deploy. The current legacy rules have **not been reviewed**. If they
  are open (`allow read, write: if true`), that is a separate security issue for the legacy app.

The test `this rules file alone denies syncCodes` exists to make this trap visible.

## 8. Sign-in method: popup vs. redirect (findings)

| Aspect | Popup (implemented) | Redirect (not implemented) |
|---|---|---|
| Desktop browsers | Works | Works only if the auth helper shares the app's domain |
| Browsers that block third-party storage (Safari 16.1+, Firefox, Chrome with storage partitioning) | Works | **Breaks** unless `authDomain` serves `/__/auth/*` from the same site as the app (Firebase Hosting, a reverse proxy, or self-hosted helper files) |
| GitHub Pages (`samradfar.github.io`) | Works | Not possible: Pages cannot proxy `/__/auth/*` to `<project>.firebaseapp.com` |
| In-app browsers (Instagram, Telegram, …) | Often blocked → Persian hint to open the page in Chrome/Safari | Unreliable |
| Popup blocker | The popup is opened synchronously inside the click; a blocked popup shows a Persian hint | — |

Conclusion: popup only. A redirect fallback becomes possible once the app is served from
Firebase Hosting (or a domain that can proxy `/__/auth/*`). That is a Phase 4 hosting decision.

## 9. Production prerequisites (before Phase 4 deployment)

- [ ] Project chosen (§0), web app registered, `.env` values available to the build
      (e.g. GitHub Actions variables; they are public, but keep them out of the repository
      for clarity).
- [ ] Google provider enabled, consent screen configured (§2).
- [ ] `samradfar.github.io` (or the final domain) in *Authorized domains* (§3).
- [ ] Firestore created in the chosen region (§4).
- [ ] Rules reviewed, merged if needed, emulator tests green, **deployed by the owner** (§7).
- [ ] Real Google sign-in verified on desktop Chrome, Safari (macOS and iOS) and Android Chrome (§5).
- [ ] API key restricted by HTTP referrer (§1).
- [ ] Budget alert in Google Cloud Billing (the free Spark plan has no cost; Blaze does).
- [ ] Privacy notice: what is stored (uid, display name, photo URL, learned flags).
- [ ] Optional hardening: Firebase App Check (reCAPTCHA Enterprise) to limit abuse of the project.
