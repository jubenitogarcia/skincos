const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EXECUTOR_CODE,
  INTERMEDIATE_FIXTURES,
  REQUIRED_MODULE_NODES,
  transformWorkflow,
  WORKFLOW_ID,
  WORKFLOW_NAME,
} = require('../scripts/build-campaign-creative-creator-continuous');
const { validateWorkflow } = require('../scripts/validate-campaign-creative-creator-continuous');

function node(name, index, extra = {}) {
  return {
    id: 'fixture-' + index,
    name,
    type: extra.type || 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [index * 10, 0],
    parameters: extra.parameters || {},
  };
}

function sourceFixture() {
  const names = [
    ...REQUIRED_MODULE_NODES,
    'Build CCG-00 dry-run fixture',
    ...INTERMEDIATE_FIXTURES,
    'Build CCG-99 retryable fixture',
    'CCG-10 Prepare Evidence Dossier',
    'CCG-40 Prepare Asset Inventory',
  ];
  const nodes = names.map((name, index) => node(name, index));
  nodes.find((candidate) => candidate.name === 'CCG-10 Prepare Evidence Dossier').parameters.jsCode = [
    'function extractPdfText() { return require(\'fs\').readFileSync(\'/tmp/a\'); }',
    'const tierLimits = {};',
    "const crypto = require('crypto');",
    'const requestSourceId = "source";',
  ].join('\n');
  nodes.find((candidate) => candidate.name === 'CCG-40 Prepare Asset Inventory').parameters.jsCode = [
    "try { const crypto = require('crypto'); asset.sha256 = crypto.createHash('sha256').update(buffer).digest('hex'); } catch (error) {}",
  ].join('\n');
  while (nodes.length < 107) nodes.push(node('Fixture filler ' + nodes.length, nodes.length));
  return {
    id: WORKFLOW_ID,
    name: WORKFLOW_NAME,
    nodes,
    connections: {
      'CCG-00 Return Module Result': { main: [[{ node: 'Build CCG-10 dry-run fixture', type: 'main', index: 0 }]] },
      'CCG-80 Return Module Result': { main: [[{ node: 'Build CCG-90 dry-run fixture', type: 'main', index: 0 }]] },
    },
    active: true,
    settings: {},
    meta: {},
    versionId: 'fixture-version',
  };
}

function executorInput({ mode = 'DRY_RUN', supplied = null, approval = null } = {}) {
  const ids = {
    run_id: 'run-test-001',
    production_id: 'production-test-001',
    content_id: 'content-test-001',
    campaign_id: 'campaign-test-001',
    request_hash: 'request-hash-test-001',
    idempotency_key: 'idempotency-test-001',
  };
  const data = {
    production_request: {
      ...ids,
      mode,
      dry_run: mode === 'DRY_RUN',
      provider_policy: { allowed_providers: ['mock-adapter'], max_jobs: 1, max_cost: 0 },
    },
    ccg_context: { ...ids, mode },
    module_outputs: { CCG_80: { status: 'DONE', production_manifest: {
      ...ids,
      budget: { max_jobs: 1, max_cost: 0 },
      jobs: [{
        job_id: 'job-test-001',
        model: 'mock-production-v1',
        expected_artifacts: [{ artifact_key: 'primary', mime_type: 'image/png', dimensions: { width: 1, height: 1 } }],
      }],
    } } },
  };
  if (supplied) data.production_execution_results = supplied;
  if (approval) data.human_approval = approval;
  return { first: () => ({ json: { data } }) };
}

async function runExecutor(input) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const executor = new AsyncFunction('$input', EXECUTOR_CODE);
  const result = await executor(input);
  return result[0].json.data.production_execution_results;
}

