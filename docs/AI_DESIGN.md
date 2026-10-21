# AI features

Status (v2.0.2): the worker uses **Cloudflare Workers AI** (free allocation, no API key), and
Anthropic remains an optional paid alternative. Two features use it: single-word suggestions in the
word form, and the **topic vocabulary generator** «ساخت واژه با هوش مصنوعی» (§7). Live AI needs only
the owner's Cloudflare login (free plan) and a `wrangler deploy` (`v2/ai-worker/README.md`).

## 1. What the legacy app did and what V2 keeps

The legacy app (`index.html`, function `cwGenerate`) used the following flow:

- The user typed a German word and an optional context sentence.
- The browser called `api.anthropic.com` directly, with the user's own API key stored in
  `localStorage` (`dvok5_apikey`) and the header `anthropic-dangerous-direct-browser-access`.
- The answer was free-form JSON parsed from text. It contained the word with its article, the type, the Persian meaning, an example, the example's translation and a Persian pronunciation.
- Words added offline stayed `pending` and were generated automatically and saved when the device came back online.

| Legacy | V2 |
|---|---|
| A word plus a context sentence produces a full entry | Kept: "from German" mode with an optional context sentence |
| Fields: article, type, fa, example, exFa, pronunciation | Kept, plus **grammar** (plural, verb forms, comparison) |
| — | New: **from Persian** (find the German word for a meaning) |
| — | New: **complete** the missing fields of an existing word |
| The API key sits in the browser | **Removed.** The key exists only as a Worker secret |
| Free-text JSON, loosely parsed | Forced tool schema, validated by the worker **and** the app |
| Offline words are filled in and saved automatically | Replaced. Nothing is saved without review. A word saved with empty fields gets «✨ تکمیل» on its card |

## 2. Architecture

```
Browser (V2)                         Cloudflare Worker (ai-worker/)            Anthropic
WordForm → AiAssist ──POST /v1/suggest──▶ CORS → size → schema → Firebase ID ──▶ /v1/messages
           Bearer <Firebase ID token>     token → limits (KV) → provider          (secret key)
           ◀── {suggestion, provider, limits} ◀── output validation ◀──────────────
review table → "put into form" → user clicks "save" → personal vocabulary (sync, search, practice)
```

- The contract is `v2/ai-worker/src/contract.ts`. Worker and app share it, and it has no dependencies.
- The frontend client is `src/features/ai/aiClient.ts`. It sends only the ID token from `AuthService.getIdToken()`. It uses `credentials: 'omit'`, a 25 s timeout and cancellation, and re-validates every answer.
- The endpoint is configured with `VITE_AI_ENDPOINT` (`src/features/ai/config.ts`). It must use https; http is allowed only for localhost. If any `VITE_` variable looks like an API key (`sk-ant-…`), the AI is disabled, and the Firebase configuration is refused as well.

## 3. Review before saving (never overwrite automatically)

The merge logic is in `src/features/ai/merge.ts`. Every field the AI returns becomes one row:

| Row | Meaning | Pre-selected |
|---|---|---|
| fill | The field is empty in the form | yes |
| replace | The user already has a different value | **no**: it needs an explicit tick |
| same | The values are identical | no action |

"Put N fields into the form" changes only the form. Saving is a separate button. Closing the dialog
discards everything. Saved words are ordinary personal words (`source: 'manual'`), so cloud sync,
search, flashcards and shadowing need no change, and neither do the Firestore rules.

Responses from the local mock provider are labelled «پیشنهاد آزمایشی». Real answers are labelled «ممکن است اشتباه باشد».

## 4. Worker security

| Threat | Measure |
|---|---|
| Stolen or exposed API key | The key exists only as a Worker secret. It is never returned and never logged. The browser never contacts Anthropic |
| Anonymous use and cost abuse | Every request needs a valid Firebase ID token: RS256 with Google's JWKs, `aud` and `iss` equal to the project, `exp`/`iat` checked. The legacy project is refused |
| Use from other websites | Exact-origin CORS. Requests without an allowed `Origin` are refused |
| Cost explosion | Limits are checked **before** the paid call: 6/min and 60/day per user, 500/day for the whole service (KV, soft). `max_tokens` is 700. Owners should also set a monthly limit in the Anthropic console |
| Prompt injection or oversized input | Strict request schema with unknown fields rejected. Word ≤ 80, context ≤ 300 and body ≤ 4 KB. The user text is sent as JSON data, not as instructions |
| Malformed or malicious model output | Forced tool schema, then server-side validation (lengths, enums, no Persian in the German lemma, control characters removed), then the same validation in the app. Everything is rendered as React text |

