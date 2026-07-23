import {
  handleMetaAdsPublishRequest,
  isMetaAdsPublishPath,
} from './meta-ads-publish.js';
import { handleSocialPublishOperation } from './social-publish.js';

const TOKEN_PREFIX = '/internal/token-vault';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const PROVIDERS = new Set(['threads', 'instagram', 'facebook']);

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(request, env) {
  const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);

  try {
    const auth = authorizeRequest(request, env);
    if (!auth.ok) {
      return json({ ok: false, error: auth.reason, requestId }, { status: auth.status });
    }

    if (request.method === 'GET' && pathname === '/health') {
      return health(env, requestId);
    }

    if (isMetaAdsPublishPath(pathname)) {
      return await handleMetaAdsPublishRequest({
        request,
        env,
        requestId,
        pathname,
        decryptToken,
        writeAudit,
      });
    }

    if (request.method === 'GET' && pathname === '/v1/token-metadata') {
      return listTokenMetadata(url, env, requestId);
    }

    if (request.method === 'POST' && pathname === '/v1/token-maintenance/refresh') {
      return refreshToken(request, env, requestId);
    }

    if (request.method === 'POST' && pathname === '/v1/social-publish/operations') {
      return handleSocialPublishOperation({ request, env, requestId, decryptToken, writeAudit });
    }

    if (request.method === 'GET' && pathname === '/v1/tokens') {
      if (auth.role !== 'admin') return adminOnly(requestId);
      return listTokens(url, env, requestId);
    }

    if (request.method === 'POST' && pathname === '/v1/tokens') {
      if (auth.role !== 'admin') return adminOnly(requestId);
      return createToken(request, env, requestId);
    }

    const patchMatch = pathname.match(/^\/v1\/tokens\/([^/]+)$/);
    if (request.method === 'PATCH' && patchMatch) {
      if (auth.role !== 'admin') return adminOnly(requestId);
      return patchToken(decodeURIComponent(patchMatch[1]), request, env, requestId);
    }

    if (request.method === 'GET' && pathname === '/contract') {
      return contract(requestId);
    }

    return json({ ok: false, error: 'not_found', requestId }, { status: 404 });
  } catch (error) {
    return json(
      { ok: false, error: 'internal_error', message: safeErrorMessage(error), requestId },
      { status: 500 },
    );
  }
}

function adminOnly(requestId) {
  return json({ ok: false, error: 'admin_credential_required', requestId }, { status: 403 });
}

function normalizePath(pathname) {
  if (pathname === TOKEN_PREFIX) return '/';
  if (pathname.startsWith(`${TOKEN_PREFIX}/`)) return pathname.slice(TOKEN_PREFIX.length);
  return pathname;
}

async function health(env, requestId) {
  const checks = {
    d1: Boolean(env.TOKEN_VAULT_DB),
    apiToken: Boolean(safeString(env.TOKEN_VAULT_API_TOKEN)),
    encryptionKey: Boolean(safeString(env.TOKEN_VAULT_ENCRYPTION_KEY)),
  };

  if (checks.d1) {
    await env.TOKEN_VAULT_DB.prepare('SELECT 1 AS ok').first();
  }

  const ok = Object.values(checks).every(Boolean);
  return json({
    ok,
    service: 'skincos-token-vault',
    environment: safeString(env.ENVIRONMENT) || 'unknown',
    checks,
    requestId,
  }, { status: ok ? 200 : 500 });
}

