const SHA256_HEX = /^[a-f0-9]{64}$/i;

function readSeedHeader(request) {
  return String(
    request.headers.get('x-seed-token') || request.headers.get('x-insumos-seed-token') || '',
  ).trim();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Authorizes the local-only snapshot seed without putting its raw token in a
 * Wrangler command line. Normal local development can still provide the raw
 * binding; the CRM preview supplies only its SHA-256 digest through --var.
 */
export async function isAuthorizedDevSeedRequest({ env, request, url }) {
  if (url.pathname !== '/admin/seed' || request.method !== 'POST') return false;
  if (String(env?.ALLOW_DEV_SEED || '').trim().toLowerCase() !== 'true') return false;

  const headerToken = readSeedHeader(request);
  if (!headerToken) return false;

  const rawToken = String(env?.INSUMOS_SEED_TOKEN || '').trim();
  if (rawToken) return headerToken === rawToken;

  const tokenSha256 = String(env?.INSUMOS_SEED_TOKEN_SHA256 || '').trim().toLowerCase();
  if (!SHA256_HEX.test(tokenSha256)) return false;
  return (await sha256Hex(headerToken)) === tokenSha256;
}
