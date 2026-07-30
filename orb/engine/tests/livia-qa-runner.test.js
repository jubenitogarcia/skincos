'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ACCESSIBILITY_BUILD_GRAPH_MARKERS,
  ACCESSIBILITY_VERIFIER_MARKERS,
  driveAuditForExecution,
  notificationForExecution,
  reconcileAuditTargets,
  verifierEnvironment,
  buildGraphReplayEnvironment,
} = require('../scripts/livia/qa-runner');

test('QA accessibility markers follow the current cross-media contract', () => {
  const buildGraph = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'livia', 'build-platform-job-graph.js'), 'utf8');
  const verifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'livia', 'verify-published-artifacts.js'), 'utf8');

  for (const marker of ACCESSIBILITY_BUILD_GRAPH_MARKERS) assert.ok(buildGraph.includes(marker), marker);
  for (const marker of ACCESSIBILITY_VERIFIER_MARKERS) assert.ok(verifier.includes(marker), marker);
  assert.ok(!buildGraph.includes('alt_text_omitted_for_video'));
  assert.ok(!verifier.includes('video_alt_text_not_supported'));
});

test('qa audit passes only the selected Token Vault values to the independent verifier', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-qa-env-'));
  const fixture = path.join(fixtureDir, 'orb-business.env');
  try {
    fs.writeFileSync(fixture, [
      'TOKEN_VAULT_N8N_API_TOKEN=from-file',
      'UNRELATED_SECRET=must-not-be-forwarded',
      'TOKEN_VAULT_BASE_URL=https://token-vault.example.test',
    ].join('\n'));
    assert.deepEqual(verifierEnvironment({
      envFiles: [fixture],
      inherited: { TOKEN_VAULT_N8N_API_TOKEN: 'from-process', OTHER_VALUE: 'ignored' },
    }), {
      TOKEN_VAULT_BASE_URL: 'https://token-vault.example.test',
      TOKEN_VAULT_N8N_API_TOKEN: 'from-process',
    });
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('qa replay pins the active bundle compose source instead of inheriting a mutable override', () => {
  const env = buildGraphReplayEnvironment({
    LIVIA_BUILD_JOB_GRAPH_SOURCE: '/opt/skincos/current/source/orb/engine/compose2-current.js',
    OTHER_VALUE: 'preserved',
  });

  assert.equal(env.LIVIA_BUILD_JOB_GRAPH_SOURCE, path.join(__dirname, '..', 'compose2-current.js'));
  assert.equal(env.OTHER_VALUE, 'preserved');
  assert.ok(!env.LIVIA_BUILD_JOB_GRAPH_SOURCE.includes('/opt/skincos/current'));
});

test('qa audit reads the notification node that actually executed', () => {
  const result = notificationForExecution({
    'Inform Success (2)': [{ data: { main: [[{ json: { ok: true, result: { message_id: 42 } } }]] } }],
    'Inform Success (1)': [{ data: { main: [[{ json: { data: { status: 'pending' } } }]] } }],
  });
  assert.equal(result.nodeName, 'Inform Success (2)');
  assert.equal(result.notification.ok, true);
  assert.equal(result.notification.result.message_id, 42);
});

test('qa audit reconciles persisted media and accessibility contracts by platform and unit', () => {
  const accessibilityContract = {
    schema: 'livia.media-alt-text.v1',
    orderedBy: 'groupOrder',
    items: [{ sourceMediaId: 'media-1', semanticJobKey: 'livia:v2:one', mediaKind: 'video', support: 'unsupported' }],
  };
  const mediaEvidenceContract = {
    schema: 'livia.media-evidence.v1',
    orderedBy: 'groupOrder',
    items: [{ sourceMediaId: 'media-1', semanticJobKey: 'livia:v2:one', providerMediaId: 'remote-1', mediaKind: 'video', groupOrder: 0 }],
  };
  const runData = {
    'Collect Publish Results': [{ data: { main: [[{ json: { publishVerification: { targets: [{
      platform: 'instagram',
      unit: 'bss',
      providerObjectId: 'object-1',
      providerMediaId: 'remote-1',
      expected: { caption: 'persisted caption' },
      submitted: { coverUrl: 'https://media.example.test/cover.jpg' },
      accessibilityContract,
      mediaEvidenceContract,
    }] } } }]] } }],
  };
  const [target] = reconcileAuditTargets(runData, [{
    platform: 'instagram',
    unit: 'bss',
    providerObjectId: 'object-1',
    providerMediaId: 'remote-1',
    expected: { caption: 'derived caption' },
    submitted: {},
  }]);
  assert.deepEqual(target.accessibilityContract, accessibilityContract);
  assert.deepEqual(target.mediaEvidenceContract, mediaEvidenceContract);
  assert.equal(target.expected.caption, 'persisted caption');
  assert.equal(target.submitted.coverUrl, 'https://media.example.test/cover.jpg');
});

test('qa audit fails closed when the persisted target conflicts with the HTTP reconstruction', () => {
  const runData = {
    'Collect Publish Results': [{ data: { main: [[{ json: { publishVerification: { targets: [{
      platform: 'instagram', unit: 'bss', providerObjectId: 'different-object', providerMediaId: 'remote-1',
    }] } } }]] } }],
  };
  assert.throws(() => reconcileAuditTargets(runData, [{
    platform: 'instagram', unit: 'bss', providerObjectId: 'object-1', providerMediaId: 'remote-1',
  }]), /conflicting providerObjectId/);
});

test('qa audit exposes legacy carousel Drive marks that silently omitted child files', () => {
  const runData = {
    'Attach Verified Publish Artifacts': [{ data: { main: [[{ json: { id: 'a', fileIds: ['a', 'b', 'c'] } }]] } }],
    'Update File': [{ data: { main: [[{ json: { id: 'a', properties: { published: 'true' } } }]] } }],
  };
  const audit = driveAuditForExecution(runData);
  assert.equal(audit.contract, 'legacy-single-mark');
  assert.equal(audit.state, 'incomplete');
  assert.deepEqual(audit.missingFileIds, ['b', 'c']);
});

test('qa audit accepts only a correlated full-group Drive readback', () => {
  const prepared = ['a', 'b'].map((id) => ({ json: { id } }));
  const runData = {
    'Prepare Drive Publication Marks': [{ data: { main: [prepared] } }],
    'Update File': [{ data: { main: [[
      { json: { id: 'a', properties: { published: 'true' } } },
      { json: { id: 'b', properties: { published: 'true' } } },
    ]] } }],
    'Assert Drive Published': [{ data: { main: [[{ json: { driveAudit: {
      state: 'verified', published: true, verifiedFileIds: ['a', 'b'],
    } } }]] } }],
  };
  const audit = driveAuditForExecution(runData);
  assert.equal(audit.contract, 'group-fanout-readback');
  assert.equal(audit.state, 'verified');
  assert.equal(audit.verifiedFileCount, 2);
});
