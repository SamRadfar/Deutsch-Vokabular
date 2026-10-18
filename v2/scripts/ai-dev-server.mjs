// Local stand-in for the AI worker (Phase 5B): the same handler as the Cloudflare Worker, run by
// Node, with in-memory usage counters. Without ANTHROPIC_API_KEY in the environment it uses the
// MOCK provider (placeholder values, not AI, no cost). Firebase ID tokens are verified for real,
// against Google's public signing keys, for the development project only.
//
//   npm run ai:dev                       → http://127.0.0.1:8787/v1/suggest
//
// Listens on 127.0.0.1 only. Never prints tokens or keys.
import { createServer } from 'node:http';
import { handleRequest } from '../ai-worker/src/index.ts';
import { memoryCounterStore } from '../ai-worker/src/limits.ts';

const port = Number(process.env.AI_DEV_PORT || 8787);
const env = {
  FIREBASE_PROJECT_ID: process.env.AI_FIREBASE_PROJECT_ID || 'deutsch-vokabular-v2-dev',
  ALLOWED_ORIGINS: process.env.AI_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
  ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
  ALLOW_MOCK_PROVIDER: 'true',
  LIMIT_PER_MINUTE: process.env.AI_LIMIT_PER_MINUTE || '6',
  LIMIT_PER_DAY: process.env.AI_LIMIT_PER_DAY || '60',
  LIMIT_GLOBAL_PER_DAY: '500',
  USAGE: memoryCounterStore(),
};

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v]])),
      ...(req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? {} : { body }),
    });
    const response = await handleRequest(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.url} → ${response.status}`);
  } catch (e) {
    console.error('ai-dev-server error:', e instanceof Error ? e.message : 'unknown');
    res.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`AI dev server on http://127.0.0.1:${port}  provider: ${env.ANTHROPIC_API_KEY ? 'anthropic (real, paid)' : 'MOCK (no AI)'}  project: ${env.FIREBASE_PROJECT_ID}`);
});
