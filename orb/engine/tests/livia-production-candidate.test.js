'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { buildCandidate } = require('../scripts/prepare-livia-production-candidate');
const { patchWorkflow: patchTodayFirstSelection } = require('../scripts/patch-livia-today-first-selection');

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
    'today-first-due-selection',
    'schedule-cadence',
    'job-graph-payload-file',
    'notification-contract',
    'ai-reel-cover-generation',
    'runtime-isolation',
  ]);
  assert.equal(nodes.has('Merge Drive Result and Context'), false);
  assert.equal(nodes.has('Prepare Drive Publication Marks'), true);
  assert.equal(nodes.has('Collect Drive Publication Marks'), true);
  assert.deepEqual(nodes.get('Schedule Trigger').parameters.rule.interval, [
    { field: 'minutes', minutesInterval: 15 },
  ]);
  assert.match(nodes.get('Validate Publish Token Health').parameters.command, /\. \/etc\/skincos\/orb-business\.env/);
  assert.match(nodes.get('Validate Publish Token Health').parameters.command, new RegExp(releaseRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(nodes.get('Prepare HTTP Publish Request').parameters.jsCode, /sourceMediaCount/);
  assert.match(nodes.get('Prepare HTTP Publish Request').parameters.jsCode, /perdeu a ordem ou identidade semântica/);
  assert.match(nodes.get('Collect Publish Results').parameters.jsCode, /mediaEvidenceContract/);
  assert.match(nodes.get('Prepare Media Items').parameters.jsCode, /livia_selection_today_first_due_v1/);
  assert.match(nodes.get('Prepare Media Items').parameters.jsCode, /America\/Sao_Paulo/);
  assert.match(nodes.get('Prepare Media Items').parameters.jsCode, /firstReadyGroup/);
  assert.match(nodes.get('Assert Livia Publication Window').parameters.jsCode, /_liviaBuildJobGraphPayloadFile/);
  assert.match(nodes.get('Assert Livia Publication Window').parameters.jsCode, /fs\.renameSync/);
  assert.doesNotMatch(nodes.get('Assert Livia Publication Window').parameters.jsCode, /process\.pid/);
  assert.match(nodes.get('BQ - Build Platform Job Graph').parameters.command, /--payload-file/);
  assert.doesNotMatch(nodes.get('BQ - Build Platform Job Graph').parameters.command, /JSON\.stringify\(payload\)/);
  assert.match(nodes.get('Cleanup Temp Files').parameters.command, /env -u NODE_OPTIONS node <<'NODE'/);
  assert.equal(nodes.get('OpenAI Livia Reel Cover Edit').parameters.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(nodes.get('OpenAI Livia Reel Cover Edit').parameters.contentType, 'multipart-form-data');
  assert.equal(nodes.get('OpenAI Livia Reel Cover Edit').retryOnFail, true);
  assert.equal(nodes.get('OpenAI Livia Reel Cover Edit').maxTries, 2);
  assert.equal(nodes.get('Upload Livia Reel Cover').retryOnFail, true);
  for (const name of ['Normalize Livia Reel Cover OpenAI', 'Normalize Livia Reel Cover Cached Binary', 'Normalize Livia Reel Cover Cached Result', 'Normalize Livia Reel Cover Fallback', 'Normalize Livia Reel Cover Upload']) {
    assert.equal(nodes.get(name).parameters.mode, 'runOnceForEachItem');
  }
  for (const name of ['Prepare Livia Reel Cover Jobs', 'Normalize Livia Reel Cover OpenAI', 'Normalize Livia Reel Cover Cached Binary', 'Normalize Livia Reel Cover Cached Result', 'Normalize Livia Reel Cover Fallback', 'Normalize Livia Reel Cover Upload', 'Aggregate Livia Reel Cover Outcomes', 'Attach Livia Reel Cover Context']) {
    assert.equal(nodes.get(name).typeVersion, 2);
    assert.equal(nodes.get(name).parameters.language, 'javaScript');
  }
  assert.equal(nodes.get('Upload Livia Reel Cover').parameters.additionalFieldsFile.public_id, '={{ $json.coverPublicId }}');
  assert.equal(nodes.get('Upload Livia Reel Cover').parameters.additionalFieldsFile.overwrite, true);
  assert.match(nodes.get('Prepare Livia Reel Cover Jobs').parameters.jsCode, /LIVIA_REEL_COVER_MODE/);
  assert.match(nodes.get('Prepare Livia Reel Cover Jobs').parameters.jsCode, /cover_mode_off/);
  assert.match(nodes.get('BQ - Validate Job Graph').parameters.jsCode, /coverStatus === "ai"/);
  assert.match(nodes.get('Assert Livia Visual Analysis').parameters.jsCode, /binary: \$input\.item\.binary/);
  assert.equal(nodes.has('Inform Success (1)'), true);
  assert.equal(nodes.has('Inform Success (2)'), true);
  assert.ok(workflow.connections['Assert Drive Published'].main[0].some((edge) => edge.node === 'Inform Success (2)'));

  for (const node of workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.executeCommand')) {
    const command = String(node.parameters?.command || '');
    assert.doesNotMatch(command, /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b|\/mnt\/c\//);
  }
});

test('today-first selection patch is idempotent and does not replace the live node wholesale', () => {
  const once = patchTodayFirstSelection(liveFixture());
  const twice = patchTodayFirstSelection(once);
  const node = once.nodes.find((candidate) => candidate.name === 'Prepare Media Items');

  assert.deepEqual(twice, once);
  assert.match(node.parameters.jsCode, /__liviaCompose1/);
  assert.match(node.parameters.jsCode, /livia_selection_today_first_due_v1/);
});
