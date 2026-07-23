#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error('Usage: patch-meta-ads-video-staging.js <input-workflow.json> <output-workflow.json>');
}

const sourceRoot = path.resolve(__dirname, '..', 'workflow-src', 'meta-ads-publish');
const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function source(fileName) {
  return fs.readFileSync(path.join(sourceRoot, fileName), 'utf8').replace(/\s+$/, '');
}

function upsert(node) {
  const index = workflow.nodes.findIndex((entry) => entry.name === node.name);
  if (index >= 0) workflow.nodes[index] = { ...workflow.nodes[index], ...node };
  else workflow.nodes.push(node);
}

function connect(from, to) {
  workflow.connections[from] = workflow.connections[from] || { main: [[]] };
  workflow.connections[from].main = workflow.connections[from].main || [[]];
  workflow.connections[from].main[0] = [{ node: to, type: 'main', index: 0 }];
}

const classify = workflow.nodes.find((node) => node.name === 'Classify Media');
if (!classify?.parameters) throw new Error('Classify Media node not found.');
classify.parameters.jsCode = source('classify-media.js');

upsert({
  id: 'meta-media-prepare-staging',
  name: 'Prepare Video Staging Directory',
  type: 'n8n-nodes-base.executeCommand',
  typeVersion: 1,
  position: [-1760, 608],
  parameters: {
    executeOnce: false,
    command: '=install -d -m 0750 -- "{{ $json.media_staging.base_dir }}"',
  },
});
upsert({
  id: 'meta-media-attach-staging',
  name: 'Attach Video Staging Context',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-1536, 608],
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: source('attach-video-staging-context.js'),
  },
});

connect('Is Video?', 'Prepare Video Staging Directory');
connect('Prepare Video Staging Directory', 'Attach Video Staging Context');
connect('Attach Video Staging Context', 'Write Video Source');

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ input: inputPath, output: outputPath, nodeCount: workflow.nodes.length }, null, 2));
