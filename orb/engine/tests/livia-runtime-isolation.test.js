#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const RELEASE = 'c525f5e1d68829fe4c93197f65d85429a2e0385c';
const RELEASE_ROOT = `/opt/skincos/releases/${RELEASE}/source/orb/engine`;
const PATCHER = path.resolve(__dirname, '..', 'scripts', 'patch-livia-runtime-isolation.js');

function commandNode(name, command) {
  return { name, type: 'n8n-nodes-base.executeCommand', parameters: { command } };
}

function fixture() {
  const pinned = (entrypoint) => `={{ node '${RELEASE_ROOT}/scripts/livia/${entrypoint}' --payload '{}' }}`;
  return {
    id: WORKFLOW_ID,
    active: true,
    nodes: [
      commandNode('Process Media Asset', pinned('process-media-asset.js')),
      commandNode('BQ - Build Platform Job Graph', `={{ LIVIA_BUILD_JOB_GRAPH_SOURCE='${RELEASE_ROOT}/compose2-current.js' node '${RELEASE_ROOT}/scripts/livia/build-platform-job-graph.js' --payload '{}' }}`),
      commandNode('Verify Published Artifacts', `={{ node '/mnt/c/CodexRuntime/operator/admin/skincos/livia-verify-provider-copy-drift-wrapper.js' --verifier '${RELEASE_ROOT}/scripts/livia/verify-published-artifacts.js' --payload - }}`),
      commandNode('Record Publish Progress', pinned('publish-progress-ledger.js')),
      commandNode('Validate Publish Token Health', pinned('validate-publish-token-health.js')),
      { name: 'BQ - Seed Publish State', type: 'n8n-nodes-base.code', parameters: { jsCode: 'const resumeBySemanticKey = new Map(); const completedSemanticJobKeys = new Set();' } },
      { name: 'Process HTTP Publish Result', type: 'n8n-nodes-base.code', parameters: { jsCode: 'const row = { semanticJobKey: str(source.semanticJobKey, "") };' } },
    ],
    connections: {},
  };
}

test('runtime isolation replaces a mutable verifier wrapper with the pinned entrypoint', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-runtime-isolation-'));
  try {
    const input = path.join(temp, 'input.json');
    const output = path.join(temp, 'output.json');
    fs.writeFileSync(input, JSON.stringify(fixture()));
    const result = spawnSync(process.execPath, [PATCHER, input, output, `--release-root=${RELEASE_ROOT}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const workflow = JSON.parse(fs.readFileSync(output, 'utf8'));
    const command = workflow.nodes.find((node) => node.name === 'Verify Published Artifacts').parameters.command;
    assert.ok(command.includes(`${RELEASE_ROOT}/scripts/livia/verify-published-artifacts.js`));
    assert.doesNotMatch(command, /\/mnt\/c\/|livia-verify-provider-copy-drift-wrapper|--verifier\b|\/opt\/skincos\/current\/source/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
