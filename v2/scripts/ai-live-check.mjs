// LIVE check of the real model with the worker's own provider code (prompt, JSON schema, validation):
// Workers AI is called through Cloudflare's REST API with the wrangler login of the owner (the OAuth
// token is read from wrangler's config and never printed). Uses Neurons of the free allocation
// (≈ 34 per word). No Firebase project, no user data: only the topic below is sent.
//   node scripts/ai-live-check.mjs ["Kleidung und Mode"] [count ≤ 15]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { workersAiProvider, DEFAULT_WORKERS_AI_MODEL } from '../ai-worker/src/provider.ts';

const topic = process.argv[2] ?? 'Kleidung und Mode';
const count = Math.min(15, Number(process.argv[3] ?? 10));

function token() {
  const paths = [join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml'), join(homedir(), '.wrangler', 'config', 'default.toml'), join(homedir(), '.config', '.wrangler', 'config', 'default.toml')];
  for (const p of paths) {
    try { const m = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(p, 'utf8')); if (m) return m[1]; } catch { /* next */ }
  }
  throw new Error('no wrangler login found (run: npx wrangler login)');
}
const auth = { authorization: `Bearer ${token()}` };
const accounts = await (await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: auth })).json();
const account = accounts.result?.[0]?.id;
if (!account) throw new Error('no Cloudflare account visible to this login');

let neurons = 0;
const binding = {
  async run(model, input) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const body = await res.json();
    if (!res.ok || body.success === false) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
    neurons += body.result?.usage?.neurons ?? 0;
    return body.result;
  },
};

const model = process.env.AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
const t0 = Date.now();
const out = await workersAiProvider(binding, model).generate({ topic, level: 'B1-B2', count });
console.log(`model ${model} · ${((Date.now() - t0) / 1000).toFixed(1)} s · ${out.entries.length} valid, ${out.rejected} rejected · ${neurons.toFixed(0)} Neurons (${(neurons / Math.max(1, out.entries.length)).toFixed(1)} per word)`);
for (const e of out.entries) {
  console.log(`- ${e.article ? `${e.article} ` : ''}${e.lemma} [${e.type}, ${e.level ?? '?'}, ${e.subcategory}] = ${e.fa}\n    ${e.example}\n    ${e.exampleFa}`);
}
