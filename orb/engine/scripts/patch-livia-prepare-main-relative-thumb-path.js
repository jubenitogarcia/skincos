#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function workflowFromRow(row, includePinData = false) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: includePinData ? parseJson(row.pinData, {}) : {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

const OLD_BLOCK = String.raw`function normalizeTmpPath(value) {
  const raw = str(value, "").trim();
  if (!raw) return "";
  const resolved = path.resolve(raw);
  const tmpRoot = path.resolve(TMP_DIR);
  if (resolved === tmpRoot || !resolved.startsWith(tmpRoot + path.sep)) return "";
  return resolved;
}`;

const NEW_BLOCK = String.raw`function normalizeTmpPath(value) {
  const raw = str(value, "").trim();
  if (!raw) return "";
  const tmpRoot = path.resolve(TMP_DIR);
  const candidate = path.isAbsolute(raw) ? raw : path.join(tmpRoot, fileNameOnly(raw));
  const resolved = path.resolve(candidate);
  if (resolved === tmpRoot || !resolved.startsWith(tmpRoot + path.sep)) return "";
  return resolved;
}`;

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-main-relative-thumb-path.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = workflowFromRow(row, false);
const node = getNode(workflow, 'Prepare Main Media Upload');
const code = node.parameters?.jsCode || '';
if (!code.includes(OLD_BLOCK)) {
  throw new Error('Expected normalizeTmpPath block not found in Prepare Main Media Upload');
}
node.parameters.jsCode = code.replace(OLD_BLOCK, NEW_BLOCK);

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-prepare-main-relative-thumb-path',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
    previousActiveVersionId: row.activeVersionId,
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
  previousActiveVersionId: row.activeVersionId,
  versionId,
  checkpointPath,
  nodes: workflow.nodes.length,
}, null, 2));
