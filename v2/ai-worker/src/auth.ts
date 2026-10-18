// Firebase ID token verification for Cloudflare Workers (WebCrypto only, no Admin SDK).
// Follows https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface VerifiedUser { uid: string }

export type JwksFetcher = () => Promise<{ keys: JsonWebKey[] & Array<{ kid?: string }>; maxAgeSeconds: number }>;

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

export const fetchGoogleJwks: JwksFetcher = async () => {
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  return { keys: ((await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> }).keys, maxAgeSeconds: maxAge };
};

/** Caches Google's signing keys for as long as Google allows (Cache-Control max-age). */
export function cachedJwks(fetcher: JwksFetcher = fetchGoogleJwks, now: () => number = Date.now) {
  let cache: { keys: Array<JsonWebKey & { kid?: string }>; until: number } | null = null;
  return async (kid: string): Promise<(JsonWebKey & { kid?: string }) | undefined> => {
    const find = () => cache?.keys.find((k) => k.kid === kid);
    if (!cache || cache.until < now() || !find()) {
      const r = await fetcher();
      cache = { keys: r.keys, until: now() + r.maxAgeSeconds * 1000 };
    }
    return find();
  };
}

export class AuthFailure extends Error {}

/**
 * Verifies a Firebase ID token (RS256, Google signing key, audience = project id, issuer =
 * securetoken.google.com/<project>, not expired, issued in the past, non-empty subject).
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  keyFor: (kid: string) => Promise<(JsonWebKey & { kid?: string }) | undefined>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthFailure('malformed token');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = json(b64urlToBytes(parts[0]!));
    payload = json(b64urlToBytes(parts[1]!));
  } catch {
    throw new AuthFailure('malformed token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthFailure('unsupported token algorithm');
  const jwk = await keyFor(header.kid);
  if (!jwk) throw new AuthFailure('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new AuthFailure('bad signature');
  const skew = 300;
  if (payload.aud !== projectId) throw new AuthFailure('wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthFailure('wrong issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) throw new AuthFailure('expired');
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + skew) throw new AuthFailure('issued in the future');
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSeconds + skew) throw new AuthFailure('auth_time in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new AuthFailure('missing subject');
  return { uid: payload.sub };
}
