# Development Workflow

## Prerequisites

- Node.js ≥ 22 (`node --test` glob support). Verified with Node 24.19.0 and npm 11.17.0.
- Git with **full history**. The legacy `dvok5` maps are rebuilt from old commits.
  A shallow clone skips that one test.
- Phase 1 has **no npm dependencies**, so there is no `npm install` step.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs every `tests/**/*.test.mjs` with `node --test` (read-only). |
| `npm run baseline:check` | Re-extracts the vocabulary from `index.html` and compares it with the fixtures. A non-zero exit means a difference. |
| `npm run baseline:update` | **Deliberately** re-baselines after an approved content change. Review the fixture diff in the commit. |
| `npm run legacy-maps:build` | Rebuilds `tests/fixtures/legacy/dvok5-index-maps.json` from git history (writes only if missing, unless `--update`). |
| `LEGACY_SOURCE=path/to/copy.html npm test` | Runs the suite against another copy of the app, e.g. for a mutation check. |

Run the legacy app locally with any static server from the repository root, for
example `python -m http.server 8000`, then open `http://localhost:8000/`. Firebase
sync and AI generation call live services. **Do not use them in tests.**

## v2 application (Phase 2+)

The React preview lives in `v2/` with its own `package.json` and lockfile. See
[`v2/README.md`](../v2/README.md) for all commands. In short:

```bash
cd v2
npm ci                              # exact locked dependencies
npx playwright install chromium     # once, for browser tests
npm run dev                         # http://localhost:5173/
npm run typecheck && npm test       # strict TypeScript + Vitest
npm run test:e2e                    # Playwright against the production build
npm run build && npm run preview    # http://localhost:4173/
npm run test:emulator               # Firestore rules + real-SDK sync tests (Java 21+)
npm run test:e2e:emulator           # browser tests against the Firebase emulators (Java 21+)
```

Firebase configuration and all manual console steps: [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).
Copy `v2/.env.example` to `v2/.env.local` (git-ignored) for a real project; never commit it.

Content in `v2/src/data/vocabulary/` was generated once by `v2/scripts/generate-content.mjs`.
Do not re-run it for normal work: content is now edited in the JSON (ids stay), and every
change must keep the data-integrity tests green or be an approved, documented content change.

## Branching and commits

- `main` = production (GitHub Pages deploys it). Never commit to it directly.
- Work on feature branches, e.g. `refactor/pro-v2-foundation`. Merging into `main`,
  pushing, tagging releases and deploying require the product owner's explicit approval.
- Destructive git commands (`reset --hard`, `clean -fd`, force-push) are not part
  of this workflow.
- Make small, logical commits. Content changes to the vocabulary must be separate
  commits that include the fixture update.

## Rules for the baseline

- Fixtures are evidence of the legacy state. They are not edited by hand and not
  "fixed" so that tests pass.
- A failing baseline test after a change means the vocabulary changed. Either
  revert the change or, if it is intended and approved, run `baseline:update` and
  explain the change in the commit message.
- When a known defect is fixed, convert its `todo` test into a regular test.

## Security rules for contributors

- Never commit `.env` files, API keys, service-account files or real user data
  (`.gitignore` blocks the usual names). Test fixtures must be synthetic.
- The Firebase **web** config in `index.html` is a public identifier. Privileged
  credentials (Admin SDK, Anthropic keys) never go into the repository or the client.
- Do not modify live Firestore data or production Security Rules from development
  machines. Use the Firebase emulator (Phase 2).
- Tests must not call paid AI services.

## GitHub Pages caveat

Pages builds `main` with Jekyll. When this branch is merged, Markdown files in the
repository are published as pages, and Liquid template sequences in them (an opening
curly brace followed by another curly brace or a percent sign) would break the build. Keep docs free of Liquid syntax, or decide on `.nojekyll` or an
Actions-based deployment together with the hosting decision (ADR 0001 §5).

## Line endings

On Windows with `core.autocrlf=true`, files are checked out with CRLF. All
extraction normalises line endings, so fixtures and fingerprints are identical on
every OS.
