import { appendFile, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { connectionCount, executionErrorDetails, matchesWorkflow, workflowDependencies, workflowGraph, workflowListRecord, workflowSummary } from './lib/workflow-analysis.mjs';
import { hasSensitiveMaterial, sanitizeErrorMessage, sanitizeText, sanitizeValue } from './lib/sanitize.mjs';

try {
  globalThis.__skincosFlattedParse = createRequire('/usr/local/lib/node_modules/n8n/package.json')('flatted').parse;
} catch { /* JSON remains the safe fallback for deployments without flatted */ }

const HOST = process.env.MCP_LISTEN_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_LISTEN_PORT || 8766);
const MCP_PATH = '/mcp';
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const UPSTREAM_URL = process.env.MCP_AUTH_UPSTREAM_URL || 'http://127.0.0.1:5678/mcp-server/http';
const AUTHORITY = process.env.MCP_OAUTH_AUTHORITY || 'https://orb.skincos.com.br';
const AUDIT_PATH = process.env.MCP_AUDIT_PATH || '/var/log/skincos/orb-mcp-readonly/audit.jsonl';
const SNAPSHOT_INDEX_PATH = process.env.MCP_SNAPSHOT_INDEX_PATH || '/var/lib/skincos-runtime/orb-mcp-readonly/snapshots/workflow-index.json';
const BACKUP_ROOT = process.env.MCP_BACKUP_ROOT || '/var/backups/skincos/orb/daily';
const SCHEMA = /^[A-Za-z_][A-Za-z0-9_]*$/.test(process.env.MCP_DB_SCHEMA || 'public') ? (process.env.MCP_DB_SCHEMA || 'public') : 'public';
const DB = {
  host: process.env.MCP_DB_HOST || '127.0.0.1', port: process.env.MCP_DB_PORT || '5432', user: process.env.MCP_DB_USER || 'skincos_mcp_ro', database: process.env.MCP_DB_DATABASE,
};
const MAX_BODY = 64 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_PAGE_SIZE = 100;
const MAX_FILTER_LENGTH = 160;
const MAX_EXECUTION_INTERVAL_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_REQUESTS = 4;
const TOOL_TIMEOUT_MS = 12_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const rateWindows = new Map();
let concurrentRequests = 0;

const q = (name) => `\"${SCHEMA}\".\"${name}\"`;
const workflowsSql = (where = '') => `
  SELECT json_build_object(
    'id', w."id", 'name', w."name", 'active', w."active", 'isArchived', w."isArchived",
    'createdAt', w."createdAt", 'updatedAt', w."updatedAt", 'settings', w."settings",
    'description', w."description", 'nodes', w."nodes", 'connections', w."connections",
    'folderName', f."name", 'projectName', p."name",
    'tags', COALESCE(json_agg(t."name") FILTER (WHERE t."name" IS NOT NULL), '[]'::json)
  )::text
  FROM ${q('workflow_entity')} w
  LEFT JOIN ${q('folder')} f ON f."id" = w."parentFolderId"
  LEFT JOIN ${q('project')} p ON p."id" = f."projectId"
  LEFT JOIN ${q('workflows_tags')} wt ON wt."workflowId" = w."id"
  LEFT JOIN ${q('tag_entity')} t ON t."id" = wt."tagId"
  ${where}
  GROUP BY w."id", f."name", p."name"
  ORDER BY w."updatedAt" DESC NULLS LAST, w."id" ASC`;

const workflowMetadataSql = `
  SELECT json_build_object(
    'id', w."id", 'name', w."name", 'active', w."active", 'isArchived', w."isArchived",
    'createdAt', w."createdAt", 'updatedAt', w."updatedAt", 'settings', w."settings",
    'description', left(COALESCE(w."description", ''), 2000), 'folderName', f."name", 'projectName', p."name",
    'nodeCount', json_array_length(COALESCE(w."nodes", '[]'::json)),
    'nodeTypes', COALESCE((SELECT json_agg(DISTINCT node.value ->> 'type') FILTER (WHERE node.value ->> 'type' IS NOT NULL) FROM json_array_elements(COALESCE(w."nodes", '[]'::json)) AS node(value)), '[]'::json),
    'connectionCount', COALESCE((SELECT count(*) FROM json_each(COALESCE(w."connections", '{}'::json)) AS source(key, value) CROSS JOIN LATERAL json_each(source.value) AS output(key, value) CROSS JOIN LATERAL json_array_elements(output.value) AS path(value) CROSS JOIN LATERAL json_array_elements(path.value) AS edge(value)), 0),
    'tags', COALESCE(json_agg(t."name") FILTER (WHERE t."name" IS NOT NULL), '[]'::json)
  )::text
  FROM ${q('workflow_entity')} w
  LEFT JOIN ${q('folder')} f ON f."id" = w."parentFolderId"
  LEFT JOIN ${q('project')} p ON p."id" = f."projectId"
  LEFT JOIN ${q('workflows_tags')} wt ON wt."workflowId" = w."id"
  LEFT JOIN ${q('tag_entity')} t ON t."id" = wt."tagId"
  GROUP BY w."id", f."name", p."name"
  ORDER BY w."updatedAt" DESC NULLS LAST, w."id" ASC`;

