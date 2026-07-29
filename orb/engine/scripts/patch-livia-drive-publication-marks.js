#!/usr/bin/env node

'use strict';

// A verified carousel is one publication, but it can contain several Drive
// source files.  Fan out the final Drive mark to every verified source ID and
// aggregate the API readback before any notification or cleanup succeeds.

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const PREPARE_NODE = 'Prepare Drive Publication Marks';
const COLLECT_NODE = 'Collect Drive Publication Marks';
const LEGACY_MERGE_NODE = 'Merge Drive Result and Context';

const prepareCode = String.raw`function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}
function uniqueIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = text(value);
    if (!id) throw new Error('Drive publication mark contains an empty source file ID.');
    if (seen.has(id)) throw new Error('Drive publication mark contains a duplicate source file ID: ' + id + '.');
    seen.add(id);
    result.push(id);
  }
  return result;
}

const input = $input.all();
if (input.length !== 1) throw new Error('Drive publication mark expects exactly one externally verified publication group.');
const source = input[0] && input[0].json && typeof input[0].json === 'object' ? input[0].json : {};
const fileIds = uniqueIds(source.fileIds);
const sourceId = text(source.id);
const groupKey = text(source.groupKey);
if (!fileIds.length) throw new Error('Drive publication mark is missing the verified fileIds contract.');
if (!sourceId || !fileIds.includes(sourceId)) throw new Error('Drive publication mark source ID is absent from the verified fileIds contract.');
if (!groupKey) throw new Error('Drive publication mark is missing groupKey.');

const finalContext = {
  id: sourceId,
  groupKey,
  whatsappMessage: text(source.whatsappMessage),
  shouldNotify: source.shouldNotify === true,
  codexDryRun: source.codexDryRun === true,
};

return fileIds.map((id, ordinal) => ({
  json: {
    id,
    driveExpectedFileIds: fileIds,
    driveMarkOrdinal: ordinal,
    driveMarkCount: fileIds.length,
    driveFinalContext: finalContext,
  },
}));`;

const collectCode = String.raw`function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function uniqueIds(values, label) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = text(value);
    if (!id) throw new Error(label + ' contains an empty source file ID.');
    if (seen.has(id)) throw new Error(label + ' contains a duplicate source file ID: ' + id + '.');
    seen.add(id);
    result.push(id);
  }
  return result;
}
function sameSet(left, right) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

const prepared = $items('Prepare Drive Publication Marks').map((item) => object(item && item.json));
if (!prepared.length) throw new Error('Drive publication readback has no prepared mark contract.');
const expectedFileIds = uniqueIds(prepared.map((row) => row.id), 'Prepared Drive publication marks');
const declaredFileIds = uniqueIds(prepared[0].driveExpectedFileIds, 'Declared Drive publication marks');
if (!sameSet(expectedFileIds, declaredFileIds)) throw new Error('Drive publication mark contract changed between fan-out and readback.');
for (const row of prepared) {
  if (!sameSet(uniqueIds(row.driveExpectedFileIds, 'Prepared Drive publication marks'), expectedFileIds)) {
    throw new Error('Drive publication mark contract is not correlated to one verified group.');
  }
  if (Number(row.driveMarkCount) !== expectedFileIds.length) {
    throw new Error('Drive publication mark count is inconsistent with its verified group.');
  }
}
const finalContext = object(prepared[0].driveFinalContext);
if (!text(finalContext.id) || !text(finalContext.groupKey)) throw new Error('Drive publication readback lost the final verified context.');

const updates = $input.all().map((item) => object(item && item.json));
if (updates.length !== expectedFileIds.length) {
  throw new Error('Drive publication readback count mismatch: expected ' + expectedFileIds.length + ', got ' + updates.length + '.');
}
const verifiedIds = [];
for (const update of updates) {
  const id = text(update.id);
  if (!expectedFileIds.includes(id)) throw new Error('Drive publication readback returned an unexpected file ID: ' + id + '.');
  if (verifiedIds.includes(id)) throw new Error('Drive publication readback returned a duplicate file ID: ' + id + '.');
  const properties = object(update.properties);
  const appProperties = object(update.appProperties);
  const published = text(properties.published || appProperties.published).toLowerCase() === 'true';
  if (!published) throw new Error('Drive publication readback failed for ' + id + ': properties.published is not true.');
  verifiedIds.push(id);
}
if (!sameSet(verifiedIds, expectedFileIds)) throw new Error('Drive publication readback is missing a verified source file.');

return [{
  json: {
    ...finalContext,
    fileIds: expectedFileIds,
    driveAudit: {
      state: 'verified',
      published: true,
      expectedFileIds,
      verifiedFileIds: verifiedIds,
      verifiedFileCount: verifiedIds.length,
    },
  },
}];`;

