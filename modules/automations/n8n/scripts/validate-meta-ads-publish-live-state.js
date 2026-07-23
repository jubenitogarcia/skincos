#!/usr/bin/env node
'use strict';

const MAIN_WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const ERROR_WORKFLOW_ID = 'metaAdsPublishErrorV1';
const CREDENTIAL_ID = 'metaPublishGatewayBearer';

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function value(input, fallback) {
  if (input === null || input === undefined || input === '') return fallback;
  return typeof input === 'string' ? JSON.parse(input) : input;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const workflows = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData", "pinData",
              "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id = ANY($1::text[])`,
      [[MAIN_WORKFLOW_ID, ERROR_WORKFLOW_ID]],
    );
    const byId = new Map(workflows.rows.map((row) => [row.id, row]));
    const main = byId.get(MAIN_WORKFLOW_ID);
    const error = byId.get(ERROR_WORKFLOW_ID);
    assert(main, 'Main workflow missing.');
    assert(error, 'Error workflow missing.');
    assert(main.active === false, 'Main workflow must remain inactive.');
    assert(error.active === false, 'Error workflow must remain inactive.');
    assert(main.activeVersionId === null, 'Inactive main workflow must not have a published version.');
    assert(error.activeVersionId === null, 'Inactive error workflow must not have a published version.');
    assert(main.staticData === null && main.pinData === null, 'Main workflow retained static or pinned data.');

    const nodes = value(main.nodes, []);
    const settings = value(main.settings, {});
    const serialized = JSON.stringify({ nodes, connections: value(main.connections, {}), settings });
    const forbidden = [
      'graph.facebook.com',
      'access_token',
      'TOKEN_VAULT_API_TOKEN',
      "'v24.0'",
      '$getWorkflowStaticData',
    ].filter((marker) => serialized.includes(marker));
    if (nodes.some((node) => node.name === 'Meta API Params')) forbidden.push('Meta API Params node');
    assert(forbidden.length === 0, `Forbidden workflow markers: ${forbidden.join(', ')}`);
    assert(settings.errorWorkflow === ERROR_WORKFLOW_ID, 'Error workflow setting is missing.');
    assert(settings.saveDataSuccessExecution === 'all', 'Successful execution data must be retained.');
    assert(settings.saveDataErrorExecution === 'all', 'Failed execution data must be retained.');
    assert(settings.saveManualExecutions === true, 'Manual execution data must be retained.');
    assert(settings.saveExecutionProgress === true, 'Execution progress must be retained.');

    const mutatingGatewayNodes = new Set([
      'Gateway Upload Image',
      'Create AdCreative',
      'Stage Ad Batch',
      'Activate Ad Batch',
      'Rollback Ad Batch',
    ]);
    for (const node of nodes.filter((entry) => mutatingGatewayNodes.has(entry.name))) {
      assert(node.retryOnFail !== true, `${node.name} must not use n8n generic retries.`);
      assert(node.credentials?.httpBearerAuth?.id === CREDENTIAL_ID, `${node.name} is not using the encrypted gateway credential.`);
    }

    const credential = await client.query(
      `SELECT c.id, c.name, c.type, length(c.data) AS encrypted_length,
              EXISTS (
                SELECT 1 FROM n8n_runtime.shared_credentials s
                 WHERE s."credentialsId" = c.id
              ) AS shared
         FROM n8n_runtime.credentials_entity c WHERE c.id = $1`,
      [CREDENTIAL_ID],
    );
    const gateway = credential.rows[0];
    assert(gateway?.type === 'httpBearerAuth', 'Encrypted gateway credential is missing.');
    assert(Number(gateway.encrypted_length) > 32, 'Gateway credential does not appear encrypted.');
    assert(gateway.shared === true, 'Gateway credential is not shared with the workflow project.');

    console.log(JSON.stringify({
      ok: true,
      main: {
        id: main.id,
        active: main.active,
        version_counter: Number(main.versionCounter),
        version_id: main.versionId,
        node_count: nodes.length,
        forbidden_markers: forbidden,
      },
      error_workflow: {
        id: error.id,
        active: error.active,
        version_counter: Number(error.versionCounter),
      },
      gateway_credential: {
        id: gateway.id,
        type: gateway.type,
        encrypted: true,
        shared: gateway.shared,
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