async function listTokens(url, env, requestId) {
  const provider = safeString(url.searchParams.get('provider')).toLowerCase();
  if (provider && !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'invalid_provider', requestId }, { status: 400 });
  }

  const activeParam = safeString(url.searchParams.get('active')).toLowerCase();
  const activeOnly = activeParam === '' ? true : !['false', '0', 'no'].includes(activeParam);
  const limit = clampInteger(url.searchParams.get('limit'), 200, 1, 1000);

  const clauses = [];
  const binds = [];
  if (provider) {
    clauses.push('provider = ?');
    binds.push(provider);
  }
  if (activeOnly) {
    clauses.push('active = 1');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext,
            expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
       FROM credential_tokens
       ${where}
       ORDER BY provider, unit, external_account_id
       LIMIT ?`,
  ).bind(...binds, limit).all()).results || [];

  const items = [];
  for (const row of rows) {
    items.push(await serializeToken(row, env));
  }

  await writeAudit(env, {
    event: 'tokens.list',
    status: 'ok',
    requestId,
    metadata: { provider: provider || null, activeOnly, count: items.length },
  });

  return json({ ok: true, count: items.length, items, requestId });
}

async function listTokenMetadata(url, env, requestId) {
  const provider = safeString(url.searchParams.get('provider')).toLowerCase();
  if (provider && !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'invalid_provider', requestId }, { status: 400 });
  }

  const activeParam = safeString(url.searchParams.get('active')).toLowerCase();
  const activeOnly = activeParam === '' ? true : !['false', '0', 'no'].includes(activeParam);
  const limit = clampInteger(url.searchParams.get('limit'), 200, 1, 1000);
  const clauses = [];
  const binds = [];
  if (provider) {
    clauses.push('provider = ?');
    binds.push(provider);
  }
  if (activeOnly) clauses.push('active = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type,
            expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
       FROM credential_tokens
       ${where}
       ORDER BY provider, unit, external_account_id
       LIMIT ?`,
  ).bind(...binds, limit).all()).results || [];

  const items = rows.map((row) => ({
    id: row.id,
    token_id: row.id,
    provider: row.provider,
    unit: row.unit,
    external_account_id: row.external_account_id,
    token_type: row.token_type,
    expires_at: row.expires_at,
    last_refreshed_at: row.last_refreshed_at,
    active: Boolean(row.active),
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  await writeAudit(env, {
    event: 'tokens.metadata.list',
    status: 'ok',
    requestId,
    metadata: { provider: provider || null, activeOnly, count: items.length },
  });
  return json({ ok: true, count: items.length, items, requestId });
}

async function refreshToken(request, env, requestId) {
  const body = await readJson(request);
  const tokenId = safeString(body?.token_id || body?.id);
  if (!tokenId) return json({ ok: false, error: 'token_id_required', requestId }, { status: 400 });

  const existing = await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext,
            expires_at, metadata_json
       FROM credential_tokens
      WHERE id = ? AND active = 1`,
  ).bind(tokenId).first();
  if (!existing) return json({ ok: false, error: 'token_not_found', requestId }, { status: 404 });
  if (!['threads', 'instagram'].includes(existing.provider)) {
    return json({ ok: false, error: 'provider_refresh_not_supported', provider: existing.provider, requestId }, { status: 409 });
  }

  const currentToken = await decryptToken(existing.token_ciphertext, env);
  const refreshUrl = new URL(existing.provider === 'threads'
    ? 'https://graph.threads.net/refresh_access_token'
    : 'https://graph.instagram.com/refresh_access_token');
  refreshUrl.searchParams.set('grant_type', existing.provider === 'threads' ? 'th_refresh_token' : 'ig_refresh_token');
  refreshUrl.searchParams.set('access_token', currentToken);

  const upstream = await fetch(refreshUrl.toString(), { method: 'GET' });
  const upstreamBody = await upstream.json().catch(() => ({}));
  const nextToken = safeString(upstreamBody.access_token);
  if (!upstream.ok || !nextToken) {
    await writeAudit(env, {
      tokenId,
      event: 'tokens.refresh',
      provider: existing.provider,
      unit: existing.unit,
      tokenType: existing.token_type,
      status: 'error',
      requestId,
      metadata: { upstream_status: upstream.status },
    });
    return json({ ok: false, error: 'provider_refresh_failed', provider: existing.provider, upstream_status: upstream.status, requestId }, { status: 502 });
  }

  const now = new Date().toISOString();
  const expiresIn = Number(upstreamBody.expires_in);
  const expiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : existing.expires_at;
  const metadata = { ...parseJsonObject(existing.metadata_json), last_refresh_source: 'token-vault-worker' };
  await env.TOKEN_VAULT_DB.prepare(
    `UPDATE credential_tokens
        SET token_ciphertext = ?, expires_at = ?, last_refreshed_at = ?,
            metadata_json = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(await encryptToken(nextToken, env), expiresAt, now, JSON.stringify(metadata), now, tokenId).run();

  await writeAudit(env, {
    tokenId,
    event: 'tokens.refresh',
    provider: existing.provider,
    unit: existing.unit,
    tokenType: existing.token_type,
    status: 'ok',
    requestId,
    metadata: { expires_at: expiresAt },
  });
  return json({
    ok: true,
    item: {
      token_id: tokenId,
      provider: existing.provider,
      unit: existing.unit,
      external_account_id: existing.external_account_id,
      expires_at: expiresAt,
      last_refreshed_at: now,
    },
    requestId,
  });
}

async function patchToken(id, request, env, requestId) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload', requestId }, { status: 400 });
  }

  const token = safeString(body.token || body.access_token);
  if (!token) {
    return json({ ok: false, error: 'token_required', requestId }, { status: 400 });
  }

  const existing = await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, metadata_json
       FROM credential_tokens
      WHERE id = ?`,
  ).bind(id).first();

  if (!existing) {
    await writeAudit(env, {
      tokenId: id,
      event: 'tokens.patch',
      status: 'not_found',
      requestId,
    });
    return json({ ok: false, error: 'token_not_found', requestId }, { status: 404 });
  }

  const encrypted = await encryptToken(token, env);
  const now = new Date().toISOString();
  const expiresAt = normalizeNullableString(body.expires_at || body.expiresAt);
  const incomingMetadata = isObject(body.metadata) ? body.metadata : {};
  const previousMetadata = parseJsonObject(existing.metadata_json);
  const metadata = {
    ...previousMetadata,
    ...incomingMetadata,
    last_refresh_source: safeString(body.source) || 'n8n-token-manager',
  };

  await env.TOKEN_VAULT_DB.prepare(
    `UPDATE credential_tokens
        SET token_ciphertext = ?,
            expires_at = COALESCE(?, expires_at),
            last_refreshed_at = ?,
            metadata_json = ?,
            updated_at = ?
      WHERE id = ?`,
  ).bind(encrypted, expiresAt, now, JSON.stringify(metadata), now, id).run();

  await writeAudit(env, {
    tokenId: id,
    event: 'tokens.patch',
    provider: existing.provider,
    unit: existing.unit,
    tokenType: existing.token_type,
    status: 'ok',
    requestId,
    metadata: {
      external_account_id: existing.external_account_id,
      expires_at: expiresAt,
      token_length: token.length,
    },
  });

  return json({
    ok: true,
    item: {
      id,
      provider: existing.provider,
      unit: existing.unit,
      external_account_id: existing.external_account_id,
      token_type: existing.token_type,
      last_refreshed_at: now,
    },
    requestId,
  });
}

async function createToken(request, env, requestId) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload', requestId }, { status: 400 });
  }

  const provider = safeString(body.provider).toLowerCase();
  if (!PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'invalid_provider', requestId }, { status: 400 });
  }

  const externalAccountId = safeString(body.external_account_id || body.externalAccountId);
  const token = safeString(body.token || body.access_token);
  if (!externalAccountId) {
    return json({ ok: false, error: 'external_account_id_required', requestId }, { status: 400 });
  }
  if (!token) {
    return json({ ok: false, error: 'token_required', requestId }, { status: 400 });
  }

  const id = safeString(body.id) || `${provider}_${externalAccountId}`;
  const tokenType = safeString(body.token_type || body.tokenType) || 'long_lived_access_token';
  const unit = normalizeNullableString(body.unit);
  const metadata = isObject(body.metadata) ? body.metadata : {};
  const now = new Date().toISOString();
  const encrypted = await encryptToken(token, env);

  await env.TOKEN_VAULT_DB.prepare(
    `INSERT INTO credential_tokens (
      id, provider, unit, external_account_id, token_type, token_ciphertext,
      expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_account_id, token_type) DO UPDATE SET
      unit = excluded.unit,
      token_ciphertext = excluded.token_ciphertext,
      expires_at = excluded.expires_at,
      active = excluded.active,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`,
  ).bind(
    id,
    provider,
    unit,
    externalAccountId,
    tokenType,
    encrypted,
    normalizeNullableString(body.expires_at || body.expiresAt),
    normalizeNullableString(body.last_refreshed_at || body.lastRefreshedAt),
    body.active === false ? 0 : 1,
    JSON.stringify(metadata),
    now,
    now,
  ).run();

  await writeAudit(env, {
    tokenId: id,
    event: 'tokens.create',
    provider,
    unit,
    tokenType,
    status: 'ok',
    requestId,
    metadata: {
      external_account_id: externalAccountId,
      token_length: token.length,
      imported: Boolean(body.imported),
    },
  });

  return json({
    ok: true,
    item: {
      id,
      provider,
      unit,
      external_account_id: externalAccountId,
      token_type: tokenType,
    },
    requestId,
  }, { status: 201 });
}

async function serializeToken(row, env) {
  const token = await decryptToken(row.token_ciphertext, env);
  const metadata = parseJsonObject(row.metadata_json);
  const base = {
    id: row.id,
    provider: row.provider,
    unit: row.unit,
    external_account_id: row.external_account_id,
    token_type: row.token_type,
    token,
    expires_at: row.expires_at,
    last_refreshed_at: row.last_refreshed_at,
    active: Boolean(row.active),
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (row.provider === 'threads') {
    base.thId = row.external_account_id;
    base.thToken = token;
  }
  if (row.provider === 'instagram') {
    base.igId = row.external_account_id;
    base.igToken = token;
  }
  if (row.provider === 'facebook') {
    base.fbId = row.external_account_id;
    base.fbToken = token;
  }

  return base;
}

function authorizeRequest(request, env) {
  if (safeString(env.REQUIRE_AUTH || 'true') !== 'true') return { ok: true };

  const adminToken = safeString(env.TOKEN_VAULT_API_TOKEN);
  const operationalToken = safeString(env.TOKEN_VAULT_N8N_API_TOKEN);
  if (!adminToken && !operationalToken) return { ok: false, status: 500, reason: 'missing_worker_secret' };

  const headerName = safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization') || 'Authorization';
  const scheme = safeString(env.WORKER_AUTH_SCHEME || 'Bearer') || 'Bearer';
  const authHeader = safeString(request.headers.get(headerName));
  if (!authHeader) return { ok: false, status: 401, reason: 'missing_auth_header' };

  if (adminToken && constantTimeEqual(authHeader, `${scheme} ${adminToken}`.trim())) {
    return { ok: true, role: 'admin' };
  }
  if (operationalToken && constantTimeEqual(authHeader, `${scheme} ${operationalToken}`.trim())) {
    return { ok: true, role: 'operational' };
  }
  return { ok: false, status: 401, reason: 'invalid_auth_header' };
}

async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const key = await getEncryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `v1:${base64Encode(iv)}:${base64Encode(new Uint8Array(ciphertext))}`;
}

async function decryptToken(value, env) {
  const parts = safeString(value).split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('unsupported_ciphertext');
  }
  const iv = base64Decode(parts[1]);
  const ciphertext = base64Decode(parts[2]);
  const key = await getEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function getEncryptionKey(env) {
  const secret = safeString(env.TOKEN_VAULT_ENCRYPTION_KEY);
  if (secret.length < 32) throw new Error('TOKEN_VAULT_ENCRYPTION_KEY must be configured');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function writeAudit(env, input) {
  if (!env.TOKEN_VAULT_DB) return;
  await env.TOKEN_VAULT_DB.prepare(
    `INSERT INTO credential_token_audit (
      id, token_id, event, provider, unit, token_type, status, request_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    normalizeNullableString(input.tokenId),
    safeString(input.event),
    normalizeNullableString(input.provider),
    normalizeNullableString(input.unit),
    normalizeNullableString(input.tokenType),
    safeString(input.status || 'ok'),
    normalizeNullableString(input.requestId),
    JSON.stringify(input.metadata || {}),
  ).run();
}

