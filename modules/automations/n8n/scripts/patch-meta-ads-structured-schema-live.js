#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');
const { createMetaAdsPublishStructuredSchema } = require('./lib/meta-ads-publish-structured-schema');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const NODE_NAME = 'OpenAI Chat Model (Agent)';
const EXPECTED_VERSION_ID = '06e6fe14-7201-4227-9412-19bac0154e17';
const EXPECTED_SCHEMA_HASH = '8d4f4d9bcb49b19f89138b9499519bc1706587217208754409aa3ee27e6ff56f';
const APPLY = process.argv.includes('--apply');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function serialize(row) {
  return {
    ...row,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: parseJson(row.pinData, null),
    meta: parseJson(row.meta, {}),
  };
}

async function load(client, lock = false) {
  const result = await client.query(
    `SELECT id, name, active, nodes, connections, settings, "staticData", "pinData", meta,
            description, "versionId", "activeVersionId", "versionCounter", "updatedAt"
       FROM n8n_runtime.workflow_entity WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [WORKFLOW_ID],
  );
  return result.rows[0] ? serialize(result.rows[0]) : null;
}

function schemaFrom(workflow) {
  return String(
    workflow.nodes.find((node) => node.name === NODE_NAME)
      ?.parameters?.options?.textFormat?.textOptions?.schema || '',
  );
}

async function main() {
  const desiredSchema = JSON.stringify(createMetaAdsPublishStructuredSchema(), null, 2);
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const observed = await load(client);
    if (!observed) throw new Error('Meta Ads Publish workflow not found.');
    const summary = {
      apply: APPLY,
      versionId: observed.versionId,
      versionCounter: Number(observed.versionCounter),
      active: observed.active,
      nodeCount: observed.nodes.length,
      currentSchemaHash: hash(schemaFrom(observed)),
      desiredSchemaHash: hash(desiredSchema),
      onlyNodePatched: NODE_NAME,
    };
    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (observed.active) throw new Error('Workflow must remain inactive during the patch.');
    if (observed.versionId !== EXPECTED_VERSION_ID) throw new Error(`Workflow version drifted: ${observed.versionId}.`);
    if (hash(schemaFrom(observed)) !== EXPECTED_SCHEMA_HASH) throw new Error('Structured schema changed after inspection.');

    const checkpointDir = path.join(
      runtimePaths.runtimeHome,
      'exports',
      'workflow-patches',
      `meta-ads-structured-schema-${stamp()}`,
    );
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(path.join(checkpointDir, 'workflow.before.json'), `${JSON.stringify(observed, null, 2)}\n`);

    await client.query('BEGIN');
    let after;
    try {
      const current = await load(client, true);
      if (current.versionId !== EXPECTED_VERSION_ID || hash(schemaFrom(current)) !== EXPECTED_SCHEMA_HASH) {
        throw new Error('Workflow changed while acquiring the patch lock.');
      }
      const patchedNodes = current.nodes.map((node) => {
        if (node.name !== NODE_NAME) return node;
        const parameters = JSON.parse(JSON.stringify(node.parameters || {}));
        parameters.options ||= {};
        parameters.options.textFormat = {
          textOptions: {
            type: 'json_schema',
            name: 'structured_output_parser',
            schema: desiredSchema,
          },
        };
        return { ...node, parameters };
      });
      const versionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
           connections, name, autosaved, description)
         VALUES ($1, $2, 'Codex strict structured schema fix', $3, $3, $4::json,
                 $5::json, $6, false, $7)`,
        [versionId, WORKFLOW_ID, now, JSON.stringify(patchedNodes), JSON.stringify(current.connections), current.name, current.description || ''],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes = $1::json,
                "versionId" = $2::character(36),
                "activeVersionId" = $2::character varying(36),
                "versionCounter" = COALESCE("versionCounter", 0) + 1,
                "updatedAt" = $3
          WHERE id = $4`,
        [JSON.stringify(patchedNodes), versionId, now, WORKFLOW_ID],
      );
      await client.query('COMMIT');
      after = await load(client);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    fs.writeFileSync(path.join(checkpointDir, 'workflow.after.json'), `${JSON.stringify(after, null, 2)}\n`);
    console.log(JSON.stringify({
      ...summary,
      checkpointDir,
      newVersionId: after.versionId,
      newVersionCounter: Number(after.versionCounter),
      activeAfter: after.active,
      nodeCountAfter: after.nodes.length,
      schemaHashAfter: hash(schemaFrom(after)),
      otherNodesPreserved: after.nodes.length === observed.nodes.length,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