const executionsSql = (where = '', includeData = false, dataLimit = 0) => `
  SELECT json_build_object(
    'id', e."id", 'workflowId', e."workflowId", 'workflowName', w."name", 'status', e."status",
    'startedAt', e."startedAt", 'stoppedAt', e."stoppedAt", 'mode', e."mode", 'retryOf', e."retryOf",
    'retrySuccessId', e."retrySuccessId", 'data', ${includeData ? `left(COALESCE(ed."data", ''), ${Math.min(1500000, Math.max(1, dataLimit))})` : `''`}
  )::text
  FROM ${q('execution_entity')} e
  LEFT JOIN ${q('workflow_entity')} w ON w."id" = e."workflowId"
  LEFT JOIN ${q('execution_data')} ed ON ed."executionId" = e."id"
  ${where}
  ORDER BY e."startedAt" DESC NULLS LAST, e."id" DESC
  LIMIT :limit`;

const tool = (name, description, inputSchema) => ({ name, description, inputSchema });
const TOOLS = [
  tool('list_workflows', 'List all Orb workflows with sanitized metadata only.', { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, additionalProperties: false }),
  tool('search_workflows', 'Search sanitized workflow metadata and structure without executing workflows.', { type: 'object', properties: { query: { type: 'string', maxLength: 160 }, tags: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 10 }, node_types: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 10 }, integrations: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 10 }, active: { type: 'boolean' }, updated_after: { type: 'string', format: 'date-time' }, updated_before: { type: 'string', format: 'date-time' }, page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE } }, additionalProperties: false }),
  tool('get_workflow_summary', 'Return sanitized structure and inferred purpose for one workflow.', { type: 'object', properties: { workflow_id: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['workflow_id'], additionalProperties: false }),
  tool('get_workflow_graph', 'Return a sanitized node graph for one workflow.', { type: 'object', properties: { workflow_id: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['workflow_id'], additionalProperties: false }),
  tool('list_recent_executions', 'List sanitized recent executions. Payloads are never returned.', { type: 'object', properties: { workflow_id: { type: 'string', maxLength: 120 }, status: { type: 'string', enum: ['success', 'error', 'waiting', 'running', 'canceled', 'crashed'] }, mode: { type: 'string', enum: ['manual', 'trigger', 'webhook', 'integrated', 'retry'] }, started_after: { type: 'string', format: 'date-time' }, started_before: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false }),
  tool('get_execution_error', 'Return a reduced, sanitized error diagnosis for one execution.', { type: 'object', properties: { execution_id: { type: 'integer', minimum: 1 } }, required: ['execution_id'], additionalProperties: false }),
  tool('find_workflow_dependencies', 'Identify structural workflow dependencies without returning node parameters.', { type: 'object', properties: { workflow_id: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['workflow_id'], additionalProperties: false }),
  tool('compare_workflow_with_repository', 'Compare live workflow structure to a prebuilt GitHub-origin snapshot index; never applies it.', { type: 'object', properties: { workflow_id: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['workflow_id'], additionalProperties: false }),
  tool('get_orb_status', 'Return sanitized local/public Orb and gateway health.', { type: 'object', properties: {}, additionalProperties: false }),
];

function writeJson(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length > MAX_RESULT_BYTES) return writeJson(res, 413, { error: 'response_too_large' });
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

function rpcError(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }
function rpcResult(id, result) { return { jsonrpc: '2.0', id: id ?? null, result }; }
function challenge(res) { return writeJson(res, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata=\"http://${HOST}:${PORT}${METADATA_PATH}\"` }); }

async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('request_too_large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

function throttle(req) {
  const key = req.socket.remoteAddress || 'unknown'; const now = Date.now();
  for (const [address, stamps] of rateWindows) if (!stamps.some((stamp) => now - stamp < RATE_WINDOW_MS)) rateWindows.delete(address);
  const recent = (rateWindows.get(key) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  recent.push(now); rateWindows.set(key, recent);
  return recent.length <= RATE_LIMIT;
}

async function authenticate(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(UPSTREAM_URL, { method: 'POST', signal: controller.signal, headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'gateway-auth', method: 'tools/list', params: {} }) });
    return response.ok;
  } catch { return false; } finally { clearTimeout(timeout); }
}

function psql(sql, variables = {}, signal) {
  if (!DB.database) throw new Error('database_configuration_missing');
  if (!/^\s*select\b/i.test(sql)) throw new Error('read_only_query_required');
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', DB.host, '-p', String(DB.port), '-U', DB.user, '-d', DB.database];
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${String(value ?? '')}`);
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/psql', args, { env: { ...process.env, PGPASSWORD: process.env.MCP_DB_PASSWORD || '', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=2000' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const abort = () => child.kill('SIGKILL');
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (data) => { stdout += data; if (stdout.length > 2_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (signal?.aborted) return reject(new Error('request_cancelled')); if (code !== 0) return reject(new Error(`database_query_failed:${sanitizeErrorMessage(stderr)}`)); try { resolve(stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))); } catch { reject(new Error('database_response_invalid')); } });
    child.stdin.end(sql);
  });
}

async function workflows(signal) { return psql(workflowMetadataSql, {}, signal); }
async function oneWorkflow(workflowId, signal) { const rows = await psql(workflowsSql('WHERE w."id" = :\'workflow_id\''), { workflow_id: workflowId }, signal); return rows[0] || null; }
function page(value, options = {}) { const pageNumber = Math.max(1, Math.min(100000, Number(options.page) || 1)); const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(options.page_size) || 50)); return { page: pageNumber, page_size: pageSize, total: value.length, data: value.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) }; }

function executionRecord(execution) {
  const error = execution.status === 'error' || execution.status === 'crashed' ? executionErrorDetails(execution.data) : {};
  const started = execution.startedAt ? Date.parse(execution.startedAt) : NaN; const stopped = execution.stoppedAt ? Date.parse(execution.stoppedAt) : NaN;
  return { id: Number(execution.id), workflow_id: sanitizeText(execution.workflowId, 120), workflow: sanitizeText(execution.workflowName || '', 240), status: sanitizeText(execution.status || 'unknown', 80), started_at: execution.startedAt || null, finished_at: execution.stoppedAt || null, duration_ms: Number.isFinite(started) && Number.isFinite(stopped) ? Math.max(0, stopped - started) : null, mode: sanitizeText(execution.mode || 'unknown', 80), error_node: error.node || null, error_message: error.message || null };
}

async function snapshotIndex() { try { const info = await stat(SNAPSHOT_INDEX_PATH); if (info.size > 4_000_000) return null; return JSON.parse(await readFile(SNAPSHOT_INDEX_PATH, 'utf8')); } catch { return null; } }
async function staticCommand(command, args) { return new Promise((resolve) => { const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] }); let output = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 3000); child.stdout.on('data', (data) => { output += data; }); child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? sanitizeText(output.trim(), 100) : 'unknown'); }); child.on('error', () => resolve('unknown')); }); }
async function health(url) { try { const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'manual' }); return { reachable: response.ok, status: response.status }; } catch { return { reachable: false, status: null }; } }

function validateInput(name, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_arguments');
  const textValues = [];
  const collect = (value) => { if (typeof value === 'string') textValues.push(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
  collect(input);
  if (textValues.some((value) => value.length > MAX_FILTER_LENGTH)) throw new Error('filter_too_large');
  if (name === 'list_recent_executions' && input.started_after && input.started_before) {
    const after = Date.parse(input.started_after); const before = Date.parse(input.started_before);
    if (!Number.isFinite(after) || !Number.isFinite(before) || before < after || before - after > MAX_EXECUTION_INTERVAL_MS) throw new Error('execution_interval_too_large');
  }
}

async function invoke(name, input, signal) {
  validateInput(name, input);
  switch (name) {
    case 'list_workflows': return page((await workflows(signal)).map(workflowListRecord), input);
    case 'search_workflows': return page((await workflows(signal)).filter((workflow) => matchesWorkflow(workflow, input)).map(workflowListRecord), input);
    case 'get_workflow_summary': { const workflow = await oneWorkflow(input.workflow_id, signal); if (!workflow) throw new Error('workflow_not_found'); return workflowSummary(workflow); }
    case 'get_workflow_graph': { const workflow = await oneWorkflow(input.workflow_id, signal); if (!workflow) throw new Error('workflow_not_found'); return workflowGraph(workflow); }
    case 'find_workflow_dependencies': { const workflow = await oneWorkflow(input.workflow_id, signal); if (!workflow) throw new Error('workflow_not_found'); return workflowDependencies(workflow); }
    case 'list_recent_executions': {
      const limit = Math.max(1, Math.min(50, Number(input.limit) || 20));
      const where = `WHERE (:'workflow_id' = '' OR e."workflowId" = :'workflow_id') AND (:'status' = '' OR e."status" = :'status') AND (:'mode' = '' OR e."mode" = :'mode') AND (NULLIF(:'started_after', '') IS NULL OR e."startedAt" >= NULLIF(:'started_after', '')::timestamptz) AND (NULLIF(:'started_before', '') IS NULL OR e."startedAt" <= NULLIF(:'started_before', '')::timestamptz)`;
      const rows = await psql(executionsSql(where), { workflow_id: input.workflow_id || '', status: input.status || '', mode: input.mode || '', started_after: input.started_after || '', started_before: input.started_before || '', limit }, signal);
      return { data: rows.map(executionRecord), count: rows.length };
    }
    case 'get_execution_error': {
      const rows = await psql(executionsSql('WHERE e."id" = :\'execution_id\'', true, 1500000), { execution_id: Number(input.execution_id), limit: 1 }, signal); const execution = rows[0]; if (!execution) throw new Error('execution_not_found'); const details = executionErrorDetails(execution.data); return { execution: executionRecord(execution), workflow: sanitizeText(execution.workflowName || '', 240), node: details.node, node_type: details.node_type, message: details.message, stack: details.stack, http_status: details.http_status, retry: details.retry, timestamps: { started_at: execution.startedAt || null, finished_at: execution.stoppedAt || null } };
    }
    case 'compare_workflow_with_repository': {
      const workflow = await oneWorkflow(input.workflow_id, signal); if (!workflow) throw new Error('workflow_not_found'); const index = await snapshotIndex(); const candidate = index?.workflows?.find((item) => item.id === workflow.id || String(item.name || '').toLowerCase() === String(workflow.name || '').toLowerCase()) || null; const live = workflowListRecord(workflow);
      if (!candidate) return { snapshot_found: false, live, snapshot_source: index?.source || null, limitation: 'No matching structural snapshot was indexed from the configured GitHub origin reference.' };
      return { snapshot_found: true, live, snapshot: { path: sanitizeText(candidate.path, 400), name: sanitizeText(candidate.name, 240), node_count: Number(candidate.node_count), connection_count: Number(candidate.connection_count), updated_at: candidate.updated_at || null, commit: sanitizeText(index.source?.commit || '', 80) }, structural_differences: { node_count_delta: live.node_count - Number(candidate.node_count), connection_count_delta: live.connection_count - Number(candidate.connection_count), node_types_only_live: [...new Set((workflow.nodes || []).map((node) => node.type))].filter((type) => !(candidate.node_types || []).includes(type)).map((type) => sanitizeText(type, 220)).slice(0, 50), node_types_only_snapshot: (candidate.node_types || []).filter((type) => !(workflow.nodes || []).some((node) => node.type === type)).map((type) => sanitizeText(type, 220)).slice(0, 50) }, likely_newer: workflow.updatedAt && candidate.updated_at ? (Date.parse(workflow.updatedAt) > Date.parse(candidate.updated_at) ? 'live' : 'snapshot_or_equal') : 'unknown', warning: 'The snapshot is comparison-only and is never applied to the live workflow.' };
    }
    case 'get_orb_status': {
      const [orb, proxy, tunnel, gateway, local, publicHealth, executionCount] = await Promise.all([staticCommand('/usr/bin/systemctl', ['is-active', 'orb']), staticCommand('/usr/bin/systemctl', ['is-active', 'orb-proxy']), staticCommand('/usr/bin/systemctl', ['is-active', 'cloudflare-orb']), staticCommand('/usr/bin/systemctl', ['is-active', 'skincos-orb-mcp-readonly']), health('http://127.0.0.1:5678/healthz'), health('https://orb.skincos.com.br/healthz'), psql(`SELECT json_build_object('count', count(*), 'last_started_at', max("startedAt"))::text FROM ${q('execution_entity')}`, {}, signal)]);
      return { services: { orb, orb_proxy: proxy, cloudflare_orb: tunnel, mcp_gateway: gateway }, n8n_version: sanitizeText(await staticCommand('/usr/local/bin/n8n', ['--version']), 80), local_health: local, public_health: publicHealth, execution_persistence: executionCount[0] || null, backup: { root: sanitizeText(BACKUP_ROOT, 180), restore_verified: 'unproven_from_gateway_without_private_manifest_index' } };
    }
    default: throw new Error('tool_not_allowed');
  }
}

async function audit(toolName, ok, started) {
  const entry = JSON.stringify({ at: new Date().toISOString(), request_id: randomUUID(), tool: toolName || 'protocol', ok, duration_ms: Date.now() - started });
  try { await appendFile(AUDIT_PATH, `${entry}\n`, { encoding: 'utf8', mode: 0o640 }); } catch { /* audit storage failure must not expose request data */ }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === METADATA_PATH) return writeJson(res, 200, { resource: `http://${HOST}:${PORT}${MCP_PATH}`, authorization_servers: [AUTHORITY], bearer_methods_supported: ['header'], scopes_supported: ['tool:listWorkflows', 'tool:getWorkflowDetails'] });
  if (url.pathname !== MCP_PATH) return writeJson(res, 404, { error: 'not_found' });
  if (req.method === 'HEAD') return challenge(res);
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'method_not_allowed' });
  if (!throttle(req)) return writeJson(res, 429, { error: 'rate_limited' });
  if (!(await authenticate(req))) return challenge(res);
  const started = Date.now(); let rpc; let toolName = null;
  try {
    rpc = JSON.parse((await bodyOf(req)).toString('utf8'));
    if (rpc.method === 'initialize') return writeJson(res, 200, rpcResult(rpc.id, { protocolVersion: rpc.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'skincos-orb-readonly', version: '1.0.0' } }));
    if (rpc.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (rpc.method === 'ping') return writeJson(res, 200, rpcResult(rpc.id, {}));
    if (rpc.method === 'tools/list') return writeJson(res, 200, rpcResult(rpc.id, { tools: TOOLS }));
    if (rpc.method !== 'tools/call' || !TOOLS.some((item) => item.name === rpc.params?.name)) return writeJson(res, 200, rpcError(rpc.id, -32601, 'tool_not_allowed'));
    toolName = rpc.params.name;
    if (concurrentRequests >= MAX_CONCURRENT_REQUESTS) return writeJson(res, 503, rpcError(rpc.id, -32003, 'too_many_concurrent_requests'));
    concurrentRequests += 1;
    const requestController = new AbortController();
    const onClose = () => requestController.abort();
    req.once('aborted', onClose); res.once('close', onClose);
    const timeout = setTimeout(() => requestController.abort(), TOOL_TIMEOUT_MS);
    let output;
    try {
      output = await Promise.race([invoke(toolName, rpc.params.arguments && typeof rpc.params.arguments === 'object' ? rpc.params.arguments : {}, requestController.signal), new Promise((_, reject) => requestController.signal.addEventListener('abort', () => reject(new Error('tool_timeout_or_client_disconnect')), { once: true }))]);
    } finally { clearTimeout(timeout); req.off('aborted', onClose); res.off('close', onClose); concurrentRequests -= 1; }
    const safeOutput = sanitizeValue(output);
    if (hasSensitiveMaterial(safeOutput)) throw new Error('sanitization_failed');
    await audit(toolName, true, started);
    return writeJson(res, 200, rpcResult(rpc.id, { content: [{ type: 'text', text: JSON.stringify(safeOutput) }], structuredContent: safeOutput }));
  } catch (error) {
    await audit(toolName, false, started);
    return writeJson(res, 200, rpcError(rpc?.id, -32602, sanitizeErrorMessage(error?.message || 'invalid_request')));
  }
});

server.listen(PORT, HOST);
