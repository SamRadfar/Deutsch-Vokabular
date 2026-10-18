# AI worker (Phase 5B)

A small Cloudflare Worker between the V2 app and the Anthropic API. The browser **never** sees
the API key. It sends a Firebase ID token and a short request; the worker checks it and returns
one validated vocabulary suggestion. The app shows the suggestion for review, and nothing is saved
without the user.

```
POST /v1/suggest
Authorization: Bearer <Firebase ID token of deutsch-vokabular-v2-dev>
{"mode":"from-german","word":"Nachhaltigkeit","context":"…"}       → suggestion
{"mode":"from-persian","fa":"پایداری"}                                → suggestion
{"mode":"complete","existing":{"lemma":"Wand","type":"n","fa":""}}   → suggestion (fills empty fields)
```

| Check | Where |
|---|---|
| Only `POST /v1/suggest`; exact-origin CORS (`ALLOWED_ORIGINS`) | `src/index.ts` |
| Body ≤ 4 KB, strict schema, unknown fields rejected, length limits | `src/contract.ts` |
| Firebase ID token: RS256 with Google's keys, `aud`/`iss` = project, `exp`, `iat`; the legacy project is refused | `src/auth.ts` |
| Limits per user (6/min, 60/day) and for the whole service (500/day), counted **before** the paid call | `src/limits.ts` |
| Anthropic call with a forced tool schema, 20 s timeout, output validated again | `src/provider.ts` |
| Errors never contain the key or the upstream response | `src/index.ts` |

Tests: `npm test -- tests/unit/worker` (local RSA keys, mocked Anthropic; no network).

## Local development (no key, no cost)

```
npm run ai:dev        # http://127.0.0.1:8787, mock provider, real Firebase token check
```

Put `VITE_AI_ENDPOINT=http://127.0.0.1:8787` in `v2/.env.local`. The mock provider returns
placeholder values marked «[آزمایشی]», and the app labels them «پیشنهاد آزمایشی». This is **not**
real AI.

## Deployment — only after the owner's approval

Each of these steps needs approval. The Anthropic API is a **paid** service.

1. Use a Cloudflare account (the Workers free plan is enough): `npx wrangler login`.
2. Create the KV namespace with `npx wrangler kv namespace create USAGE`, then put the id into `wrangler.toml`.
3. Set `ALLOWED_ORIGINS` to the exact origin(s) of the approved V2 hosting.
4. Store the key as a secret with `npx wrangler secret put ANTHROPIC_API_KEY`. It is typed into the prompt and never committed. Set a monthly spend limit in the Anthropic console.
5. Deploy with `npx wrangler deploy`. Then set `VITE_AI_ENDPOINT=https://<worker>.workers.dev` for the app.
6. Run the live test: sign in, generate a word, and check the review step and the limits.
