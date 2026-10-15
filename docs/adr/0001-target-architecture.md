# ADR 0001: Target architecture for Deutsch Vokabular 2.0

- Status: **Proposed.** Awaiting the product owner's decision on the open points in §5.
- Date: 2026-10-15
- Scope: the direction for Phase 2+. Phase 1 only adds documentation and baseline tests.

## 1. Context

- Today the app is one ~4,500-line `index.html` (CSS, markup, 999 vocabulary rows,
  logic), served by GitHub Pages from `main`. There is no build, no tests and no
  user identity.
- Persistence is `localStorage`. Cross-device sync uses unauthenticated Firestore
  documents addressed by a 6-digit code. AI calls go from the browser to Anthropic
  with a key that the user stores in `localStorage`.
- The UI is Persian (RTL) and mobile-first, and the learning flows are offline-capable.
- **Network constraint:** the app itself tells users that Google/Firebase domains
  may be blocked and suggests a VPN (`syncDiagnoseFailure`). The core learning must
  therefore keep working when Google services are unreachable.
- Goals: multiple users with Google sign-in, user-specific cloud data, secure AI,
  maintainable code, and room for more vocabulary and for SRS later.

## 2. Evaluation of the proposed stack

| Proposal | Verdict | Reasoning / conditions |
|---|---|---|
| React | **Accept** | Stateful multi-screen UI (tables, overlays, sessions, auth state) benefits from components. It is widely known, which matters for AI-assisted development. Cost: bundle size. Mitigate with code-splitting per mode. Preact or Svelte were considered and rejected because of a smaller ecosystem and no decisive gain at this scale. |
| TypeScript | **Accept** | The data contracts (`DATA_CONTRACTS.md`) become types. It catches the class of bugs found in the legacy app (undefined handlers, wrong ids). |
| Vite | **Accept** | It is the simplest maintained build for a static SPA. PWA support via `vite-plugin-pwa` (Workbox) replaces the hand-written `sw.js`. |
| Firebase Authentication (Google) | **Accept, with a local mode** | Firebase is already in use, and Google sign-in is native there. **Sign-in must be optional:** a fully functional local (anonymous) mode is required because Google may be unreachable. |
| Cloud Firestore | **Accept** | Firestore is already in use. Per-user documents with Security Rules (`request.auth.uid == uid`) replace code-addressed blobs. Progress is stored **per word** to allow per-word merging and SRS fields later. |
| Secure server-side AI API | **Accept, hosting open (§5)** | The Anthropic key moves to the server. The endpoint verifies the Firebase ID token, rate-limits per user, validates input and validates the model output against a schema. The browser never sees the key. |
| Vitest + React Testing Library | **Accept** | Unit and component tests. The Phase 1 baseline suite (Node test runner, ADR 0002) stays and can be ported. |
| Playwright | **Accept** | Browser-level flows on mobile and desktop viewports, including a parity smoke test against the legacy app. |
| GitHub Actions | **Accept** | CI runs typecheck, lint, test and build on every push and PR. Deployment is a separate, manually approved job. |

## 3. Decision (proposed)

1. **Local-first data layer.** An own IndexedDB store is the source of truth on each
   device. Learning, review and pronunciation work offline and signed-out. Cloud
   sync is a layer on top: when signed in, changes replicate to Firestore and remote
   changes merge per word (last-writer-wins on `updatedAt`). Firestore's own offline
   cache alone is **not** sufficient, because the SDK may not load at all on blocked
   networks and sign-in is optional.
2. **Vocabulary content stays static and versioned.** It is stored as JSON files in
   the repository (one per category), bundled and pre-cached, with **stable ids
   minted once** from the Phase 1 baseline (see `MIGRATION_SPEC.md` §2). It is not
   stored in Firestore: content is reviewed through pull requests, cached for free,
   identical for all users, and checked by tests. User-added words live in the user
   data.
3. **Cloud schema (per user):** `users/{uid}` (profile, schemaVersion),
   `users/{uid}/progress/{wordId}`, `users/{uid}/customWords/{id}`,
   `users/{uid}/settings/app`. Security Rules are versioned in the repository and
   tested with the Firebase emulator before any deployment.
4. **Legacy compatibility.** The migration follows `MIGRATION_SPEC.md`. Legacy
   `localStorage` keys and `syncCodes/*` are read-only for v2.
5. **Rendering safety.** No `innerHTML` with data. React escapes by default.
   `dangerouslySetInnerHTML` is forbidden by a lint rule.
6. **Repository layout (planned):** `src/` (app), `src/content/` (vocabulary JSON),
   `functions/` or `server/` (AI endpoint), `firestore.rules`, `tests/` (baseline,
   migration, unit), `e2e/` (Playwright). The legacy `index.html` stays deployable
   until the v2 release is approved.

## 4. Consequences

- (+) There is one maintainable codebase with types, tests and CI.
- (+) Multiple users with private data. Secrets leave the client.
- (+) Offline and blocked-network use is preserved by design.
- (−) A local-first sync engine is more code than "Firestore only". It is kept small
  through per-word records and LWW rather than a general CRDT.
- (−) A build step means the deployment changes from "upload a file" to CI. The
  product owner must approve the switch.
- (−) The vocabulary moves out of `index.html`. The Phase 1 baseline guarantees that
  nothing is lost or altered.

## 5. Open decisions for the product owner

| Topic | Options | Trade-off |
|---|---|---|
| AI endpoint hosting | (a) Firebase Cloud Functions (2nd gen); (b) Cloudflare Workers; (c) another serverless host | (a) is the most cohesive with Firebase Auth and emulators, but **requires the Blaze (pay-as-you-go) billing plan**. (b) has a free tier and verifies Firebase ID tokens via JWKS, but adds a second platform. Reachability from the users' networks must be checked for either option. |
| Web hosting | (a) keep GitHub Pages (deployed via Actions); (b) Firebase Hosting | (a) involves no change and is free, but SPA deep links need a 404 fallback or hash routing. (b) adds rewrites and preview channels and pairs naturally with (a) Functions. |
| Legacy app during the transition | keep `/legacy/` on the same origin for N weeks, or no legacy copy | Keeping it gives a safe fallback at the cost of a small maintenance burden. |
| Legacy `syncCodes` retirement | keep read-only indefinitely, or delete after a date | Deleting requires a privileged admin operation and user notice. |
| Content fixes (`DATA_QUALITY.md`) | fix before or after the migration | Fixing after the ids are minted is safer, because ids survive text edits. |

## 6. Alternatives considered

- **Incremental refactor of the vanilla single file into ES modules.** This has the
  lowest risk short-term, but auth, per-user data and testing would be rebuilt by hand.
  Rejected as the end state. It remains acceptable for hot-fixes to the legacy app.
- **Next.js or another SSR framework.** Rejected: there is no SEO or SSR need, it
  conflicts with static hosting, and it adds complexity.
- **Supabase or another backend-as-a-service.** Rejected for now: Firebase is already
  in use and contains the legacy sync data.
