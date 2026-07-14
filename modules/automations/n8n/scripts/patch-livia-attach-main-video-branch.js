#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.env.HOME, '.n8n', 'database.sqlite');
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPECTED_VERSION_ID = 'e5abdd4f-a659-4bc6-aa54-0e144bec94d0';
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

function backupWorkflow(workflow) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', 'T');
  const backupPath = path.join(ROOT, 'workflows', `livia.before-attach-main-video-branch.${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(workflow, null, 2)}\n`);
  return backupPath;
}

function patchAttachCode(code) {
  const marker = 'const mainGroupKeys = new Set(mainRecords.map((record) => record.groupKey).filter(Boolean));';
  if (code.includes(marker)) return code;

  const insertBefore = 'mainRecords.sort((left, right) => {';
  const guardBlock = `
const mainGroupKeys = new Set(mainRecords.map((record) => record.groupKey).filter(Boolean));

if (!mainRecords.length && inputItems.length) {
  const received = inputItems.map((item) => {
    const upload = asObj(item && item.json);
    const sourceName = sourceNameForUpload(upload, upload.secure_url || upload.url);
    const role = isFrameCandidateUpload(upload) ? "frame_candidate" : "unknown";
    return [role, str(upload.groupKey || deriveGroupKey(sourceName), ""), fileNameOnly(sourceName)].filter(Boolean).join(":");
  }).filter(Boolean);

  throw new Error(
    "Attach Uploaded Main Media Metadata: no main media upload was identified from Cloudinary results" +
    (received.length ? " (" + received.join(", ") + ")" : "")
  );
}

const missingSignalGroups = [...frameSignalCounts.keys()].filter((groupKey) => groupKey && !mainGroupKeys.has(groupKey));
if (missingSignalGroups.length) {
  throw new Error(
    "Attach Uploaded Main Media Metadata: frame candidate uploads were received but no main media upload survived for groupKey(s)=" +
    missingSignalGroups.join(", ")
  );
}

`;

  assert(code.includes(insertBefore), 'Attach code shape changed: mainRecords sort marker not found');
  return code.replace(insertBefore, `${guardBlock}${insertBefore}`);
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
    const backupPath = backupWorkflow(workflow);

    const parseNode = findNode(workflow, 'Parse Frame Analysis JSON');
    parseNode.parameters = {
      ...(parseNode.parameters || {}),
      jsCode: fs.readFileSync(path.join(ROOT, 'workflow-src', 'livia', 'parse-frame-analysis-json.js'), 'utf8').trimEnd(),
    };

    const attachNode = findNode(workflow, 'Attach Uploaded Main Media Metadata');
    attachNode.parameters = {
      ...(attachNode.parameters || {}),
      jsCode: patchAttachCode(String(attachNode.parameters?.jsCode || '')),
    };

    const persisted = persistWorkflow(db, row, workflow);
    exportWorkflow(workflow, persisted.versionId, persisted.updatedAt);

    console.log(JSON.stringify({
      ok: true,
      workflowId: WORKFLOW_ID,
      previousVersionId: row.versionId,
      previousActiveVersionId: row.activeVersionId,
      versionId: persisted.versionId,
      exportPaths: EXPORT_PATHS,
      backupPath,
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
