# ADR 0004: Authentication, personal progress and synchronisation (Phase 3)

- Status: **Accepted for implementation** (Phase 3). Production use still needs the manual steps
  in `docs/FIREBASE_SETUP.md` and the product owner's approval.
- Date: 2026-10-15
- Builds on: ADR 0003 (accepted product requirements).

## Decisions

1. **Google sign-in via Firebase Authentication, popup only.** `prompt=select_account` keeps
   account switching explicit. Redirect is not used, because it breaks on GitHub Pages under
   third-party-storage blocking (`FIREBASE_SETUP.md` §8). The popup opens synchronously in the
   click; a stuck sign-in can be cancelled.
2. **Browsing stays public; progress requires sign-in.** No anonymous Firebase accounts and no
   guest progress (ADR 0003 R2). Without sign-in no checkbox is shown.
3. **Per-word documents** `users/{uid}/progress/{wordId}` keyed by the Phase 2 stable ids. Content
   is never copied into user data. "Not learned" is stored as `learned: false` (no deletes),
   which keeps last-writer-wins ordering intact.
4. **Local-first with exactly one local source of truth:** the app's IndexedDB, partitioned by uid
   (confirmed copy, pending queue, meta). Firestore uses a memory cache.
5. **Conflict resolution:** per-word last-writer-wins by **server commit order**
   (`updatedAt == request.time`, enforced by the rules). Device clocks are informational. A
   pending local change is never overwritten by a snapshot until our write is confirmed. The
   known limitation for offline multi-device edits of the same word is documented in
   `SYNC_DESIGN.md` §4.
6. **Security Rules in the repository**, emulator-tested, **not deployed**. Deploying them
   replaces the legacy rules, so they need an explicit merge or project decision
   (`FIREBASE_SETUP.md` §0, §7).
7. **Data minimisation:** Firestore holds `uid`-scoped progress, a display name and photo URL;
   no email. The device id is random and not personal.
8. **Migration** is explicit, previewed and additive. It is verified against server-confirmed
   state and recorded once per dataset (`migrations/{sha256}`, create-only). The legacy data is
   never modified. When origins differ, a secrets-free JSON backup is the import path.

## Consequences

- (+) Works offline, survives reloads and account switches without leaking data, and converges
  across devices.
- (+) Rules enforce isolation server-side; the client-side checks are only defence in depth.
- (−) Firebase SDK adds ≈ 217 kB gzip (an async chunk; browsing does not wait for it).
- (−) Users on networks that block Google cannot sign in without a VPN (open decision in ADR 0003).
- (−) Real Google OAuth cannot be verified by automated tests; it needs a configured project and
  a manual check.
