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

function patchPrepareRequest(code) {
  let patched = code;

  if (!patched.includes('function recoverJobFromWaitOutput()')) {
    patched = replaceOnce(
      patched,
      `function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }


function accessTokenForJob(job) {`,
      `function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }

function looksLikePreparedJob(value) {
  const j = normObj(value);
  return !!(
    j.phase &&
    j.publishRunIndex !== undefined &&
    j.publishRunIndex !== null &&
    j.publishRunIndex !== "" &&
    (j.url || j.httpRequest?.url)
  );
}

function recoverJobFromWaitOutput() {
  try {
    const paired = $("Wait").item?.json;
    if (looksLikePreparedJob(paired)) {
      return removeNulls({ ...paired, prepareRequestRecoveredFrom: "wait-item" });
    }
  } catch {}

  try {
    const waitItems = $items("Wait") || [];
    for (let i = waitItems.length - 1; i >= 0; i--) {
      const candidate = waitItems[i]?.json;
      if (looksLikePreparedJob(candidate)) {
        return removeNulls({ ...candidate, prepareRequestRecoveredFrom: "wait-items" });
      }
    }
  } catch {}

  return null;
}

function dequeuePostHttpJob() {
  return dequeue() || recoverJobFromWaitOutput();
}

function accessTokenForJob(job) {`,
      'Prepare Request Wait recovery helpers',
    );
  }

  patched = replaceOnce(
    patched,
    `  const job = dequeue();
  if (!job) {
    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia (sem job correspondente no cache da execução).");
  }
`,
    `  const job = dequeuePostHttpJob();
  if (!job) {
    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia e não consegui recuperar o job do item anterior do Wait.");
  }
`,
    'Prepare Request post-http dequeue recovery',
  );

  return patched;
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-wait-recovery.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = workflowFromRow(row, false);
const prepare = getNode(workflow, 'Prepare Request');
prepare.parameters.jsCode = patchPrepareRequest(prepare.parameters.jsCode || '');

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-prepare-request-wait-recovery',
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
