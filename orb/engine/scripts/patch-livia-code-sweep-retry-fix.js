#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.env.HOME, '.n8n', 'database.sqlite');
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPECTED_VERSION_ID = '29f0e5b1-0c25-4252-b46f-0807343bf121';
const ROOT = path.join(__dirname, '..');
const EXPORT_PATHS = [
  path.join(ROOT, 'workflows', 'livia.json'),
  path.join(ROOT, 'workflows', 'livia.active.json'),
  path.join(ROOT, 'workflows', 'livia.verify.json'),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || null,
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function extractFunctionSource(code, name) {
  const marker = `function ${name}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`Function not found: ${name}`);

  let depth = 0;
  let opened = false;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') {
      depth += 1;
      opened = true;
    } else if (char === '}') {
      depth -= 1;
      if (opened && depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not extract function: ${name}`);
}

function replaceFunctionSource(code, name, nextSource) {
  const current = extractFunctionSource(code, name);
  return code.replace(current, nextSource.trim());
}

function patchAttachCode(code) {
  const nextFrameStoreFn = `
function getExecutionFrameStoreForWrite() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaFrameUploads ||= {};
    for (const key of Object.keys(sd.__liviaFrameUploads)) {
      if (key !== execId) delete sd.__liviaFrameUploads[key];
    }
    sd.__liviaFrameUploads[execId] = {};
    return sd.__liviaFrameUploads[execId];
  } catch {
    return null;
  }
}
`.trim();

  const nextMainStoreFn = `
function getExecutionMainStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaMainUploads ||= {};
    for (const key of Object.keys(sd.__liviaMainUploads)) {
      if (key !== execId) delete sd.__liviaMainUploads[key];
    }
    sd.__liviaMainUploads[execId] = {};
    return sd.__liviaMainUploads[execId];
  } catch {
    return null;
  }
}
`.trim();

  let patched = replaceFunctionSource(code, 'getExecutionFrameStoreForWrite', nextFrameStoreFn);
  patched = replaceFunctionSource(patched, 'getExecutionMainStore', nextMainStoreFn);
  return patched;
}

function persistWorkflow(db, row, workflow) {
  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  const nodes = JSON.stringify(workflow.nodes);
  const connections = JSON.stringify(workflow.connections);
  const settings = JSON.stringify(workflow.settings || {});
  const staticData = JSON.stringify(workflow.staticData || {});
  const pinData = JSON.stringify(workflow.pinData || {});
  const meta = JSON.stringify(workflow.meta || {});

  db.prepare(`
    INSERT INTO workflow_history (
      versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    versionId,
    WORKFLOW_ID,
    'Codex',
    updatedAt,
    updatedAt,
    nodes,
    connections,
    workflow.name,
    workflow.description || row.description || null,
  );

  db.prepare(`
    UPDATE workflow_entity
    SET
      name = ?,
      nodes = ?,
      connections = ?,
      settings = ?,
      staticData = ?,
      pinData = ?,
      meta = ?,
      description = ?,
      versionId = ?,
      activeVersionId = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    workflow.name,
    nodes,
    connections,
    settings,
    staticData,
    pinData,
    meta,
    workflow.description || row.description || null,
    versionId,
    versionId,
    updatedAt,
    WORKFLOW_ID,
  );

  return { versionId, updatedAt };
}

function exportWorkflow(workflow, versionId, updatedAt) {
  const exportData = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    active: workflow.active,
    settings: workflow.settings || {},
    staticData: workflow.staticData || {},
    pinData: workflow.pinData || {},
    meta: workflow.meta || {},
    versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) {
    fs.writeFileSync(exportPath, `${JSON.stringify(exportData, null, 2)}\n`);
  }
}

function main() {
  const db = new Database(DB_PATH);
  try {
    const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
    assert(row, `Workflow not found: ${WORKFLOW_ID}`);
    assert(row.versionId === EXPECTED_VERSION_ID, `Expected versionId ${EXPECTED_VERSION_ID}, got ${row.versionId}`);

    const workflow = workflowFromRow(row);
    const attach = findNode(workflow, 'Attach Uploaded Main Media Metadata');
    attach.parameters = {
      ...(attach.parameters || {}),
      jsCode: patchAttachCode(String(attach.parameters?.jsCode || '')),
    };

    const persisted = persistWorkflow(db, row, workflow);
    exportWorkflow(workflow, persisted.versionId, persisted.updatedAt);

    console.log(JSON.stringify({
      ok: true,
      workflowId: WORKFLOW_ID,
      previousVersionId: row.versionId,
      versionId: persisted.versionId,
      exportPaths: EXPORT_PATHS,
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
