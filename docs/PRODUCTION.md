# Production — Deutsch Vokabular V2

| | |
|---|---|
| Public website | **https://deutsch-vokabular.web.app** (Firebase Hosting, default site) |
| Firebase project | `deutsch-vokabular` ("Deutsch Vokabular Production"), **Spark plan, no billing account** |
| Firestore | `(default)`, Standard edition (native mode), `europe-west3` (Frankfurt), delete protection on |
| Web app | "Deutsch Vokabular Web" (public config in `v2/deploy/production.env`) |
| Source code | GitHub `SamRadfar/Deutsch-Vokabular`, branch `release/v2.0.0`, tag `v2.0.0` |
| Separate projects | `deutsch-vokabular-v2-dev` (development) · `deutsch-wortschatz-c7a11` (legacy app, **never touched**) |

GitHub stores the source code only. GitHub Pages keeps serving the legacy app from `main`, and is neither the V2 host nor changed by this release.

## 1. How production is built

- `npm run build:production` runs `v2/scripts/build-production.mjs`. It works as follows.
  - **Hermetic.** It reads only `deploy/production.env`, which holds public web-app identifiers. It never reads `.env.local`.
  - **Validated.** The configuration must name the production project. Emulators, the dev and legacy projects, secrets, and localhost or mock AI endpoints are all refused. The config loader in the app enforces the same rule through `PRODUCTION_PROJECT_IDS`.
  - **Release stamp.** It sets base `/`, the version from `package.json` and the git build id, and writes them to the `version.json` it publishes.
  - **Clean output.** Source maps are removed. A service worker with a versioned precache is generated. Every output file is scanned for secrets and non-production endpoints.
- `deploy/production.env` deliberately contains `VITE_AI_ENDPOINT=` (empty). The AI panel then says "not active", and manual entry keeps working.

## 2. Hosting configuration (`v2/firebase.json`)

| Path | Behaviour |
|---|---|
| `/`, extension-less paths | `index.html` with `no-cache` and a CSP. Hash routes (`#/mine`, …) work after a reload, and deep links fall back to the app |
| `/assets/*` | Content-hashed, `max-age=31536000, immutable`. A missing asset is a real 404, not HTML |
| `/sw.js`, `/version.json` | `no-cache` |
| `/manifest.webmanifest`, icons | Short caching |
| All | `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. The shell also gets `X-Frame-Options: DENY` and a CSP |

The CSP allows only `self` plus Google sign-in (`apis.google.com`, `accounts.google.com`, `deutsch-vokabular.firebaseapp.com`) and Google APIs (`*.googleapis.com`). **When an AI worker is added, put its origin into `connect-src`.**

## 3. PWA

- `manifest.webmanifest` (fa, RTL, standalone) with 192/512 icons and a maskable icon. `scripts/generate-icons.mjs` produces them from the brand image.
- The service worker loads the shell network-first, so a new release is used on the next load and a user never stays on an old version. Hashed files are served cache-first. Caches of older releases are deleted, and cross-origin requests (Firebase, Google) are never intercepted. When a new release is waiting, the page offers «به‌روزرسانی».
- Offline: after the first visit, the vocabulary, search and practice work. Changes are queued on the device, and cloud sync, sign-in and German speech (browser voices) may need the network.

## 4. Security

- **Firestore rules.** Production uses `v2/firestore.rules`, the same file as dev, emulator-tested with 48 tests including rules and cross-account isolation. It was deployed on 2026-10-18 through `npm run deploy:production -- --project deutsch-vokabular --confirm deutsch-vokabular --only rules`:
  - Ruleset `cfd2d556-49d8-40ab-b655-3c18aaa29046` is identical to the file.
  - Live checks without sign-in: reads, writes and listings under `users/…`, plus any other collection, return **403**.
- Data: `users/{uid}/…` is owner-only, schema-validated, uses server timestamps, has no client deletes, keeps personal-word tombstones final and makes migrations create-only.
- No secrets are in the repository or the bundle: the build scan runs on every release, and the tracked files were checked. The Firebase web config is public by design; security comes from Auth and the rules.
- The dev and production environments are fully separate. No user data was copied, and the legacy project was not accessed.

## 5. Deploying an update

```
cd v2
git checkout release/v2.0.0           # or a newer release branch
# bump "version" in package.json, commit, tag (e.g. v2.0.1)
npm test && npm run test:emulator && npm run test:e2e
npm run deploy:production -- --project deutsch-vokabular                                   # dry run
npm run deploy:production -- --project deutsch-vokabular --confirm deutsch-vokabular --only hosting
node scripts/smoke-production.mjs https://deutsch-vokabular.web.app
```

- A Hosting deploy refuses uncommitted changes, because every release must be reproducible from a commit.
- Rules changes use `--only rules`; the emulator tests run first.
- Credentials come from the owner's interactive `npx firebase login`. No CI secret or service-account key exists.

## 6. Rollback

- **Hosting.** In Firebase console → Hosting → *Release history*, pick the previous release and choose "Rollback". This is instant and needs no rebuild. Alternatively, check out the previous tag and deploy it with the command above.
- **Rules.** In Firebase console → Firestore → Rules → history, restore the previous ruleset. Alternatively, check out the previous tag and run `--only rules`.
- **Service worker.** Clients pick up the rolled-back shell on the next load, because the shell is fetched network-first.
- **Legacy app.** It is untouched on GitHub Pages and `deutsch-wortschatz-c7a11`.

## 7. Not active / owner actions

- **AI suggestions** need the owner's approval before they can be switched on:
  1. A Cloudflare account and deployment of `v2/ai-worker` (with `ALLOWED_ORIGINS=https://deutsch-vokabular.web.app` and `FIREBASE_PROJECT_ID=deutsch-vokabular`).
  2. A paid Anthropic API key, set as a Worker secret.
  3. `VITE_AI_ENDPOINT=https://…` in `deploy/production.env`, plus the CSP `connect-src`.

  See `docs/AI_DESIGN.md` §6.
