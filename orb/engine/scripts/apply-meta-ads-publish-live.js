#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const workflowPath = process.argv[2] || path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
const expectedVersionId = process.argv[3];
const expectedVersionCounter = Number(process.argv[4]);
const replaceNodeCodeName = process.env.META_ADS_REPLACE_NODE_CODE_NAME
  || (process.env.META_ADS_REPLACE_NODE_CODE_NAME_B64
    ? Buffer.from(process.env.META_ADS_REPLACE_NODE_CODE_NAME_B64, 'base64').toString('utf8')
    : process.argv[5]);
const replaceNodeCodePath = process.env.META_ADS_REPLACE_NODE_CODE_PATH || process.argv[6];

if (!expectedVersionId || !Number.isInteger(expectedVersionCounter)) {
  throw new Error('Usage: apply-meta-ads-publish-live.js <workflow-json> <expected-version-id> <expected-version-counter> [node-name node-code-path]');
}

if (Boolean(replaceNodeCodeName) !== Boolean(replaceNodeCodePath)) {
  throw new Error('Node name and node code path must be provided together.');
}

async function main() {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  if (workflow.id !== WORKFLOW_ID) throw new Error(`Unexpected workflow id: ${workflow.id}`);
  if (!Array.isArray(workflow.nodes) || !workflow.connections || typeof workflow.connections !== 'object') {
    throw new Error('Workflow export is missing nodes or connections.');
  }
  if (replaceNodeCodeName) {
    const targetNode = workflow.nodes.find((node) => node.name === replaceNodeCodeName);
    if (!targetNode?.parameters || typeof targetNode.parameters.jsCode !== 'string') {
      throw new Error(`Code node not found: ${replaceNodeCodeName}`);
    }
    targetNode.parameters.jsCode = fs.readFileSync(replaceNodeCodePath, 'utf8');
  }

  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, active, "versionId", "versionCounter"
       FROM n8n_runtime.workflow_entity
       WHERE id = $1
       FOR UPDATE`,
      [WORKFLOW_ID],
    );
    const row = current.rows[0];
    if (!row) throw new Error(`Live workflow ${WORKFLOW_ID} not found.`);
    if (row.active) throw new Error('Refusing to patch an active workflow outside the publish flow.');
    if (row.versionId !== expectedVersionId || Number(row.versionCounter) !== expectedVersionCounter) {
      throw new Error(`Live workflow changed concurrently: ${row.versionId}/${row.versionCounter}`);
    }

    const nextVersionId = crypto.randomUUID();
    const nextVersionCounter = Number(row.versionCounter) + 1;
    const updated = await client.query(
      `UPDATE n8n_runtime.workflow_entity
       SET nodes = $1::json,
           connections = $2::json,
           "versionId" = $3,
           "versionCounter" = $4,
           "updatedAt" = NOW()
       WHERE id = $5
         AND "versionId" = $6
         AND "versionCounter" = $7`,
      [JSON.stringify(workflow.nodes), JSON.stringify(workflow.connections), nextVersionId, nextVersionCounter, WORKFLOW_ID, expectedVersionId, expectedVersionCounter],
    );
    if (updated.rowCount !== 1) throw new Error('Optimistic live workflow update did not apply.');

    await client.query(
      `INSERT INTO n8n_runtime.workflow_history (
         "versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description
       )
       SELECT $1, id, '', NOW(), NOW(), $2::json, $3::json, name, false, description
       FROM n8n_runtime.workflow_entity
       WHERE id = $4`,
      [nextVersionId, JSON.stringify(workflow.nodes), JSON.stringify(workflow.connections), WORKFLOW_ID],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ workflow_id: WORKFLOW_ID, previous_version_id: expectedVersionId, previous_version_counter: expectedVersionCounter, version_id: nextVersionId, version_counter: nextVersionCounter }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
