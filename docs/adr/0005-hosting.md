# ADR 0005: Hosting for Deutsch Vokabular 2.0

- Status: **Proposed.** Awaiting the product owner's decision; nothing has been deployed.
- Date: 2026-10-15
- Details and comparison: [`docs/HOSTING_EVALUATION.md`](../HOSTING_EVALUATION.md)

## Decision (proposed)

Host v2 on **Firebase Hosting**, in a dev project now and a production project later, with Firebase
Auth and Firestore in the same project. The legacy app stays on GitHub Pages, unchanged.

## Why

- Redirect sign-in works on the app's own domain (Firebase's recommended fix for browsers that
  block third-party storage), so a fallback to popups is possible for in-app browsers.
- Preview channels provide temporary HTTPS URLs for testing on physical phones.
- Atomic releases, one-click rollback, security headers, and per-project dev/prod separation.

## Costs and trade-offs

- Spark covers Hosting with 10 GB storage and 360 MB/day transfer (≈ 900 uncached first visits per
  day for the current bundle); beyond that Blaze (billing) is needed.
- Same-origin legacy migration is lost. Mitigation: a small export page on the legacy GitHub Pages
  origin (a new file; `index.html` untouched) in Phase 4, subject to approval.

## Alternatives

GitHub Pages for v2: free, and it keeps same-origin migration; but it is popup-only (redirect only
via self-hosted helper files), has no header control and no preview channels.
