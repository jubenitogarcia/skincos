import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import { createJsonlAuditSink } from './audit.mjs';
import { createInfluencerIntelligenceServiceHandler } from './service-handler.mjs';
import { createCreatorRegistryWriter } from './registry-writer.mjs';
import { createInfluencerIntelligenceReadService } from './read-service.mjs';
import { createSnapshotBatchRunner } from './snapshot-runtime.mjs';
import { INFLUENCER_INTELLIGENCE_GRANT, INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED, parseFeatureFlag, RUNTIME_LIMITS } from './runtime-contract.mjs';

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function error(code) {
  const value = new Error(code);
  value.code = code;
  return value;
}

async function requestFromNode(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > RUNTIME_LIMITS.maxRequestBytes) throw error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`http://${req.headers.host || '127.0.0.1'}${req.url || '/'}`, {
    method: req.method || 'GET',
    headers,
    body: body && body.length ? body : undefined,
    duplex: 'half',
  });
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

function createPool(environment = process.env) {
  const connectionString = String(environment.INFLUENCER_INTELLIGENCE_DATABASE_URL || environment.DATABASE_URL || '').trim();
  if (!connectionString) return null;
  try {
    const packageRequire = createRequire(new URL('../../../crm/api/package.json', import.meta.url));
    const { Pool } = packageRequire('pg');
    return new Pool({ connectionString, max: 4, statement_timeout: RUNTIME_LIMITS.serviceTimeoutMs, idle_in_transaction_session_timeout: RUNTIME_LIMITS.serviceTimeoutMs });
  } catch {
    return null;
  }
}

export function createInternalServiceRuntime({ environment = process.env, clock = () => Date.now(), auditPath } = {}) {
  const configuration = {
    env: environment,
    registered: parseFeatureFlag(environment[INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED]),
    enabled: () => parseFeatureFlag(environment.INFLUENCER_INTELLIGENCE_ENABLED),
    serviceToken: String(environment.INFLUENCER_INTELLIGENCE_SERVICE_TOKEN || '').trim(),
    crmHmacKey: String(environment.INFLUENCER_INTELLIGENCE_ACTOR_HMAC_KEY || '').trim(),
  };
  const audit = createJsonlAuditSink(auditPath || environment.INFLUENCER_INTELLIGENCE_AUDIT_PATH || '/var/log/skincos/influencer-intelligence/service-audit.jsonl');
  let pool;
  let readService;
  let registryWriter;
  async function getQueryable() {
    if (!pool) pool = createPool(environment);
    if (!pool) throw error('UNAVAILABLE');
    return pool;
  }
  async function getReadService() {
    if (!readService) readService = createInfluencerIntelligenceReadService({ queryable: await getQueryable(), clock });
    return readService;
  }
  async function getRegistryWriter() {
    if (!registryWriter) registryWriter = createCreatorRegistryWriter({ queryable: await getQueryable(), clock });
    return registryWriter;
  }
  const snapshotRunner = createSnapshotBatchRunner({ getQueryable, environment, clock });
  const handler = createInfluencerIntelligenceServiceHandler({ getReadService, getRegistryWriter, getSnapshotOperations: async () => snapshotRunner, audit, clock, config: configuration });
  const server = createServer(async (req, res) => {
    try {
      const request = await requestFromNode(req);
      await writeResponse(res, await handler.handle(request));
    } catch (caught) {
      const status = caught?.code === 'REQUEST_TOO_LARGE' ? 413 : 500;
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: caught?.code || 'INTERNAL' }));
    }
  });
  return Object.freeze({ handler, server, configuration, async close() { await new Promise((resolve) => server.close(() => resolve())); if (pool) await pool.end(); } });
}

export async function main() {
  const host = env('INFLUENCER_INTELLIGENCE_SERVICE_HOST', '127.0.0.1');
  const port = Number(env('INFLUENCER_INTELLIGENCE_SERVICE_PORT', '8899'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid service port');
  const runtime = createInternalServiceRuntime();
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(port, host, resolve);
  });
  const stop = async () => { await runtime.close(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.stdout.write(`Influencer Intelligence internal service registered at ${host}:${port}; enabled=${runtime.configuration.enabled()} grant=${INFLUENCER_INTELLIGENCE_GRANT}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
