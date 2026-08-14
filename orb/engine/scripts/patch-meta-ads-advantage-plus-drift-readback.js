#!/usr/bin/env node
'use strict';

// Adds a second, post-activation Graph readback while the publish run is still
// open. The operation is a Token Vault journal entry, but its Graph request is
// strictly get_creative (HTTP GET); it never recreates, updates, activates or
// rolls back a Meta resource.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const ACTIVATE_NODE = 'Activate Ad Batch';
const BUILD_DRIVE_NODE = 'Build Drive Finalization';
const RESUME_DRIVE_NODE = 'Resume Drive Only?';
const INITIAL_VERIFY_NODE = 'Verify Advantage+ Creative';
const WAIT_NODE = 'Wait Advantage+ Post-Activation Stabilization';
const PREPARE_NODE = 'Prepare Advantage+ Drift Readback';
const VERIFY_NODE = 'Verify Advantage+ Drift Readback';
const CLASSIFY_NODE = 'Classify Advantage+ Graph Drift';
const NEW_NODE_NAMES = [WAIT_NODE, PREPARE_NODE, VERIFY_NODE, CLASSIFY_NODE];
const CODE_SOURCE_FILES = Object.freeze({
  [PREPARE_NODE]: 'prepare-advantage-plus-drift-readback.js',
  [CLASSIFY_NODE]: 'classify-advantage-plus-graph-drift.js',
  [BUILD_DRIVE_NODE]: 'build-drive-finalization.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
});

function clone(value) { return structuredClone(value); }
function nodeByName(workflow, name) { return workflow?.nodes?.find((node) => node.name === name); }
function codeSource(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish', fileName), 'utf8').replace(/\s+$/, '');
}
function requireNode(workflow, name, type) {
  const node = nodeByName(workflow, name);
  if (!node || (type && node.type !== type)) throw new Error(`Expected ${type || 'workflow'} node: ${name}`);
  return node;
}
function outgoing(connections, name) {
  return (connections?.[name]?.main || []).flat().filter(Boolean);
}
function hasTarget(connections, from, to) {
  return outgoing(connections, from).some((edge) => edge.node === to);
}
function replaceTarget(connections, from, oldTarget, newTarget) {
  const main = connections?.[from]?.main;
  if (!Array.isArray(main)) throw new Error(`Workflow connection missing from ${from}.`);
  let replaced = false;
  connections[from] = {
    ...connections[from],
    main: main.map((branch) => (Array.isArray(branch) ? branch.map((edge) => {
      if (edge?.node !== oldTarget) return edge;
      replaced = true;
      return { ...edge, node: newTarget };
    }) : branch)),
  };
  if (!replaced) throw new Error(`Workflow edge missing: ${from} -> ${oldTarget}.`);
}

function nodeDefinitions(initialVerify) {
  const lateVerify = clone(initialVerify);
  lateVerify.id = 'meta-publish-verify-advantage-drift-readback';
  lateVerify.name = VERIFY_NODE;
  lateVerify.position = [13680, 1272];
  lateVerify.continueOnFail = true;
  return [
    {
      id: 'meta-publish-advantage-post-activation-stabilization-wait',
      name: WAIT_NODE,
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      parameters: { amount: 30 },
      position: [13232, 1272],
    },
    {
      id: 'meta-publish-prepare-advantage-drift-readback',
      name: PREPARE_NODE,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: { jsCode: codeSource(CODE_SOURCE_FILES[PREPARE_NODE]) },
      position: [13456, 1272],
    },
    lateVerify,
    {
      id: 'meta-publish-classify-advantage-graph-drift',
      name: CLASSIFY_NODE,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: { jsCode: codeSource(CODE_SOURCE_FILES[CLASSIFY_NODE]) },
      position: [13904, 1272],
    },
  ];
}

