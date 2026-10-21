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

## Model: Cloudflare Workers AI (free allocation, no API key)

The worker calls Workers AI through its `AI` binding (`[ai]` in `wrangler.toml`). There is no
API key to store. The Workers **Free** plan includes **10,000 Neurons per day**; when they are used
up, Workers AI returns an error (no charge) and the app shows "try again tomorrow". The default
model is `@cf/openai/gpt-oss-120b` with reasoning effort "low". The live check measured it at about
**8.3 Neurons per word** and about 30 s per batch of 15, with better Persian than
`llama-3.3-70b-instruct-fp8-fast`, which costs about 34 Neurons per word and mixed foreign scripts
into Persian. `LIMIT_WORDS_PER_DAY = 600` per user and `LIMIT_GLOBAL_WORDS_PER_DAY = 900` keep the
service inside the free allocation. More needs the Workers Paid plan (not enabled). An
`ANTHROPIC_API_KEY` (paid) is optional; when it is set, it takes precedence.

Deployed (owner's account, free plan): `https://deutsch-vokabular-ai.sfr-arian.workers.dev`, with
KV `USAGE`. The real model was checked with `node scripts/ai-live-check.mjs "<topic>" 15`
(same provider code, prompt and validation, via the owner's wrangler login; it prints Neurons).

```
POST /v1/generate
Authorization: Bearer <Firebase ID token of deutsch-vokabular>
{"topic":"Kleidung und Mode","level":"B1-B2","count":15,"subcategories":["Oberteile"],"focus":"Oberteile","avoid":["die Jacke"]}
→ {"entries":[{article,lemma,type,grammar,fa,example,exampleFa,subcategory,level}], "rejected":1, "provider":"workers-ai", …}
```

The app builds lists of 25–200 words from batches of at most 15 (`src/features/personal/generate`).
`avoid` contains only words of the list being built. The user's saved vocabulary is never sent.

## Deployment (owner's Cloudflare account, free plan)

1. `npx wrangler login`: the owner approves in the browser. This is the only interactive step.
2. `npx wrangler kv namespace create USAGE`, then put the id into `wrangler.toml`.
3. `npx wrangler deploy`. Workers AI needs no further setup and no key.
4. Put `VITE_AI_ENDPOINT=https://deutsch-vokabular-ai.<subdomain>.workers.dev` into
   `deploy/production.env`, and add the same origin to `connect-src` in `firebase.json`.
5. Run the live test: sign in on the preview and generate 25 words.
