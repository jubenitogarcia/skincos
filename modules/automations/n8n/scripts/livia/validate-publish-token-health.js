#!/usr/bin/env node

'use strict';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function activeItems(payload) {
  const root = asObject(payload);
  const candidates = [root.items, root.raw?.items, root.tokenVaultContext?.raw?.items];
  return candidates.find(Array.isArray) || [];
}

function endpointFor(item) {
  const provider = String(item.provider || '').toLowerCase();
  const accountId = String(item.external_account_id || item.igId || item.thId || item.fbId || '');
  const token = String(item.token || item.igToken || item.thToken || item.fbToken || '');
  if (!provider || !accountId || !token) return null;
  if (provider === 'instagram') {
    return `https://graph.instagram.com/v25.0/${encodeURIComponent(accountId)}/media?limit=1&fields=id&access_token=${encodeURIComponent(token)}`;
  }
  if (provider === 'threads') {
    return `https://graph.threads.net/v1.0/me?fields=id&access_token=${encodeURIComponent(token)}`;
  }
  if (provider === 'facebook' && !asObject(item.metadata).purpose) {
    return `https://graph.facebook.com/v25.0/${encodeURIComponent(accountId)}?fields=id&access_token=${encodeURIComponent(token)}`;
  }
  return null;
}

async function check(item) {
  const url = endpointFor(item);
  if (!url) return null;
  const provider = String(item.provider || '').toLowerCase();
  const unit = String(item.unit || 'unknown').toLowerCase();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    let body = {};
    try { body = await response.json(); } catch {}
    return {
      provider,
      unit,
      accountId: String(item.external_account_id || item.igId || item.thId || item.fbId || ''),
      ok: response.ok,
      status: response.status,
      error: body?.error ? {
        message: String(body.error.message || ''),
        code: body.error.code ?? null,
        type: String(body.error.type || ''),
      } : null,
    };
  } catch (error) {
    return { provider, unit, accountId: String(item.external_account_id || ''), ok: false, status: 0, error: { message: error.message, code: null, type: error.name } };
  }
}

function gatewayTarget(item) {
  const provider = String(item.provider || '').toLowerCase();
  const accountId = String(item.external_account_id || item.igId || item.thId || item.fbId || '');
  if (provider === 'facebook' && asObject(item.metadata).purpose) return null;
  if (!provider || !accountId || !process.env.TOKEN_VAULT_N8N_API_TOKEN) return null;
  const host = provider === 'instagram' ? 'graph.instagram.com' : provider === 'threads' ? 'graph.threads.net' : 'graph.facebook.com';
  const version = provider === 'threads' ? 'v1.0' : 'v25.0';
  return { provider, unit: String(item.unit || 'unknown').toLowerCase(), url: `https://${host}/${version}/${encodeURIComponent(accountId)}`, fields: 'id' };
}

async function checkThroughGateway(item) {
  const target = gatewayTarget(item);
  if (!target) return null;
  try {
    const response = await fetch(`${String(process.env.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault').replace(/\/+$/, '')}/v1/social-publish/operations`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.TOKEN_VAULT_N8N_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ platform: target.provider, unit: target.unit, operation: 'verify_published_artifact', method: 'GET', url: target.url, query: { fields: target.fields } }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    return { provider: target.provider, unit: target.unit, accountId: String(item.external_account_id || ''), ok: response.ok, status: response.status, error: body?.error || null };
  } catch (error) {
    return { provider: target.provider, unit: target.unit, accountId: String(item.external_account_id || ''), ok: false, status: 0, error: { message: error.message } };
  }
}

async function main() {
  const raw = argument('--payload');
  if (!raw) throw new Error('validate-publish-token-health requires --payload JSON.');
  const items = activeItems(JSON.parse(raw)).filter((item) => item && item.active !== false);
  const checks = (await Promise.all(items.map(async (item) => (await check(item)) || (await checkThroughGateway(item))))).filter(Boolean);
  const expected = ['instagram', 'threads', 'facebook'];
  const missing = expected.filter((provider) => !checks.some((entry) => entry.provider === provider));
  const failures = checks.filter((entry) => !entry.ok);
  if (missing.length || failures.length) {
    const detail = failures.map((entry) => `${entry.provider}/${entry.unit}:status=${entry.status}:code=${entry.error?.code ?? 'n/a'}`).join(', ');
    throw new Error(`Livia publish credential preflight failed (missing=${missing.join('|') || 'none'}; failures=${detail || 'none'}).`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), checks })}\n`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
