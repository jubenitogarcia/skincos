'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { transform, validate, PREPARE_NODE, ENSURE_NODE, ATTACH_NODE } = require('../scripts/patch-meta-ads-tracking-reconciliation');
const { assertCodeSourceCoverage } = require('../scripts/lib/meta-ads-publish-code-sources');

const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');
function source(name) { return fs.readFileSync(path.join(sourceRoot, name), 'utf8'); }
function executeSource(name, { input = [], items = {}, execution = { id: 'tracking-test' } } = {}) {
  const $input = { all: () => input, first: () => input[0] };
  const $items = (nodeName) => items[nodeName] || [];
  return Function('$input', '$items', '$execution', `'use strict';\n${source(name)}`)($input, $items, execution);
}

function workflowUrlTagsValidator(name) {
  const text = source(name);
  const match = text.match(/(const URL_TAG_PARAMETER_KEY_PATTERN[\s\S]*?function validUrlTags\(value\) \{[\s\S]*?^\})\n\nfunction trackingFingerprint/m);
  assert.ok(match, `could not extract ${name} url-tags validator`);
  return Function(`${match[1]}\nreturn validUrlTags;`)();
}

const URL_TAG_VECTORS = [
  ['key1=value1&key2=value2', true],
  ['utm_source=meta&utm_medium=paid_social', true],
  ['campaign-name=Spring%20Sale&1st.value=ok@home', true],
  ['segment={{campaign.name}}&path=/book;new', true],
  ['key=value%20already_encoded', true],
  ['key=value%2520literal_percent_encoding', true],
  ['key=value%2', false],
  ['key=value%ZZ', false],
  ['access_token=secret', false],
  ['key=value&key=duplicate', false],
  ['https://example.test/?key=value', false],
  ['key=value#fragment', false],
];

test('Token Vault, Build Jobs and creative validation use the exact arbitrary URL-tags acceptance table', async () => {
  const { __test } = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'platform', 'security', 'token-vault', 'src', 'meta-ads-publish.js')).href);
  const validators = [
    ['token-vault', (value) => {
      try {
        __test.normalizeUrlTags(value, { required: true });
        return true;
      } catch {
        return false;
      }
    }],
  ];
  for (const name of ['build-jobs.js', 'validate-meta-creative-payload.js']) {
    validators.push([name, workflowUrlTagsValidator(name)]);
  }
  for (const [name, validUrlTags] of validators) {
    for (const [value, expected] of URL_TAG_VECTORS) {
      assert.equal(validUrlTags(value), expected, `${name}: ${value}`);
    }
  }
});

function websitePendingJob() {
  return {
    job_key: 'job-website',
    run_id: 'run-tracking-test',
    token_id: 'facebook_tracking',
    account_id: '123456789',
    api_version: 'v25.0',
    destination_adset_id: '323456789',
    destination_contract: { kind: 'website' },
    tracking_contract: {
      destination_kind: 'website',
      profile_ref: 'website_schedule_v1',
      profile_configured: true,
      website_event_requirement: 'required',
      offline_event_dataset_requirement: 'required',
      website_event_status: 'pending_reconciliation',
      offline_event_dataset_status: 'pending_reconciliation',
      reconciliation_status: 'pending',
      url_tags_status: 'expected',
      url_tags_fingerprint: 'fnv1a:6d58875a',
    },
    creativePayload: { url_tags: 'key1=value1&key2=value2%20encoded' },
    creative_id: '923456789',
    action: 'create_new',
    destination_group: 'BarraShoppingSul',
    creative_group_key: 'botox',
    media_variant: 'static_flexible',
    adPayload: { name: 'Tracking | BarraShoppingSul', status: 'ACTIVE', adset_id: '323456789' },
    asset_ids: { '4x5': 'drive-file-1' },
    asset_names: { '4x5': 'image.jpg' },
  };
}

