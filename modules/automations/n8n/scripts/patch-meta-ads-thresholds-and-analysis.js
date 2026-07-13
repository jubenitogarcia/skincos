#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const WORKFLOW_NAMES = new Set(['Meta Ads – Copia para o Codex Trabalhar', 'Meta Ads – Report']);
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const ROOT_DIR = path.resolve(__dirname, '..');
const AUTHORS = 'Julian Benito Garcia';
const SOURCE_DIR = path.join(ROOT_DIR, 'workflow-src', 'meta-ads-performance-report');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-thresholds-and-analysis.json');
const LATEST_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');
const LIVE_CURRENT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.live-current.json');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function parseJson(text, fallback) {
  return text ? JSON.parse(text) : fallback;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function exportWorkflow(db) {
  const row = db.prepare(`
    SELECT id, name, active, nodes, connections, settings, staticData, pinData, versionId, meta, description
    FROM workflow_entity
    WHERE id = ?
  `).get(WORKFLOW_ID);

  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado.`);

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: parseJson(row.pinData, {}),
    versionId: row.versionId,
    meta: parseJson(row.meta, null),
    description: row.description || '',
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function applyChanges(workflow) {
  getNode(workflow, 'Build Grouped Outputs').parameters.jsCode = fs.readFileSync(
    path.join(SOURCE_DIR, 'build-grouped-outputs.js'),
    'utf8',
  );

  getNode(workflow, 'Build Consolidated WhatsApp Report').parameters.jsCode = fs.readFileSync(
    path.join(SOURCE_DIR, 'build-consolidated-whatsapp-report.js'),
    'utf8',
  );

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
    return { ...workflow, versionId, previousVersionId: previous.versionId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 15000');
  const current = exportWorkflow(db);

  if (!WORKFLOW_NAMES.has(current.name)) {
    throw new Error(`Workflow inesperado: ${current.name}`);
  }

  writeJson(BACKUP_PATH, current);
  const updated = applyChanges(structuredClone(current));
  const persisted = persistWorkflow(db, updated, current);
  writeJson(LATEST_PATH, persisted);
  writeJson(LIVE_CURRENT_PATH, persisted);

  console.log(JSON.stringify({
    workflowId: persisted.id,
    previousVersionId: current.versionId,
    versionId: persisted.versionId,
    backupPath: BACKUP_PATH,
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