const assertCode = String.raw`function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}
function uniqueIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = text(value);
    if (!id || seen.has(id)) throw new Error('Drive verification received an invalid file ID contract.');
    seen.add(id);
    result.push(id);
  }
  return result;
}
function sameSet(left, right) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

const update = $input.first()?.json || {};
const audit = update.driveAudit && typeof update.driveAudit === 'object' ? update.driveAudit : {};
const expectedFileIds = uniqueIds(audit.expectedFileIds);
const verifiedFileIds = uniqueIds(audit.verifiedFileIds);
if (audit.state !== 'verified' || audit.published !== true || !expectedFileIds.length || !sameSet(expectedFileIds, verifiedFileIds)) {
  throw new Error('Drive publish verification failed: every verified source file must be marked published=true.');
}
const finalContext = {
  id: String(update.id || ''),
  groupKey: String(update.groupKey || ''),
  whatsappMessage: String(update.whatsappMessage || ''),
  shouldNotify: update.shouldNotify === true,
  codexDryRun: update.codexDryRun === true,
};
if (!finalContext.id || !finalContext.groupKey) throw new Error('Drive publish verification lost the final publication context.');
return [{ json: { ...finalContext, driveAudit: {
  state: 'verified',
  fileId: finalContext.id,
  published: true,
  expectedFileIds,
  verifiedFileIds,
  verifiedFileCount: verifiedFileIds.length,
} } }];`;

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function required(name) {
  const current = value(name);
  if (!current) throw new Error(`${name} is required.`);
  return current;
}

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function codeNode(name, id, position, jsCode) {
  return {
    parameters: { jsCode },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function setMain(connection, output, edges) {
  connection.main ||= [];
  connection.main[output] = edges;
}

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const candidate = structuredClone(workflow);
  const update = (candidate.nodes || []).find((node) => node?.name === 'Update File');
  const finalDryRun = (candidate.nodes || []).find((node) => node?.name === 'Switch Final Dry Run');
  if (!update || update.type !== 'n8n-nodes-base.googleDrive') throw new Error('Update File must be the Google Drive update node.');
  if (!finalDryRun) throw new Error('Switch Final Dry Run is required.');

  candidate.nodes = (candidate.nodes || []).filter((node) => node?.name !== LEGACY_MERGE_NODE && node?.name !== PREPARE_NODE && node?.name !== COLLECT_NODE);
  const updatePosition = Array.isArray(update.position) ? update.position : [0, 0];
  candidate.nodes.push(
    codeNode(PREPARE_NODE, '8c4e4943-5935-46c7-a5c8-efb3d18443e1', [Number(updatePosition[0]) - 260, Number(updatePosition[1]) - 96], prepareCode),
    codeNode(COLLECT_NODE, '57d96dd2-d55f-4e27-a9cb-b7742ec26573', [Number(updatePosition[0]) + 260, Number(updatePosition[1])], collectCode),
  );
  const assertDrive = candidate.nodes.find((node) => node?.name === 'Assert Drive Published');
  if (!assertDrive || assertDrive.type !== 'n8n-nodes-base.code') throw new Error('Assert Drive Published must be a Code node.');
  assertDrive.parameters ||= {};
  assertDrive.parameters.jsCode = assertCode;

  candidate.connections ||= {};
  setMain(candidate.connections['Switch Final Dry Run'] ||= {}, 0, [{ node: PREPARE_NODE, type: 'main', index: 0 }]);
  setMain(candidate.connections[PREPARE_NODE] ||= {}, 0, [{ node: 'Update File', type: 'main', index: 0 }]);
  setMain(candidate.connections['Update File'] ||= {}, 0, [{ node: COLLECT_NODE, type: 'main', index: 0 }]);
  setMain(candidate.connections[COLLECT_NODE] ||= {}, 0, [{ node: 'Assert Drive Published', type: 'main', index: 0 }]);
  delete candidate.connections[LEGACY_MERGE_NODE];

  return candidate;
}

function main() {
  const input = required('--input');
  const output = required('--output');
  const patched = patchWorkflow(readWorkflow(input));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(patched, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, workflowId: patched.id, output, nodes: [PREPARE_NODE, COLLECT_NODE] })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || String(error));
    process.exit(1);
  }
}

module.exports = { PREPARE_NODE, COLLECT_NODE, prepareCode, collectCode, assertCode, patchWorkflow };
