'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { buildCandidate } = require('../scripts/prepare-livia-production-candidate');

const releaseRoot = '/opt/skincos/releases/0123456789abcdef0123456789abcdef01234567/source/orb/engine';
const workflowPath = path.join(__dirname, '..', 'workflows', 'livia', 'livia.current.json');

function liveFixture() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

test('production candidate builder applies every Livia fail-closed patch as one unit', () => {
  const { workflow, report } = buildCandidate(liveFixture(), releaseRoot);
  const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

  assert.deepEqual(report.patches, [
    'drive-publication-marks',
    'token-vault-preflight',
    'accessibility-contract',
    'facebook-carousel-contract',
    'job-graph-payload-file',
    'runtime-isolation',
  ]);
  assert.equal(nodes.has('Merge Drive Result and Context'), false);
  assert.equal(nodes.has('Prepare Drive Publication Marks'), true);
  assert.equal(nodes.has('Collect Drive Publication Marks'), true);
  assert.match(nodes.get('Validate Publish Token Health').parameters.command, /\. \/etc\/skincos\/orb-business\.env/);
  assert.match(nodes.get('Validate Publish Token Health').parameters.command, new RegExp(releaseRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(nodes.get('Prepare HTTP Publish Request').parameters.jsCode, /sourceMediaCount/);
  assert.match(nodes.get('Prepare HTTP Publish Request').parameters.jsCode, /perdeu a ordem ou identidade semântica/);
  assert.match(nodes.get('Collect Publish Results').parameters.jsCode, /mediaEvidenceContract/);
  assert.match(nodes.get('Assert Livia Publication Window').parameters.jsCode, /_liviaBuildJobGraphPayloadFile/);
  assert.match(nodes.get('Assert Livia Publication Window').parameters.jsCode, /fs\.renameSync/);
  assert.doesNotMatch(nodes.get('Assert Livia Publication Window').parameters.jsCode, /process\.pid/);
  assert.match(nodes.get('BQ - Build Platform Job Graph').parameters.command, /--payload-file/);
  assert.doesNotMatch(nodes.get('BQ - Build Platform Job Graph').parameters.command, /JSON\.stringify\(payload\)/);

  for (const node of workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.executeCommand')) {
    const command = String(node.parameters?.command || '');
    assert.doesNotMatch(command, /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b|\/mnt\/c\//);
  }
});
