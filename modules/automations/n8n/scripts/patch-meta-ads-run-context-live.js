#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const APPLY = process.argv.includes('--apply');
const SOURCES = Object.freeze({
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
});

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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

function sourceMap() {
  return new Map(Object.entries(SOURCES).map(([name, file]) => {
    const code = fs.readFileSync(path.join(runtimePaths.workflowSrcDir, 'meta-ads-publish', file), 'utf8').replace(/\s+$/, '');
    new Function('$input', '$items', '$', 'URL', code);
    return [name, code];
  }));
}

async function load(client, lock = false) {
  const result = await client.query(
    `SELECT id, name, active, nodes, connections, settings, "staticData", "pinData", meta,
            description, "versionId", "activeVersionId", "versionCounter", "updatedAt"
       FROM n8n_runtime.workflow_entity WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [WORKFLOW_ID],
  );
  return result.rows[0] ? serialize(result.rows[0]) : null;
}

function nodeHashes(workflow) {
  return Object.fromEntries(Object.keys(SOURCES).map((name) => {
    const node = workflow.nodes.find((entry) => entry.name === name);
    if (!node || node.type !== 'n8n-nodes-base.code') throw new Error(`Code node not found: ${name}`);
    return [name, hash(String(node.parameters?.jsCode || '').replace(/\s+$/, ''))];
  }));
}

async function main() {
  const desired = sourceMap();
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const observed = await load(client);
    if (!observed) throw new Error('Meta Ads - Publish workflow not found.');
    if (observed.active) throw new Error('Workflow must remain inactive during the patch.');
    const beforeHashes = nodeHashes(observed);
    const desiredHashes = Object.fromEntries([...desired].map(([name, code]) => [name, hash(code)]));
    const changedNodes = Object.keys(SOURCES).filter((name) => beforeHashes[name] !== desiredHashes[name]);
    const summary = {
      apply: APPLY,
      versionId: observed.versionId,
      activeVersionId: observed.activeVersionId,
      versionCounter: Number(observed.versionCounter),
      changedNodes,
      beforeHashes,
      desiredHashes,
    };
    if (!APPLY || !changedNodes.length) {
      console.log(JSON.stringify({ ...summary, alreadyApplied: changedNodes.length === 0 }, null, 2));
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointDir = path.join(runtimePaths.runtimeHome, 'exports', 'workflow-patches', `meta-ads-run-context-${stamp}`);
    fs.mkdirSync(checkpointDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(checkpointDir, 'workflow.before.json'), `${JSON.stringify(observed, null, 2)}\n`, { mode: 0o600 });

    await client.query('BEGIN');
    let after;
    try {
      const current = await load(client, true);
      if (current.versionId !== observed.versionId || JSON.stringify(nodeHashes(current)) !== JSON.stringify(beforeHashes)) {
        throw new Error('Workflow changed while acquiring the patch lock.');
      }
      const nodes = current.nodes.map((node) => desired.has(node.name)
        ? { ...node, parameters: { ...node.parameters, jsCode: desired.get(node.name) } }
        : node);
      const versionId = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes,
           connections, name, autosaved, description)
         VALUES ($1, $2, 'Codex Meta Ads controlled recovery guardrails', $3, $3, $4::json,
                 $5::json, $6, false, $7)`,
        [versionId, WORKFLOW_ID, now, JSON.stringify(nodes), JSON.stringify(current.connections), current.name, current.description || ''],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes=$1::json, "versionId"=$2::character(36),
                "versionCounter"=COALESCE("versionCounter", 0)+1, "updatedAt"=$3
          WHERE id=$4`,
        [JSON.stringify(nodes), versionId, now, WORKFLOW_ID],
      );
      await client.query('COMMIT');
      after = await load(client);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    fs.writeFileSync(path.join(checkpointDir, 'workflow.after.json'), `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      ...summary,
      checkpointDir,
      newVersionId: after.versionId,
      newActiveVersionId: after.activeVersionId,
      newVersionCounter: Number(after.versionCounter),
      afterHashes: nodeHashes(after),
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
