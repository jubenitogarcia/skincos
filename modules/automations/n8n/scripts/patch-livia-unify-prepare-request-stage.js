#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.active.json'),
  path.join(__dirname, '..', 'workflows', 'livia.verify.json'),
];

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    versionId: row.versionId || '',
    activeVersionId: row.activeVersionId || row.versionId || '',
    meta: parseJson(row.meta, {}),
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
}

function removeConnectionsForNode(connections, nodeName) {
  delete connections[nodeName];
  for (const source of Object.keys(connections)) {
    for (const [outputName, groups] of Object.entries(connections[source] || {})) {
      connections[source][outputName] = (groups || []).map((group) =>
        (group || []).filter((connection) => connection.node !== nodeName),
      );
    }
  }
}

function renameConnectionNode(connections, oldName, newName) {
  if (connections[oldName]) {
    connections[newName] = connections[oldName];
    delete connections[oldName];
  }

  for (const source of Object.keys(connections)) {
    for (const outputName of Object.keys(connections[source] || {})) {
      connections[source][outputName] = (connections[source][outputName] || []).map((group) =>
        (group || []).map((connection) =>
          connection.node === oldName ? { ...connection, node: newName } : connection,
        ),
      );
    }
  }
}

function setMainConnections(connections, source, groups) {
  connections[source] ||= {};
  connections[source].main = groups.map((group) =>
    (group || []).map((connection) => ({
      node: connection.node,
      type: 'main',
      index: connection.index ?? 0,
    })),
  );
}

