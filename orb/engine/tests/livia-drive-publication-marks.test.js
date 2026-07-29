'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PREPARE_NODE,
  COLLECT_NODE,
  prepareCode,
  collectCode,
  assertCode,
  patchWorkflow,
} = require('../scripts/patch-livia-drive-publication-marks');

function runCode(code, { input = [], items = () => [] } = {}) {
  return new Function('$input', '$items', `"use strict";\n${code}`)(
    { all: () => input, first: () => input[0] || { json: {} } },
    items,
  );
}

function baseWorkflow() {
  return {
    id: 'WGXr4vYkv9UoJ8zc',
    nodes: [
      { name: 'Switch Final Dry Run', type: 'n8n-nodes-base.switch', position: [0, 0], parameters: {} },
      { name: 'Update File', type: 'n8n-nodes-base.googleDrive', position: [400, 0], parameters: {} },
      { name: 'Merge Drive Result and Context', type: 'n8n-nodes-base.merge', position: [600, 0], parameters: {} },
      { name: 'Assert Drive Published', type: 'n8n-nodes-base.code', position: [800, 0], parameters: { jsCode: 'old' } },
    ],
    connections: {
      'Switch Final Dry Run': { main: [[
        { node: 'Update File', type: 'main', index: 0 },
        { node: 'Merge Drive Result and Context', type: 'main', index: 0 },
      ], []] },
      'Update File': { main: [[{ node: 'Merge Drive Result and Context', type: 'main', index: 1 }]] },
      'Merge Drive Result and Context': { main: [[{ node: 'Assert Drive Published', type: 'main', index: 0 }]] },
    },
  };
}

test('Drive publication patch fans out every verified source and removes the positional merge', () => {
  const patched = patchWorkflow(baseWorkflow());
  const names = patched.nodes.map((node) => node.name);
  assert.ok(names.includes(PREPARE_NODE));
  assert.ok(names.includes(COLLECT_NODE));
  assert.ok(!names.includes('Merge Drive Result and Context'));
  assert.deepEqual(patched.connections['Switch Final Dry Run'].main[0], [{ node: PREPARE_NODE, type: 'main', index: 0 }]);
  assert.deepEqual(patched.connections[PREPARE_NODE].main[0], [{ node: 'Update File', type: 'main', index: 0 }]);
  assert.deepEqual(patched.connections['Update File'].main[0], [{ node: COLLECT_NODE, type: 'main', index: 0 }]);
  assert.deepEqual(patched.connections[COLLECT_NODE].main[0], [{ node: 'Assert Drive Published', type: 'main', index: 0 }]);
  assert.deepEqual(patchWorkflow(patched), patched);
});

test('Drive publication contract marks and verifies every carousel source file', () => {
  const source = { json: {
    id: 'file-a',
    fileIds: ['file-a', 'file-b', 'file-c'],
    groupKey: 'dt:2907261000',
    whatsappMessage: 'ok',
    shouldNotify: true,
    codexDryRun: false,
  } };
  const prepared = runCode(prepareCode, { input: [source] });
  assert.equal(prepared.length, 3);
  assert.deepEqual(prepared.map((item) => item.json.id), ['file-a', 'file-b', 'file-c']);
  const updates = prepared.map((item) => ({ json: { id: item.json.id, properties: { published: 'true' } } }));
  const collected = runCode(collectCode, { input: updates, items: (name) => name === PREPARE_NODE ? prepared : [] });
  assert.deepEqual(collected[0].json.driveAudit.verifiedFileIds, ['file-a', 'file-b', 'file-c']);
  const asserted = runCode(assertCode, { input: collected });
  assert.equal(asserted[0].json.driveAudit.verifiedFileCount, 3);
});

test('Drive publication contract fails closed for an incomplete carousel readback', () => {
  const prepared = runCode(prepareCode, { input: [{ json: {
    id: 'file-a', fileIds: ['file-a', 'file-b'], groupKey: 'group', shouldNotify: true,
  } }] });
  assert.throws(
    () => runCode(collectCode, {
      input: [{ json: { id: 'file-a', properties: { published: 'true' } } }],
      items: (name) => name === PREPARE_NODE ? prepared : [],
    }),
    /count mismatch/,
  );
});
