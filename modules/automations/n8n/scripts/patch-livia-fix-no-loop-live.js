#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.env.HOME, '.n8n', 'database.sqlite');
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPECTED_BASELINE_VERSION_ID = 'ec0b3cf7-5aa0-450d-ae35-496ccfe02e31';
const ROOT = path.join(__dirname, '..');
const EXPORT_PATHS = [
  path.join(ROOT, 'workflows', 'livia.json'),
  path.join(ROOT, 'workflows', 'livia.active.json'),
  path.join(ROOT, 'workflows', 'livia.verify.json'),
];

function readSource(name) {
  return fs.readFileSync(path.join(ROOT, 'workflow-src', 'livia', name), 'utf8').trimEnd();
}

const extractTimesGroupedCode = readSource('extract-times-grouped.js');
const compose1PostWaitCode = readSource('compose1-post-wait.js');
const prepareRequestRuntimeNoLoopCode = readSource('prepare-request-runtime-no-loop.js');

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

function maybeFindNode(workflow, name) {
  return workflow.nodes.find((item) => item.name === name) || null;
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

function ensureConnection(connections, source, target, groupIndex = 0, index = 0) {
  connections[source] ||= {};
  connections[source].main ||= [];
  while (connections[source].main.length <= groupIndex) {
    connections[source].main.push([]);
  }

  const group = connections[source].main[groupIndex];
  if (!group.some((edge) => edge.node === target && edge.type === 'main' && edge.index === index)) {
    group.push({ node: target, type: 'main', index });
  }
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

function extractFunctionSource(code, name) {
  const marker = `function ${name}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`Function not found in Prepare Request code: ${name}`);

  let braceDepth = 0;
  let seenOpenBrace = false;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') {
      braceDepth += 1;
      seenOpenBrace = true;
    } else if (char === '}') {
      braceDepth -= 1;
      if (seenOpenBrace && braceDepth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not extract function source for ${name}`);
}

function sanitizePrepareRequestFunctionSource(source) {
  return source
    .replace(/COMPOSE \(2\) FINAL - Job Builder/g, 'PREPARE REQUEST - Bootstrap job builder')
    .replace(/Compose \(2\):/g, 'Prepare Request bootstrap:')
    .replace(/Compose \(3\)/g, 'Prepare Request final collector')
    .replace(/Recebe todos os itens do loop/g, 'Recebe todos os jobs concluídos da fila')
    .replace(/Loop -> Prepare Request -> IF \(ready===true \? Loop : Wait->HTTP->Prepare Request\)/g, 'Livia -> Prepare Request -> If -> Wait/HTTP -> Prepare Request, com orquestração interna')
    .replace(/vai para IF pós-Prepare -> Loop/g, 'segue para o orquestrador único interno');
}

function buildPrepareRequestCode(currentCode) {
  const comment = [
    '// ======================================================',
    '// PREPARE REQUEST - ORQUESTRADOR UNICO SEM LOOP',
    '// - bootstrap: constrói a fila completa e devolve só o próximo request',
    '// - lifecycle: reaproveita o stateful runner HTTP/repoll já existente',
    '// - final collector: consolida os jobs concluídos no próprio node',
    '// ======================================================',
    '',
  ].join('\n');

  const pieces = [
    sanitizePrepareRequestFunctionSource(extractFunctionSource(currentCode, 'buildPublishJobsFromLiviaInput')),
    '',
    sanitizePrepareRequestFunctionSource(extractFunctionSource(currentCode, 'runPrepareRequestLifecycle')),
    '',
    sanitizePrepareRequestFunctionSource(extractFunctionSource(currentCode, 'buildFinalCollectorRows')),
    '',
    prepareRequestRuntimeNoLoopCode,
    '',
  ];

  return comment + pieces.join('\n');
}

function patchExtractPlanner(workflow) {
  const node = findNode(workflow, 'Extract Times and Split Out and Compose (1)');
  node.parameters = {
    ...(node.parameters || {}),
    jsCode: extractTimesGroupedCode,
  };
}

function patchCompose1(workflow) {
  const triggerSchedule = findNode(workflow, 'Trigger Schedule');
  const downloadFile = findNode(workflow, 'Download File');
  let compose1 = maybeFindNode(workflow, 'Compose (1)');

  if (!compose1) {
    compose1 = {
      id: crypto.randomUUID(),
      name: 'Compose (1)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [
        Math.round((triggerSchedule.position[0] + downloadFile.position[0]) / 2),
        downloadFile.position[1],
      ],
      parameters: {},
    };
    workflow.nodes.push(compose1);
  }

  compose1.type = 'n8n-nodes-base.code';
  compose1.typeVersion = 2;
  compose1.parameters = {
    ...(compose1.parameters || {}),
    jsCode: compose1PostWaitCode,
  };

  const connections = workflow.connections || {};
  setMainConnections(connections, 'Trigger Schedule', [[{ node: 'Compose (1)', index: 0 }]]);
  setMainConnections(connections, 'Compose (1)', [[{ node: 'Download File', index: 0 }]]);
  workflow.connections = connections;
}

