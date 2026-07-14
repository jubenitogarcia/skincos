#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.active.json'),
  path.join(__dirname, '..', 'workflows', 'livia.verify.json'),
];

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    versionId: row.versionId || '',
    activeVersionId: row.activeVersionId || row.versionId || '',
    meta: parseJson(row.meta, {}),
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const workflow = workflowFromRow(row);
const prepare = getNode(workflow, 'Prepare Request');
let code = String(prepare.parameters.jsCode || '');

if (!code.includes('function runPrepareRequestLifecycle(incomingJson, inputItems)')) {
  code = code.replace(
    'function runPrepareRequestLifecycle(incoming, inputItems) {',
    'function runPrepareRequestLifecycle(incomingJson, inputItems) {',
  );
  code = code.replace('const $json = incoming;', 'const $json = incomingJson;');
  code = code.replace('item: { json: incoming },', 'item: { json: incomingJson },');
}

prepare.parameters.jsCode = code;

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-unified-prepare-request-wrapper-fix',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
  },
};

workflow.versionId = versionId;
workflow.activeVersionId = versionId;
workflow.updatedAt = updatedAt;
workflow.meta = meta;
workflow.pinData = {};

const nodesJson = JSON.stringify(workflow.nodes);
const connectionsJson = JSON.stringify(workflow.connections);
const metaJson = JSON.stringify(meta);

db.transaction(() => {
  db.prepare(`
    insert into workflow_history
      (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
    values
      (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
  `).run({
    versionId,
    workflowId: WORKFLOW_ID,
    authors: 'Codex',
    createdAt: updatedAt,
    updatedAt,
    nodes: nodesJson,
    connections: connectionsJson,
    name: workflow.name,
    description: row.description || null,
  });

  db.prepare(`
    update workflow_entity
    set nodes = @nodes,
        connections = @connections,
        meta = @meta,
        versionId = @versionId,
        activeVersionId = @versionId,
        updatedAt = @updatedAt,
        versionCounter = versionCounter + 1
    where id = @workflowId
  `).run({
    nodes: nodesJson,
    connections: connectionsJson,
    meta: metaJson,
    versionId,
    updatedAt,
    workflowId: WORKFLOW_ID,
  });
})();

for (const exportPath of EXPORT_PATHS) {
  writeExport(workflow, exportPath);
}

console.log(JSON.stringify({
  ok: true,
  workflowId: WORKFLOW_ID,
  previousVersionId: row.versionId,
  versionId,
}, null, 2));
