#!/usr/bin/env node
'use strict';

// Inserts the private Token Vault ad-set reconciliation before the resumable
// checkpoint. The gateway is responsible for the only Graph mutation; this
// graph never carries a Pixel, custom conversion or offline dataset ID.
const fs = require('fs');
const path = require('path');
const { assertCodeSourceCoverage } = require('./lib/meta-ads-publish-code-sources');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const VALIDATE_NODE = 'Validate Meta Creative Payload';
const CHECKPOINT_NODE = 'Build Resume Jobs Checkpoint';
const PREPARE_NODE = 'Prepare Tracking Reconciliation';
const ENSURE_NODE = 'Ensure Ad Set Conversion Contract';
const ATTACH_NODE = 'Attach Tracking Reconciliation';
const NEW_NODE_NAMES = [PREPARE_NODE, ENSURE_NODE, ATTACH_NODE];

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

function nodeDefinitions() {
  return [
    {
      id: 'meta-publish-prepare-tracking-reconciliation',
      name: PREPARE_NODE,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: { jsCode: codeSource('prepare-tracking-reconciliation.js') },
      position: [8752, 1000],
    },
    {
      id: 'meta-publish-ensure-adset-conversion-contract',
      name: ENSURE_NODE,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      parameters: {
        method: 'POST',
        url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id + '/operations' }}",
        authentication: 'genericCredentialType',
        genericAuthType: 'httpBearerAuth',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.gateway_request }}',
        options: { timeout: 330000 },
      },
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 15000,
      position: [8976, 1000],
      credentials: {
        httpBearerAuth: {
          id: 'metaPublishGatewayBearer',
          name: 'Meta Ads Publish - Gateway Bearer',
        },
      },
    },
    {
      id: 'meta-publish-attach-tracking-reconciliation',
      name: ATTACH_NODE,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: { jsCode: codeSource('attach-tracking-reconciliation.js') },
      position: [9200, 1000],
    },
  ];
}

function validate(workflow) {
  if (workflow?.id !== WORKFLOW_ID || workflow?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const connections = workflow.connections || {};
  const prepare = requireNode(workflow, PREPARE_NODE, 'n8n-nodes-base.code');
  const ensure = requireNode(workflow, ENSURE_NODE, 'n8n-nodes-base.httpRequest');
  const attach = requireNode(workflow, ATTACH_NODE, 'n8n-nodes-base.code');
  requireNode(workflow, VALIDATE_NODE, 'n8n-nodes-base.code');
  requireNode(workflow, CHECKPOINT_NODE, 'n8n-nodes-base.code');
  if (nodes.filter((node) => NEW_NODE_NAMES.includes(node.name)).length !== NEW_NODE_NAMES.length) {
    throw new Error('Tracking reconciliation nodes are duplicated or incomplete.');
  }
  if (!String(prepare.parameters?.jsCode || '').includes("action: 'ensure_adset_conversion_contract'") ||
    !String(prepare.parameters?.jsCode || '').includes('tracking-adset:v1:')) {
    throw new Error('Tracking reconciliation does not prepare the guarded gateway operation.');
  }
  if (ensure.parameters?.method !== 'POST' ||
    !String(ensure.parameters?.url || '').includes('/v1/meta-ads-publish/runs/') ||
    !String(ensure.parameters?.jsonBody || '').includes('$json.gateway_request') ||
    ensure.parameters?.authentication !== 'genericCredentialType' ||
    ensure.parameters?.genericAuthType !== 'httpBearerAuth' ||
    !ensure.credentials?.httpBearerAuth?.id ||
    ensure.continueOnFail === true) {
    throw new Error('Tracking reconciliation gateway request is incomplete or fail-open.');
  }
  if (!String(attach.parameters?.jsCode || '').includes('adset_conversion_reconciliation') ||
    !String(attach.parameters?.jsCode || '').includes("['verified', 'reconciled']")) {
    throw new Error('Tracking reconciliation does not attach a verified attestation.');
  }
  if (hasTarget(connections, VALIDATE_NODE, CHECKPOINT_NODE) ||
    !hasTarget(connections, VALIDATE_NODE, PREPARE_NODE) ||
    !hasTarget(connections, PREPARE_NODE, ENSURE_NODE) ||
    !hasTarget(connections, ENSURE_NODE, ATTACH_NODE) ||
    !hasTarget(connections, ATTACH_NODE, CHECKPOINT_NODE)) {
    throw new Error('Tracking reconciliation graph is not sequenced before the checkpoint.');
  }
  assertCodeSourceCoverage(workflow);
  return true;
}

function transform(workflow) {
  const candidate = clone(workflow);
  if (candidate?.id !== WORKFLOW_ID || candidate?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  requireNode(candidate, VALIDATE_NODE, 'n8n-nodes-base.code');
  requireNode(candidate, CHECKPOINT_NODE, 'n8n-nodes-base.code');

  // Normalize a previously patched graph to its direct original edge before
  // recreating the controlled nodes, so this transform remains idempotent.
  if (hasTarget(candidate.connections, VALIDATE_NODE, PREPARE_NODE)) {
    replaceTarget(candidate.connections, VALIDATE_NODE, PREPARE_NODE, CHECKPOINT_NODE);
  }
  candidate.nodes = candidate.nodes.filter((node) => !NEW_NODE_NAMES.includes(node.name));
  for (const name of NEW_NODE_NAMES) delete candidate.connections[name];
  candidate.nodes.push(...nodeDefinitions());
  replaceTarget(candidate.connections, VALIDATE_NODE, CHECKPOINT_NODE, PREPARE_NODE);
  candidate.connections[PREPARE_NODE] = { main: [[{ node: ENSURE_NODE, type: 'main', index: 0 }]] };
  candidate.connections[ENSURE_NODE] = { main: [[{ node: ATTACH_NODE, type: 'main', index: 0 }]] };
  candidate.connections[ATTACH_NODE] = { main: [[{ node: CHECKPOINT_NODE, type: 'main', index: 0 }]] };
  validate(candidate);
  return candidate;
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((value) => value.startsWith('--input='))?.slice('--input='.length);
  const output = args.find((value) => value.startsWith('--output='))?.slice('--output='.length);
  if (!input || !output) throw new Error('Usage: node patch-meta-ads-tracking-reconciliation.js --input=<workflow.json> --output=<workflow.json>');
  const candidate = transform(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, added_nodes: NEW_NODE_NAMES, output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = {
  ATTACH_NODE,
  CHECKPOINT_NODE,
  ENSURE_NODE,
  NEW_NODE_NAMES,
  PREPARE_NODE,
  VALIDATE_NODE,
  transform,
  validate,
};
