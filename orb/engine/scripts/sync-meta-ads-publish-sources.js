#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CODE_SOURCES } = require('./lib/meta-ads-publish-code-sources');

const moduleRoot = path.resolve(__dirname, '..');
const workflowArg = process.argv.slice(2).find((value) => value.startsWith('--workflow='));
const workflowPath = workflowArg
  ? path.resolve(workflowArg.slice('--workflow='.length))
  : path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

function readWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function writeWorkflow(workflow) {
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  if (node.type !== 'n8n-nodes-base.code') throw new Error(`Node is not a Code node: ${name}`);
  return node;
}

function extract() {
  const workflow = readWorkflow();
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const [nodeName, fileName] of Object.entries(CODE_SOURCES)) {
    const code = String(findNode(workflow, nodeName).parameters.jsCode || '');
    if (!code.trim()) throw new Error(`Empty source in node: ${nodeName}`);
    fs.writeFileSync(path.join(sourceRoot, fileName), `${code.replace(/\s+$/, '')}\n`);
  }
}

function inject({ write = true } = {}) {
  const workflow = readWorkflow();
  const drift = [];
  for (const [nodeName, fileName] of Object.entries(CODE_SOURCES)) {
    const filePath = path.join(sourceRoot, fileName);
    const code = fs.readFileSync(filePath, 'utf8').replace(/\s+$/, '');
    const node = findNode(workflow, nodeName);
    const embedded = String(node.parameters.jsCode || '').replace(/\s+$/, '');
    if (embedded !== code) {
      drift.push(nodeName);
      node.parameters.jsCode = code;
    }
  }
  if (write && drift.length) writeWorkflow(workflow);
  return drift;
}

function main() {
  const command = process.argv.slice(2).find((value) => !value.startsWith('--')) || 'check';
  if (command === 'extract') {
    extract();
    console.log(`Extracted ${Object.keys(CODE_SOURCES).length} Code nodes.`);
    return;
  }
  if (command === 'inject') {
    const drift = inject({ write: true });
    console.log(`Injected ${drift.length} changed Code nodes.`);
    return;
  }
  if (command === 'check') {
    const drift = inject({ write: false });
    if (drift.length) {
      throw new Error(`Embedded Code node drift: ${drift.join(', ')}`);
    }
    console.log('Embedded Code node sources are synchronized.');
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main();
