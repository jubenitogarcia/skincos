#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const ROOT_DIR = path.resolve(__dirname, '..');
const AUTHORS = 'Julian Benito Garcia';
const SOURCE_DIR = path.join(ROOT_DIR, 'workflow-src', 'meta-ads-performance-report');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-ad-only-conclusions.json');
const LATEST_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');
const LIVE_CURRENT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.live-current.json');

const NODE_SOURCES = {
  'Build Grouped Outputs': path.join(SOURCE_DIR, 'build-grouped-outputs.js'),
  'Build Subjective Review Queue': path.join(SOURCE_DIR, 'build-subjective-review-queue.js'),
  'Build Consolidated WhatsApp Report': path.join(SOURCE_DIR, 'build-consolidated-whatsapp-report.js'),
};

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function readJson(text, fallback) {
  if (!text) return fallback;
  return JSON.parse(text);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exportWorkflow(db, workflowId) {
  const row = db.prepare(`
    SELECT id, name, active, nodes, connections, settings, staticData, pinData, versionId, meta, description
    FROM workflow_entity
    WHERE id = ?
  `).get(workflowId);

  if (!row) throw new Error(`Workflow ${workflowId} nao encontrado.`);

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: readJson(row.nodes, []),
    connections: readJson(row.connections, {}),
    settings: readJson(row.settings, {}),
    staticData: readJson(row.staticData, null),
    pinData: readJson(row.pinData, {}),
    versionId: row.versionId,
    meta: readJson(row.meta, null),
    description: row.description || '',
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function applyNodeSources(workflow) {
  for (const [nodeName, sourcePath] of Object.entries(NODE_SOURCES)) {
    const node = getNode(workflow, nodeName);
    node.parameters = node.parameters || {};
    node.parameters.jsCode = loadSource(sourcePath);
  }
  return workflow;
}

function persistWorkflow(db, workflow, previous) {
  const versionId = crypto.randomUUID();
  const timestamp = nowSql();
  const nodesText = JSON.stringify(workflow.nodes);
  const connectionsText = JSON.stringify(workflow.connections);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      workflow.id,
      AUTHORS,
      timestamp,
      timestamp,
      nodesText,
      connectionsText,
      workflow.name,
      0,
      workflow.description || '',
    );

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?, connections = ?, versionId = ?, updatedAt = ?, name = ?, description = ?
      WHERE id = ?
    `).run(
      nodesText,
      connectionsText,
      versionId,
      timestamp,
      workflow.name,
      workflow.description || '',
      workflow.id,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { ...workflow, versionId, previousVersionId: previous.versionId };
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  const current = exportWorkflow(db, WORKFLOW_ID);

  if (current.name !== WORKFLOW_NAME) {
    throw new Error(`Workflow ${WORKFLOW_ID} nao corresponde ao nome esperado: ${current.name}`);
  }

  writeJson(BACKUP_PATH, current);

  const updated = applyNodeSources(structuredClone(current));
  const persisted = persistWorkflow(db, updated, current);
  writeJson(LATEST_PATH, persisted);
  writeJson(LIVE_CURRENT_PATH, persisted);

  console.log(JSON.stringify({
    workflowId: persisted.id,
    name: persisted.name,
    previousVersionId: current.versionId,
    versionId: persisted.versionId,
    backupPath: BACKUP_PATH,
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
