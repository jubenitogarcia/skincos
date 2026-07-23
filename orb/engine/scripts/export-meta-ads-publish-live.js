#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';

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

async function main() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData", "pinData", meta,
              description, "versionId", "activeVersionId", "versionCounter", "updatedAt"
         FROM n8n_runtime.workflow_entity WHERE id = $1`,
      [WORKFLOW_ID],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Meta Ads Publish workflow not found.');
    const workflow = {
      ...row,
      nodes: parseJson(row.nodes, []),
      connections: parseJson(row.connections, {}),
      settings: parseJson(row.settings, {}),
      staticData: parseJson(row.staticData, null),
      pinData: parseJson(row.pinData, null),
      meta: parseJson(row.meta, {}),
    };
    const buildPayload = workflow.nodes.find((node) => node.name === 'Build Payload');
    if (!buildPayload?.parameters?.jsCode) throw new Error('Build Payload Code node not found.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointRoot = process.env.META_ADS_PUBLISH_CHECKPOINT_ROOT || path.join(
      runtimePaths.runtimeHome,
      'exports',
      'workflow-patches',
    );
    const target = path.join(
      checkpointRoot,
      `meta-ads-build-payload-${stamp}`,
    );
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'workflow.live.json'), `${JSON.stringify(workflow, null, 2)}\n`);
    fs.writeFileSync(path.join(target, 'build-payload.live.js'), buildPayload.parameters.jsCode);
    console.log(JSON.stringify({
      checkpointDir: target,
      versionId: row.versionId,
      versionCounter: Number(row.versionCounter),
      active: row.active,
      updatedAt: row.updatedAt,
      nodeCount: workflow.nodes.length,
      buildPayloadHash: hash(buildPayload.parameters.jsCode),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
