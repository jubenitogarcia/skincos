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

async function main() {
  const runId = String(process.argv[2] || '').trim();
  if (!/^map_[a-f0-9]{24}$/.test(runId)) {
    throw new Error('Usage: heartbeat-meta-ads-publish-run-live.js <run_id>');
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

  const response = await fetch(
    `${BASE_URL}/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}/heartbeat`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Heartbeat failed with HTTP ${response.status}: ${body.error || 'unknown_error'}`);
  }

  console.log(JSON.stringify({
    ok: true,
    run_id: body.run_id,
    heartbeat_at: body.heartbeat_at,
    lock_expires_at: body.lock_expires_at,
    request_id: body.requestId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
