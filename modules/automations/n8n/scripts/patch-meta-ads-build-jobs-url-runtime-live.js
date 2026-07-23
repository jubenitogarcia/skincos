#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const NODE_NAME = 'Build Jobs';
const EXPECTED_NODE_HASH = '414cbe1e9c787495ccc3c608c8964bb4c490734da058fcf34e89757987f91957';
const APPLY = process.argv.includes('--apply');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
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

function codeFor(workflow) {
  const node = workflow.nodes.find((entry) => entry.name === NODE_NAME);
  if (!node?.parameters?.jsCode) throw new Error(`${NODE_NAME} was not found.`);
  return String(node.parameters.jsCode);
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

async function main() {
  const desiredCode = fs.readFileSync(
    path.join(runtimePaths.workflowSrcDir, 'meta-ads-publish', 'build-jobs.js'),
    'utf8',
  ).replace(/\s+$/, '');
  new Function(desiredCode);
  if (!desiredCode.includes('function parseHttpsHostname') || desiredCode.includes('new URL(')) {
    throw new Error('The desired Build Jobs source does not contain the URL-runtime compatibility repair.');
  }

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
    const currentCode = codeFor(observed);
    const currentHash = hash(currentCode);
    const desiredHash = hash(desiredCode);
    const summary = {
      apply: APPLY,
      versionId: observed.versionId,
      versionCounter: Number(observed.versionCounter),
      active: observed.active,
      currentNodeHash: currentHash,
      desiredNodeHash: desiredHash,
      node: NODE_NAME,
    };
    if (!APPLY) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (observed.active) throw new Error('Workflow must remain inactive during this patch.');
    if (currentHash !== EXPECTED_NODE_HASH || !currentCode.includes('new URL(')) {
      throw new Error(`Live Build Jobs changed after inspection: hash=${currentHash}.`);
    }

    const checkpointDir = path.join(runtimePaths.runtimeHome, 'exports', 'workflow-patches', `meta-ads-build-jobs-url-runtime-${stamp()}`);
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(path.join(checkpointDir, 'workflow.before.json'), `${JSON.stringify(observed, null, 2)}\n`);

    await client.query('BEGIN');
    let after;
    try {
      const current = await load(client, true);
      if (!current || current.active || hash(codeFor(current)) !== EXPECTED_NODE_HASH || !codeFor(current).includes('new URL(')) {
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
         VALUES ($1, $2, 'Codex Build Jobs URL-runtime compatibility repair', $3, $3, $4::json,
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
      nodeHashAfter: hash(codeFor(after)),
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
