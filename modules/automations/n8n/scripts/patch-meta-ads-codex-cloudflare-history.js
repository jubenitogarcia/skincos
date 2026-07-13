const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const ROOT_DIR = path.resolve(__dirname, '..');
const AUTHORS = 'Julian Benito Garcia';
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-cloudflare-history.json');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');
const SOURCE_DIR = path.join(ROOT_DIR, 'workflow-src', 'meta-ads-performance-report');
const ENV_PATH = path.join(ROOT_DIR, '.env');

const nodeSources = {
  'Build Metrics Worker Payload': path.join(SOURCE_DIR, 'build-metrics-worker-payload.js'),
  'Prepare Metrics Worker Persistence': path.join(SOURCE_DIR, 'prepare-metrics-worker-request.js'),
  'Validate Metrics Worker Persistence': path.join(SOURCE_DIR, 'validate-metrics-worker-persistence.js'),
  'Build Report History Payload': path.join(SOURCE_DIR, 'build-report-history-payload.js'),
  'Build Delivery History Payload': path.join(SOURCE_DIR, 'build-delivery-history-payload.js'),
  'Prepare Report History Persistence': path.join(SOURCE_DIR, 'prepare-report-history-request.js'),
  'Prepare Delivery History Persistence': path.join(SOURCE_DIR, 'prepare-report-history-request.js'),
  'Validate Report History Persistence': path.join(SOURCE_DIR, 'validate-report-history-persistence.js'),
  'Validate Delivery History Persistence': path.join(SOURCE_DIR, 'validate-delivery-history-persistence.js'),
  'Fail Metrics Worker Persistence Config': path.join(SOURCE_DIR, 'fail-persistence-config.js'),
  'Fail Report History Persistence Config': path.join(SOURCE_DIR, 'fail-persistence-config.js'),
  'Fail Delivery History Persistence Config': path.join(SOURCE_DIR, 'fail-persistence-config.js'),
};

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readDotenvValue(key) {
  if (!fs.existsSync(ENV_PATH)) return '';
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^${escapedKey}=(.*)$`, 'm'));
  if (!match) return '';
  const raw = String(match[1] || '').trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  return JSON.parse(text);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function removeNodes(workflow, names) {
  const removeSet = new Set(names);
  workflow.nodes = workflow.nodes.filter((node) => !removeSet.has(node.name));

  for (const sourceName of Object.keys(workflow.connections || {})) {
    if (removeSet.has(sourceName)) {
      delete workflow.connections[sourceName];
      continue;
    }

    const source = workflow.connections[sourceName];
    if (!source || !Array.isArray(source.main)) continue;
    source.main = source.main.map((slot) =>
      Array.isArray(slot) ? slot.filter((edge) => !removeSet.has(edge.node)) : slot
    );
  }
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

function buildCodeNode(name, position, jsCode = '') {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { jsCode },
  };
}

function buildIfNode(name, position, leftValueExpression) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
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
            leftValue: leftValueExpression,
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
  };
}

function buildHttpPersistenceNode(name, position) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: "={{ $json.persistence_method || 'POST' }}",
      url: '={{ $json.persistence_target_url }}',
      sendHeaders: true,
      specifyHeaders: 'json',
      jsonHeaders: "={{ JSON.stringify(Object.assign({}, $json.requestHeaders || {}, { [($json.auth_header_name || 'Authorization')]: (((($json.auth_scheme || 'Bearer') + '').trim() ? (($json.auth_scheme || 'Bearer') + ' ') : '') + ($json.worker_api_token || '')) })) }}",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody || {}) }}',
      options: {
        timeout: '={{ Number($json.requestTimeoutMs || 120000) }}',
        response: {
          response: {
            fullResponse: true,
            neverError: true,
          },
        },
      },
    },
  };
}

function ensureMetaApiParams(workflow) {
  const node = getNode(workflow, 'Meta API Params');
  node.parameters = node.parameters || {};
  node.parameters.values = node.parameters.values || {};
  node.parameters.values.string = node.parameters.values.string || [];
  const workerApiTokenFallback = readDotenvValue('META_ADS_REPORT_WORKER_API_TOKEN');

  const ensureStringField = (name, value) => {
    const existing = node.parameters.values.string.find((entry) => entry.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    node.parameters.values.string.push({ name, value });
  };

  ensureStringField(
    'report_history_worker_persist_path',
    "={{ $vars['META_ADS_REPORT_HISTORY_WORKER_PERSIST_PATH'] || '/ingest/meta-ads-report-history' }}"
  );
  ensureStringField(
    'worker_api_token',
    `={{ $vars['META_ADS_REPORT_WORKER_API_TOKEN'] || '${workerApiTokenFallback}' }}`
  );
}

function buildWorkflow(workflow) {
  ensureMetaApiParams(workflow);
  removeNodes(workflow, [
    'Persist Math Group Snapshot',
    'Persist Subjective Review Snapshot',
  ]);

  upsertNode(workflow, buildCodeNode('Build Metrics Worker Payload', [240, -1248]));
  upsertNode(workflow, buildCodeNode('Prepare Metrics Worker Persistence', [464, -1248]));
  upsertNode(workflow, buildIfNode('If Metrics Worker Persistence Ready', [688, -1248], '={{ $json.persistence_ready }}'));
  upsertNode(workflow, buildCodeNode('Fail Metrics Worker Persistence Config', [912, -1360]));
  upsertNode(workflow, buildHttpPersistenceNode('Persist Metrics to Worker', [912, -1168]));
  upsertNode(workflow, buildCodeNode('Validate Metrics Worker Persistence', [1136, -1168]));

  upsertNode(workflow, buildCodeNode('Build Report History Payload', [1968, -592]));
  upsertNode(workflow, buildCodeNode('Prepare Report History Persistence', [2192, -592]));
  upsertNode(workflow, buildIfNode('If Report History Persistence Ready', [2416, -592], '={{ $json.persistence_ready }}'));
  upsertNode(workflow, buildCodeNode('Fail Report History Persistence Config', [2640, -704]));
  upsertNode(workflow, buildHttpPersistenceNode('Persist Report History', [2640, -512]));
  upsertNode(workflow, buildCodeNode('Validate Report History Persistence', [2864, -512]));

  upsertNode(workflow, buildCodeNode('Build Delivery History Payload', [2640, -848]));
  upsertNode(workflow, buildCodeNode('Prepare Delivery History Persistence', [2864, -848]));
  upsertNode(workflow, buildIfNode('If Delivery History Persistence Ready', [3088, -848], '={{ $json.persistence_ready }}'));
  upsertNode(workflow, buildCodeNode('Fail Delivery History Persistence Config', [3312, -960]));
  upsertNode(workflow, buildHttpPersistenceNode('Persist Delivery History', [3312, -768]));
  upsertNode(workflow, buildCodeNode('Validate Delivery History Persistence', [3536, -768]));

  for (const [nodeName, sourcePath] of Object.entries(nodeSources)) {
    getNode(workflow, nodeName).parameters.jsCode = loadSource(sourcePath);
  }

  replaceConnections(workflow.connections, 'Finalize Normalized Entities', [
    [{ node: 'Build Metrics Worker Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Metrics Worker Payload', [
    [{ node: 'Prepare Metrics Worker Persistence', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare Metrics Worker Persistence', [
    [{ node: 'If Metrics Worker Persistence Ready', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'If Metrics Worker Persistence Ready', [
    [{ node: 'Persist Metrics to Worker', index: 0 }],
    [{ node: 'Fail Metrics Worker Persistence Config', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Persist Metrics to Worker', [
    [{ node: 'Validate Metrics Worker Persistence', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Validate Metrics Worker Persistence', [
    [{ node: 'Build Snapshot Indexes', index: 0 }],
  ]);

  replaceConnections(workflow.connections, 'Build Consolidated WhatsApp Report', [
    [{ node: 'Build Report History Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Report History Payload', [
    [{ node: 'Prepare Report History Persistence', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare Report History Persistence', [
    [{ node: 'If Report History Persistence Ready', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'If Report History Persistence Ready', [
    [{ node: 'Persist Report History', index: 0 }],
    [{ node: 'Fail Report History Persistence Config', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Persist Report History', [
    [{ node: 'Validate Report History Persistence', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Validate Report History Persistence', [
    [{ node: 'Check Consolidated Idempotency', index: 0 }],
  ]);

  replaceConnections(workflow.connections, 'Persist Consolidated Delivery Audit', [
    [{ node: 'Build Delivery History Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Delivery History Payload', [
    [{ node: 'Prepare Delivery History Persistence', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare Delivery History Persistence', [
    [{ node: 'If Delivery History Persistence Ready', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'If Delivery History Persistence Ready', [
    [{ node: 'Persist Delivery History', index: 0 }],
    [{ node: 'Fail Delivery History Persistence Config', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Persist Delivery History', [
    [{ node: 'Validate Delivery History Persistence', index: 0 }],
  ]);
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  const row = db
    .prepare('SELECT id, name, nodes, connections, settings, staticData, meta, pinData, versionId, triggerCount FROM workflow_entity WHERE id = ?')
    .get(WORKFLOW_ID);

  if (!row) {
    throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado.`);
  }

  const workflow = {
    id: row.id,
    name: row.name,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    meta: parseJson(row.meta, null),
    pinData: parseJson(row.pinData, {}),
    versionId: row.versionId,
    triggerCount: row.triggerCount,
  };

  writeJson(BACKUP_PATH, workflow);
  buildWorkflow(workflow);

  const newVersionId = crypto.randomUUID();
  const timestamp = nowSql();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, nodes, connections
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newVersionId,
      workflow.id,
      AUTHORS,
      timestamp,
      JSON.stringify(workflow.nodes),
      JSON.stringify(workflow.connections)
    );

    db.prepare(`
      UPDATE workflow_entity
      SET
        nodes = ?,
        connections = ?,
        settings = ?,
        staticData = ?,
        meta = ?,
        pinData = ?,
        versionId = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      JSON.stringify(workflow.nodes),
      JSON.stringify(workflow.connections),
      JSON.stringify(workflow.settings || {}),
      JSON.stringify(workflow.staticData || {}),
      workflow.meta == null ? null : JSON.stringify(workflow.meta),
      JSON.stringify(workflow.pinData || {}),
      newVersionId,
      timestamp,
      workflow.id
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  writeJson(SNAPSHOT_PATH, workflow);

  console.log(JSON.stringify({
    workflowId: workflow.id,
    workflowName: workflow.name,
    previousVersionId: row.versionId,
    newVersionId,
    backupPath: BACKUP_PATH,
    snapshotPath: SNAPSHOT_PATH,
    nodeCount: workflow.nodes.length,
  }, null, 2));
}

main();