test('prepare sends only the redacted reconciliation request and never a Pixel/dataset payload', () => {
  const job = websitePendingJob();
  const output = executeSource('prepare-tracking-reconciliation.js', { input: [{ json: job }] });
  assert.equal(output.length, 1);
  const request = output[0].json.gateway_request;
  assert.deepEqual(request, {
    action: 'ensure_adset_conversion_contract',
    operation_key: 'tracking-adset:v1:run-tracking-test:123456789:323456789:website_schedule_v1',
    token_id: 'facebook_tracking',
    account_id: '123456789',
    api_version: 'v25.0',
    object_id: '323456789',
    destination_kind: 'website',
    profile_ref: 'website_schedule_v1',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'payload'), false);
  assert.equal(JSON.stringify(request).match(/pixel|dataset|offline_conversion/i), null);
});

test('prepare rejects incompatible tracking profiles aimed at the same ad set', () => {
  const first = websitePendingJob();
  const second = websitePendingJob();
  second.job_key = 'job-website-conflicting-profile';
  second.tracking_contract.profile_ref = 'website_other_schedule_v1';
  assert.throws(
    () => executeSource('prepare-tracking-reconciliation.js', {
      input: [{ json: first }, { json: second }],
    }),
    /contratos de tracking divergentes/,
  );
});

test('prepare replays an already-attested Website reconciliation during resume', () => {
  const job = websitePendingJob();
  job.tracking_contract.reconciliation_status = 'reconciled';
  job.tracking_contract.website_event_status = 'configured';
  job.tracking_contract.offline_event_dataset_status = 'configured';
  const prepared = executeSource('prepare-tracking-reconciliation.js', { input: [{ json: job }] });
  assert.equal(prepared[0].json.gateway_request.action, 'ensure_adset_conversion_contract');
  const attached = executeSource('attach-tracking-reconciliation.js', {
    input: [{
      json: {
        ok: true,
        operation: { status: 'completed', result: {
          status: 'verified', destination_kind: 'website', profile_ref: 'website_schedule_v1',
          website_event: { configured: true, required: true },
          offline_event_dataset: { configured: true, required: true },
          tracking_fingerprint: 'fnv1a:adset', snapshot_id: '123e4567-e89b-42d3-a456-426614174000', graph_mutation: 'none',
        } },
      },
      pairedItem: { item: 0 },
    }],
    items: {
      'Prepare Tracking Reconciliation': prepared,
      'Validate Meta Creative Payload': [{ json: job }],
    },
  });
  assert.equal(attached[0].json.tracking_contract.reconciliation_status, 'verified');
  assert.doesNotThrow(() => executeSource('build-stage-batch.js', { input: attached }));
});

test('attach requires an attested Website event and offline dataset before checkpointing', () => {
  const job = websitePendingJob();
  const prepared = executeSource('prepare-tracking-reconciliation.js', { input: [{ json: job }] });
  const output = executeSource('attach-tracking-reconciliation.js', {
    input: [{
      json: {
        ok: true,
        operation: {
          status: 'completed',
          result: {
            status: 'reconciled',
            destination_kind: 'website',
            profile_ref: 'website_schedule_v1',
            website_event: { configured: true, required: true },
            offline_event_dataset: { configured: true, required: true },
            tracking_fingerprint: 'fnv1a:adset',
            snapshot_id: '123e4567-e89b-42d3-a456-426614174000',
            graph_mutation: 'promoted_object_updated',
          },
        },
      },
      pairedItem: { item: 0 },
    }],
    items: {
      'Prepare Tracking Reconciliation': prepared,
      'Validate Meta Creative Payload': [{ json: job }],
    },
  });
  assert.equal(output.length, 1);
  assert.equal(output[0].json.tracking_contract.reconciliation_status, 'reconciled');
  assert.equal(output[0].json.tracking_contract.website_event_status, 'configured');
  assert.equal(output[0].json.tracking_contract.offline_event_dataset_status, 'configured');
  assert.equal(output[0].json.creativePayload.url_tags, 'key1=value1&key2=value2%20encoded');
  assert.equal(JSON.stringify(output[0].json).includes('723456789'), false);

  assert.throws(() => executeSource('attach-tracking-reconciliation.js', {
    input: [{
      json: {
        ok: true,
        operation: { status: 'completed', result: {
          status: 'verified', destination_kind: 'website', profile_ref: 'website_schedule_v1',
          website_event: { configured: true, required: true },
          offline_event_dataset: { configured: false, required: true },
        } },
      },
      pairedItem: { item: 0 },
    }],
    items: {
      'Prepare Tracking Reconciliation': prepared,
      'Validate Meta Creative Payload': [{ json: job }],
    },
  }), /dataset offline requerido/);
});

