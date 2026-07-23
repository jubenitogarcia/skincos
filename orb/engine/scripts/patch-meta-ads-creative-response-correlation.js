#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');

const mergeNodes = [
  { id: 'meta-merge-creative-response-0', name: 'Merge Creative Response 0', position: [1488, 496] },
  { id: 'meta-merge-creative-response-1', name: 'Merge Creative Response 1', position: [1936, 496] },
  { id: 'meta-merge-creative-response-2', name: 'Merge Creative Response 2', position: [2384, 496] },
];

function target(node, index = 0) {
  return { node, type: 'main', index };
}

function main(...connections) {
  return { main: [connections] };
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

for (const definition of mergeNodes) {
  const existing = workflow.nodes.find((node) => node.name === definition.name || node.id === definition.id);
  const node = {
    parameters: {
      mode: 'combine',
      combineBy: 'combineByPosition',
      options: {
        clashHandling: {
          values: {
            resolveClash: 'preferInput2',
            mergeMode: 'deepMerge',
            overrideEmpty: false,
          },
        },
      },
    },
    id: definition.id,
    name: definition.name,
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position: definition.position,
  };
  if (existing) Object.assign(existing, node);
  else workflow.nodes.push(node);
}

workflow.connections['Prepare Creative Operation'] = main(
  target('Merge Creative Response 0', 0),
  target('Create AdCreative', 0),
);
workflow.connections['Create AdCreative'] = main(target('Merge Creative Response 0', 1));
workflow.connections['Merge Creative Response 0'] = main(target('Prepare Creative Fallback 1'));

workflow.connections['Prepare Creative Fallback 1'] = main(
  target('Merge Creative Response 1', 0),
  target('Create AdCreative Fallback 1', 0),
);
workflow.connections['Create AdCreative Fallback 1'] = main(target('Merge Creative Response 1', 1));
workflow.connections['Merge Creative Response 1'] = main(target('Prepare Creative Fallback 2'));

workflow.connections['Prepare Creative Fallback 2'] = main(
  target('Merge Creative Response 2', 0),
  target('Create AdCreative Fallback 2', 0),
);
workflow.connections['Create AdCreative Fallback 2'] = main(target('Merge Creative Response 2', 1));
workflow.connections['Merge Creative Response 2'] = main(target('Attach Creative Result'));

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Creative responses now correlate through explicit Merge nodes.');
