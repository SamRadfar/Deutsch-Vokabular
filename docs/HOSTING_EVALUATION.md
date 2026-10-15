# Hosting evaluation for Deutsch Vokabular 2.0

Status: **recommendation for the product owner. Nothing has been deployed.**
Date: 2026-10-15. Prices and quotas were checked on firebase.google.com/pricing on that date;
re-check before deciding.

## Options

- **A. GitHub Pages** (frontend) + Firebase Auth/Firestore (as today for the legacy app)
- **B. Firebase Hosting** (frontend) + Firebase Auth/Firestore, in the same Firebase project

## Comparison

| Criterion | A. GitHub Pages | B. Firebase Hosting |
|---|---|---|
| **Google sign-in (popup)** | Works (implemented and emulator-tested in 5 browser engines) | Works |
| **Redirect sign-in fallback** (popup-hostile environments: in-app browsers, some iOS cases) | Firebase requires one of its workarounds in Chrome 115+, Firefox 109+ and Safari 16.1+. Only "self-host the auth helper files" is possible on Pages: it needs a build pipeline (Jekyll drops `__/` folders) and maintenance of copied helper files | **Supported out of the box:** Hosting serves `/__/auth/*` on the app's own domain, so setting `authDomain` to that domain makes redirect sign-in work (Firebase's "Option 1") |
| **Mobile browsers** | Popup only; in-app browsers show a hint to open Chrome/Safari | Popup, plus a redirect fallback that can be added later |
| **Staging for real-device tests** | No built-in previews; would need a second repo or path | **Preview channels:** temporary HTTPS URLs per branch or PR with automatic expiry, ideal for testing on real phones |
| **Deployment automation** | GitHub Actions to Pages (build step needed; today's Pages build is Jekyll from `main`) | Official GitHub Action (`FirebaseExtended/action-hosting-deploy`); deploys on merge and previews on PRs |
| **Rollback** | Redeploy an older commit (minutes) | **One-click rollback** to any earlier release in the console; atomic releases |
| **Security configuration** | Cannot set HTTP headers (no CSP, HSTS policy, …) | `firebase.json` headers: CSP, `X-Content-Type-Options`, cache rules, etc. |
| **PWA** | Works (static files, HTTPS) | Works; plus per-file cache headers (`sw.js` no-cache, assets immutable) |
| **Custom domain** | Supported (CNAME), free TLS | Supported, free TLS; required for the cleanest redirect setup |
| **Dev/prod separation** | One site per repository; separating environments is awkward | One Hosting site per Firebase project (`-dev` and prod), plus preview channels |
| **Legacy migration (same origin)** | **Advantage:** v2 on `samradfar.github.io` can read the legacy `localStorage` directly (same origin, path does not matter) | Different origin → users need the JSON backup (`MIGRATION_GUIDE.md`); see the mitigation below |
| **Operating cost** | Free (public repository) | Spark (no billing account): 10 GB storage, **360 MB/day** transfer. The v2 bundle is ≈ 1.4 MB uncached (≈ 0.4 MB gzip) → roughly 900 uncached first visits per day before the quota (caching reduces repeat cost). Above that, Blaze is needed (pay-as-you-go) |
| **Firestore / Auth cost** | Same for both options: Spark 50 K reads, 20 K writes and 20 K deletes per day, 1 GiB stored; Auth 50 K monthly active users at no cost | Same |

## Recommendation: **B. Firebase Hosting** for v2, with a migration bridge on the legacy origin

Reasons:

1. **Sign-in robustness.** Redirect sign-in remains possible on the app's own domain. That is the
   official fix for browsers that block third-party storage, and the fallback when popups are
   blocked (in-app browsers, which matter for users who open links from Telegram or Instagram).
2. **Real-device staging.** Preview channels give expiring HTTPS URLs for iPhone and Android testing
   without touching production. This is exactly what the next validation step needs.
3. **Operations.** Atomic releases, instant rollback, security headers, and a clean `-dev` vs. prod
   separation per Firebase project.

Trade-off and mitigation: the **same-origin legacy migration is lost** (the legacy app stays on
GitHub Pages). Proposed mitigation for Phase 4, subject to approval: add a small **export page**
next to the legacy app on GitHub Pages (a new file, e.g. `export.html`, so `index.html` stays
untouched). It reads the legacy keys **without** the API key or sync code and lets users download
the JSON backup, or hand it to v2. Users then never need the developer console.

Keep for later (not needed now): a custom domain shared by both, which would restore same-site
behaviour and is the cleanest redirect setup.

## What is NOT done

- No Hosting site, preview channel or deploy workflow was created.
- No `firebase.json` hosting section was added; that is Phase 4 work after approval.
- Costs beyond the documented free quotas were not verified against real traffic.
