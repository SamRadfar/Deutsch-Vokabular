# Architecture

## Current (legacy, in production)

A single static file served by GitHub Pages (branch `main`, path `/`):

```
index.html     CSS (1–1124) · markup (1131–1347) · DATA (1357–2821) · logic (2823–4380)
sw.js          network-first service worker (install currently fails, see BASELINE V1)
manifest.json  PWA manifest
icon-512.png   app icon
```

```mermaid
flowchart LR
  subgraph Browser["Browser: index.html"]
    UI["DOM tables & overlays<br/>(DOM is the source of truth for ticks)"]
    DATA["const DATA (999 rows)"]
    LOGIC["vanilla JS globals"]
    LS[("localStorage")]
    TTS["Web Speech API"]
  end
  FS[("Firestore syncCodes/code")]
  AN["Anthropic API (user key)"]
  DATA --> LOGIC --> UI --> LOGIC
  LOGIC <--> LS
  LOGIC --> TTS
  LOGIC <--> FS
  LOGIC --> AN
```

Details: [`DATA_CONTRACTS.md`](DATA_CONTRACTS.md) and [`BASELINE.md`](BASELINE.md).

## Target (proposed, see ADR 0001)

```mermaid
flowchart LR
  subgraph Client["SPA: React + TypeScript + Vite (PWA)"]
    UI2["Components (RTL, mobile-first)"]
    CONTENT["Static content JSON<br/>(stable word ids)"]
    STORE[("IndexedDB<br/>local-first store")]
    SYNC["Sync engine<br/>(per-word LWW)"]
    MIG["Legacy migrator<br/>(read-only on legacy keys)"]
  end
  AUTH["Firebase Auth (Google, optional)"]
  FS2[("Firestore users/uid/...")]
  API["AI endpoint (server-side key,<br/>auth + rate limit)"]
  LEG[("legacy localStorage<br/>+ syncCodes (read-only)")]

  CONTENT --> UI2
  UI2 <--> STORE
  STORE <--> SYNC <--> FS2
  SYNC --> AUTH
  UI2 --> API
  API --> AUTH
  MIG --> LEG
  MIG --> STORE
```

## Repository layout

Current (Phase 1):

```
index.html, sw.js, manifest.json, icon-512.png   legacy app (unchanged)
package.json                                      scripts only, no dependencies
scripts/lib/legacy-source.mjs                     read-only extraction helpers
scripts/extract-baseline.mjs                      → tests/fixtures/baseline/*
scripts/extract-legacy-index-maps.mjs             → tests/fixtures/legacy/*
tests/baseline/*.test.mjs                         baseline, contract, known-defect tests
docs/                                             this documentation, ADRs
.github/workflows/ci.yml                          CI (tests only, no deploy)
```

Planned (Phase 2+): `src/`, `src/content/`, `functions/` or `server/`,
`firestore.rules`, `e2e/`. See ADR 0001 §3.6.
