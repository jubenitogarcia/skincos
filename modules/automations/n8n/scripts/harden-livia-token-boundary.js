#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APPLY_LIVE = process.argv.includes('--apply-live');
const MODULE_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(MODULE_ROOT, 'workflows', 'livia.active.json');
const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/mnt/c/CodexRuntime/n8n';
const TARGET_IDS = new Set(['WGXr4vYkv9UoJ8zc', '4edff84e07534309', 'f7bd5f08ac17460f']);
const BASE = "($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault')";
const AUTH = { httpBearerAuth: { id: 'metaPublishGatewayBearer', name: 'Meta Ads Publish - Gateway Bearer' } };

function hardenEmbeddedCode(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\(\"Get Credential Tokens\"\)/g, '$("Get Credential Tokens")')
    .replace(/str\(token\.fbToken \|\| token\.token, \"\"\)/g, '"__TOKEN_GATEWAY__"')
    .replace(/str\(token\.igToken \|\| token\.token, \"\"\)/g, '"__TOKEN_GATEWAY__"')
    .replace(/str\(token\.thToken \|\| token\.token, \"\"\)/g, '"__TOKEN_GATEWAY__"');
}

function harden(workflow) {
  for (const current of workflow.nodes || []) {
    if (current.name === 'Get Credential Tokens') {
      current.type = 'n8n-nodes-base.httpRequest';
      current.typeVersion = 4.2;
      current.parameters = {
        url: `={{ ${BASE} + '/v1/token-metadata?active=true' }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        options: { timeout: 120000 },
      };
      current.credentials = AUTH;
      continue;
    }

    if (current.name === 'HTTP Request') {
      current.type = 'n8n-nodes-base.httpRequest';
      current.typeVersion = 4.2;
      current.parameters = {
        method: 'POST',
        url: `={{ ${BASE} + '/v1/social-publish/operations' }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'application/json',
        body: `={{ JSON.stringify({
  platform: $json.platform,
  unit: $json.unit,
  operation: $json.step || $json.phase,
  method: $json.method || $json.httpRequest?.method || 'POST',
  url: $json.url || $json.httpRequest?.url,
  query: $json.params || $json.query || $json.httpRequest?.query || {},
  headers: $json.requestHeaders || $json.headers || $json.httpRequest?.headers || {},
  body: ($json.requestSkipBody || $json.httpRequest?.skipBody)
    ? {}
    : ($json.requestBody || $json.jsonRequest || $json.httpRequest?.body || {})
}) }}`,
        options: { timeout: 120000, response: { response: { neverError: true, responseFormat: 'json' } } },
      };
      current.credentials = AUTH;
      continue;
    }

    for (const key of ['jsCode', 'jsonOutput', 'command']) {
      if (typeof current.parameters?.[key] === 'string') {
        current.parameters[key] = hardenEmbeddedCode(current.parameters[key]);
      }
    }
  }

  workflow.settings = {
    ...(workflow.settings || {}),
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
  };
  return workflow;
}

async function main() {
  const source = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  fs.writeFileSync(WORKFLOW_PATH, `${JSON.stringify(harden(source), null, 2)}\n`);

  const updated = [];
  if (APPLY_LIVE) {
    const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
    const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
    await client.connect();
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, description,
              "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity
        WHERE id = ANY($1::varchar[])
        ORDER BY id`,
      [[...TARGET_IDS]],
    );
    const rows = result.rows;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointDir = path.join(RUNTIME_HOME, 'exports', 'workflow-patches');
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(path.join(checkpointDir, `livia-token-boundary.before-${timestamp}.json`), JSON.stringify(rows, null, 2), { mode: 0o600 });
    await client.query('BEGIN');
    try {
      for (const row of rows) {
        if (!TARGET_IDS.has(row.id)) continue;
        const workflow = harden(row);
        const versionId = crypto.randomUUID();
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO n8n_runtime.workflow_history
            ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
             connections, name, autosaved, description)
           VALUES ($1, $2, 'Codex execution history hardening', $3, $3, $4::json, $5::json, $6, false, $7)`,
          [versionId, row.id, now, JSON.stringify(workflow.nodes), JSON.stringify(row.connections || {}), row.name, row.description || ''],
        );
        await client.query(
          `UPDATE n8n_runtime.workflow_entity
              SET nodes=$1::json,
                  settings=$2::json,
                  "versionId"=$3::character(36),
                  "activeVersionId"=CASE WHEN active THEN $3::character varying(36) ELSE NULL END,
                  "versionCounter"=COALESCE("versionCounter", 0) + 1,
                  "updatedAt"=$4
            WHERE id=$5`,
          [JSON.stringify(workflow.nodes), JSON.stringify(workflow.settings), versionId, now, row.id],
        );
        updated.push({ id: row.id, name: row.name, versionId });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }
  console.log(JSON.stringify({ ok: true, live: APPLY_LIVE, updated }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
module.exports = { harden };
