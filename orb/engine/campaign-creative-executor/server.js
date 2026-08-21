'use strict';

const http = require('http');
const path = require('path');
const { executeProductionManifest } = require('./executor');
const { createDefaultRegistry } = require('./registry');
const { LocalArtifactStore, MemoryArtifactStore } = require('./storage');
const { FileExecutionStore, InMemoryExecutionStore } = require('./store');
const { object, text } = require('./contracts');

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function jsonResponse(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function authMatches(request, token) {
  if (!token) return false;
  const value = text(request.headers.authorization);
  return value === `Bearer ${token}`;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large'), { code: 'BODY_TOO_LARGE', statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw Object.assign(new Error('Request body must be valid JSON'), { code: 'INVALID_JSON', statusCode: 400, cause: error });
  }
}

function optionsFromEnvironment(options = {}) {
  const stateRoot = text(options.stateRoot || process.env.CCG_EXECUTOR_STATE_ROOT || path.join(process.cwd(), '.ccg-executor-state'));
  const liveEnabled = options.liveEnabled === true || process.env.CCG_EXECUTOR_LIVE_ENABLED === '1';
  const liveExecutionStore = options.liveExecutionStore || options.executionStore || new FileExecutionStore(stateRoot);
  const dryRunExecutionStore = options.dryRunExecutionStore || new InMemoryExecutionStore();
  const liveArtifactStore = options.liveArtifactStore || options.artifactStore || new LocalArtifactStore({
    root: text(options.artifactRoot || process.env.CCG_EXECUTOR_ARTIFACT_ROOT || path.join(stateRoot, 'artifacts')),
    publicBaseUrl: options.publicArtifactBaseUrl || process.env.CCG_EXECUTOR_PUBLIC_ARTIFACT_BASE_URL,
  });
  const dryRunArtifactStore = options.dryRunArtifactStore || new MemoryArtifactStore();
  return {
    ...options,
    stateRoot,
    liveEnabled,
    registry: options.registry || createDefaultRegistry({
      openaiApiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
      openaiBaseUrl: options.openaiBaseUrl || process.env.OPENAI_API_BASE_URL,
      openaiImageModel: options.openaiImageModel || process.env.OPENAI_IMAGE_MODEL,
      openaiImageCost: options.openaiImageCost ?? process.env.CCG_EXECUTOR_OPENAI_IMAGE_COST,
    }),
    executionStore: liveExecutionStore,
    artifactStore: liveArtifactStore,
    liveExecutionStore,
    dryRunExecutionStore,
    liveArtifactStore,
    dryRunArtifactStore,
  };
}

function createServer(options = {}) {
  const configured = optionsFromEnvironment(options);
  const authToken = text(configured.authToken || process.env.CCG_EXECUTOR_AUTH_TOKEN);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return jsonResponse(response, 200, { status: 'ok', service: 'campaign-creative-executor', live_enabled: configured.liveEnabled });
      }
      if (!authMatches(request, authToken)) return jsonResponse(response, 401, { error: 'UNAUTHORIZED' });
      if (request.method === 'POST' && url.pathname === '/v1/production-manifests') {
        const body = object(await readJson(request));
        const manifest = object(body.manifest || body.production_manifest || body.productionManifest);
        const mode = text(body.mode || body.request_context?.mode || manifest.mode || 'DRY_RUN').toUpperCase();
        const dryRun = mode !== 'LIVE';
        const result = await executeProductionManifest({
          manifest,
          mode,
          requestContext: body.request_context || body.context || {},
          registry: configured.registry,
          executionStore: dryRun ? configured.dryRunExecutionStore : configured.liveExecutionStore,
          artifactStore: dryRun ? configured.dryRunArtifactStore : configured.liveArtifactStore,
          liveEnabled: configured.liveEnabled,
        });
        return jsonResponse(response, 200, {
          execution_id: result.execution_id,
          status: result.status,
          reused: result.reused === true,
          production_execution_results: result,
        });
      }
      const match = url.pathname.match(/^\/v1\/production-manifests\/([^/]+)$/);
      if (request.method === 'GET' && match) {
        const executionId = decodeURIComponent(match[1]);
        const result = await configured.dryRunExecutionStore.get(executionId) || await configured.liveExecutionStore.get(executionId);
        if (!result) return jsonResponse(response, 404, { error: 'EXECUTION_NOT_FOUND' });
        return jsonResponse(response, 200, { execution_id: executionId, status: result.status, production_execution_results: result });
      }
      return jsonResponse(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const statusCode = Number(error && error.statusCode) >= 400 && Number(error.statusCode) < 500 ? Number(error.statusCode) : 500;
      return jsonResponse(response, statusCode, { error: text(error && error.code) || 'EXECUTOR_REQUEST_FAILED', message: text(error && error.message).slice(0, 300) });
    }
  });
  return { server, configured };
}

function start(options = {}) {
  const { server, configured } = createServer(options);
  const host = text(options.listenAddress || process.env.CCG_EXECUTOR_LISTEN_ADDRESS || '127.0.0.1');
  const port = Number(options.port || process.env.CCG_EXECUTOR_PORT || 8790);
  server.listen(port, host, () => {
    process.stdout.write(`campaign-creative-executor listening on ${host}:${port} live_enabled=${configured.liveEnabled}\n`);
  });
  return server;
}

if (require.main === module) start();

module.exports = {
  MAX_BODY_BYTES,
  createServer,
  start,
};
