// Where the AI worker runs (VITE_AI_ENDPOINT). Only the URL of OUR worker belongs in the frontend;
// the Anthropic key stays a Worker secret. A value that looks like an API key is refused.

type Env = Record<string, string | boolean | undefined>;

export type AiEndpointConfig =
  | { status: 'configured'; endpoint: string }
  | { status: 'off' }
  | { status: 'invalid'; problem: string };

/** Anthropic / generic secret key shapes that must never appear in a VITE_ variable. */
export const SECRET_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9]{20,}/;

export function readAiEndpoint(env: Env = import.meta.env as Env): AiEndpointConfig {
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('VITE_') && typeof v === 'string' && SECRET_KEY_PATTERN.test(v)) {
      return { status: 'invalid', problem: `${k} looks like an API key; API keys must never be used in the frontend` };
    }
  }
  const raw = typeof env.VITE_AI_ENDPOINT === 'string' ? env.VITE_AI_ENDPOINT.trim() : '';
  if (!raw) return { status: 'off' };
  let url: URL;
  try { url = new URL(raw); } catch { return { status: 'invalid', problem: 'VITE_AI_ENDPOINT is not a URL' }; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { status: 'invalid', problem: 'VITE_AI_ENDPOINT must use https (http only for localhost)' };
  if (url.username || url.password || url.search || url.hash) return { status: 'invalid', problem: 'VITE_AI_ENDPOINT must be a plain origin/path' };
  return { status: 'configured', endpoint: url.href.replace(/\/+$/, '') };
}
