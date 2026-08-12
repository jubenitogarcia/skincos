import { createServer } from 'node:http';

import { createJsonlAuditSink } from './audit.mjs';
import { verifyMcpBearer } from './auth.mjs';
import { createInfluencerIntelligenceMcpGateway } from '../mcp-readonly.mjs';
import {
  INFLUENCER_INTELLIGENCE_FLAG,
  INFLUENCER_INTELLIGENCE_GRANT,
  INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED,
  MCP_PATH,
  RUNTIME_LIMITS,
  parseFeatureFlag,
  safeActorScope,
  safeDataScope,
} from './runtime-contract.mjs';

function env(name, fallback = '') { return String(process.env[name] ?? fallback).trim(); }
function error(code) { const value = new Error(code); value.code = code; return value; }

function serviceUrl(value) {
  try {
    const url = new URL(value || 'http://127.0.0.1:8899');
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase());
    if (url.username || url.password || !loopback || url.protocol !== 'http:') throw error('UNAVAILABLE');
    return url.toString().replace(/\/$/, '');
  } catch { throw error('UNAVAILABLE'); }
}

function creatorPath(key, suffix = '') { return `/creators/${encodeURIComponent(key)}${suffix}`; }

function historyQuery(input) {
  const url = new URLSearchParams();
  if (input.window?.start) url.set('window_start', input.window.start);
  if (input.window?.end) url.set('window_end', input.window.end);
  if (input.page !== undefined) url.set('page', String(input.page));
  if (input.page_size !== undefined) url.set('page_size', String(input.page_size));
  return url.toString() ? `?${url.toString()}` : '';
}

