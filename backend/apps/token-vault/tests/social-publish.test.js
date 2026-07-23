import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSocialPublishOperation } from '../src/social-publish.js';

const SECRET_TOKEN = 'fixture-secret-token';

class Statement {
  constructor(rows) { this.rows = rows; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.rows.filter((row) => row.provider === this.values[0]) }; }
}

function context(overrides = {}) {
  const audits = [];
  return {
    requestId: 'req-test',
    env: {
      TOKEN_VAULT_DB: {
        prepare() {
          return new Statement([{
            id: 'ig_nh',
            provider: 'instagram',
            unit: 'Novo Hamburgo',
            external_account_id: '123',
            token_type: 'long_lived_access_token',
            token_ciphertext: 'encrypted',
            metadata_json: '{}',
          }]);
        },
      },
    },
    decryptToken: async () => SECRET_TOKEN,
    writeAudit: async (_env, entry) => audits.push(entry),
    audits,
    ...overrides,
  };
}

test('social gateway injects token upstream and never returns it', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = '';
  let upstreamBody = '';
  globalThis.fetch = async (url, options) => {
    upstreamUrl = String(url);
    upstreamBody = String(options.body || '');
    return new Response(JSON.stringify({ id: 'container-1', access_token: SECRET_TOKEN }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const ctx = context();
    const request = new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'instagram',
        unit: 'nh',
        operation: 'media_create',
        method: 'POST',
        url: 'https://graph.instagram.com/v25.0/123/media',
        body: { image_url: 'https://example.com/image.jpg', access_token: 'leaked-input' },
      }),
    });
    const response = await handleSocialPublishOperation({ request, ...ctx });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(upstreamBody, new RegExp(SECRET_TOKEN));
    assert.equal(upstreamUrl.includes(SECRET_TOKEN), false);
    assert.equal(JSON.stringify(body).includes(SECRET_TOKEN), false);
    assert.equal(JSON.stringify(body).includes('leaked-input'), false);
    assert.equal(ctx.audits.length, 1);
    assert.equal(JSON.stringify(ctx.audits).includes(SECRET_TOKEN), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('social gateway rejects arbitrary hosts before credential lookup', async () => {
  const ctx = context();
  const request = new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'instagram',
      unit: 'nh',
      operation: 'media_create',
      url: 'https://example.com/v25.0/123/media',
    }),
  });
  const response = await handleSocialPublishOperation({ request, ...ctx });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'target_not_allowed');
});
