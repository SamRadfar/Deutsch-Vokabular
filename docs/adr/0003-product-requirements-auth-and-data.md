# ADR 0003: Product requirements for accounts, cloud data and migration

- Status: **Accepted** (requirements from the product owner, Phase 2 brief, 2026-10-15)
- Supersedes: ADR 0001 §3.1 ("sign-in must be optional") and the related consequence in §4.
  The rest of ADR 0001 remains *Proposed*.

## Requirements

| # | Requirement | Consequence for the architecture |
|---|---|---|
| R1 | **Google Authentication is required** for personal cloud accounts and cross-device synchronisation. | Cloud features (sync, server-side AI) are available only to signed-in users. Firebase Auth with the Google provider is the identity system. |
| R2 | **Offline guest functionality may be supported later, but is not approved for production.** | No design may *depend* on a guest mode. The local-first store from ADR 0001 is still useful for offline use by signed-in users and for reading legacy data, but whether an unauthenticated user may use the production app is **undecided** (see open decisions). |
| R3 | **Firestore data is isolated per authenticated user.** | All user data lives under `users/{uid}/…`, and Security Rules enforce `request.auth.uid == uid`. The rules are versioned in the repository and tested with the emulator before deployment. |
| R4 | **Built-in vocabulary stays versioned content, separate from personal progress.** | Implemented in Phase 2: `v2/src/data/vocabulary/*.v1.json` with stable ids. Progress references ids. Content is never copied into user documents. |
| R5 | **Existing local progress must be safely migratable.** | Implemented as pure logic in Phase 2 (`v2/src/features/progress/migration`), following `docs/MIGRATION_SPEC.md`. Not executed yet. |
| R6 | **No live data is deleted during migration.** | Legacy `localStorage` keys and `syncCodes/*` documents are read-only for v2. Any later clean-up is a separate, explicitly approved operation. |
| R7 | **The legacy application remains available until full feature parity is achieved and approved.** | The root `index.html` keeps being served by GitHub Pages. v2 lives in `v2/` and is not deployed. A replacement requires an explicit parity sign-off. |

## Open decisions (not decided by this ADR)

1. **Guest/offline-first use without sign-in** in production (R2): allowed, read-only, or not at all?
   This matters for users on networks where Google is blocked.
2. **Sign-in reachability:** Google sign-in needs `accounts.google.com` and
   `*.googleapis.com`. If these are blocked for some users, they cannot sync without a VPN.
   Is that acceptable?
3. **AI endpoint hosting** and its billing plan (ADR 0001 §5).
4. **Web hosting** for v2 (GitHub Pages sub-path vs Firebase Hosting) and the cut-over plan.
5. **Legacy `syncCodes` retirement** date and the user notice.
6. **Relocation of orphaned ticks:** whether ticks for the 7 removed Bautechnik words that still
   exist in `arch` should be offered to the user (`MIGRATION_SPEC.md` §7).
7. **Content fixes** from `DATA_QUALITY.md`, e.g. what the type `x` should mean.
