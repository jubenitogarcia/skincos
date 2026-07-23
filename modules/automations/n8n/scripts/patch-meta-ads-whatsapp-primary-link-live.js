#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const NODE_NAME = 'Build Jobs';
const EXPECTED_VERSION_ID = '6cad1ec6-77c5-46df-83dd-7a91183a7c15';
const EXPECTED_NODE_HASH = '87ab30dc39945011e802ae3ff292fa0282e53119cede5c8be36819cfa49fff6a';
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

function nodeCode(workflow) {
  return String(workflow.nodes.find((node) => node.name === NODE_NAME)?.parameters?.jsCode || '');
}

async function main() {
  const sourcePath = path.join(runtimePaths.workflowSrcDir, 'meta-ads-publish', 'build-jobs.js');
  const desiredCode = fs.readFileSync(sourcePath, 'utf8');
  new Function(desiredCode);

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
    const currentHash = hash(nodeCode(observed));
    const desiredHash = hash(desiredCode);
    const summary = {
      apply: APPLY,
      versionId: observed.versionId,
      versionCounter: Number(observed.versionCounter),
      active: observed.active,
      currentNodeHash: currentHash,
      desiredNodeHash: desiredHash,
      onlyNodePatched: NODE_NAME,
    };
    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (observed.active) throw new Error('Workflow must remain inactive during the patch.');
    if (observed.versionId !== EXPECTED_VERSION_ID || currentHash !== EXPECTED_NODE_HASH) {
      throw new Error(`Live workflow changed after inspection: version=${observed.versionId} hash=${currentHash}.`);
    }

    const checkpointDir = path.join(
      runtimePaths.runtimeHome,
      'exports',
      'workflow-patches',
      `meta-ads-whatsapp-primary-link-${stamp()}`,
    );
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(path.join(checkpointDir, 'workflow.before.json'), `${JSON.stringify(observed, null, 2)}\n`);

    await client.query('BEGIN');
    let after;
    try {
      const current = await load(client, true);
      if (current.versionId !== EXPECTED_VERSION_ID || hash(nodeCode(current)) !== EXPECTED_NODE_HASH) {
        throw new Error('Workflow changed while acquiring the patch lock.');
      }
      const nodes = current.nodes.map((node) => (
        node.name === NODE_NAME
          ? { ...node, parameters: { ...node.parameters, jsCode: desiredCode } }
          : node
      ));
      const versionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
           connections, name, autosaved, description)
         VALUES ($1, $2, 'Codex canonical WhatsApp primary link fix', $3, $3, $4::json,
                 $5::json, $6, false, $7)`,
        [versionId, WORKFLOW_ID, now, JSON.stringify(nodes), JSON.stringify(current.connections), current.name, current.description || ''],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes = $1::json,
                "versionId" = $2::character(36),
                "activeVersionId" = $2::character varying(36),
                "versionCounter" = COALESCE("versionCounter", 0) + 1,
                "updatedAt" = $3
          WHERE id = $4`,
        [JSON.stringify(nodes), versionId, now, WORKFLOW_ID],
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
      nodeHashAfter: hash(nodeCode(after)),
      nodeCountPreserved: after.nodes.length === observed.nodes.length,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
