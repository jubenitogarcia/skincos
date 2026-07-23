#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const moduleRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

function readSource(name) {
  return fs.readFileSync(path.join(sourceRoot, name), 'utf8').replace(/\s+$/, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mainConnection(target) {
  return { main: [[{ node: target, type: 'main', index: 0 }]] };
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = workflow.nodes || [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const create = byName.get('Create AdCreative');
if (!create) throw new Error('Create AdCreative node not found.');
const fallbackAlreadyPresent = byName.has('Prepare Creative Fallback 1');

const definitions = [
  {
    name: 'Prepare Creative Fallback 1',
    id: 'meta-prepare-creative-fallback-1',
    source: 'prepare-creative-fallback-1.js',
    position: [1600, 640],
  },
  {
    name: 'Prepare Creative Fallback 2',
    id: 'meta-prepare-creative-fallback-2',
    source: 'prepare-creative-fallback-2.js',
    position: [2048, 640],
  },
];
for (const definition of definitions) {
  let node = byName.get(definition.name);
  if (!node) {
    node = {
      parameters: { mode: 'runOnceForAllItems', jsCode: '' },
      id: definition.id,
      name: definition.name,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: definition.position,
    };
    nodes.push(node);
    byName.set(node.name, node);
  }
  node.parameters.jsCode = readSource(definition.source);
}

const fallbackHttp = [
  { name: 'Create AdCreative Fallback 1', id: 'meta-create-adcreative-fallback-1', position: [1824, 640], continueOnFail: true },
  { name: 'Create AdCreative Fallback 2', id: 'meta-create-adcreative-fallback-2', position: [2272, 640], continueOnFail: false },
];
for (const definition of fallbackHttp) {
  let node = byName.get(definition.name);
  if (!node) {
    node = clone(create);
    node.name = definition.name;
    node.id = definition.id;
    nodes.push(node);
    byName.set(node.name, node);
  }
  node.position = definition.position;
  node.retryOnFail = true;
  node.maxTries = 2;
  node.waitBetweenTries = 10000;
  if (definition.continueOnFail) node.continueOnFail = true;
  else delete node.continueOnFail;
}
create.continueOnFail = true;

const attach = byName.get('Attach Creative Result');
if (!attach) throw new Error('Attach Creative Result node not found.');
const nodesToShift = nodes.filter((node) => ![
  'Prepare Creative Fallback 1',
  'Create AdCreative Fallback 1',
  'Prepare Creative Fallback 2',
  'Create AdCreative Fallback 2',
].includes(node.name) && Array.isArray(node.position) && Number(node.position[0]) >= 1600);
if (!fallbackAlreadyPresent) {
  for (const node of nodesToShift) node.position[0] = Number(node.position[0]) + 896;
}

workflow.connections['Create AdCreative'] = mainConnection('Prepare Creative Fallback 1');
workflow.connections['Prepare Creative Fallback 1'] = mainConnection('Create AdCreative Fallback 1');
workflow.connections['Create AdCreative Fallback 1'] = mainConnection('Prepare Creative Fallback 2');
workflow.connections['Prepare Creative Fallback 2'] = mainConnection('Create AdCreative Fallback 2');
workflow.connections['Create AdCreative Fallback 2'] = mainConnection('Attach Creative Result');

workflow.nodes = nodes;
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, node_count: nodes.length, added: [...definitions, ...fallbackHttp].map((item) => item.name) }, null, 2));
