#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const EXPECTED_VERSION_ID = '2f8d46fc-481e-4044-9e43-f6868e0b1221';
const APPLY = process.argv.includes('--apply');
const workflowPath = path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateDesired(workflow) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const required of [
    'Prepare Visual Grouping Batch',
    'Visual Grouping Agent',
    'OpenAI Vision Model (Grouping)',
    'Validate Visual Grouping',
    'Build Payload',
  ]) {
    if (!names.has(required)) throw new Error(`Desired workflow missing ${required}.`);
  }
  const credential = workflow.nodes.find((node) => node.name === 'OpenAI Vision Model (Grouping)')?.credentials?.openAiApi;
  if (credential?.id !== 'd5x9D1q8y2QXDeUD') throw new Error('Visual grouping model is not using the approved OpenAI credential.');
  const mediaEdge = workflow.connections?.['Download File']?.main?.[0]?.[0]?.node;
  if (mediaEdge !== 'Prepare Visual Grouping Batch') throw new Error('Download File does not feed the visual grouping batch.');
}

async function main() {
  const desired = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  validateDesired(desired);
  const Client = loadPgClient();
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const beforeResult = await client.query(
      `SELECT id, name, active, nodes, connections, settings, description,
              "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id=$1`,
      [WORKFLOW_ID],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new Error('Meta Ads Publish workflow not found.');
    const report = {
      apply: APPLY,
      workflow_id: WORKFLOW_ID,
      current_version_id: before.versionId,
      current_version_counter: Number(before.versionCounter),
      current_active: before.active,
      current_node_count: parseJson(before.nodes, []).length,
      desired_node_count: desired.nodes.length,
      desired_hash: digest({ nodes: desired.nodes, connections: desired.connections, settings: desired.settings }),
    };
    if (!APPLY) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (before.versionId !== EXPECTED_VERSION_ID) {
      throw new Error(`Live workflow drifted after checkpoint: expected ${EXPECTED_VERSION_ID}, got ${before.versionId}.`);
    }
    if (before.active !== false || before.activeVersionId !== null) {
      throw new Error('Workflow must remain inactive while applying this manual-only change.');
    }

    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      const locked = await client.query(
        `SELECT "versionId" FROM n8n_runtime.workflow_entity WHERE id=$1 FOR UPDATE`,
        [WORKFLOW_ID],
      );
      if (locked.rows[0]?.versionId !== EXPECTED_VERSION_ID) {
        throw new Error(`Workflow changed while locking: ${locked.rows[0]?.versionId}.`);
      }
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
           connections, name, autosaved, description)
         VALUES ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
        [versionId, WORKFLOW_ID, 'Codex visual grouping and landing recurrence fix', now,
          JSON.stringify(desired.nodes), JSON.stringify(desired.connections), desired.name, desired.description || before.description || ''],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET name=$1, active=false, nodes=$2::json, connections=$3::json, settings=$4::json,
                "staticData"=NULL, "pinData"=NULL, description=$5,
                "versionId"=$6::character(36), "activeVersionId"=NULL,
                "versionCounter"=COALESCE("versionCounter",0)+1, "updatedAt"=$7
          WHERE id=$8`,
        [desired.name, JSON.stringify(desired.nodes), JSON.stringify(desired.connections), JSON.stringify(desired.settings || {}),
          desired.description || before.description || '', versionId, now, WORKFLOW_ID],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const afterResult = await client.query(
      `SELECT active, nodes, connections, settings, "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id=$1`,
      [WORKFLOW_ID],
    );
    const after = afterResult.rows[0];
    const persisted = {
      nodes: parseJson(after.nodes, []),
      connections: parseJson(after.connections, {}),
      settings: parseJson(after.settings, {}),
    };
    const persistedHash = digest(persisted);
    if (persistedHash !== report.desired_hash) throw new Error('Persisted workflow hash differs from desired workflow.');
    console.log(JSON.stringify({
      ...report,
      new_version_id: after.versionId,
      new_version_counter: Number(after.versionCounter),
      active: after.active,
      active_version_id: after.activeVersionId,
      persisted_hash: persistedHash,
      meta_mutations_performed: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
