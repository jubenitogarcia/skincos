import {
  handleMetaAdsPublishRequest,
  isMetaAdsPublishPath,
  updateMetaAdsPublishConfig,
} from './meta-ads-publish.js';
import { handleSocialPublishOperation } from './social-publish.js';
import { handleAnalyticsReadonlyRequest } from './analytics-readonly.js';
import { handleAnalyticsStagingBootstrapRequest } from './analytics-staging-bootstrap.js';
import { decryptToken, encryptToken } from './token-crypto.js';

const TOKEN_PREFIX = '/internal/token-vault';
const META_ADS_PUBLISH_CONFIG_PATH = '/v1/meta-ads-publish/config';
const META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH = `${META_ADS_PUBLISH_CONFIG_PATH}/bootstrap`;
const META_ADS_PUBLISH_CONFIG_BOOTSTRAP_ROLLBACK_PATH = `${META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH}/rollback`;
const META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PLAN_PATH = `${META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH}/derive-plan`;
const META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PATH = `${META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH}/derive`;
const META_ADS_PUBLISH_CONFIG_STAGING_EXERCISE_PATH = `${META_ADS_PUBLISH_CONFIG_PATH}/staging-exercise`;
const META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH = `${META_ADS_PUBLISH_CONFIG_PATH}/staging-synthetic-seed`;
const META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_PATH = `${META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH}/attest`;
const META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_APPSECRET_PROOF_PATH = `${META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH}/attest-appsecret-proof`;
const META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_RECONCILE_PATH = `${META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH}/reconcile`;
const META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ROLLBACK_PATH = `${META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH}/rollback`;
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

    if (auth.role === 'staging-bootstrap') {
      if (request.method !== 'POST' || pathname !== '/v1/analytics/staging-bootstrap') {
        return json({ ok: false, error: 'bootstrap_endpoint_required', requestId }, { status: 403 });
      }
      return await handleAnalyticsStagingBootstrapRequest({
        request,
        env,
        requestId,
        encryptToken,
        prepareAuditStatement,
        writeAudit,
      });
    }

    if (request.method === 'POST' && pathname === '/v1/analytics/staging-bootstrap') {
      return json({ ok: false, error: 'staging_bootstrap_credential_required', requestId }, { status: 403 });
    }

    // This one-shot credential is even narrower than the Meta Ads config
    // credential: it can only construct or compensate the isolated staging
    // synthetic lineage. Keep it outside every general publishing role.
    if (auth.role === 'meta-ads-staging-seed') {
      if (
        request.method !== 'POST' || ![
          META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_PATH,
          META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_APPSECRET_PROOF_PATH,
          META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_RECONCILE_PATH,
          META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH,
          META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ROLLBACK_PATH,
        ].includes(pathname)
      ) {
        return roleRequired(requestId, 'meta_ads_staging_seed_credential_scope_required');
      }
      return await handleMetaAdsPublishRequest({
        request,
        env,
        requestId,
        pathname,
        decryptToken,
        encryptToken,
        writeAudit,
      });
    }

    // Intercept these paths before the generic Meta Ads gateway. The seed is
    // not an administrative escape hatch: only its dedicated staging bearer
    // can call these routes, and only with POST.
    if ([
      META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_PATH,
      META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ATTEST_APPSECRET_PROOF_PATH,
      META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_RECONCILE_PATH,
      META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_PATH,
      META_ADS_PUBLISH_CONFIG_STAGING_SYNTHETIC_SEED_ROLLBACK_PATH,
    ].includes(pathname)) {
      return roleRequired(requestId, 'meta_ads_staging_seed_credential_required');
    }

    // This credential is deliberately isolated from the generic Meta Ads
    // gateway. It can inspect the public contract and configuration, and its
    // one future mutation is a dedicated bootstrap route handled by the
    // Meta Ads module itself. Do not add it to the operational role allowlist.
    if (auth.role === 'meta-ads-config') {
      if (request.method === 'GET' && pathname === '/health') {
        return health(env, requestId);
      }
      if (request.method === 'GET' && pathname === '/contract') {
        return contract(requestId);
      }
      if (
        (request.method === 'GET' && pathname === META_ADS_PUBLISH_CONFIG_PATH) ||
        (request.method === 'POST' && [
          META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH,
          META_ADS_PUBLISH_CONFIG_BOOTSTRAP_ROLLBACK_PATH,
          META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PLAN_PATH,
          META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PATH,
          META_ADS_PUBLISH_CONFIG_STAGING_EXERCISE_PATH,
        ].includes(pathname))
      ) {
        return await handleMetaAdsPublishRequest({
          request,
          env,
          requestId,
          pathname,
          decryptToken,
          encryptToken,
          writeAudit,
        });
      }
      return roleRequired(requestId, 'meta_ads_config_credential_scope_required');
    }

    if (request.method === 'GET' && pathname === '/health') {
      return health(env, requestId);
    }

    if (request.method === 'PUT' && pathname === META_ADS_PUBLISH_CONFIG_PATH) {
      if (auth.role !== 'admin') return adminOnly(requestId);
      return await updateMetaAdsPublishConfig({
        request,
        env,
        requestId,
      });
    }

    // Bootstrap and staging exercise can mutate a Graph ad set and private
    // configuration.  They are intentionally not part of the broad
    // operational publishing gateway: only an administrator or the dedicated
    // constrained configuration credential may invoke them.
    if (
      request.method === 'POST' &&
      [
        META_ADS_PUBLISH_CONFIG_BOOTSTRAP_PATH,
        META_ADS_PUBLISH_CONFIG_BOOTSTRAP_ROLLBACK_PATH,
        META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PLAN_PATH,
        META_ADS_PUBLISH_CONFIG_BOOTSTRAP_DERIVE_PATH,
        META_ADS_PUBLISH_CONFIG_STAGING_EXERCISE_PATH,
      ].includes(pathname)
    ) {
      if (auth.role !== 'admin') {
        return roleRequired(requestId, 'meta_ads_config_credential_required');
      }
      return await handleMetaAdsPublishRequest({
        request,
        env,
        requestId,
        pathname,
        decryptToken,
        encryptToken,
        writeAudit,
      });
    }

    if (isMetaAdsPublishPath(pathname)) {
      if (!['admin', 'operational'].includes(auth.role)) {
        return roleRequired(requestId, 'write_gateway_credential_required');
      }
      return await handleMetaAdsPublishRequest({
        request,
        env,
        requestId,
        pathname,
        decryptToken,
        encryptToken,
        writeAudit,
      });
    }

    if (request.method === 'POST' && pathname === '/v1/social-publish/operations') {
      if (!['admin', 'operational'].includes(auth.role)) {
        return roleRequired(requestId, 'write_gateway_credential_required');
      }
      return handleSocialPublishOperation({ request, env, requestId, decryptToken, writeAudit });
    }

    if (request.method === 'POST' && pathname === '/v1/analytics/operations') {
      if (auth.role !== 'admin' && auth.role !== 'analytics') {
        return json({ ok: false, error: 'analytics_credential_required', requestId }, { status: 403 });
      }
      const mode = analyticsMode(env);
      if (mode === 'invalid') {
        return json({ ok: false, error: 'invalid_analytics_mode', requestId }, { status: 500 });
      }
      if (mode === 'off' || (mode === 'active' && safeString(env.INFLUENCER_INTELLIGENCE_ENABLED).toLowerCase() !== 'true')) {
        return json({ ok: false, error: 'analytics_disabled', requestId }, { status: 503 });
      }
      return handleAnalyticsReadonlyRequest({ request, env, requestId, decryptToken, writeAudit });
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

function roleRequired(requestId, error) {
  return json({ ok: false, error, requestId }, { status: 403 });
}

function normalizePath(pathname) {
  if (pathname === TOKEN_PREFIX) return '/';
  if (pathname.startsWith(`${TOKEN_PREFIX}/`)) return pathname.slice(TOKEN_PREFIX.length);
  return pathname;
}

async function health(env, requestId) {
  const mode = analyticsMode(env);
  const checks = {
    d1: Boolean(env.TOKEN_VAULT_DB),
    apiToken: Boolean(safeString(env.TOKEN_VAULT_API_TOKEN)),
    n8nApiToken: Boolean(safeString(env.TOKEN_VAULT_N8N_API_TOKEN)),
    analyticsApiToken: Boolean(safeString(env.TOKEN_VAULT_ANALYTICS_API_TOKEN)),
    encryptionKey: Boolean(safeString(env.TOKEN_VAULT_ENCRYPTION_KEY)),
    analyticsMode: mode !== 'invalid',
  };

  if (checks.d1) {
    await env.TOKEN_VAULT_DB.prepare('SELECT 1 AS ok').first();
  }

  const ok = checks.d1 && checks.apiToken && checks.n8nApiToken && checks.analyticsApiToken && checks.encryptionKey && checks.analyticsMode;
  return json({
    ok,
    service: 'skincos-token-vault',
    environment: safeString(env.ENVIRONMENT) || 'unknown',
    analytics_mode: mode,
    analytics_ready: checks.analyticsApiToken && mode !== 'off' && mode !== 'invalid',
    checks,
    requestId,
  }, { status: ok ? 200 : 500 });
}

function analyticsMode(env) {
  const mode = safeString(env.INFLUENCER_INTELLIGENCE_ANALYTICS_MODE ?? 'off').toLowerCase();
  return ['off', 'shadow', 'active'].includes(mode) ? mode : 'invalid';
}

function stagingBootstrapEligible(env) {
  return safeString(env.ENVIRONMENT).toLowerCase() === 'staging'
    && analyticsMode(env) === 'shadow'
    && safeString(env.INFLUENCER_INTELLIGENCE_ENABLED).toLowerCase() === 'false';
}

function stagingMetaAdsSeedEligible(env) {
  return safeString(env.ENVIRONMENT).toLowerCase() === 'staging';
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

async function patchToken(id, request, env, requestId) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload', requestId }, { status: 400 });
  }
  if (hasMetaAdsPublishConfig(body.metadata)) {
    return json({ ok: false, error: 'meta_ads_publish_config_writer_required', requestId }, { status: 409 });
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
  if (hasMetaAdsPublishConfig(body.metadata)) {
    return json({ ok: false, error: 'meta_ads_publish_config_writer_required', requestId }, { status: 409 });
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
  // POST is an upsert with whole-metadata replacement semantics. Never allow
  // it to silently erase a governed tracking subtree on an existing
  // credential; the narrow config writer is the only authority for that path.
  const existing = await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, metadata_json
       FROM credential_tokens
      WHERE provider = ? AND external_account_id = ? AND token_type = ?`,
  ).bind(provider, externalAccountId, tokenType).first();
  if (existing && hasMetaAdsPublishConfig(parseJsonObject(existing.metadata_json))) {
    return json({ ok: false, error: 'meta_ads_publish_config_writer_required', requestId }, { status: 409 });
  }
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
  const requireAuth = safeString(env.REQUIRE_AUTH ?? 'true').toLowerCase();
  if (requireAuth !== 'true') {
    return { ok: false, status: 500, reason: 'invalid_auth_configuration' };
  }

  const adminToken = safeString(env.TOKEN_VAULT_API_TOKEN);
  const operationalToken = safeString(env.TOKEN_VAULT_N8N_API_TOKEN);
  const analyticsToken = safeString(env.TOKEN_VAULT_ANALYTICS_API_TOKEN);
  const metaAdsConfigToken = safeString(env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN);
  const stagingBootstrapToken = safeString(env.TOKEN_VAULT_STAGING_ANALYTICS_BOOTSTRAP_TOKEN);
  const stagingMetaAdsSeedToken = safeString(env.TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN);
  if (stagingBootstrapToken && !stagingBootstrapEligible(env)) {
    return { ok: false, status: 500, reason: 'invalid_worker_secret_configuration' };
  }
  if (stagingMetaAdsSeedToken && !stagingMetaAdsSeedEligible(env)) {
    return { ok: false, status: 500, reason: 'invalid_worker_secret_configuration' };
  }
  if (!adminToken && !operationalToken && !analyticsToken && !metaAdsConfigToken && !stagingBootstrapToken && !stagingMetaAdsSeedToken) {
    return { ok: false, status: 500, reason: 'missing_worker_secret' };
  }
  const configuredTokens = [
    adminToken,
    operationalToken,
    analyticsToken,
    metaAdsConfigToken,
    stagingBootstrapToken,
    stagingMetaAdsSeedToken,
  ].filter(Boolean);
  if (new Set(configuredTokens).size !== configuredTokens.length) {
    return { ok: false, status: 500, reason: 'invalid_worker_secret_configuration' };
  }

  const headerName = safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization') || 'Authorization';
  const scheme = safeString(env.WORKER_AUTH_SCHEME || 'Bearer') || 'Bearer';
  const authHeader = safeString(request.headers.get(headerName));
  if (!authHeader) return { ok: false, status: 401, reason: 'missing_auth_header' };

  if (adminToken && constantTimeEqual(authHeader, `${scheme} ${adminToken}`.trim())) {
    return { ok: true, role: 'admin' };
  }
  if (analyticsToken && constantTimeEqual(authHeader, `${scheme} ${analyticsToken}`.trim())) {
    return { ok: true, role: 'analytics' };
  }
  if (metaAdsConfigToken && constantTimeEqual(authHeader, `${scheme} ${metaAdsConfigToken}`.trim())) {
    return { ok: true, role: 'meta-ads-config' };
  }
  if (stagingBootstrapToken && constantTimeEqual(authHeader, `${scheme} ${stagingBootstrapToken}`.trim())) {
    return { ok: true, role: 'staging-bootstrap' };
  }
  if (stagingMetaAdsSeedToken && constantTimeEqual(authHeader, `${scheme} ${stagingMetaAdsSeedToken}`.trim())) {
    return { ok: true, role: 'meta-ads-staging-seed' };
  }
  if (operationalToken && constantTimeEqual(authHeader, `${scheme} ${operationalToken}`.trim())) {
    return { ok: true, role: 'operational' };
  }
  return { ok: false, status: 401, reason: 'invalid_auth_header' };
}

async function writeAudit(env, input) {
  if (!env.TOKEN_VAULT_DB) return;
  await prepareAuditStatement(env, input).run();
}

function prepareAuditStatement(env, input) {
  return env.TOKEN_VAULT_DB.prepare(
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
  );
}

function contract(requestId) {
  return json({
    ok: true,
    service: 'skincos-token-vault',
    endpoints: {
      health: 'GET /internal/token-vault/health',
      listTokens: 'GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true',
      createToken: 'POST /internal/token-vault/v1/tokens',
      updateToken: 'PATCH /internal/token-vault/v1/tokens/:id',
      updateMetaAdsPublishConfig: 'PUT /internal/token-vault/v1/meta-ads-publish/config',
      analyticsOperation: 'POST /internal/token-vault/v1/analytics/operations',
    },
    auth: {
      header: 'Authorization',
      scheme: 'Bearer',
      secret: 'TOKEN_VAULT_API_TOKEN',
      operational_secret: 'TOKEN_VAULT_N8N_API_TOKEN',
      analytics_secret: 'TOKEN_VAULT_ANALYTICS_API_TOKEN',
      analytics_scope: 'influencer-intelligence',
      analytics_mode: 'shadow|active',
      meta_ads_config_secret: 'TOKEN_VAULT_META_ADS_CONFIG_TOKEN',
      meta_ads_config_scope: 'health|contract|meta-ads-config-read|meta-ads-config-bootstrap|meta-ads-config-bootstrap-rollback|meta-ads-config-bootstrap-derive-plan|meta-ads-config-bootstrap-derive|meta-ads-config-staging-exercise',
      meta_ads_staging_seed_secret: 'TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN',
      meta_ads_staging_seed_scope: 'meta-ads-config-staging-synthetic-seed-attest|meta-ads-config-staging-synthetic-seed-attest-appsecret-proof|meta-ads-config-staging-synthetic-seed-reconcile|meta-ads-config-staging-synthetic-seed|meta-ads-config-staging-synthetic-seed-rollback',
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

function hasMetaAdsPublishConfig(value) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, 'meta_ads_publish');
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

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/token|secret|cipher|auth/i.test(message)) return 'secure_operation_failed';
  return message;
}
