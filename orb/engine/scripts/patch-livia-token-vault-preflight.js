#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const NODE_NAME = 'Validate Publish Token Health';

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

function commandFor(releaseRoot) {
  if (!/^\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine$/.test(releaseRoot)) {
    throw new Error('release root must be an immutable /opt/skincos/releases/<sha>/source/orb/engine path.');
  }
  return `={{ (() => {
  const payload = $json || {};
  function sh(value) { return "'" + String(value).replace(/'/g, "'\\\\''") + "'"; }
  return "set -a; . /etc/skincos/orb-business.env; set +a; node " + sh("${releaseRoot}/scripts/livia/validate-publish-token-health.js") + " --payload " + sh(JSON.stringify(payload));
})() }}`;
}

function patchWorkflow(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const node = (workflow.nodes || []).find((candidate) => candidate?.name === NODE_NAME);
  if (!node || node.type !== 'n8n-nodes-base.executeCommand') {
    throw new Error(`${NODE_NAME} must be an Execute Command node.`);
  }
  const candidate = structuredClone(workflow);
  const target = candidate.nodes.find((entry) => entry?.name === NODE_NAME);
  target.parameters ||= {};
  target.parameters.command = commandFor(releaseRoot);
  return candidate;
}

function main() {
  const input = required('--input');
  const output = required('--output');
  const releaseRoot = required('--release-root');
  const patched = patchWorkflow(readWorkflow(input), releaseRoot);
  const outputDir = path.dirname(output);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(patched, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    workflowId: patched.id,
    node: NODE_NAME,
    output,
    releaseRoot,
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || String(error));
    process.exit(1);
  }
}

module.exports = { commandFor, patchWorkflow };
