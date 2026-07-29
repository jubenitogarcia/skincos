'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePayload } = require('../scripts/livia/validate-publish-token-health');

const payload = {
  items: [
    { provider: 'instagram', unit: 'bss', external_account_id: '17841464379584003', token: 'direct-instagram-token' },
    { provider: 'facebook', unit: 'bss', external_account_id: '185513961319461', token: 'direct-facebook-token' },
    { provider: 'threads', unit: 'bss', external_account_id: '24559172163775830', token: 'direct-threads-token' },
  ],
};

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withMockedFetch(fn) {
  const previousFetch = global.fetch;
  const previousToken = process.env.TOKEN_VAULT_N8N_API_TOKEN;
  process.env.TOKEN_VAULT_N8N_API_TOKEN = 'gateway-admin-fixture';
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/v1/social-publish/operations')) {
      assert.equal(options.headers.Authorization, 'Bearer gateway-admin-fixture');
      return response(200, { id: 'gateway-ok' });
    }
    return response(200, { id: 'provider-ok' });
  };
  try {
    return await fn();
  } finally {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.TOKEN_VAULT_N8N_API_TOKEN;
    else process.env.TOKEN_VAULT_N8N_API_TOKEN = previousToken;
  }
}

test('token health preflight requires direct provider and gateway validation', async () => {
  const result = await withMockedFetch(() => validatePayload(payload));
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.equal(result.gatewayChecks.length, 3);
  assert.ok(result.gatewayChecks.every((check) => check.ok));
});

test('token health preflight fails closed when the verifier bearer is unavailable', async () => {
  const previousFetch = global.fetch;
  const previousToken = process.env.TOKEN_VAULT_N8N_API_TOKEN;
  delete process.env.TOKEN_VAULT_N8N_API_TOKEN;
  global.fetch = async () => response(200, { id: 'provider-ok' });
  try {
    await assert.rejects(() => validatePayload(payload), /gateway_missing=instagram\|threads\|facebook/);
  } finally {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.TOKEN_VAULT_N8N_API_TOKEN;
    else process.env.TOKEN_VAULT_N8N_API_TOKEN = previousToken;
  }
});
