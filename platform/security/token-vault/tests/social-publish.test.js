import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSocialPublishOperation } from '../src/social-publish.js';

const SECRET_TOKEN = 'fixture-secret-token';

class Statement {
  constructor(rows) {
    this.rows = rows;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return { results: this.rows.filter((row) => row.provider === this.values[0]) };
  }
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

test('social gateway strips credential query parameters from provider pagination URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ id: 'media-1' }],
    paging: {
      next: `https://graph.instagram.com/v25.0/123/media?after=cursor-1&access_token=${SECRET_TOKEN}&fields=id`,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const ctx = context();
    const response = await handleSocialPublishOperation({
      request: new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'instagram',
          unit: 'nh',
          operation: 'media_list',
          method: 'GET',
          url: 'https://graph.instagram.com/v25.0/123/media',
        }),
      }),
      ...ctx,
    });
    const body = await response.json();
    const next = new URL(body.paging.next);
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(body).includes(SECRET_TOKEN), false);
    assert.equal(next.searchParams.has('access_token'), false);
    assert.equal(next.searchParams.get('after'), 'cursor-1');
    assert.equal(next.searchParams.get('fields'), 'id');
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

test('social gateway never falls back to a Meta Ads Facebook credential', async () => {
  let fetched = false;
  const ctx = context({
    env: {
      TOKEN_VAULT_DB: {
        prepare() {
          return new Statement([{
            id: 'facebook_bss_meta_ads',
            provider: 'facebook',
            unit: 'BarraShoppingSul',
            external_account_id: '123',
            token_type: 'long_lived_access_token',
            token_ciphertext: 'encrypted',
            metadata_json: JSON.stringify({ purpose: 'meta_ads_publish' }),
          }]);
        },
      },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await handleSocialPublishOperation({
      request: new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'facebook',
          unit: 'bss',
          operation: 'photo_create',
          method: 'POST',
          url: 'https://graph.facebook.com/v25.0/123/photos',
        }),
      }),
      ...ctx,
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'credential_not_found');
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('social gateway accepts every Livia provider route, including the Facebook Reel upload chain', async () => {
  const rows = [
    { id: 'fb_nh', provider: 'facebook', unit: 'Novo Hamburgo', external_account_id: '123', token_type: 'long_lived_access_token', token_ciphertext: 'encrypted', metadata_json: '{}' },
    { id: 'ig_nh', provider: 'instagram', unit: 'Novo Hamburgo', external_account_id: '123', token_type: 'long_lived_access_token', token_ciphertext: 'encrypted', metadata_json: '{}' },
    { id: 'th_nh', provider: 'threads', unit: 'Novo Hamburgo', external_account_id: '123', token_type: 'long_lived_access_token', token_ciphertext: 'encrypted', metadata_json: '{}' },
  ];
  const ctx = context({ env: { TOKEN_VAULT_DB: { prepare() { return new Statement(rows); } } } });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, authorization: options.headers.get('authorization') });
    return new Response(JSON.stringify({ id: 'provider-object' }), { status: 200 });
  };
  try {
    const requests = [
      ['facebook', 'POST', 'https://graph.facebook.com/v25.0/123/photos'],
      ['facebook', 'POST', 'https://graph.facebook.com/v25.0/123/video_reels?upload_phase=start'],
      ['facebook', 'POST', 'https://rupload.facebook.com/video-upload/v25.0/987'],
      ['facebook', 'GET', 'https://graph.facebook.com/v25.0/987?fields=status'],
      ['instagram', 'POST', 'https://graph.instagram.com/v25.0/123/media'],
      ['instagram', 'POST', 'https://graph.instagram.com/v25.0/123/media_publish'],
      ['instagram', 'GET', 'https://graph.instagram.com/v25.0/987?fields=status'],
      ['threads', 'POST', 'https://graph.threads.net/v1.0/me/threads'],
      ['threads', 'POST', 'https://graph.threads.net/v1.0/me/threads_publish'],
      ['threads', 'GET', 'https://graph.threads.net/v1.0/987?fields=id'],
    ];
    for (const [platform, method, url] of requests) {
      const response = await handleSocialPublishOperation({
        request: new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platform, unit: 'nh', operation: 'livia_contract_probe', method, url }),
        }),
        ...ctx,
      });
      assert.equal(response.status, 200, `${platform} ${method} ${url}`);
    }
    assert.equal(calls.length, requests.length);
    assert.equal(calls[2].authorization, `OAuth ${SECRET_TOKEN}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