function patchPrepareRequest(workflow) {
  const node = findNode(workflow, 'Prepare Request');
  node.parameters = {
    ...(node.parameters || {}),
    jsCode: buildPrepareRequestCode(node.parameters?.jsCode || ''),
  };
}

function patchIfNode(workflow) {
  const node = findNode(workflow, 'If');
  node.parameters = {
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
          leftValue: '={{ $json.ready === true }}',
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
  };
}

function patchAttachComments(workflow) {
  const node = findNode(workflow, 'Attach Uploaded Main Media Metadata');
  const code = String(node.parameters?.jsCode || '');
  node.parameters = {
    ...(node.parameters || {}),
    jsCode: code
      .replace(/Prepare Main Media Upload/g, 'legacy pre-upload stage')
      .replace(/Attach Uploaded Frame Metadata/g, 'legacy frame metadata stage'),
  };
}

function clearStaleStaticData(workflow) {
  const global = workflow.staticData?.global;
  if (!global || typeof global !== 'object') return;
  delete global.__pr;
  delete global.__liviaCompose1;
  delete global.__liviaMainUploads;
  delete global.__liviaFrameUploads;
}

function validatePatchedWorkflow(workflow) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const name of [
    'Extract Times and Split Out and Compose (1)',
    'Trigger Schedule',
    'Compose (1)',
    'Download File',
    'Prepare Request',
    'If',
    'Attach Uploaded Main Media Metadata',
  ]) {
    assert(names.has(name), `Required node missing after patch: ${name}`);
  }

  for (const removed of ['Compose (2)', 'Compose (3)', 'Loop (2)', 'Route Prepare Request']) {
    assert(!names.has(removed), `${removed} must not exist after no-loop patch`);
  }

  const prepare = findNode(workflow, 'Prepare Request').parameters.jsCode;
  assert(prepare.includes('state.pending'), 'Prepare Request must keep pending queue state');
  assert(prepare.includes('state.completed'), 'Prepare Request must keep completed job state');
  assert(!prepare.includes('prepareRequestRoute'), 'Prepare Request must not emit prepareRequestRoute');
  assert(!prepare.includes('Route Prepare Request'), 'Prepare Request must not reference Route Prepare Request');
  assert(!prepare.includes('Loop (2)'), 'Prepare Request must not reference Loop (2)');
  assert(!prepare.includes('Compose (2)'), 'Prepare Request must not reference Compose (2)');
  assert(!prepare.includes('Compose (3)'), 'Prepare Request must not reference Compose (3)');

  const extract = findNode(workflow, 'Extract Times and Split Out and Compose (1)').parameters.jsCode;
  assert(extract.includes('waitUntil'), 'Planner node must emit waitUntil');
  assert(extract.includes('items'), 'Planner node must carry grouped items[]');

  const compose1 = findNode(workflow, 'Compose (1)').parameters.jsCode;
  assert(compose1.includes('__liviaCompose1'), 'Compose (1) must repopulate __liviaCompose1');

  const ifNode = findNode(workflow, 'If');
  const leftValue = String(ifNode.parameters?.conditions?.conditions?.[0]?.leftValue || '');
  assert(leftValue.includes('$json.ready === true'), 'If must branch on ready === true');
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

  const history = db.prepare(`
    SELECT versionId
    FROM workflow_history
    WHERE workflowId = ? AND versionId = ?
  `).get(WORKFLOW_ID, versionId);
  assert(history, `workflow_history row missing for ${versionId}`);

  return {
    versionId,
    updatedAt,
  };
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
    assert(
      row.versionId === EXPECTED_BASELINE_VERSION_ID,
      `Baseline mismatch: expected versionId=${EXPECTED_BASELINE_VERSION_ID}, got ${row.versionId}`,
    );

    const workflow = workflowFromRow(row);
    patchExtractPlanner(workflow);
    patchCompose1(workflow);
    patchPrepareRequest(workflow);
    patchIfNode(workflow);
    patchAttachComments(workflow);
    clearStaleStaticData(workflow);
    validatePatchedWorkflow(workflow);

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
