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
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-ad-inventory-limits.json');
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

function upsertSetString(node, fieldName, value) {
  const strings = node.parameters?.values?.string || [];
  const field = strings.find((entry) => entry.name === fieldName);
  if (!field) throw new Error(`Campo "${fieldName}" nao encontrado em "${node.name}".`);
  field.value = value;
}

function applyChanges(workflow) {
  const groupedNode = getNode(workflow, 'Build Grouped Outputs');
  groupedNode.parameters.jsCode = fs.readFileSync(
    path.join(SOURCE_DIR, 'build-grouped-outputs.js'),
    'utf8',
  );

  const paramsNode = getNode(workflow, 'Meta API Params');
  upsertSetString(
    paramsNode,
    'inventory_ads_limit',
    "={{ Math.max(Number($vars['META_ADS_REPORT_INVENTORY_ADS_LIMIT'] || 50) || 50, 50) }}",
  );
  upsertSetString(
    paramsNode,
    'max_campaigns',
    "={{ Math.max(Number($vars['META_ADS_REPORT_MAX_CAMPAIGNS'] || 10) || 10, 1) }}",
  );
  upsertSetString(
    paramsNode,
    'max_adsets_per_campaign',
    "={{ Math.max(Number($vars['META_ADS_REPORT_MAX_ADSETS_PER_CAMPAIGN'] || 10) || 10, 10) }}",
  );
  upsertSetString(
    paramsNode,
    'max_ads_per_adset',
    "={{ Math.max(Number($vars['META_ADS_REPORT_MAX_ADS_PER_ADSET'] || 20) || 20, 20) }}",
  );

  const getAdNode = getNode(workflow, 'Get Ad');
  const parameters = getAdNode.parameters?.queryParameters?.parameters || [];
  const limitParam = parameters.find((entry) => entry.name === 'limit');
  if (!limitParam) throw new Error('Parametro limit nao encontrado em Get Ad.');
  limitParam.value = "={{ Math.max(Number($('Meta API Params').first().json.inventory_ads_limit || 50) || 50, 50) }}";

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
  const current = exportWorkflow(db);
  if (current.name !== WORKFLOW_NAME) {
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
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