test('build removes intermediate fixtures and creates an idempotent continuous graph', () => {
  const first = transformWorkflow(sourceFixture(), { strictSource: false });
  const second = transformWorkflow(first, { strictSource: false });

  assert.equal(first.active, false);
  assert.equal(first.nodes.length, 100);
  assert.equal(first.nodes.filter((candidate) => candidate.name === 'Operational Production Request').length, 1);
  assert.equal(first.nodes.filter((candidate) => candidate.name === 'CCG-80 Production Executor').length, 1);
  for (const fixture of INTERMEDIATE_FIXTURES) {
    assert.equal(first.nodes.some((candidate) => candidate.name === fixture), false, fixture);
  }
  assert.equal(first.connections['CCG-00 Return Module Result'].main[0][0].node, 'CCG-10 Validate CCG-00 Input');
  assert.equal(first.connections['CCG-80 Return Module Result'].main[0][0].node, 'CCG-80 Production Executor');
  assert.equal(first.connections['CCG-80 Production Executor'].main[0][0].node, 'CCG-90 Validate CCG-80 Input');
  assert.equal(first.nodes.find((candidate) => candidate.name === 'CCG-10 Prepare Evidence Dossier').parameters.jsCode.includes('require('), false);
  assert.equal(first.nodes.find((candidate) => candidate.name === 'CCG-40 Prepare Asset Inventory').parameters.jsCode.includes('require('), false);
  assert.deepEqual(second, first);
  assert.doesNotThrow(() => validateWorkflow(first));
});

test('dry-run executor simulates jobs without paid or external effects', async () => {
  const result = await runExecutor(executorInput());
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.dry_run, true);
  assert.equal(result.simulated, true);
  assert.deepEqual(result.external_calls, []);
  assert.deepEqual(result.storage_writes, []);
  assert.equal(result.total_cost, 0);
  assert.equal(result.publish_allowed, false);
  assert.equal(result.publish_requested, false);
  assert.match(result.jobs[0].artifacts[0].uri, /^simulated:\/\//);
  assert.equal(result.jobs[0].artifacts[0].base64, undefined);
});

test('live executor blocks when approval or an adapter is absent', async () => {
  const noApproval = await runExecutor(executorInput({ mode: 'LIVE' }));
  assert.equal(noApproval.status, 'POLICY_BLOCKED');
  assert.equal(noApproval.reason_code, 'HUMAN_APPROVAL_REQUIRED');
  assert.deepEqual(noApproval.external_calls, []);

  const noAdapter = await runExecutor(executorInput({ mode: 'LIVE', approval: { status: 'APPROVED' } }));
  assert.equal(noAdapter.status, 'POLICY_BLOCKED');
  assert.equal(noAdapter.reason_code, 'EXECUTOR_ADAPTER_NOT_CONFIGURED');
  assert.equal(noAdapter.adapter_required, true);
});

test('live executor accepts only lineage-complete, URI-backed external results', async () => {
  const ids = {
    run_id: 'run-test-001',
    production_id: 'production-test-001',
    content_id: 'content-test-001',
    campaign_id: 'campaign-test-001',
    request_hash: 'request-hash-test-001',
    idempotency_key: 'idempotency-test-001',
  };
  const supplied = {
    ...ids,
    jobs: [{
      ...ids,
      job_id: 'job-test-001',
      provider_id: 'mock-adapter',
      cost: { amount: 0, currency: 'BRL', recorded: true },
      artifacts: [{
        artifact_id: 'artifact-test-001',
        uri: 'private://artifact-test-001',
        mime_type: 'image/png',
        dimensions: { width: 1, height: 1 },
        checksum: { algorithm: 'SHA-256', value: 'synthetic-checksum' },
      }],
    }],
  };
  const result = await runExecutor(executorInput({ mode: 'LIVE', approval: { status: 'APPROVED' }, supplied }));
  assert.equal(result.source, 'external_executor');
  assert.equal(result.status, undefined);
  assert.equal(result.dispatched_by_this_workflow, false);
  assert.equal(result.publish_allowed, false);
  assert.equal(result.total_cost, 0);

  const overBudget = {
    ...supplied,
    jobs: [{
      ...supplied.jobs[0],
      cost: { amount: 1, currency: 'BRL', recorded: true },
    }],
  };
  const blocked = await runExecutor(executorInput({ mode: 'LIVE', approval: { status: 'APPROVED' }, supplied: overBudget }));
  assert.equal(blocked.status, 'POLICY_BLOCKED');
  assert.equal(blocked.reason_code, 'EXECUTOR_RESULT_INVALID');
  assert.match(blocked.validation_error, /cost exceeds/);
});