function validate(workflow) {
  if (workflow?.id !== WORKFLOW_ID || workflow?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const connections = workflow.connections || {};
  const wait = requireNode(workflow, WAIT_NODE, 'n8n-nodes-base.wait');
  const prepare = requireNode(workflow, PREPARE_NODE, 'n8n-nodes-base.code');
  const verify = requireNode(workflow, VERIFY_NODE, 'n8n-nodes-base.httpRequest');
  const classify = requireNode(workflow, CLASSIFY_NODE, 'n8n-nodes-base.code');
  if (nodes.filter((node) => NEW_NODE_NAMES.includes(node.name)).length !== NEW_NODE_NAMES.length) throw new Error('Advantage+ drift readback nodes are duplicated or incomplete.');
  if (Number(wait.parameters?.amount) !== 30) throw new Error('Advantage+ post-activation stabilization wait must remain 30 seconds.');
  if (!String(prepare.parameters?.jsCode || '').includes("action: 'get_creative'") || !String(prepare.parameters?.jsCode || '').includes('verify-post-activation:')) {
    throw new Error('Advantage+ drift readback does not prepare a distinct get_creative operation.');
  }
  if (verify.parameters?.method !== 'POST' || !String(verify.parameters?.url || '').includes('/v1/meta-ads-publish/runs/') || !String(verify.parameters?.jsonBody || '').includes('$json.gateway_request') || verify.parameters?.authentication !== 'genericCredentialType' || verify.parameters?.genericAuthType !== 'httpBearerAuth' || !verify.credentials?.httpBearerAuth?.id || verify.continueOnFail !== true) {
    throw new Error('Advantage+ drift readback gateway request is incomplete.');
  }
  const classifyCode = String(classify.parameters?.jsCode || '');
  for (const expected of ['unchanged_graph_state_ui_unverified', 'graph_state_drift_detected', "status: 'unavailable'", "graph_request_method: 'GET'", "automatic_remediation: 'none'"]) {
    if (!classifyCode.includes(expected)) throw new Error(`Advantage+ drift classifier contract is missing: ${expected}`);
  }
  if (hasTarget(connections, ACTIVATE_NODE, BUILD_DRIVE_NODE) || !hasTarget(connections, ACTIVATE_NODE, WAIT_NODE) || !hasTarget(connections, WAIT_NODE, PREPARE_NODE) || !hasTarget(connections, PREPARE_NODE, VERIFY_NODE) || !hasTarget(connections, VERIFY_NODE, CLASSIFY_NODE) || !hasTarget(connections, CLASSIFY_NODE, BUILD_DRIVE_NODE)) {
    throw new Error('Advantage+ drift readback graph is not sequenced before Drive finalization.');
  }
  if (!hasTarget(connections, RESUME_DRIVE_NODE, BUILD_DRIVE_NODE)) throw new Error('Drive-only resume path was changed by the Advantage+ drift readback patch.');
  const buildDrive = requireNode(workflow, BUILD_DRIVE_NODE, 'n8n-nodes-base.code');
  const driveCode = String(buildDrive.parameters?.jsCode || '');
  if (!driveCode.includes("$items('Activate Ad Batch')") || !driveCode.includes('advantage_plus_graph_drift')) {
    throw new Error('Drive finalization does not preserve the Advantage+ drift summary.');
  }
  return true;
}

function transform(workflow) {
  const candidate = clone(workflow);
  if (candidate?.id !== WORKFLOW_ID || candidate?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  const initialVerify = clone(requireNode(candidate, INITIAL_VERIFY_NODE, 'n8n-nodes-base.httpRequest'));
  requireNode(candidate, ACTIVATE_NODE, 'n8n-nodes-base.httpRequest');
  requireNode(candidate, BUILD_DRIVE_NODE, 'n8n-nodes-base.code');
  requireNode(candidate, RESUME_DRIVE_NODE, 'n8n-nodes-base.if');

  // Make the transform idempotent: normalize an already-patched graph back to
  // its single original edge before recreating the four controlled nodes.
  if (hasTarget(candidate.connections, ACTIVATE_NODE, WAIT_NODE)) {
    replaceTarget(candidate.connections, ACTIVATE_NODE, WAIT_NODE, BUILD_DRIVE_NODE);
  }
  candidate.nodes = candidate.nodes.filter((node) => !NEW_NODE_NAMES.includes(node.name));
  for (const nodeName of NEW_NODE_NAMES) delete candidate.connections[nodeName];
  for (const [nodeName, fileName] of Object.entries(CODE_SOURCE_FILES)) {
    const node = nodeByName(candidate, nodeName);
    if (node) node.parameters.jsCode = codeSource(fileName);
  }
  candidate.nodes.push(...nodeDefinitions(initialVerify));
  replaceTarget(candidate.connections, ACTIVATE_NODE, BUILD_DRIVE_NODE, WAIT_NODE);
  candidate.connections[WAIT_NODE] = { main: [[{ node: PREPARE_NODE, type: 'main', index: 0 }]] };
  candidate.connections[PREPARE_NODE] = { main: [[{ node: VERIFY_NODE, type: 'main', index: 0 }]] };
  candidate.connections[VERIFY_NODE] = { main: [[{ node: CLASSIFY_NODE, type: 'main', index: 0 }]] };
  candidate.connections[CLASSIFY_NODE] = { main: [[{ node: BUILD_DRIVE_NODE, type: 'main', index: 0 }]] };
  validate(candidate);
  return candidate;
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((value) => value.startsWith('--input='))?.slice('--input='.length);
  const output = args.find((value) => value.startsWith('--output='))?.slice('--output='.length);
  if (!input || !output) throw new Error('Usage: node patch-meta-ads-advantage-plus-drift-readback.js --input=<workflow.json> --output=<workflow.json>');
  const candidate = transform(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, added_nodes: NEW_NODE_NAMES, output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = {
  ACTIVATE_NODE,
  BUILD_DRIVE_NODE,
  CLASSIFY_NODE,
  PREPARE_NODE,
  RESUME_DRIVE_NODE,
  VERIFY_NODE,
  WAIT_NODE,
  transform,
  validate,
};
