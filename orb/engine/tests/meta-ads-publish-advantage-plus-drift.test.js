'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  BUILD_DRIVE_NODE,
  CLASSIFY_NODE,
  PREPARE_NODE,
  VERIFY_NODE,
  WAIT_NODE,
  transform,
  validate,
} = require('../scripts/patch-meta-ads-advantage-plus-drift-readback');
const { CODE_SOURCES } = require('../scripts/lib/meta-ads-publish-code-sources');

const workflowRoot = path.join(__dirname, '..');
const sourceRoot = path.join(workflowRoot, 'workflow-src', 'meta-ads-publish');

function source(name) {
  return fs.readFileSync(path.join(sourceRoot, name), 'utf8');
}

function executeSource(name, { input = [], items = {}, execution = { id: 'test-execution' } } = {}) {
  const $input = {
    all: () => input,
    first: () => input[0],
  };
  const $items = (nodeName) => items[nodeName] || [];
  return Function('$input', '$items', '$execution', `'use strict';\n${source(name)}`)($input, $items, execution);
}

function featureSpec({ optIn = [], optOut = [] } = {}) {
  return Object.fromEntries([
    ...optIn.map((feature) => [feature, { enroll_status: 'OPT_IN' }]),
    ...optOut.map((feature) => [feature, { enroll_status: 'OPT_OUT' }]),
  ]);
}

function activationResponse(creativeId = '100000000000001') {
  return {
    ok: true,
    operation: {
      status: 'completed',
      result: {
        status: 'meta_completed_drive_pending',
        jobs: [{
          creative_id: creativeId,
          destination_group: 'Novo Hamburgo',
          creative_group_key: 'NH_TEST',
          action: 'create_new',
          ad_id: '200000000000001',
          created_new: true,
          files: [{ id: 'drive-file-1', name: 'creative.png', ratio: '4x5' }],
        }],
      },
    },
  };
}

function initialReadback({ creativeId = '100000000000001', requested = ['add_text_overlay', 'image_touchups'], optIn = requested, optOut = [], notReported = [] } = {}) {
  return {
    creative_id: creativeId,
    token_id: 'facebook_nh',
    account_id: '123456789',
    api_version: 'v25.0',
    destination_group: 'Novo Hamburgo',
    creative_group_key: 'NH_TEST',
    advantage_plus_verification: {
      status: 'graph_acknowledged_ui_unverified',
      checked_at: '2026-08-12T18:53:30.000Z',
      requested_features: requested,
      reported_opt_in: optIn,
      removed_or_ineligible: optOut,
      not_reported: notReported,
      graph_acknowledgement_is_not_ui_confirmation: true,
    },
  };
}

function prepareReadback(initial = initialReadback()) {
  return executeSource('prepare-advantage-plus-drift-readback.js', {
    input: [{ json: activationResponse(initial.creative_id) }],
    items: {
      'Build Activate Batch': [{ json: { run_id: 'run-001' } }],
      'Attach Advantage+ Verification': [{ json: initial }],
    },
  });
}

function lateReadback(prepared, { optIn = [], optOut = [] } = {}) {
  return executeSource('classify-advantage-plus-graph-drift.js', {
    input: [{
      json: {
        ok: true,
        operation: {
          status: 'completed',
          result: {
            id: prepared[0].json.creative_id,
            degrees_of_freedom_spec: { creative_features_spec: featureSpec({ optIn, optOut }) },
          },
        },
      },
      pairedItem: { item: 0 },
    }],
    items: { 'Prepare Advantage+ Drift Readback': prepared },
  });
}

test('post-activation readback uses a distinct get_creative operation and carries no creative body', () => {
  const prepared = prepareReadback();
  assert.equal(prepared.length, 1);
  const request = prepared[0].json.gateway_request;
  assert.equal(request.action, 'get_creative');
  assert.match(request.operation_key, /^verify-post-activation:run-001:100000000000001$/);
  assert.doesNotMatch(JSON.stringify(prepared[0].json), /creativePayload|access_token/i);
  assert.equal(prepared[0].json.baseline.graph_request_method, 'GET');
});

test('late Graph readback distinguishes stable, lost, omitted, and newly reported features', () => {
  const initial = initialReadback({
    requested: ['add_text_overlay', 'image_touchups', 'text_optimizations'],
    optIn: ['add_text_overlay', 'image_touchups'],
    notReported: ['text_optimizations'],
  });
  const prepared = prepareReadback(initial);
  const result = lateReadback(prepared, {
    optIn: ['text_optimizations'],
    optOut: ['add_text_overlay'],
  })[0].json.advantage_plus_graph_drift;
  assert.equal(result.status, 'graph_state_drift_detected');
  const report = result.creatives[0];
  assert.equal(report.status, 'graph_state_drift_detected');
  assert.deepEqual(report.lost_opt_in, ['add_text_overlay']);
  assert.deepEqual(report.not_reported_after_ack, ['image_touchups']);
  assert.deepEqual(report.new_opt_in, ['text_optimizations']);
  assert.equal(report.graph_request_method, 'GET');
  assert.equal(report.graph_acknowledgement_is_not_ui_confirmation, true);
});