## 5. Tests

Live AI is **not** covered by any of these tests.

| Area | File |
|---|---|
| Worker: JWT verification with local RSA keys, CORS, validation, limits, Anthropic request shape with a mocked fetch, no secret in responses, error mapping | `tests/unit/worker/worker.test.ts` (19) |
| Merge rules, client error mapping, timeout, configuration and secret detection | `tests/unit/ai/ai-logic.test.ts` (10) |
| UI: generate, review, apply, save; existing values kept; from-Persian mode; errors; cancellation; mock label; «✨ تکمیل»; not-configured state | `tests/unit/ai/ai-ui.test.tsx` (6) |
| Browser + emulators with a mocked worker: real ID token sent, no direct Anthropic call, cloud sync, search, flashcards, shadowing, complete, offline | `tests/e2e-emulator/ai.spec.ts` |

For local use, `npm run ai:dev` starts the worker handler under Node on 127.0.0.1:8787 with the mock provider. It verifies real dev-project tokens.

## 6. What needs the owner's approval

1. **Cloudflare**: an account (the free Workers plan is enough), a KV namespace `USAGE`, and `wrangler deploy` of `v2/ai-worker` (see `v2/ai-worker/README.md`).
2. **Anthropic API key** (a paid service): stored with `wrangler secret put ANTHROPIC_API_KEY`, with a monthly spend limit set in the console.
3. **Allowed origins**: the exact origin of the V2 hosting, once that is approved.
4. After these, `VITE_AI_ENDPOINT=https://<worker>.workers.dev` for the app, followed by a live test with a real account.

## 7. Topic vocabulary generator («ساخت واژه با هوش مصنوعی»), v2.0.2

The flow is topic → count (25/50/100/200) → level (A1–A2, B1–B2, C1–C2, all) → target category →
generate → preview/edit → import → sync. It replaces the removed legacy import UI. The data model is
unchanged: words with `source: 'legacy-import'` stay valid.

| Part | Where | Notes |
|---|---|---|
| Worker endpoint `POST /v1/generate` | `ai-worker/src/index.ts` | Batches of ≤ 15. Limits are counted in **words** (300/day per user and service-wide, which keeps the service inside the free allocation). Timeout is 85 s |
| Prompt, JSON schema, Workers AI provider | `ai-worker/src/provider.ts` | JSON mode (`response_format: json_schema`). Text answers of other models are parsed tolerantly |
| Entry validation (worker **and** app) | `ai-worker/src/contract.ts` `validateGeneratedEntry` | Nouns need a correct-form article and capitalisation. German text in German fields and Persian in Persian fields. Length limits. Duplicates inside a batch are dropped |
| Orchestration | `src/features/personal/generate/generation.ts` | The first batch names the subcategories. Then 2 parallel batches, each focused on one subcategory. `avoid` = the words of this list only. Duplicates are dropped by folded spelling. Transient errors are retried twice. Limits stop the run and keep the partial list |
| Preview and import | `generate/AiVocabularyGenerator.tsx`, `importPlan.ts` | Nothing is saved before «وارد کردن». Every field is editable. Rows can be removed or regenerated. Duplicates of existing words are flagged and unselected. Each row has its final id from the start, so the import is idempotent and never overwrites |
| User-created categories | `src/features/personal/collections.ts` | `placement = { category: "my:<name>", subtab: "<subcategory>" }` fits the **deployed** Firestore rules unchanged (bounded strings). The categories appear in «واژه‌های من» (filter, labels), the word form, and practice scopes (review, flashcards, shadowing). Search covers them as personal words |
| Bulk write | `DocSyncEngine.setMany` | One state update and one flush for 200 words (local first, then cloud sync with retries) |

Privacy: only the topic, level, the optional instructions and the words of the list being built
are sent to the worker and the model. Saved vocabulary never is.

Tests: `tests/unit/worker/generate.test.ts`, `tests/unit/personal/generate.test.ts`,
`tests/unit/personal/generator-ui.test.tsx`, `tests/emulator/customWords.rules.test.ts` (own
categories, isolation), and `tests/e2e-emulator/generator.spec.ts` (200 words → import → second
device, other account sees nothing).
