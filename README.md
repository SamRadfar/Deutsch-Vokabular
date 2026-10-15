# Deutsch-Vokabular

A German–Persian specialist vocabulary PWA (RTL Persian UI) with 999 built-in
entries in 7 categories (architecture, architecture studies, building technology,
building physics, fitness, anatomy, Dreame products). It offers translations,
examples, Persian pronunciation, text-to-speech, flashcards, pronunciation/shadowing
practice, AI-generated custom words and device sync.

Live: <https://samradfar.github.io/Deutsch-Vokabular/>

## Status

The production app is the single file `index.html` on `main`.
**Deutsch Vokabular 2.0 — Phase 1 (foundation)** adds documentation and read-only
baseline tests on branch `refactor/pro-v2-foundation`. The legacy app is unchanged.

## Quick start

```bash
npm test                 # baseline + data-contract checks (Node ≥ 22, no install needed)
npm run baseline:check   # compare index.html vocabulary with the fixtures
```

## Documentation

| Document | Content |
|---|---|
| [docs/BASELINE.md](docs/BASELINE.md) | Content statistics and the features that must be preserved |
| [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md) | localStorage keys, progress identity, legacy `dvok5`, Firestore sync |
| [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md) | Known content issues (recorded, not corrected) |
| [docs/MIGRATION_SPEC.md](docs/MIGRATION_SPEC.md) | Loss-free migration to v2 and Google sign-in, and rollback |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current and target architecture |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Workflow, commands, rules |