function contract(requestId) {
  return json({
    ok: true,
    service: 'skincos-token-vault',
    endpoints: {
      health: 'GET /internal/token-vault/health',
      tokenMetadata: 'GET /internal/token-vault/v1/token-metadata?provider=threads|instagram|facebook&active=true',
      tokenRefresh: 'POST /internal/token-vault/v1/token-maintenance/refresh',
      socialPublish: 'POST /internal/token-vault/v1/social-publish/operations',
      listTokens: 'GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true',
      createToken: 'POST /internal/token-vault/v1/tokens',
      updateToken: 'PATCH /internal/token-vault/v1/tokens/:id',
      metaAdsPublishConfig: 'GET /internal/token-vault/v1/meta-ads-publish/config',
      metaAdsPublishInventory: 'POST /internal/token-vault/v1/meta-ads-publish/inventory',
      metaAdsPublishRuns: 'POST /internal/token-vault/v1/meta-ads-publish/runs',
      metaAdsPublishRun: 'GET|PATCH /internal/token-vault/v1/meta-ads-publish/runs/:id',
      metaAdsPublishHeartbeat: 'POST /internal/token-vault/v1/meta-ads-publish/runs/:id/heartbeat',
      metaAdsPublishOperations: 'POST /internal/token-vault/v1/meta-ads-publish/runs/:id/operations',
      metaAdsPublishEvents: 'POST /internal/token-vault/v1/meta-ads-publish/runs/:id/events',
    },
    auth: {
      header: 'Authorization',
      scheme: 'Bearer',
      admin_secret: 'TOKEN_VAULT_API_TOKEN',
      operational_secret: 'TOKEN_VAULT_N8N_API_TOKEN',
    },
    storage: {
      d1_binding: 'TOKEN_VAULT_DB',
      encryption_secret: 'TOKEN_VAULT_ENCRYPTION_KEY',
    },
    requestId,
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function safeString(value) {
  return String(value ?? '').trim();
}

function normalizeNullableString(value) {
  const normalized = safeString(value);
  return normalized || null;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function constantTimeEqual(a, b) {
  const left = safeString(a);
  const right = safeString(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function base64Encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/token|secret|cipher|auth/i.test(message)) return 'secure_operation_failed';
  return message;
}
