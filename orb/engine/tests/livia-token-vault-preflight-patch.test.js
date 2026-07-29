'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { commandFor, patchWorkflow } = require('../scripts/patch-livia-token-vault-preflight');

const releaseRoot = '/opt/skincos/releases/0123456789abcdef0123456789abcdef01234567/source/orb/engine';
const workflow = {
  id: 'WGXr4vYkv9UoJ8zc',
  nodes: [{ name: 'Validate Publish Token Health', type: 'n8n-nodes-base.executeCommand', parameters: { command: 'old' } }],
};

test('preflight patch pins the versioned script and uses the verifier environment', () => {
  const patched = patchWorkflow(workflow, releaseRoot);
  const command = patched.nodes[0].parameters.command;
  assert.match(command, /\. \/etc\/skincos\/orb-business\.env/);
  assert.match(command, /validate-publish-token-health\.js/);
  assert.match(command, new RegExp(releaseRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(workflow.nodes[0].parameters.command, 'old');
});

test('preflight patch rejects mutable release roots', () => {
  assert.throws(() => commandFor('/opt/skincos/current/source/orb/engine'), /immutable/);
});
