import { readBoundedText } from './bounded-body.js';

const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_MAX_LENGTH = 4096;
const CREDENTIAL_REF_MAX_LENGTH = 160;
const ACCOUNT_ID_MAX_LENGTH = 40;
const ANALYTICS_SCOPE = 'influencer-intelligence';
const BOOTSTRAP_EVENT = 'analytics.staging_bootstrap';
const BOOTSTRAP_UNIT = 'influencer-intelligence-shadow';
const BOOTSTRAP_CONTRACT = 'influencer-intelligence/staging-bootstrap/v1';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

class StagingBootstrapError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'StagingBootstrapError';
    this.code = code;
    this.status = status;
  }
}

function safeString(value) {
  return String(value ?? '').trim();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function bootstrapEnabled(env) {
  return safeString(env.ENVIRONMENT).toLowerCase() === 'staging'
    && safeString(env.INFLUENCER_INTELLIGENCE_ANALYTICS_MODE).toLowerCase() === 'shadow'
    && safeString(env.INFLUENCER_INTELLIGENCE_ENABLED).toLowerCase() === 'false';
}

function opaque(value, maximum) {
  if (typeof value !== 'string') throw new StagingBootstrapError('invalid_request', 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new StagingBootstrapError('invalid_request', 400);
  }
  return normalized;
}

async function readInput(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isInteger(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new StagingBootstrapError('request_too_large', 413);
  }
  const text = request.body
    ? await readBoundedText(request.body, MAX_BODY_BYTES, () => new StagingBootstrapError('request_too_large', 413))
    : await request.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new StagingBootstrapError('invalid_payload', 400);
  }
  if (!isRecord(body)) throw new StagingBootstrapError('invalid_payload', 400);
  const allowed = new Set(['access_token', 'credential_ref', 'instagram_business_account_id']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new StagingBootstrapError('invalid_request', 400);
  }

  const accessToken = opaque(body.access_token, TOKEN_MAX_LENGTH);
  if (accessToken.length < 20 || /\s/.test(accessToken)) {
    throw new StagingBootstrapError('invalid_request', 400);
  }
  const credentialRef = opaque(body.credential_ref, CREDENTIAL_REF_MAX_LENGTH);
  if (!/^[A-Za-z0-9._:-]+$/.test(credentialRef)) {
    throw new StagingBootstrapError('invalid_request', 400);
  }
  const accountId = opaque(body.instagram_business_account_id, ACCOUNT_ID_MAX_LENGTH);
  if (!/^\d{1,40}$/.test(accountId)) {
    throw new StagingBootstrapError('invalid_request', 400);
  }
  return Object.freeze({ accessToken, credentialRef, accountId });
}

async function findExistingInstagramCredential(env) {
  if (!env.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.prepare !== 'function') {
    throw new StagingBootstrapError('bootstrap_unavailable', 503);
  }
  try {
    return await env.TOKEN_VAULT_DB.prepare(
      'SELECT id FROM credential_tokens WHERE provider = ? LIMIT 1',
    ).bind('instagram').first();
  } catch {
    throw new StagingBootstrapError('bootstrap_unavailable', 503);
  }
}

async function writeFailureAudit(writeAudit, env, requestId, status, metadata = {}) {
  if (typeof writeAudit !== 'function') throw new StagingBootstrapError('bootstrap_unavailable', 503);
  await writeAudit(env, {
    tokenId: null,
    event: BOOTSTRAP_EVENT,
    provider: 'instagram',
    unit: BOOTSTRAP_UNIT,
    tokenType: 'long_lived_access_token',
    status,
    requestId,
    metadata: {
      scope: ANALYTICS_SCOPE,
      contract: BOOTSTRAP_CONTRACT,
      environment: 'staging',
      mode: 'shadow',
      ...metadata,
    },
  });
}

function responseStatus(code) {
  if (code === 'request_too_large') return 413;
  if (code === 'invalid_payload' || code === 'invalid_request') return 400;
  if (code === 'bootstrap_already_sealed' || code === 'bootstrap_existing_credential') return 409;
  if (code === 'bootstrap_disabled' || code === 'bootstrap_unavailable') return 503;
  return 500;
}

/**
 * One-time staging bridge used only to seal an approved Meta token into the
 * existing encrypted Token Vault. It does not call Meta, expose stored values,
 * refresh a token, or update/replace a credential.
 */
export async function handleAnalyticsStagingBootstrapRequest({
  request,
  env,
  requestId,
  encryptToken,
  prepareAuditStatement,
  writeAudit,
}) {
  let input;
  try {
    if (!bootstrapEnabled(env)) throw new StagingBootstrapError('bootstrap_disabled', 503);
    input = await readInput(request);
    const existing = await findExistingInstagramCredential(env);
    if (existing) {
      const code = safeString(existing.id) === input.credentialRef
        ? 'bootstrap_already_sealed'
        : 'bootstrap_existing_credential';
      await writeFailureAudit(writeAudit, env, requestId, code, {
        credential_ref_state: code === 'bootstrap_already_sealed' ? 'already_sealed' : 'other_instagram_credential_present',
      });
      return responseJson({ ok: false, error: code, requestId }, responseStatus(code));
    }
    if (typeof encryptToken !== 'function' || typeof prepareAuditStatement !== 'function'
      || typeof env.TOKEN_VAULT_DB.batch !== 'function') {
      throw new StagingBootstrapError('bootstrap_unavailable', 503);
    }

    const now = new Date().toISOString();
    const ciphertext = await encryptToken(input.accessToken, env);
    const metadata = {
      analytics_scopes: [ANALYTICS_SCOPE],
      credential_purpose: BOOTSTRAP_UNIT,
      bootstrap_contract: BOOTSTRAP_CONTRACT,
    };
    const insert = env.TOKEN_VAULT_DB.prepare(
      `INSERT INTO credential_tokens (
        id, provider, unit, external_account_id, token_type, token_ciphertext,
        expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.credentialRef,
      'instagram',
      BOOTSTRAP_UNIT,
      input.accountId,
      'long_lived_access_token',
      ciphertext,
      null,
      now,
      1,
      JSON.stringify(metadata),
      now,
      now,
    );
    const audit = prepareAuditStatement(env, {
      tokenId: input.credentialRef,
      event: BOOTSTRAP_EVENT,
      provider: 'instagram',
      unit: BOOTSTRAP_UNIT,
      tokenType: 'long_lived_access_token',
      status: 'ok',
      requestId,
      metadata: {
        scope: ANALYTICS_SCOPE,
        contract: BOOTSTRAP_CONTRACT,
        environment: 'staging',
        mode: 'shadow',
        credential_ref_state: 'sealed',
      },
    });
    const results = await env.TOKEN_VAULT_DB.batch([insert, audit]);
    if (!Array.isArray(results) || results.some((result) => result?.success !== true)) {
      throw new StagingBootstrapError('bootstrap_unavailable', 503);
    }

    return responseJson({
      ok: true,
      bootstrap: 'sealed',
      contract_version: BOOTSTRAP_CONTRACT,
      provider: 'meta-graph',
      requestId,
    }, 201);
  } catch (error) {
    const code = error instanceof StagingBootstrapError ? error.code : 'bootstrap_unavailable';
    try {
      await writeFailureAudit(writeAudit, env, requestId, code, {
        ...(input ? { credential_ref_state: 'not_sealed' } : {}),
      });
    } catch {
      return responseJson({ ok: false, error: 'internal_error', requestId }, 500);
    }
    return responseJson({ ok: false, error: code, requestId }, responseStatus(code));
  }
}
