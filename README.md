# Deutsch-Vokabular

A German–Persian specialist vocabulary PWA (RTL Persian UI) with 999 built-in
entries in 7 categories (architecture, architecture studies, building technology,
building physics, fitness, anatomy, Dreame products). It offers translations,
examples, Persian pronunciation, text-to-speech, flashcards, pronunciation/shadowing
practice, AI-generated custom words and device sync.

Live: <https://samradfar.github.io/Deutsch-Vokabular/>

## Status

The production app is the single file `index.html` on `main` (unchanged).

- **Phase 1 (foundation):** documentation and read-only baseline tests.
- **Phase 2 (architecture, branch `refactor/pro-v2-architecture`):** an isolated React +
  TypeScript + Vite preview in [`v2/`](v2/README.md) that browses all 999 entries, with
  stable word ids and tested, read-only migration-preparation logic.
- **Phase 3 (auth + sync, branch `feature/pro-v2-auth-sync`):** Google sign-in, personal progress
  (IndexedDB + Firestore, per-user Security Rules, offline queue) and an explicit legacy migration.
  Not deployed; Firebase must be configured manually ([docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)).

## Quick start

```bash
npm test                 # baseline + data-contract checks (Node ≥ 22, no install needed)
npm run baseline:check   # compare index.html vocabulary with the fixtures

cd v2 && npm ci && npm run dev   # v2 preview → http://localhost:5173/
```

## Documentation

| Document | Content |
|---|---|
| [docs/BASELINE.md](docs/BASELINE.md) | Content statistics and the features that must be preserved |
| [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md) | localStorage keys, progress identity, legacy `dvok5`, Firestore sync |
| [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md) | Known content issues (recorded, not corrected) |
| [docs/MIGRATION_SPEC.md](docs/MIGRATION_SPEC.md) | Loss-free migration to v2 and Google sign-in, and rollback |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current and target architecture |
| [docs/adr/](docs/adr/) | Architecture Decision Records (0003 = accepted product requirements) |
| [v2/README.md](v2/README.md) | v2 preview: commands, structure, visible differences |
| [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) | Manual Firebase configuration (product owner) |
| [docs/SYNC_DESIGN.md](docs/SYNC_DESIGN.md) | Progress storage, sync and conflict handling |
| [docs/MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md) | How users move legacy progress |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Workflow, commands, rules |
