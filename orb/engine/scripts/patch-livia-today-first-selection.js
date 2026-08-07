#!/usr/bin/env node

'use strict';

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const PREPARE_NODE = 'Prepare Media Items';
const PATCH_MARKER = 'livia_selection_today_first_due_v1';
const START_MARKER = 'const readyGroups = new Map();';
const END_MARKER = '\n\nconst selectedList = normalizedList';

const SELECTION_BLOCK = [
  'const LIVIA_TIME_ZONE = "America/Sao_Paulo";',
  '',
  'function dateKeyInTimeZone(timestampMs) {',
  '  const parts = new Intl.DateTimeFormat("en-GB", {',
  '    timeZone: LIVIA_TIME_ZONE,',
  '    day: "2-digit",',
  '    month: "2-digit",',
  '    year: "2-digit",',
  '  }).formatToParts(new Date(timestampMs));',
  '  const values = {};',
  '  for (const part of parts) {',
  '    if (part.type !== "literal") values[part.type] = part.value;',
  '  }',
  '  return [values.day || "", values.month || "", values.year || ""].join("");',
  '}',
  '',
  '// ' + PATCH_MARKER + ': only today and the earliest due group are eligible.',
  'const todayDate = dateKeyInTimeZone(nowMs);',
  'const readyGroups = new Map();',
  'for (const row of normalizedList) {',
  '  if (!row.supportedMedia) continue;',
  '  if (!row.postPrefix) continue;',
  '  if (row.targetDate !== todayDate) continue;',
  '  if (!Number.isFinite(row.publishTimeMs)) continue;',
  '  if (row.publishTimeMs > nowMs) continue;',
  '',
  '  const existing = readyGroups.get(row.postPrefix);',
  '  if (!existing || row.publishTimeMs < existing.publishTimeMs) {',
  '    readyGroups.set(row.postPrefix, { postPrefix: row.postPrefix, publishTimeMs: row.publishTimeMs });',
  '  }',
  '}',
  '',
  'let selectedPrefixes = new Set();',
  'if (readyGroups.size) {',
  '  const firstReadyGroup = Array.from(readyGroups.values())',
  '    .sort((left, right) => left.publishTimeMs - right.publishTimeMs || left.postPrefix.localeCompare(right.postPrefix))[0];',
  '  if (firstReadyGroup) selectedPrefixes = new Set([firstReadyGroup.postPrefix]);',
  '}',
].join('\n');

function patchCode(code) {
  const current = String(code || '');
  if (current.includes(PATCH_MARKER)) return current;

  const start = current.indexOf(START_MARKER);
  const end = start >= 0 ? current.indexOf(END_MARKER, start) : -1;
  if (start < 0 || end < 0) {
    throw new Error(PREPARE_NODE + ' does not contain the expected live selection block.');
  }

  return current.slice(0, start) + SELECTION_BLOCK + current.slice(end);
}

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error('Expected Livia workflow ' + WORKFLOW_ID + '.');
  const candidate = structuredClone(workflow);
  const node = (candidate.nodes || []).find((entry) => entry?.name === PREPARE_NODE);
  if (!node || node.type !== 'n8n-nodes-base.code') {
    throw new Error(PREPARE_NODE + ' must be a Code node.');
  }
  node.parameters ||= {};
  node.parameters.jsCode = patchCode(node.parameters.jsCode);
  return candidate;
}

module.exports = {
  END_MARKER,
  PATCH_MARKER,
  PREPARE_NODE,
  SELECTION_BLOCK,
  START_MARKER,
  patchCode,
  patchWorkflow,
};
