const PLATFORM_HOSTS = {
  facebook: new Set(['graph.facebook.com', 'rupload.facebook.com']),
  instagram: new Set(['graph.instagram.com']),
  threads: new Set(['graph.threads.net']),
};

const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);
const FORBIDDEN_KEYS = /^(access_token|token|fbToken|igToken|thToken|authorization|secret)$/i;

export async function handleSocialPublishOperation({ request, env, requestId, decryptToken, writeAudit }) {
  const body = await readJson(request);
  const platform = text(body?.platform).toLowerCase();
  const unit = normalizeUnit(body?.unit);
  const operation = text(body?.operation || body?.step || body?.phase).toLowerCase();
  const method = text(body?.method || body?.request?.method || 'POST').toUpperCase();
  const target = text(body?.url || body?.request?.url);

  if (!PLATFORM_HOSTS[platform]) return response({ ok: false, error: 'invalid_platform', requestId }, 400);
  if (!unit) return response({ ok: false, error: 'invalid_unit', requestId }, 400);
  if (!operation || !/^[a-z0-9_:-]{1,80}$/.test(operation)) {
    return response({ ok: false, error: 'invalid_operation', requestId }, 400);
  }
  if (!ALLOWED_METHODS.has(method)) return response({ ok: false, error: 'method_not_allowed', requestId }, 405);

  let url;
  try { url = new URL(target); } catch { return response({ ok: false, error: 'invalid_target_url', requestId }, 400); }
  if (url.protocol !== 'https:' || !PLATFORM_HOSTS[platform].has(url.hostname.toLowerCase()) || !allowedPath(platform, url)) {
    return response({ ok: false, error: 'target_not_allowed', requestId }, 403);
  }

  const credential = await resolveCredential(env, platform, unit);
  if (!credential) return response({ ok: false, error: 'credential_not_found', platform, unit, requestId }, 404);
  const accessToken = await decryptToken(credential.token_ciphertext, env);

  const query = sanitizeObject(body?.query || body?.params || body?.request?.query);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.delete('access_token');

  const headers = new Headers(sanitizeObject(body?.headers || body?.requestHeaders || body?.request?.headers));
  headers.delete('authorization');
  let payload = sanitizeObject(body?.body || body?.jsonRequest || body?.requestBody || body?.request?.body);
  if (url.hostname.toLowerCase() === 'rupload.facebook.com') {
    headers.set('Authorization', `OAuth ${accessToken}`);
  } else if (method === 'GET' || method === 'HEAD') {
    url.searchParams.set('access_token', accessToken);
  } else {
    payload = { ...payload, access_token: accessToken };
    headers.set('content-type', 'application/json');
  }

  const upstream = await fetch(url.toString(), {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(payload),
  });
  const raw = await upstream.text();
  let upstreamBody;
  try { upstreamBody = JSON.parse(raw); } catch { upstreamBody = raw ? { text: raw.slice(0, 4000) } : {}; }
  const cleanBody = sanitizeValue(upstreamBody);

  await writeAudit(env, {
    tokenId: credential.id,
    event: 'social.operation',
    provider: platform,
    unit: credential.unit,
    tokenType: credential.token_type,
    status: upstream.ok ? 'ok' : 'error',
    requestId,
    metadata: {
      operation,
      method,
      host: url.hostname,
      path: url.pathname,
      upstream_status: upstream.status,
    },
  });

  const envelope = isObject(cleanBody) ? cleanBody : { data: cleanBody };
  return response({
    ...envelope,
    _gateway: {
      ok: upstream.ok,
      operation,
      platform,
      unit,
      upstream_status: upstream.status,
      requestId,
    },
  }, upstream.ok ? 200 : upstream.status);
}

function allowedPath(platform, url) {
  const path = url.pathname;
  if (url.hostname.toLowerCase() === 'rupload.facebook.com') return /^\/video-upload\//.test(path);
  if (platform === 'threads') return /^\/v1\.0\/(?:me|\d+)(?:\/(?:threads|threads_publish))?$/.test(path);
  if (platform === 'instagram') return /^\/v25\.0\/\d+(?:\/(?:media|media_publish))?$/.test(path);
  return /^\/v25\.0\/\d+(?:\/(?:feed|photos|videos|video_reels))?$/.test(path);
}

async function resolveCredential(env, provider, unit) {
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext, metadata_json
       FROM credential_tokens
      WHERE provider = ? AND active = 1
      ORDER BY updated_at DESC`,
  ).bind(provider).all()).results || [];
  const matching = rows.filter((row) => normalizeUnit(row.unit || parseMetadata(row.metadata_json)?.legacy_columns?.Unit) === unit);
  if (provider !== 'facebook') return matching[0] || null;
  return matching.find((row) => {
    const metadata = parseMetadata(row.metadata_json);
    return metadata.purpose !== 'meta_ads_publish' && !metadata.meta_ads_publish;
  }) || matching[0] || null;
}

function sanitizeObject(value) {
  const cleaned = sanitizeValue(value);
  return isObject(cleaned) ? cleaned : {};
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    out[key] = sanitizeValue(entry);
  }
  return out;
}

function normalizeUnit(value) {
  const compact = text(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'bss' || compact === 'barrashoppingsul') return 'bss';
  if (compact === 'nh' || compact === 'novohamburgo') return 'nh';
  return '';
}

function parseMetadata(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return String(value ?? '').trim();
}
