#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const moduleRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

const CODE_SOURCES = Object.freeze({
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
  'Validate Meta Placement Eligibility': 'validate-meta-placement-eligibility.js',
  'Build Payload': 'build-payload.js',
  'Prepare Publish Run': 'prepare-publish-run.js',
  'Restore Publish Groups': 'restore-publish-groups.js',
  'Prepare Gateway Uploads': 'prepare-gateway-uploads.js',
  'Normalize Gateway Upload': 'normalize-gateway-upload.js',
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Prepare Creative Operation': 'prepare-creative-operation.js',
  'Attach Creative Result': 'attach-creative-result.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
  'Build Stage Batch': 'build-stage-batch.js',
  'Build Activate Batch': 'build-activate-batch.js',
  'Build Drive Finalization': 'build-drive-finalization.js',
  'Prepare Drive Read': 'prepare-drive-read.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
});

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
  const command = process.argv[2] || 'check';
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
