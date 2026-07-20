#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { checkWithGatewayFallback } = require('./validate-publish-token-health');

const originalFetch = global.fetch;
const originalToken = process.env.TOKEN_VAULT_N8N_API_TOKEN;
const originalBase = process.env.TOKEN_VAULT_BASE_URL;
process.env.TOKEN_VAULT_N8N_API_TOKEN = 'test-only';
process.env.TOKEN_VAULT_BASE_URL = 'https://vault.test';

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const item = { provider: 'instagram', unit: 'test', external_account_id: 'account', token: 'token' };

async function run() {
  global.fetch = async (url) => {
    if (String(url).startsWith('https://graph.instagram.com')) throw new TypeError('egress unavailable');
    return response(200);
  };
  const gatewayRecovery = await checkWithGatewayFallback(item);
  assert.equal(gatewayRecovery.ok, true);
  assert.equal(gatewayRecovery.validationPath, 'token_vault_gateway');
  assert.equal(gatewayRecovery.directFailure.status, 0);

  global.fetch = async (url) => {
    if (String(url).startsWith('https://graph.instagram.com')) return response(401, { error: { code: 190 } });
    return response(502, { error: { code: 'upstream_unavailable' } });
  };
  const dualFailure = await checkWithGatewayFallback(item);
  assert.equal(dualFailure.ok, false);
  assert.equal(dualFailure.status, 502);
  assert.equal(dualFailure.directFailure.status, 401);

  let calls = 0;
  global.fetch = async () => { calls += 1; return response(200); };
  const directSuccess = await checkWithGatewayFallback(item);
  assert.equal(directSuccess.ok, true);
  assert.equal(directSuccess.validationPath, 'direct_graph');
  assert.equal(calls, 1);

  global.fetch = async () => response(200);
  const metadataOnly = await checkWithGatewayFallback({ ...item, token: '' });
  assert.equal(metadataOnly.ok, true);
  assert.equal(metadataOnly.validationPath, 'token_vault_gateway');

  console.log('Token health preflight: all fallback cases passed');
}

run().finally(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.TOKEN_VAULT_N8N_API_TOKEN;
  else process.env.TOKEN_VAULT_N8N_API_TOKEN = originalToken;
  if (originalBase === undefined) delete process.env.TOKEN_VAULT_BASE_URL;
  else process.env.TOKEN_VAULT_BASE_URL = originalBase;
}).catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