test('a Website profile without a conversion requirement remains compatible and is still reconciled', () => {
  const job = websitePendingJob();
  job.tracking_contract.website_event_requirement = 'not_required';
  job.tracking_contract.website_event_status = 'not_required';
  job.tracking_contract.offline_event_dataset_requirement = 'not_required';
  job.tracking_contract.offline_event_dataset_status = 'not_required';
  const prepared = executeSource('prepare-tracking-reconciliation.js', { input: [{ json: job }] });
  const output = executeSource('attach-tracking-reconciliation.js', {
    input: [{
      json: {
        ok: true,
        operation: { status: 'completed', result: {
          status: 'verified', destination_kind: 'website', profile_ref: 'website_schedule_v1',
          website_event: { configured: false, required: false },
          offline_event_dataset: { configured: false, required: false },
          tracking_fingerprint: 'fnv1a:adset', snapshot_id: '', graph_mutation: 'none',
        } },
      },
      pairedItem: { item: 0 },
    }],
    items: {
      'Prepare Tracking Reconciliation': prepared,
      'Validate Meta Creative Payload': [{ json: job }],
    },
  });
  assert.equal(output[0].json.tracking_contract.website_event_status, 'not_required');
  assert.doesNotThrow(() => executeSource('build-stage-batch.js', { input: output }));
});

test('stage rejects a pending Website reconciliation and permits only the attached attestation', () => {
  const pending = websitePendingJob();
  assert.throws(
    () => executeSource('build-stage-batch.js', { input: [{ json: pending }] }),
    /Reconciliação de tracking pendente ou ausente/,
  );
  const verified = websitePendingJob();
  verified.tracking_contract.website_event_status = 'configured';
  verified.tracking_contract.offline_event_dataset_status = 'configured';
  verified.tracking_contract.reconciliation_status = 'verified';
  const staged = executeSource('build-stage-batch.js', { input: [{ json: verified }] });
  assert.equal(staged[0].json.gateway_request.action, 'stage_batch');
});

test('Click-to-WhatsApp remains tracking not-applicable through the reconciliation preparation', () => {
  const job = websitePendingJob();
  job.destination_contract = { kind: 'whatsapp' };
  job.tracking_contract = {
    destination_kind: 'whatsapp',
    website_event_status: 'not_applicable',
    offline_event_dataset_status: 'not_applicable',
    url_tags_status: 'not_applicable',
    reconciliation_status: 'not_applicable',
  };
  job.creativePayload = {};
  const output = executeSource('prepare-tracking-reconciliation.js', { input: [{ json: job }] });
  assert.equal(output[0].json.gateway_request.destination_kind, 'whatsapp');
  assert.equal(Object.prototype.hasOwnProperty.call(output[0].json.gateway_request, 'profile_ref'), false);
});

test('workflow patch is idempotent and keeps the reconciliation before the resumable checkpoint', () => {
  const workflowPath = path.join(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const once = transform(workflow);
  const twice = transform(once);
  assert.doesNotThrow(() => validate(twice));
  assertCodeSourceCoverage(twice);
  for (const nodeName of [PREPARE_NODE, ENSURE_NODE, ATTACH_NODE]) {
    assert.equal(twice.nodes.filter((node) => node.name === nodeName).length, 1);
  }
  const targets = (name) => (twice.connections[name]?.main || []).flat().map((edge) => edge.node);
  assert.deepEqual(targets('Validate Meta Creative Payload'), [PREPARE_NODE]);
  assert.deepEqual(targets(PREPARE_NODE), [ENSURE_NODE]);
  assert.deepEqual(targets(ENSURE_NODE), [ATTACH_NODE]);
  assert.deepEqual(targets(ATTACH_NODE), ['Build Resume Jobs Checkpoint']);
});
