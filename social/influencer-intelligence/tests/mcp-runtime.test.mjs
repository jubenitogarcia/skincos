import assert from 'node:assert/strict';
import test from 'node:test';

import { createInternalHttpReadService, createMcpTransportHandler } from '../runtime/mcp-server.mjs';
import { INFLUENCER_INTELLIGENCE_GRANT, MCP_PATH } from '../runtime/runtime-contract.mjs';

const token = 'synthetic-mcp-bearer-token';

function request({ headers = {}, body = { jsonrpc: '2.0', id: 1, method: 'ping' } } = {}) {
  return new Request(`http://127.0.0.1${MCP_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-influencer-intelligence-grant': INFLUENCER_INTELLIGENCE_GRANT, ...headers },
    body: JSON.stringify(body),
  });
}

test('MCP transport remains unavailable while the module flag is off', async () => {
  let called = false;
  const handler = createMcpTransportHandler({ gateway: { handleRpc: async () => { called = true; return {}; } }, token, enabled: false });
  const response = await handler.handle(request());
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test('MCP transport remains unavailable when its runtime registration marker is absent', async () => {
  let called = false;
  const handler = createMcpTransportHandler({ gateway: { handleRpc: async () => { called = true; return {}; } }, token, registered: false, enabled: true });
  const response = await handler.handle(request());
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test('MCP transport requires bearer authentication and the fixed grant', async () => {
  const gateway = { handleRpc: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) };
  const handler = createMcpTransportHandler({ gateway, token, enabled: true });
  const missingToken = await handler.handle(new Request(`http://127.0.0.1${MCP_PATH}`, { method: 'POST', body: '{}' }));
  assert.equal(missingToken.status, 401);
  const missingGrant = await handler.handle(new Request(`http://127.0.0.1${MCP_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' }));
  assert.equal(missingGrant.status, 403);
});

test('MCP transport passes only an authenticated read context to the domain gateway', async () => {
  let invocation;
  const gateway = { handleRpc: async (value) => { invocation = value; return { jsonrpc: '2.0', id: 7, result: { ok: true } }; } };
  const handler = createMcpTransportHandler({ gateway, token, enabled: true });
  const response = await handler.handle(request({ headers: { 'x-influencer-intelligence-actor-scope': 'crm-shadow' }, body: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} } }));
  assert.equal(response.status, 200);
  assert.equal(invocation.context.authenticated, true);
  assert.deepEqual(invocation.context.grants, [INFLUENCER_INTELLIGENCE_GRANT]);
  assert.equal(invocation.context.actor_scope, 'crm-shadow');
  assert.equal(invocation.rpc.method, 'tools/list');
  assert.equal(invocation.requestBytes > 0, true);
});

test('MCP internal read client uses the service token and fixed read-only caller', async () => {
  let call;
  const fakeFetch = async (url, init) => {
    call = { url: String(url), init };
    return new Response(JSON.stringify({ data: { items: [] }, data_classification: 'observed', freshness: 'fresh', retrieved_at: '2025-01-01T00:00:00.000Z', confidence: 1, coverage: { available_metrics: 1, expected_metrics: 1, ratio: 1 }, providers: [], provenance: [{ provider: null, source_type: 'registry', source_ref: 'db:creator_registry', observed_at: '2025-01-01T00:00:00.000Z', retrieved_at: '2025-01-01T00:00:00.000Z', evidence_state: 'observed' }], limitations: [], errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const service = createInternalHttpReadService({ baseUrl: 'http://127.0.0.1:8899', serviceToken: 'synthetic-service-token', fetchImpl: fakeFetch });
  const result = await service.searchCreators({ query: 'synthetic', page: 1, page_size: 10 }, { actor_scope: 'mcp-readonly', request_id: 'mcp-test' });
  assert.deepEqual(result.data, { items: [] });
  assert.equal(call.init.headers.get('x-influencer-intelligence-service-token'), 'synthetic-service-token');
  assert.equal(call.init.headers.get('x-influencer-intelligence-grant'), INFLUENCER_INTELLIGENCE_GRANT);
  assert.equal(call.init.headers.get('x-influencer-intelligence-caller'), 'mcp-readonly');
  assert.match(call.url, /\/internal\/influencer-intelligence\/v1\/creators\?query=synthetic/);
  assert.throws(() => createInternalHttpReadService({ baseUrl: 'https://external.example.internal', serviceToken: 'synthetic-service-token', fetchImpl: fakeFetch }), /UNAVAILABLE/);
});
