#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const ROOT_DIR = path.resolve(__dirname, '..');
const AUTHORS = 'Julian Benito Garcia';
const SOURCE_DIR = path.join(ROOT_DIR, 'workflow-src', 'meta-ads-performance-report');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-per-ad-whatsapp.json');
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

function upsertNode(workflow, definition) {
  const index = workflow.nodes.findIndex((entry) => entry.name === definition.name);
  if (index >= 0) {
    workflow.nodes[index] = {
      ...workflow.nodes[index],
      ...definition,
      parameters: definition.parameters ?? workflow.nodes[index].parameters,
    };
    return workflow.nodes[index];
  }
  workflow.nodes.push(definition);
  return definition;
}

function replaceConnections(connections, sourceNode, outputs) {
  connections[sourceNode] = {
    main: outputs.map((slot) => slot.map((edge) => ({ ...edge, type: 'main' }))),
  };
}

function readSource(fileName) {
  return fs.readFileSync(path.join(SOURCE_DIR, fileName), 'utf8');
}

function applyChanges(workflow) {
  getNode(workflow, 'Build Consolidated WhatsApp Report').parameters.jsCode = readSource('build-consolidated-whatsapp-report.js');
  getNode(workflow, 'Build Report History Payload').parameters.jsCode = readSource('build-report-history-payload.js');
  getNode(workflow, 'Prepare Report History Persistence').parameters.jsCode = readSource('prepare-report-history-request.js');
  getNode(workflow, 'Build Delivery History Payload').parameters.jsCode = readSource('build-delivery-history-payload.js');
  getNode(workflow, 'Persist Consolidated Delivery Audit').parameters.jsCode = readSource('persist-consolidated-delivery-audit.js');
  getNode(workflow, 'Check Consolidated Idempotency').parameters.jsCode = readSource('check-consolidated-idempotency.js');
  getNode(workflow, 'Prepare Evolution Payload').parameters.jsCode = readSource('prepare-evolution-payload.js');

  upsertNode(workflow, {
    id: crypto.randomUUID(),
    name: 'Route Evolution Delivery Mode',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [4496, -1112],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: "={{ $json.delivery_message_mode === 'send-text' }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  });

  upsertNode(workflow, {
    id: crypto.randomUUID(),
    name: 'Send Summary Report',
    type: 'n8n-nodes-evolution-api-en.evolutionApi',
    typeVersion: 1,
    position: [4720, -1240],
    parameters: {
      resource: 'messages-api',
      operation: 'send-text',
      instanceName: '={{$json.evolution_instance_name}}',
      remoteJid: '={{$json.evolution_remote_jid}}',
      messageText: '={{$json.evolution_message_text}}',
      options_message: {},
    },
  });

  const sendReportNode = getNode(workflow, 'Send Report');
  sendReportNode.position = [4720, -1020];
  sendReportNode.parameters = {
    ...sendReportNode.parameters,
    operation: 'send-image',
    instanceName: '={{$json.evolution_instance_name}}',
    remoteJid: '={{$json.evolution_remote_jid}}',
    media: '={{$json.evolution_media}}',
    mimetype: '={{$json.evolution_mime_type || "image/jpeg"}}',
    fileName: '={{$json.evolution_file_name || "creative.jpg"}}',
    caption: '={{$json.evolution_caption}}',
    options_message: sendReportNode.parameters.options_message || {},
  };

  replaceConnections(workflow.connections, 'Should Send WhatsApp', [
    [{ node: 'Route Evolution Delivery Mode', index: 0 }],
    [],
  ]);
  replaceConnections(workflow.connections, 'Route Evolution Delivery Mode', [
    [{ node: 'Send Summary Report', index: 0 }],
    [{ node: 'Send Report', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Send Summary Report', [
    [{ node: 'Persist Consolidated Delivery Audit', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Send Report', [
    [{ node: 'Persist Consolidated Delivery Audit', index: 0 }],
  ]);

  return workflow;
}

function persistWorkflow(db, workflow) {
  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  const previousVersionId = row.versionId;
  const versionId = crypto.randomUUID();
  const timestamp = nowSql();

  db.prepare(`
    UPDATE workflow_entity
    SET nodes = ?, connections = ?, settings = ?, staticData = ?, pinData = ?, versionId = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    JSON.stringify(workflow.nodes),
    JSON.stringify(workflow.connections),
    JSON.stringify(workflow.settings || {}),
    JSON.stringify(workflow.staticData || null),
    JSON.stringify(workflow.pinData || {}),
    versionId,
    timestamp,
    WORKFLOW_ID,
  );

  db.prepare(`
    INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    WORKFLOW_ID,
    AUTHORS,
    timestamp,
    timestamp,
    JSON.stringify(workflow.nodes),
    JSON.stringify(workflow.connections),
    workflow.name,
    0,
    workflow.description || '',
  );

  return { previousVersionId, versionId };
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  const before = exportWorkflow(db);
  writeJson(BACKUP_PATH, before);

  const workflow = applyChanges(before);
  const { previousVersionId, versionId } = persistWorkflow(db, workflow);

  const exported = exportWorkflow(db);
  writeJson(LATEST_PATH, exported);
  writeJson(LIVE_CURRENT_PATH, exported);

  console.log(JSON.stringify({
    workflowId: WORKFLOW_ID,
    previousVersionId,
    versionId,
    backupPath: BACKUP_PATH,
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