function indent(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

function wrapFunction(name, args, setupLines, body) {
  const parts = [`function ${name}(${args.join(', ')}) {`];
  if (setupLines.length) {
    parts.push(indent(setupLines.join('\n')));
    parts.push('');
  }
  parts.push(indent(String(body).trimEnd()));
  parts.push('}');
  return parts.join('\n');
}

function buildMergedPrepareRequestCode(compose2Code, prepareCode, compose3Code) {
  const comment = [
    '// ======================================================',
    '// PREPARE REQUEST - UNIFIED STAGE',
    '// - bootstrap: absorve o job builder antigo de Compose (2)',
    '// - lifecycle: preserva a lógica stateful original de Prepare Request',
    '// - finalize: absorve o collector final antigo de Compose (3)',
    '// - routing: devolve prepareRequestRoute = loop | wait | finalize',
    '// ======================================================',
    '',
  ].join('\n');

  const compose2Fn = wrapFunction(
    'buildPublishJobsFromLiviaInput',
    ['rawItems'],
    [
      'const $input = { all: () => rawItems || [] };',
    ],
    compose2Code,
  );

  const prepareFn = wrapFunction(
    'runPrepareRequestLifecycle',
    ['incomingJson', 'inputItems'],
    [
      'const $json = incomingJson;',
      'const $input = {',
      '  all: () => Array.isArray(inputItems) ? inputItems : [],',
      '  item: { json: incomingJson },',
      '};',
    ],
    prepareCode,
  );

  const compose3Fn = wrapFunction(
    'buildFinalCollectorRows',
    ['inputItems'],
    [
      'const $input = { all: () => Array.isArray(inputItems) ? inputItems : [] };',
    ],
    compose3Code,
  );

  const runtime = `
function __prStr(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function __prAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __prCloneItem(item, route) {
  const json = item && typeof item === "object" && item.json && typeof item.json === "object"
    ? item.json
    : {};

  return {
    ...item,
    json: {
      ...json,
      prepareRequestRoute: __prStr(json.prepareRequestRoute || route || "").trim().toLowerCase(),
    },
  };
}

function __prFinalizeRoute(items) {
  return __prAsArray(items).map((item) => __prCloneItem(item, "finalize"));
}

function __prLoopRoute(items) {
  return __prAsArray(items).map((item) => __prCloneItem(item, "loop"));
}

function __prShouldWait(json) {
  if (!json || typeof json !== "object") return false;
  if (__prStr(json.prepareRequestRoute, "")) return __prStr(json.prepareRequestRoute, "").trim().toLowerCase() === "wait";
  if (json.ready === false) return true;
  if (json.ready === true) return false;
  if (json.httpRequest && typeof json.httpRequest === "object") return true;
  return false;
}

function __prLifecycleRoute(items) {
  return __prAsArray(items).map((item) => {
    const json = item && typeof item === "object" && item.json && typeof item.json === "object"
      ? item.json
      : {};
    const route = __prShouldWait(json) ? "wait" : "loop";
    return __prCloneItem(item, route);
  });
}

function __prLooksLikePreparedJob(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.httpRequest && typeof obj.httpRequest === "object") return true;
  if (__prStr(obj.phase, "").trim()) return true;
  if (__prStr(obj.method, "").trim()) return true;
  if (__prStr(obj.url, "").trim()) return true;
  return false;
}

function __prIsHttpEnvelopeCandidate(obj) {
  return !!(obj && typeof obj === "object" && (
    "statusCode" in obj || "body" in obj || "headers" in obj || "response" in obj
  ));
}

function __prLooksLikeFinalCollectorBatch(items) {
  if (!Array.isArray(items) || items.length <= 1) return false;
  return items.every((item) => {
    const json = item && item.json && typeof item.json === "object" ? item.json : {};
    return !!(
      __prStr(json.platform, "").trim() ||
      __prStr(json.phase, "").trim() ||
      json.media ||
      __prStr(json.groupKey, "").trim()
    );
  });
}

function __prLooksLikeBootstrapInput(items) {
  if (!Array.isArray(items) || !items.length) return false;
  const first = items[0] && items[0].json && typeof items[0].json === "object" ? items[0].json : {};
  if (__prIsHttpEnvelopeCandidate(first)) return false;
  if (__prLooksLikePreparedJob(first)) return false;
  return true;
}

const __prepareRequestInputItems = (() => {
  try {
    if ($input && typeof $input.all === "function") {
      const rows = $input.all();
      if (Array.isArray(rows) && rows.length) return rows;
    }
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

const __prepareRequestIncoming = (
  __prepareRequestInputItems[0] &&
  __prepareRequestInputItems[0].json &&
  typeof __prepareRequestInputItems[0].json === "object"
) ? __prepareRequestInputItems[0].json : {};

if (__prLooksLikeFinalCollectorBatch(__prepareRequestInputItems)) {
  return __prFinalizeRoute(buildFinalCollectorRows(__prepareRequestInputItems));
}

if (__prLooksLikeBootstrapInput(__prepareRequestInputItems)) {
  return __prLoopRoute(buildPublishJobsFromLiviaInput(__prepareRequestInputItems));
}

return __prLifecycleRoute(runPrepareRequestLifecycle(__prepareRequestIncoming, __prepareRequestInputItems));
`;

  return [
    comment,
    compose2Fn,
    '',
    prepareFn,
    '',
    compose3Fn,
    '',
    runtime.trim(),
    '',
  ].join('\n');
}

function patchWorkflow(workflow) {
  const compose2 = getNode(workflow, 'Compose (2)');
  const prepare = getNode(workflow, 'Prepare Request');
  const compose3 = getNode(workflow, 'Compose (3)');
  const router = getNode(workflow, 'If');

  prepare.parameters.mode = 'runOnceForAllItems';
  prepare.parameters.language = 'javaScript';
  prepare.parameters.jsCode = buildMergedPrepareRequestCode(
    compose2.parameters.jsCode || '',
    prepare.parameters.jsCode || '',
    compose3.parameters.jsCode || '',
  );

  router.name = 'Route Prepare Request';
  router.type = 'n8n-nodes-base.switch';
  router.typeVersion = 3.4;
  router.parameters = {
    mode: 'expression',
    numberOutputs: 3,
    output: '={{ (() => { const route = String($json.prepareRequestRoute || "").trim().toLowerCase(); if (route === "loop") return 0; if (route === "wait") return 1; if (route === "finalize") return 2; return 1; })() }}',
  };

  renameConnectionNode(workflow.connections, 'If', 'Route Prepare Request');
  removeConnectionsForNode(workflow.connections, 'Compose (2)');
  removeConnectionsForNode(workflow.connections, 'Compose (3)');
  removeNode(workflow, 'Compose (2)');
  removeNode(workflow, 'Compose (3)');

  setMainConnections(workflow.connections, 'Livia', [
    [{ node: 'Prepare Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Loop (2)', [
    [{ node: 'Prepare Request', index: 0 }],
    [{ node: 'Prepare Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Prepare Request', [
    [{ node: 'Route Prepare Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Route Prepare Request', [
    [{ node: 'Loop (2)', index: 0 }],
    [{ node: 'Wait', index: 0 }],
    [
      { node: 'Update File', index: 0 },
      { node: 'Inform Success (1)', index: 0 },
    ],
  ]);
  setMainConnections(workflow.connections, 'HTTP Request', [
    [{ node: 'Prepare Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Wait', [
    [{ node: 'HTTP Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Update File', [
    [{ node: 'Cleanup Temp Files', index: 0 }],
  ]);

  const informSuccess2 = getNode(workflow, 'Inform Success (2)');
  informSuccess2.parameters.text = String(informSuccess2.parameters.text || '')
    .replace(/\|\|\s*\$\("Compose \(3\)"\)\.first\(\)\.json\.whatsappMessage/g, '|| ""');

  const cleanup = getNode(workflow, 'Cleanup Temp Files');
  cleanup.parameters.command = String(cleanup.parameters.command || '')
    .replace(/\$\("Compose \(3\)"\)\.item\.json\.groupKey/g, '$json.groupKey');

  return workflow;
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-unify-prepare-request-stage.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = patchWorkflow(workflowFromRow(row));
const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-unify-prepare-request-stage',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
    removedNodes: ['Compose (2)', 'Compose (3)'],
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

const insertHistory = db.prepare(`
  insert into workflow_history
    (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  values
    (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
`);

const updateWorkflow = db.prepare(`
  update workflow_entity
  set nodes = @nodes,
      connections = @connections,
      meta = @meta,
      versionId = @versionId,
      activeVersionId = @versionId,
      updatedAt = @updatedAt,
      versionCounter = versionCounter + 1
  where id = @workflowId
`);

db.transaction(() => {
  insertHistory.run({
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
  updateWorkflow.run({
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
  versionId,
  checkpointPath,
  exports: EXPORT_PATHS,
  nodes: workflow.nodes.length,
}, null, 2));
