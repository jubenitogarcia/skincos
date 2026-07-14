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

const OLD_FUNCTION = String.raw`function findFrameContext(groupKey, sourceName, upload) {
  const store = getExecutionFrameStore();
  for (const key of cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url, upload.id, upload.mediaId)) {
    if (store[key]) return asObj(store[key]);
  }
  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  const matches = rows.filter((row) => {
    if (groupKey && row.groupKey === groupKey) return true;
    const rowKeys = cacheKeys(row.groupKey, row.mediaName, row.thumbPath, row.candidate?.thumbPath, row.candidate?.url);
    const keys = cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url);
    return keys.some((key) => rowKeys.includes(key));
  });
  if (!matches.length) return {};
  const candidates = matches.flatMap((row) => Array.isArray(row.technicalFrameCandidates) ? row.technicalFrameCandidates : []);
  const best = matches.find((row) => asObj(row.bestFrame).selectedFrameUrl)?.bestFrame || matches[0].bestFrame || {};
  return {
    ...matches[0],
    frameCandidates: candidates.length ? candidates : matches.flatMap((row) => Array.isArray(row.frameCandidates) ? row.frameCandidates : []),
    technicalFrameCandidates: candidates,
    bestFrame: best,
    frameCandidateCount: candidates.length || matches.length,
  };
}`;

const NEW_FUNCTION = String.raw`function findFrameContext(groupKey, sourceName, upload) {
  const store = getExecutionFrameStore();
  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  const keys = cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url);
  const matches = rows.filter((row) => {
    if (groupKey && row.groupKey === groupKey) return true;
    const rowKeys = cacheKeys(row.groupKey, row.mediaName, row.thumbPath, row.candidate?.thumbPath, row.candidate?.url);
    return keys.some((key) => rowKeys.includes(key));
  });
  if (matches.length) {
    const candidates = matches.flatMap((row) => Array.isArray(row.technicalFrameCandidates) ? row.technicalFrameCandidates : []);
    const fallbackCandidates = matches.flatMap((row) => Array.isArray(row.frameCandidates) ? row.frameCandidates : []);
    const best = matches.find((row) => asObj(row.bestFrame).selectedFrameUrl)?.bestFrame || matches[0].bestFrame || {};
    return {
      ...matches[0],
      frameCandidates: candidates.length ? candidates : fallbackCandidates,
      technicalFrameCandidates: candidates.length ? candidates : fallbackCandidates,
      bestFrame: best,
      frameCandidateCount: (candidates.length ? candidates.length : fallbackCandidates.length) || matches.length,
    };
  }
  for (const key of cacheKeys(sourceName, upload.public_id, upload.secure_url, upload.url, upload.id, upload.mediaId)) {
    if (store[key]) return asObj(store[key]);
  }
  return {};
}`;

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-frame-context-aggregation.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = workflowFromRow(row, false);
const attach = getNode(workflow, 'Attach Uploaded Main Media Metadata');
const code = attach.parameters.jsCode || '';
if (!code.includes(OLD_FUNCTION)) throw new Error('Expected findFrameContext function not found');
attach.parameters.jsCode = code.replace(OLD_FUNCTION, NEW_FUNCTION);

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-frame-context-aggregation',
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
