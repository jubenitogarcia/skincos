#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function node(name) {
  const value = workflow.nodes.find((entry) => entry.name === name);
  if (!value) throw new Error(`Missing workflow node: ${name}`);
  return value;
}

function ensureCodeNode({ id, name, position }) {
  const existing = workflow.nodes.find((entry) => entry.name === name);
  if (existing) return existing;
  const created = {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '' },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
  workflow.nodes.push(created);
  return created;
}

function ensurePersistNode() {
  const name = 'Persist Resume Jobs';
  const existing = workflow.nodes.find((entry) => entry.name === name);
  if (existing) return existing;
  const acquire = node('Acquire Publish Run');
  const created = {
    parameters: {
      method: 'PATCH',
      url: "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/meta-ads-publish/runs/' + $json.run_id }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: false,
      options: { timeout: 60000 },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ $json.checkpoint_request }}',
    },
    id: 'meta-publish-persist-resume-jobs',
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [1240, 420],
    credentials: acquire.credentials,
  };
  workflow.nodes.push(created);
  return created;
}

ensureCodeNode({ id: 'meta-publish-build-resume-checkpoint', name: 'Build Resume Jobs Checkpoint', position: [1000, 420] });
ensurePersistNode();
ensureCodeNode({ id: 'meta-publish-restore-resume-jobs', name: 'Restore Persisted Resume Jobs', position: [1480, 420] });

const validate = node('Validate Meta Creative Payload');
const prepare = node('Prepare Creative Operation');
if (!validate || !prepare) throw new Error('Workflow connection anchor missing.');

workflow.connections['Validate Meta Creative Payload'] = {
  main: [[{ node: 'Build Resume Jobs Checkpoint', type: 'main', index: 0 }]],
};
workflow.connections['Build Resume Jobs Checkpoint'] = {
  main: [[{ node: 'Persist Resume Jobs', type: 'main', index: 0 }]],
};
workflow.connections['Persist Resume Jobs'] = {
  main: [[{ node: 'Restore Persisted Resume Jobs', type: 'main', index: 0 }]],
};
workflow.connections['Restore Persisted Resume Jobs'] = {
  main: [[{ node: 'Prepare Creative Operation', type: 'main', index: 0 }]],
};

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Added resume-job checkpoint path.');
