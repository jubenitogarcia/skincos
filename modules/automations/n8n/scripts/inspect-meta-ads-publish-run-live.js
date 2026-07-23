#!/usr/bin/env node
'use strict';

const BASE_URL = String(
  process.env.TOKEN_VAULT_BASE_URL
    || 'https://api.skincos.com.br/internal/token-vault',
).replace(/\/$/, '');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function errorSummary(value) {
  const error = value && typeof value === 'object' ? value : {};
  return {
    classification: String(error.classification || error.error_class || ''),
    code: error.code ?? null,
    error_subcode: error.error_subcode ?? null,
    message: String(error.message || error.error || '').slice(0, 500),
    fbtrace_id: String(error.fbtrace_id || ''),
    retryable: Boolean(error.retryable),
    ambiguous: Boolean(error.ambiguous),
  };
}

async function main() {
  const runId = String(process.argv[2] || '').trim();
  if (!/^map_[a-f0-9]{24}$/.test(runId)) {
    throw new Error('Usage: inspect-meta-ads-publish-run-live.js <run_id>');
  }

  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  let token;
  try {
    const result = await client.query(
      `SELECT value FROM n8n_runtime.variables WHERE key = 'TOKEN_VAULT_API_TOKEN'`,
    );
    token = String(result.rows[0]?.value || '').trim();
  } finally {
    await client.end();
  }
  if (!token) throw new Error('TOKEN_VAULT_API_TOKEN is not configured in n8n.');

  const response = await fetch(`${BASE_URL}/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Run inspection failed with HTTP ${response.status}: ${body.error || 'unknown_error'}`);
  }

  console.log(JSON.stringify({
    run: {
      id: body.run?.id,
      status: body.run?.status,
      workflow_execution_id: body.run?.workflow_execution_id,
      heartbeat_at: body.run?.heartbeat_at,
      lock_expires_at: body.run?.lock_expires_at,
      error: errorSummary(body.run?.error),
    },
    jobs: (body.jobs || []).map((job) => ({
      operation_key: job.operation_key,
      destination_group: job.destination_group,
      creative_group_key: job.creative_group_key,
      action: job.action,
      status: job.status,
      error: errorSummary(job.error),
    })),
    operations: (body.operations || []).map((operation) => ({
      operation_key: operation.operation_key,
      action: operation.action,
      status: operation.status,
      attempt_count: operation.attempt_count,
      error: errorSummary(operation.error),
      fbtrace_id: operation.fbtrace_id || '',
    })),
    request_id: body.requestId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
