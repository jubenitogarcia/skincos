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
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-send-report-fix.json');
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
      credentials: definition.credentials ?? workflow.nodes[index].credentials,
    };
    return workflow.nodes[index];
  }
  workflow.nodes.push(definition);
  return definition;
}

function replaceConnections(workflow, sourceNode, outputs) {
  workflow.connections[sourceNode] = {
    main: outputs.map((slot) => slot.map((edge) => ({ ...edge, type: 'main' }))),
  };
}

function applyChanges(workflow) {
  getNode(workflow, 'Prepare Evolution Payload').parameters.jsCode = fs.readFileSync(
    path.join(SOURCE_DIR, 'prepare-evolution-payload.js'),
    'utf8',
  );

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

  const sendReportNode = getNode(workflow, 'Send Report');
  const existingCredentials = sendReportNode.credentials || {};
  sendReportNode.position = [4720, -1020];
  sendReportNode.parameters = {
    resource: 'messages-api',
    operation: 'send-image',
    instanceName: '={{$json.evolution_instance_name}}',
    remoteJid: '={{$json.evolution_remote_jid}}',
    media: '={{$json.evolution_media}}',
    mimetype: '={{$json.evolution_mime_type || "image/jpeg"}}',
    fileName: '={{$json.evolution_file_name || "creative.jpg"}}',
    caption: '={{$json.evolution_caption}}',
    options_message: sendReportNode.parameters?.options_message || {},
  };
  sendReportNode.credentials = existingCredentials;

  upsertNode(workflow, {
    id: crypto.randomUUID(),
    name: 'Send Summary Report',
    type: 'n8n-nodes-evolution-api-en.evolutionApi',
    typeVersion: 1,
    position: [4720, -1240],
    credentials: existingCredentials,
    parameters: {
      resource: 'messages-api',
      operation: 'send-text',
      instanceName: '={{$json.evolution_instance_name}}',
      remoteJid: '={{$json.evolution_remote_jid}}',
      messageText: '={{$json.evolution_message_text}}',
      options_message: {},
    },
  });

  replaceConnections(workflow, 'Prepare Evolution Payload', [
    [{ node: 'Should Send WhatsApp', index: 0 }],
  ]);
  replaceConnections(workflow, 'Should Send WhatsApp', [
    [{ node: 'Route Evolution Delivery Mode', index: 0 }],
    [],
  ]);
  replaceConnections(workflow, 'Route Evolution Delivery Mode', [
    [{ node: 'Send Summary Report', index: 0 }],
    [{ node: 'Send Report', index: 0 }],
  ]);
  replaceConnections(workflow, 'Send Summary Report', [
    [{ node: 'Persist Consolidated Delivery Audit', index: 0 }],
  ]);
  replaceConnections(workflow, 'Send Report', [
    [{ node: 'Persist Consolidated Delivery Audit', index: 0 }],
    [],
  ]);

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
    backupPath: BACKUP_PATH,
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
