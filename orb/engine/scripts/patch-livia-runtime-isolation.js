#!/usr/bin/env node
'use strict';

// Creates a version-pinned Livia candidate.  Applying it is intentionally a
// separate, expected-version-checked operation.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const REQUIRED_NODES = new Set([
  'Process Media Asset',
  'BQ - Build Platform Job Graph',
  'Verify Published Artifacts',
  'Record Publish Progress',
  'Validate Publish Token Health',
]);
const RELEASE_ROOT_RE = /^\/opt\/skincos\/releases\/[0-9a-f]{7,64}\/source\/orb\/engine$/;

function fail(message) { throw new Error(message); }
function arg(prefix) { return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''; }
function validate(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID || workflow?.active !== true) fail('Expected the active Livia workflow.');
  if (!RELEASE_ROOT_RE.test(releaseRoot)) fail(`Invalid immutable Orb release root: ${releaseRoot}.`);
  const touched = [];
  for (const node of workflow.nodes || []) {
    if (!REQUIRED_NODES.has(node?.name)) continue;
    if (node.type !== 'n8n-nodes-base.executeCommand') fail(`${node.name} must remain an Execute Command node.`);
    const command = String(node.parameters?.command || '');
    if (!command.includes('/opt/skincos/current/source/orb/engine')) fail(`${node.name} no longer has the expected mutable source path.`);
    node.parameters.command = command.replaceAll('/opt/skincos/current/source/orb/engine', releaseRoot);
    touched.push(node.name);
  }
  if (touched.length !== REQUIRED_NODES.size) fail(`Expected to pin ${REQUIRED_NODES.size} Livia sidecars, changed ${touched.length}.`);
  const mutable = (workflow.nodes || []).filter((node) => node?.type === 'n8n-nodes-base.executeCommand')
    .filter((node) => /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b/.test(String(node.parameters?.command || '')))
    .map((node) => node.name);
  if (mutable.length) fail(`Mutable Execute Command reference remains: ${mutable.join(', ')}.`);
  return touched.sort();
}

function main() {
  const [input, output] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const releaseRoot = arg('--release-root=');
  if (!input || !output || !releaseRoot) {
    fail('Usage: patch-livia-runtime-isolation.js <live-export.json> <candidate.json> --release-root=/opt/skincos/releases/<sha>/source/orb/engine');
  }
  const workflow = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const touched = validate(workflow, releaseRoot);
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o640 });
  process.stdout.write(JSON.stringify({ ok: true, workflowId: WORKFLOW_ID, releaseRoot, nodes: touched }) + '\n');
}

main();
