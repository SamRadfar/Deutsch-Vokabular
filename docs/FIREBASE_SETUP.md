# Firebase setup for Deutsch Vokabular 2.0 (development project)

Audience: the product owner, who has access to the Firebase/Google Cloud console.
Everything here is a **manual action**. The code never creates projects, enables providers,
changes rules or deploys anything by itself. Exact console labels may differ slightly from the
wording here.

> **Public vs. secret.** The Firebase *web app* configuration (API key, auth domain, project id,
> app id, sender id, bucket) is **public by design**. It is part of every browser bundle and only
> identifies the project. Protection comes from Firebase Authentication plus Firestore Security
> Rules. **Never** share or store service-account JSON files, private keys, OAuth *client secrets*,
> refresh tokens, Google passwords or the Anthropic API key — not in the repository, not in
> `.env.local`, not in documentation, not in chat. The only thing to hand over is the public web
> app config from step 2.

## Target architecture

| | Legacy app | Deutsch Vokabular 2.0 |
|---|---|---|
| Firebase project | existing (`deutsch-wortschatz-c7a11`), **untouched** | **separate**: first `deutsch-vokabular-v2-dev`, later a production project |
| Website | GitHub Pages (unchanged) | local dev now; hosting is decided later (`HOSTING_EVALUATION.md`) |
| Data | `syncCodes/{code}` (untouched) | `users/{uid}/…` with per-user rules |

A **separate development project** is the safest option. It cannot affect the legacy app's data
or rules, it has its own quotas and test users, and it can be deleted entirely after testing. The
app refuses the legacy project id in every mode (`FIREBASE_VALIDATION.md` §2).

## 1. Create the development project (Spark, no billing)

1. <https://console.firebase.google.com> → **Create a project**.
2. Name: `deutsch-vokabular-v2-dev`. The project **id** must contain `-dev`; Firebase may append
   a suffix such as `-1a2b3`, which is fine. Note the final project id.
3. Google Analytics: **disable** (not needed).
4. Plan: stay on **Spark** (no payment method needed). **Do not** upgrade to Blaze; that would
   need a billing account and is not required.

## 2. Register the web app and copy the public config

1. Project overview → **Add app** → **Web** (`</>`).
2. Nickname: `v2-web-dev`. Do **not** tick "Also set up Firebase Hosting".
3. Copy the shown `firebaseConfig` values into `v2/.env.local` (git-ignored; template:
   `v2/.env.example`):

```dotenv
VITE_FIREBASE_ENV=development
VITE_FIREBASE_API_KEY=<apiKey>
VITE_FIREBASE_AUTH_DOMAIN=<projectId>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<projectId>
VITE_FIREBASE_APP_ID=<appId>
VITE_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId>   # optional
VITE_FIREBASE_STORAGE_BUCKET=<storageBucket>            # optional
VITE_FIREBASE_USE_EMULATORS=false
```

The app validates the file at start-up and refuses inconsistent values with a named reason
(e.g. auth domain from another project, legacy project, missing `-dev`).
`git status` must **not** list `.env.local`.

## 3. Enable Google sign-in

1. **Build → Authentication → Get started**.
2. **Sign-in method → Add new provider → Google → Enable**.
3. **Project support email:** choose your own address. It is shown to users on Google's consent
   screen. The public-facing name can be set in the next step.
4. **Save.** (Web SDK configuration needs no client id or secret here. Do not copy secrets anywhere.)
5. Optional: Google Cloud Console → *Google Auth Platform / OAuth consent screen* → app name
   "Deutsch Vokabular (dev)". The app only uses the default scopes (`openid`, `email`, `profile`),
   which need no Google verification.

## 4. Authorized domains

**Authentication → Settings → Authorized domains:**