async function readResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > RUNTIME_LIMITS.maxResponseBytes) throw error('SANITIZATION_FAILED');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw error('INVALID_SERVICE_RESPONSE'); }
  if (!response.ok) { const failure = error(body?.error || (response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE')); throw failure; }
  return body;
}

export function createInternalHttpReadService({ baseUrl, serviceToken, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  const target = serviceUrl(baseUrl);
  const call = async (method, path, input, options = {}) => {
    const headers = new Headers({
      accept: 'application/json',
      [ 'x-influencer-intelligence-service-token' ]: serviceToken || '',
      [ 'x-influencer-intelligence-grant' ]: INFLUENCER_INTELLIGENCE_GRANT,
      [ 'x-influencer-intelligence-caller' ]: 'mcp-readonly',
      [ 'x-influencer-intelligence-actor-scope' ]: safeActorScope(options.actor_scope, 'mcp-readonly'),
      [ 'x-request-id' ]: options.request_id || `mcp-${clock()}`,
    });
    const url = new URL(`${target}${path}`);
    let body;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(input || {})) if (value !== undefined) url.searchParams.set(key, String(value));
    } else {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(input || {});
    }
    const response = await fetchImpl(url, { method, headers, body, signal: options.signal });
    return readResponse(response);
  };
  return Object.freeze({
    searchCreators: (input, options) => call('GET', '/internal/influencer-intelligence/v1/creators', input, options),
    getCreatorProfile: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/profile`, {}, options).then((value) => value),
    getCreatorSnapshots: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/snapshots${historyQuery(input)}`, {}, options),
    getCreatorMedia: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/media${historyQuery(input)}`, {}, options),
    getCreatorAnalytics: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/analysis`, {}, options),
    getCreatorScore: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/score`, {}, options),
    getCreatorDashboard: (input, options) => call('GET', `${'/internal/influencer-intelligence/v1'}${creatorPath(input.creator_key)}/dashboard`, {}, options),
    getCampaignFit: (input, options) => call('POST', '/internal/influencer-intelligence/v1/campaign-fit', { campaignKey: input.campaign_key, campaignVersion: input.campaign_version, creatorKeys: input.creator_keys }, options),
    compareCreators: (input, options) => call('POST', '/internal/influencer-intelligence/v1/compare', { creatorKeys: input.creator_keys }, options),
  });
}

async function requestFromNode(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > RUNTIME_LIMITS.maxRequestBytes) throw error('REQUEST_TOO_LARGE'); chunks.push(chunk); }
  return { body: chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0), headers: new Headers(Object.entries(req.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])), method: req.method || 'GET', url: `http://${req.headers.host || '127.0.0.1'}${req.url || MCP_PATH}` };
}

export function createMcpTransportHandler({ gateway, token, registered = true, enabled = false, audit, clock = () => Date.now() } = {}) {
  if (!gateway || typeof gateway.handleRpc !== 'function') throw new TypeError('gateway is required');
  return Object.freeze({
    async handle(request) {
      const requestId = request.headers.get('x-request-id') || `mcp-${clock()}`;
      if (!registered || !enabled) return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND', request_id: requestId }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      if (new URL(request.url).pathname !== MCP_PATH || request.method.toUpperCase() !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND', request_id: requestId }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      if (!verifyMcpBearer(request, token)) return new Response(JSON.stringify({ ok: false, error: 'AUTH_REQUIRED', request_id: requestId }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      if (request.headers.get('x-influencer-intelligence-grant') !== INFLUENCER_INTELLIGENCE_GRANT) return new Response(JSON.stringify({ ok: false, error: 'GRANT_REQUIRED', request_id: requestId }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > RUNTIME_LIMITS.maxRequestBytes) return new Response(JSON.stringify({ ok: false, error: 'REQUEST_TOO_LARGE', request_id: requestId }), { status: 413, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      let bytes;
      let rpc;
      try {
        bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength > RUNTIME_LIMITS.maxRequestBytes) throw error('REQUEST_TOO_LARGE');
        rpc = JSON.parse(new TextDecoder().decode(bytes));
      } catch (caught) {
        const code = caught?.code === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_INPUT';
        return new Response(JSON.stringify({ ok: false, error: code, request_id: requestId }), { status: code === 'REQUEST_TOO_LARGE' ? 413 : 400, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
      }
      const context = { authenticated: true, grants: [INFLUENCER_INTELLIGENCE_GRANT], actor_scope: safeActorScope(request.headers.get('x-influencer-intelligence-actor-scope'), 'mcp-readonly'), data_scope: safeDataScope(request.headers.get('x-influencer-intelligence-data-scope')) };
      const response = await gateway.handleRpc({ rpc, context, requestBytes: bytes.byteLength });
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } });
    },
  });
}

export function createMcpRuntime({ environment = process.env, clock = () => Date.now(), auditPath } = {}) {
  const registered = parseFeatureFlag(environment[INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED]);
  const enabled = registered && parseFeatureFlag(environment.INFLUENCER_INTELLIGENCE_ENABLED);
  const audit = createJsonlAuditSink(auditPath || environment.INFLUENCER_INTELLIGENCE_MCP_AUDIT_PATH || '/var/log/skincos/influencer-intelligence/mcp-audit.jsonl');
  const readService = createInternalHttpReadService({ baseUrl: environment.INFLUENCER_INTELLIGENCE_SERVICE_URL || 'http://127.0.0.1:8899', serviceToken: environment.INFLUENCER_INTELLIGENCE_SERVICE_TOKEN, clock });
  const gateway = createInfluencerIntelligenceMcpGateway({ readService, audit, clock });
  const handler = createMcpTransportHandler({ gateway, token: environment.INFLUENCER_INTELLIGENCE_MCP_BEARER_TOKEN, registered, enabled, audit, clock });
  const server = createServer(async (req, res) => {
    try {
      const incoming = await requestFromNode(req);
      const request = new Request(incoming.url, { method: incoming.method, headers: incoming.headers, body: incoming.body.length ? incoming.body : undefined, duplex: 'half' });
      const response = await handler.handle(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (caught) {
      res.statusCode = caught?.code === 'REQUEST_TOO_LARGE' ? 413 : 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: caught?.code || 'INTERNAL' }));
    }
  });
  return Object.freeze({ handler, server, enabled, registered });
}

export async function main() {
  const host = env('INFLUENCER_INTELLIGENCE_MCP_HOST', '127.0.0.1');
  const port = Number(env('INFLUENCER_INTELLIGENCE_MCP_PORT', '8767'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid MCP port');
  const runtime = createMcpRuntime();
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(port, host, resolve); });
  const stop = async () => { await new Promise((resolve) => runtime.server.close(resolve)); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  process.stdout.write(`Influencer Intelligence read-only MCP registered at ${host}:${port}; enabled=${runtime.enabled} grant=${INFLUENCER_INTELLIGENCE_GRANT} flag=${INFLUENCER_INTELLIGENCE_FLAG}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