test('identical late Graph state remains explicitly UI-unverified', () => {
  const initial = initialReadback({ requested: ['enhance_cta'], optIn: ['enhance_cta'] });
  const result = lateReadback(prepareReadback(initial), { optIn: ['enhance_cta'] })[0].json.advantage_plus_graph_drift;
  assert.equal(result.status, 'unchanged_graph_state_ui_unverified');
  assert.deepEqual(result.creatives[0].lost_opt_in, []);
  assert.deepEqual(result.creatives[0].not_reported_after_ack, []);
  assert.deepEqual(result.creatives[0].new_opt_in, []);
});

test('unavailable late readback remains non-mutating evidence rather than a publication failure', () => {
  const prepared = prepareReadback();
  const result = executeSource('classify-advantage-plus-graph-drift.js', {
    input: [{ json: { error: { code: 'gateway_timeout' }, status: 504 }, pairedItem: { item: 0 } }],
    items: { 'Prepare Advantage+ Drift Readback': prepared },
  })[0].json.advantage_plus_graph_drift;
  assert.equal(result.status, 'unavailable');
  assert.equal(result.automatic_remediation, 'none');
  assert.equal(result.creatives[0].status, 'unavailable');
  assert.equal(result.creatives[0].error_code, 'gateway_timeout');
});

test('Drive finalization keeps only the compact Graph drift report in the journal summary', () => {
  const drift = lateReadback(prepareReadback(), { optIn: ['add_text_overlay', 'image_touchups'] })[0].json.advantage_plus_graph_drift;
  const finalized = executeSource('build-drive-finalization.js', {
    input: [{ json: { advantage_plus_graph_drift: drift } }],
    items: {
      'Activate Ad Batch': [{ json: activationResponse() }],
      'Build Activate Batch': [{ json: { run_id: 'run-001' } }],
    },
  });
  assert.equal(finalized[0].json.advantage_plus_graph_drift.status, 'unchanged_graph_state_ui_unverified');
  assert.equal(Object.hasOwn(finalized[0].json.advantage_plus_graph_drift.creatives[0], 'baseline'), false);
  const completed = executeSource('verify-drive-finalization.js', {
    input: finalized.map((item, index) => ({
      json: {
        properties: {
          published: 'true',
          meta_ads_run_id: item.json.run_id,
          meta_ads_creative_group_key: item.json.meta_ads_creative_group_key,
        },
      },
      pairedItem: { item: index },
    })),
    items: { 'Prepare Drive Read': finalized },
  });
  assert.equal(completed[0].json.completion_request.summary.advantage_plus_graph_drift.status, 'unchanged_graph_state_ui_unverified');
});

test('workflow patch sequences the delayed readback before Drive finalization and preserves Drive-only resume', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowRoot, 'workflows', 'meta-ads-publish.current.json'), 'utf8'));
  const candidate = transform(workflow);
  assert.equal(candidate.nodes.filter((node) => [WAIT_NODE, PREPARE_NODE, VERIFY_NODE, CLASSIFY_NODE].includes(node.name)).length, 4);
  assert.equal(candidate.connections['Activate Ad Batch'].main[0][0].node, WAIT_NODE);
  assert.equal(candidate.connections[WAIT_NODE].main[0][0].node, PREPARE_NODE);
  assert.equal(candidate.connections[PREPARE_NODE].main[0][0].node, VERIFY_NODE);
  assert.equal(candidate.connections[VERIFY_NODE].main[0][0].node, CLASSIFY_NODE);
  assert.equal(candidate.connections[CLASSIFY_NODE].main[0][0].node, BUILD_DRIVE_NODE);
  assert.equal(candidate.connections['Resume Drive Only?'].main[0][0].node, BUILD_DRIVE_NODE);
  assert.doesNotMatch(JSON.stringify(candidate.connections['Activate Ad Batch']), /Build Drive Finalization/);
  assert.doesNotThrow(() => validate(candidate));
});

test('all mutable Advantage+ drift Code nodes are tracked and the Graph creative reader remains GET-only', () => {
  assert.equal(Object.keys(CODE_SOURCES).length, 51);
  assert.equal(CODE_SOURCES[PREPARE_NODE], 'prepare-advantage-plus-drift-readback.js');
  assert.equal(CODE_SOURCES[CLASSIFY_NODE], 'classify-advantage-plus-graph-drift.js');
  const gateway = fs.readFileSync(path.join(workflowRoot, '..', '..', 'platform', 'security', 'token-vault', 'src', 'meta-ads-publish.js'), 'utf8');
  assert.match(gateway, /async function getCreative\([\s\S]*?\{ method: 'GET' \}/);
});
