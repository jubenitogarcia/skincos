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

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchAttach(code) {
  let patched = code;
  patched = replaceOnce(
    patched,
    `function getExecutionCompose1Store() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaCompose1)[execId]);
  } catch {
    return {};
  }
}`,
    `function getExecutionCompose1Store() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaCompose1)[execId]);
  } catch {
    return {};
  }
}

function getCompose1ItemsFallback() {
  try {
    return $("Compose (1)").all() || [];
  } catch {
    try {
      return $items("Compose (1)") || [];
    } catch {
      return [];
    }
  }
}`,
    'Attach Compose (1) fallback helpers',
  );

  patched = replaceOnce(
    patched,
    `function findCompose1Context({ groupKey, name, upload, finalUrl }) {
  const keys = cacheKeys(groupKey, name, upload.id, upload.mediaId, upload.public_id, upload.original_filename, upload.display_name, finalUrl);
  const store = getExecutionCompose1Store();
  for (const key of keys) {
    if (store[key]) return asObj(store[key]);
  }
  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  for (const row of rows) {
    const rowKeys = cacheKeys(row.groupKey, row.name, row.id, row.webContentLink);
    if (keys.some((key) => rowKeys.includes(key))) return row;
  }
  if (groupKey) {
    const byGroup = rows.find((row) => str(row.groupKey, "") === groupKey);
    if (byGroup) return byGroup;
  }
  return {};
}`,
    `function findCompose1Context({ groupKey, name, upload, finalUrl }) {
  const keys = cacheKeys(groupKey, name, upload.id, upload.mediaId, upload.public_id, upload.original_filename, upload.display_name, finalUrl);
  const store = getExecutionCompose1Store();
  for (const key of keys) {
    if (store[key]) return asObj(store[key]);
  }
  const staticRows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  const fallbackRows = getCompose1ItemsFallback()
    .map((item) => asObj(item && item.json))
    .filter((row) => Object.keys(row).length);
  const rows = [...staticRows, ...fallbackRows];
  for (const row of rows) {
    const rowKeys = cacheKeys(row.groupKey, row.name, row.id, row.webContentLink);
    if (keys.some((key) => rowKeys.includes(key))) return row;
  }
  if (groupKey) {
    const byGroup = rows.find((row) => str(row.groupKey, "") === groupKey);
    if (byGroup) return byGroup;
  }
  if (rows.length === 1) return rows[0];
  return {};
}`,
    'Attach findCompose1Context fallback',
  );
  return patched;
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-attach-compose1-fallback.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = workflowFromRow(row, false);
const attach = getNode(workflow, 'Attach Uploaded Main Media Metadata');
attach.parameters.jsCode = patchAttach(attach.parameters.jsCode || '');

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-attach-compose1-fallback',
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