| Domain | Needed for |
|---|---|
| `localhost` | Already listed by default; required for `npm run dev` (http://localhost:5173) and `npm run preview` (http://localhost:4173). Add it if missing |
| `127.0.0.1` | Only if you open the dev server via the IP address |
| `<projectId>.firebaseapp.com` | Listed by default (the auth handler domain) |
| A staging/production domain | Later, when hosting is approved (`HOSTING_EVALUATION.md`) |

## 5. Create Cloud Firestore

1. **Build → Firestore Database → Create database**.
2. Edition and mode: the standard/native Firestore database.
3. **Location:** `europe-west3` (Frankfurt), a single region close to the users. It **cannot be
   changed later.** (`eur3` multi-region offers higher availability at higher cost, which is not
   needed for development.)
4. Start in **production mode** (deny all). The app shows sync errors until the reviewed rules are
   deployed (step 7). That is intended.

## 6. Check the configuration locally (before rules)

```bash
cd v2
npm ci
npm run dev        # http://localhost:5173
```

- The header badge must read **`v2 preview · dev: <projectId>`**.
- «ورود با گوگل» → real Google popup → signed in. Progress shows a sync error
  (`permission-denied`) until step 7. That proves the deny-all default.

## 7. Security Rules for the dev project (approval required)

The rules are in `v2/firestore.rules` and tested on the emulator (`npm run test:emulator`).
They are written for **this separate project**, so no merging with legacy rules is needed.

1. Review `v2/firestore.rules` (owner-only access, schema validation, no deletes, create-only
   migration records).
2. Install the CLI login once: `npx firebase login`. This is your own interactive Google login; no
   token is shared.
3. Dry run (runs the emulator rules tests, deploys nothing):
   `npm run rules:deploy:dev -- --project <projectId>`
4. Deploy (owner, after approval):
   `npm run rules:deploy:dev -- --project <projectId> --confirm`
5. Firebase Console → Firestore → *Rules* shows the new rules and a publish date.

The script refuses the legacy project, `demo-` ids and ids without `-dev`. **Never** deploy these
rules to the legacy project: that would replace its rules and break legacy sync.

## 8. Live validation

Follow `FIREBASE_VALIDATION.md` §7 (authentication, Firestore, scenarios A–D, clean-up).
Use dedicated test Google accounts.

## 9. Billing, quotas and monitoring

Spark (no-cost, no payment method; checked on firebase.google.com/pricing, 2026-10-15):

| Service | No-cost quota |
|---|---|
| Firestore | 1 GiB stored; **50 K reads/day**, 20 K writes/day, 20 K deletes/day; 10 GiB/month egress |
| Authentication | 50 K monthly active users |
| Hosting (if chosen later) | 10 GB storage, 360 MB/day transfer |
| App Check | no cost, subject to provider limits |

On Spark, reaching a quota **stops** the service for the rest of the day instead of charging.
Watch **Firestore → Usage**. Budget alerts require a billing account (Blaze); before any future
Blaze upgrade, create a budget with email alerts first. The app reduces reads with incremental
sync (`FIREBASE_VALIDATION.md` §4).

Recommended hardening (owner, optional for dev):
- Google Cloud Console → *APIs & Services → Credentials*: restrict the browser API key to the
  referrers `http://localhost:*/*` (dev) and later the real domain.
- **App Check** (reCAPTCHA): start in monitoring mode, enforce later.

## 10. Emulator (no real accounts; used by the automated tests)

Requires Java 21+ (development machine: portable JRE in `C:\Users\safar\.local-tools\`).

```bash
cd v2
npm run test:emulator                       # rules + real-SDK sync tests
npm run test:e2e:emulator                   # browser tests (Chromium desktop + mobile)
E2E_BROWSERS=all npm run test:e2e:emulator  # + Edge, Firefox, WebKit desktop, iPhone emulation
```

Emulator configs use `VITE_FIREBASE_ENV=emulator` with the `demo-deutsch-vokabular` project.

> Correction: Phase 3 claimed that the first emulator sign-in "completes in the popup but does not
> report back". The real cause was an app-side race on desktop browsers, now fixed
> (`FIREBASE_VALIDATION.md` §3).

## 11. Sign-in method: popup vs. redirect

Popup is implemented. Redirect sign-in needs one of Firebase's documented workarounds in Chrome
115+, Firefox 109+ and Safari 16.1+. The simplest is hosting on Firebase Hosting with the app
domain as `authDomain`; see `HOSTING_EVALUATION.md`.
