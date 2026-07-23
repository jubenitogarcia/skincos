#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');
const { createMetaAdsPublishStructuredSchema } = require('./lib/meta-ads-publish-structured-schema');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const MODEL_NODE = 'OpenAI Chat Model (Agent)';
const LEGACY_PARSER_NODE = 'Meta Publish Structured Output';
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
    workflow.nodes.find((node) => node.name === MODEL_NODE)
      ?.parameters?.options?.textFormat?.textOptions?.schema || '',
  );
}

function responsesApiEffective(workflow) {
  const model = workflow.nodes.find((node) => node.name === MODEL_NODE);
  const stored = model?.parameters?.responsesApiEnabled;
  return stored === true || (stored === undefined && Number(model?.typeVersion || 0) >= 1.3);
}

function patchWorkflow(workflow, desiredSchema) {
  const nodes = workflow.nodes
    .filter((node) => node.name !== LEGACY_PARSER_NODE)
    .map((node) => {
      if (node.name !== MODEL_NODE) return node;
      const parameters = JSON.parse(JSON.stringify(node.parameters || {}));
      parameters.responsesApiEnabled = true;
      parameters.options ||= {};
      parameters.options.textFormat = {
        textOptions: {
          type: 'json_schema',
          name: 'meta_ads_publish',
          schema: desiredSchema,
        },
      };
      return { ...node, parameters };
    });
  const connections = JSON.parse(JSON.stringify(workflow.connections || {}));
  delete connections[LEGACY_PARSER_NODE];
  for (const channels of Object.values(connections)) {
    for (const output of Object.values(channels)) {
      for (const edges of output) {
        if (!Array.isArray(edges)) continue;
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          if (edges[index]?.node === LEGACY_PARSER_NODE) edges.splice(index, 1);
        }
      }
    }
  }
  return { nodes, connections };
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
      legacyParserPresent: observed.nodes.some((node) => node.name === LEGACY_PARSER_NODE),
      responsesApiStored: observed.nodes.find((node) => node.name === MODEL_NODE)?.parameters?.responsesApiEnabled ?? null,
      responsesApiEnabled: responsesApiEffective(observed),
      currentSchemaHash: hash(schemaFrom(observed)),
      desiredSchemaHash: hash(desiredSchema),
    };
    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (observed.active) throw new Error('Workflow must remain inactive during the patch.');
    if (responsesApiEffective(observed)) {
      console.log(JSON.stringify({ ...summary, changed: false, reason: 'responses_api_already_enabled' }, null, 2));
      return;
    }

    const checkpointDir = path.join(
      runtimePaths.runtimeHome,
      'exports',
      'workflow-patches',
      `meta-ads-responses-schema-${stamp()}`,
    );
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(path.join(checkpointDir, 'workflow.before.json'), `${JSON.stringify(observed, null, 2)}\n`);

    await client.query('BEGIN');
    let after;
    try {
      const current = await load(client, true);
      if (current.versionId !== observed.versionId || hash(schemaFrom(current)) !== hash(schemaFrom(observed))) {
        throw new Error('Workflow changed while acquiring the patch lock.');
      }
      const patched = patchWorkflow(current, desiredSchema);
      const versionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
           connections, name, autosaved, description)
         VALUES ($1, $2, 'Codex Responses API structured output fix', $3, $3, $4::json,
                 $5::json, $6, false, $7)`,
        [versionId, WORKFLOW_ID, now, JSON.stringify(patched.nodes), JSON.stringify(patched.connections), current.name, current.description || ''],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes = $1::json,
                connections = $2::json,
                "versionId" = $3::character(36),
                "activeVersionId" = $3::character varying(36),
                "versionCounter" = COALESCE("versionCounter", 0) + 1,
                "updatedAt" = $4
          WHERE id = $5`,
        [JSON.stringify(patched.nodes), JSON.stringify(patched.connections), versionId, now, WORKFLOW_ID],
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
      legacyParserPresentAfter: after.nodes.some((node) => node.name === LEGACY_PARSER_NODE),
      responsesApiEnabledAfter: responsesApiEffective(after),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
