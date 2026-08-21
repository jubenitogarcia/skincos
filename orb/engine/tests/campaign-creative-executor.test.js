'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AdapterRegistry,
  CAPABILITIES,
  executeProductionManifest,
  InMemoryExecutionStore,
  MemoryArtifactStore,
  createDefaultRegistry,
} = require('../campaign-creative-executor');
const { OpenAIImageAdapter } = require('../campaign-creative-executor/adapters/openai-images');
const { createServer } = require('../campaign-creative-executor/server');

const IDS = {
  run_id: 'run-executor-test',
  production_id: 'production-executor-test',
  content_id: 'content-executor-test',
  campaign_id: 'campaign-executor-test',
  request_hash: 'request-executor-test',
  idempotency_key: 'idempotency-executor-test',
};

function job(jobId, capability, extra = {}) {
  return {
    job_id: jobId,
    capability,
    provider: 'mock',
    expected_artifacts: [{ artifact_key: 'primary' }],
    ...extra,
  };
}

test('example environment never contains CCG executor authentication material', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.doesNotMatch(envExample, /^CCG_EXECUTOR_AUTH_TOKEN=/m);
});

function manifest(jobs, extra = {}) {
  const maxJobs = Math.max(1, jobs.length);
  return {
    ...IDS,
    mode: 'DRY_RUN',
    allowed_providers: ['mock'],
    execution_policy: {
      allowed_providers: ['mock'],
      max_jobs: maxJobs,
      max_revisions: 2,
      max_cost: 100,
      currency: 'BRL',
    },
    budget: { max_jobs: maxJobs, max_revisions: 2, max_cost: 100, currency: 'BRL' },
    jobs,
    publish_allowed: false,
    publish_requested: false,
    ...extra,
  };
}

function liveManifest(jobs, extra = {}) {
  return manifest(jobs, {
    mode: 'LIVE',
    allowed_providers: ['deterministic-renderer'],
    execution_policy: {
      allowed_providers: ['deterministic-renderer'],
      max_jobs: Math.max(1, jobs.length),
      max_revisions: 2,
      max_cost: 100,
      currency: 'BRL',
      human_approval: { approved: true },
    },
    budget: { max_jobs: Math.max(1, jobs.length), max_revisions: 2, max_cost: 100, currency: 'BRL' },
    ...extra,
  });
}

class CostingAdapter {
  constructor(cost, output = true) {
    this.configuredCost = cost;
    this.output = output;
  }

  supports() {
    return true;
  }

  async execute({ job: currentJob }) {
    return {
      provider_job_id: `test-provider-job-${currentJob.job_id}`,
      outputs: this.output ? [{ artifact_key: 'primary', bytes: Buffer.from('test-artifact'), metadata: { mime_type: 'application/octet-stream' } }] : [],
      cost: this.configuredCost,
      currency: 'BRL',
      warnings: [],
      provenance: { adapter: 'test' },
    };
  }
}

class DivergentArtifactStore extends MemoryArtifactStore {
  async verify() {
    return { valid: false, reason: 'ARTIFACT_CHECKSUM_MISMATCH', sha256: 'different' };
  }
}

test('executor dry-run reports a synthetic provider without external calls or inline artifacts', async () => {
  const result = await executeProductionManifest({
    manifest: manifest([job('static-001', 'image_generation')]),
    mode: 'DRY_RUN',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.jobs[0].status, 'COMPLETED');
  assert.equal(result.jobs[0].provider, 'fixture-provider');
  assert.match(result.jobs[0].artifact_uri, /^mock:\/\//);
  assert.match(result.jobs[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.external_calls, []);
  assert.deepEqual(result.storage_writes, []);
  assert.equal(result.publish_allowed, false);
  assert.equal(result.publish_requested, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.jobs[0], 'base64'), false);
});

test('executor mock registry covers every declared production capability', async () => {
  const capabilities = CAPABILITIES.map((capability, index) => job(`mock-capability-${index + 1}`, capability));
  const registry = createDefaultRegistry();
  assert.ok(CAPABILITIES.every((capability) => registry.resolve('mock', capability)));
  const result = await executeProductionManifest({
    manifest: manifest(capabilities),
    mode: 'DRY_RUN',
    registry,
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.jobs.length, CAPABILITIES.length);
  assert.ok(result.jobs.every((item) => item.status === 'COMPLETED'));
  assert.ok(result.jobs.every((item) => item.artifact_uri && item.sha256 && item.file_size > 0));
});

test('executor mock completes carousel dependencies and deterministic composition', async () => {
  const artifactStore = new MemoryArtifactStore();
  const result = await executeProductionManifest({
    manifest: manifest([
      job('carousel-visual-a', 'image_generation'),
      job('carousel-visual-b', 'image_generation'),
      job('carousel-composition', 'image_composition', {
        dependencies: ['carousel-visual-a', 'carousel-visual-b'],
        copy: 'Synthetic copy',
        cta: 'Synthetic CTA',
        price: 'R$ 10',
        disclaimer: 'Synthetic disclaimer',
        logo_uri: 'asset://synthetic-logo',
        logo_required: true,
      }),
    ]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
    artifactStore,
  });
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.jobs.map((item) => item.status), ['COMPLETED', 'COMPLETED', 'COMPLETED']);
  assert.equal(result.jobs[2].provenance.overlays_applied_deterministically, true);
  assert.equal(result.checkpoint.completed_job_ids.length, 3);
  const compositionSvg = (await artifactStore.read(result.jobs[2].artifact_uri)).toString('utf8');
  for (const overlay of ['Synthetic copy', 'Synthetic CTA', 'R$ 10', 'Synthetic disclaimer', 'asset://synthetic-logo']) {
    assert.ok(compositionSvg.includes(overlay), `deterministic overlay missing: ${overlay}`);
  }
});

test('executor mock completes temporal video with a traceable deterministic preview', async () => {
  const result = await executeProductionManifest({
    manifest: manifest([job('video-001', 'temporal_video_rendering', { duration_seconds: 6 })]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.jobs[0].status, 'COMPLETED');
  assert.equal(result.jobs[0].duration_seconds, 6);
  assert.ok(result.jobs[0].warnings.includes('MOCK_TEMPORAL_RENDER_IS_DETERMINISTIC_SVG_PREVIEW'));
});

test('executor reuses a completed idempotent job and checkpoint', async () => {
  const executionStore = new InMemoryExecutionStore();
  const artifactStore = new MemoryArtifactStore();
  const input = { manifest: manifest([job('idempotent-001', 'image_generation')]), mode: 'DRY_RUN', registry: createDefaultRegistry(), executionStore, artifactStore };
  const first = await executeProductionManifest(input);
  const second = await executeProductionManifest(input);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'COMPLETED');
  assert.equal(second.reused, true);
  assert.equal(second.jobs[0].provider_job_id, first.jobs[0].provider_job_id);
  assert.equal(second.checkpoint.completed_job_ids[0], 'idempotent-001');
});

test('executor retries a 429 idempotently and records the final attempt', async () => {
  const result = await executeProductionManifest({
    manifest: manifest([job('retry-429', 'image_generation', { max_attempts: 2, failure_sequence: [{ code: 'RATE_LIMIT', statusCode: 429, retryable: true }, null] })]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.jobs[0].attempt, 2);
  assert.equal(result.jobs[0].attempts, 2);
});

test('executor returns FAILED for a permanent provider error', async () => {
  const result = await executeProductionManifest({
    manifest: manifest([job('permanent-failure', 'image_generation', { mock_error: { code: 'INVALID_INPUT', retryable: false } })]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.jobs[0].status, 'FAILED');
  assert.equal(result.jobs[0].error.code, 'INVALID_INPUT');
});

test('executor blocks a live dispatch before a paid call when cost would exceed the limit', async () => {
  const registry = new AdapterRegistry();
  registry.register('test-paid', ['image_generation'], new CostingAdapter(20));
  const result = await executeProductionManifest({
    manifest: liveManifest([job('cost-exceeded', 'image_generation', { provider: 'test-paid', estimated_cost: 20 })], {
      execution_policy: { allowed_providers: ['test-paid'], max_jobs: 1, max_revisions: 2, max_cost: 10, currency: 'BRL', human_approval: { approved: true } },
      allowed_providers: ['test-paid'],
    }),
    mode: 'LIVE',
    liveEnabled: true,
    registry,
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.jobs[0].error.code, 'COST_EXCEEDED');
  assert.deepEqual(result.external_calls, []);
});

test('executor blocks LIVE when max_cost is not configured', async () => {
  const result = await executeProductionManifest({
    manifest: liveManifest([job('cost-unconfigured', 'image_generation', { provider: 'deterministic-renderer', estimated_cost: 0 })], {
      execution_policy: { allowed_providers: ['deterministic-renderer'], max_jobs: 1, max_revisions: 2, currency: 'BRL', human_approval: { approved: true } },
      budget: { max_jobs: 1, max_revisions: 2, currency: 'BRL' },
      allowed_providers: ['deterministic-renderer'],
    }),
    mode: 'LIVE',
    liveEnabled: true,
    registry: createDefaultRegistry(),
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.warnings.includes('MAX_COST_REQUIRED'));
  assert.deepEqual(result.external_calls, []);
});

test('executor marks missing artifacts for review', async () => {
  const registry = new AdapterRegistry();
  registry.register('test-provider', ['image_generation'], new CostingAdapter(0, false));
  const result = await executeProductionManifest({
    manifest: liveManifest([job('artifact-missing', 'image_generation', { provider: 'test-provider', estimated_cost: 0 })], {
      execution_policy: { allowed_providers: ['test-provider'], max_jobs: 1, max_revisions: 2, max_cost: 10, currency: 'BRL', human_approval: { approved: true } },
      allowed_providers: ['test-provider'],
    }),
    mode: 'LIVE',
    liveEnabled: true,
    registry,
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.jobs[0].error.code, 'ARTIFACT_MISSING');
});

test('executor marks a checksum divergence for review', async () => {
  const registry = new AdapterRegistry();
  registry.register('test-provider', ['image_generation'], new CostingAdapter(0));
  const result = await executeProductionManifest({
    manifest: liveManifest([job('checksum-divergent', 'image_generation', { provider: 'test-provider', estimated_cost: 0 })], {
      execution_policy: { allowed_providers: ['test-provider'], max_jobs: 1, max_revisions: 2, max_cost: 10, currency: 'BRL', human_approval: { approved: true } },
      allowed_providers: ['test-provider'],
    }),
    mode: 'LIVE',
    liveEnabled: true,
    registry,
    artifactStore: new DivergentArtifactStore(),
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.jobs[0].error.code, 'ARTIFACT_CHECKSUM_MISMATCH');
});

test('executor blocks a provider outside the allowlist and missing consent', async () => {
  const providerResult = await executeProductionManifest({
    manifest: liveManifest([job('provider-blocked', 'image_generation', { provider: 'unlisted-provider', estimated_cost: 0 })]),
    mode: 'LIVE',
    liveEnabled: true,
    registry: createDefaultRegistry(),
  });
  assert.equal(providerResult.status, 'NEEDS_REVIEW');
  assert.ok(providerResult.warnings.includes('PROVIDER_NOT_ALLOWLISTED'));

  const consentResult = await executeProductionManifest({
    manifest: liveManifest([job('consent-blocked', 'image_generation', { provider: 'deterministic-renderer', identifiable_person: true, estimated_cost: 0 })]),
    mode: 'LIVE',
    liveEnabled: true,
    registry: createDefaultRegistry(),
  });
  assert.equal(consentResult.status, 'NEEDS_REVIEW');
  assert.ok(consentResult.warnings.includes('CONSENT_REQUIRED'));

  const dryConsentResult = await executeProductionManifest({
    manifest: manifest([job('dry-consent-blocked', 'image_generation', { identifiable_person: true })]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  assert.equal(dryConsentResult.status, 'NEEDS_REVIEW');
  assert.equal(dryConsentResult.jobs[0].error.code, 'CONSENT_REQUIRED');
});

test('executor result is directly consumable as CCG-90 production_execution_results and never publishes', async () => {
  const result = await executeProductionManifest({
    manifest: manifest([job('ccg90-contract', 'image_generation')]),
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  const ccg90Input = { production_execution_results: result };
  assert.equal(ccg90Input.production_execution_results.jobs[0].job_id, 'ccg90-contract');
  assert.equal(ccg90Input.production_execution_results.status, 'COMPLETED');
  assert.equal(ccg90Input.production_execution_results.publish_allowed, false);
  assert.equal(ccg90Input.production_execution_results.publish_requested, false);
  assert.equal(result.jobs[0].artifacts[0].file_size > 0, true);
});

test('allowlisted OpenAI static-image adapter route is exercised with a non-network stub', async () => {
  let requestBody = null;
  const adapter = new OpenAIImageAdapter({
    apiKey: 'synthetic-test-key',
    configuredCost: 1,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: { get: () => 'unit-test-provider-job' },
        json: async () => ({ data: [{ b64_json: Buffer.from('synthetic-png').toString('base64') }] }),
      };
    },
  });
  const output = await adapter.execute({
    job: job('openai-static-route', 'image_generation', { visual_prompt: 'clean neutral studio product background', width: 1024, height: 1024 }),
    manifest: { consent: { status: 'VERIFIED', consent_id: 'consent-synthetic' } },
    context: {},
  });
  assert.equal(output.provider_job_id, 'unit-test-provider-job');
  assert.equal(output.outputs[0].metadata.mime_type, 'image/png');
  assert.equal(output.cost, 1);
  assert.match(requestBody.prompt, /clean neutral studio product background/);
  assert.equal(requestBody.prompt.includes('Synthetic CTA'), false);
  assert.equal(requestBody.prompt.includes('R$'), false);
});

test('OpenAI static-image adapter uses the injected fetch for URL artifacts', async () => {
  let downloaded = false;
  const adapter = new OpenAIImageAdapter({
    apiKey: 'synthetic-test-key',
    configuredCost: 1,
    fetchImpl: async (url) => {
      if (url.endsWith('/images/generations')) {
        return {
          ok: true,
          headers: { get: () => 'synthetic-url-provider-job' },
          json: async () => ({ data: [{ url: 'https://provider.invalid/synthetic-image.png' }] }),
        };
      }
      downloaded = true;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('synthetic-url-image') };
    },
  });
  const output = await adapter.execute({
    job: job('openai-url-route', 'image_generation', { visual_prompt: 'clean neutral studio product background' }),
    manifest: { consent: { status: 'VERIFIED', consent_id: 'consent-synthetic' } },
    context: {},
  });
  assert.equal(downloaded, true);
  assert.equal(output.outputs[0].bytes.toString(), 'synthetic-url-image');
});

test('executor HTTP route keeps DRY_RUN in memory and exposes a pollable result', async () => {
  const { server } = createServer({
    registry: createDefaultRegistry(),
    liveEnabled: false,
    authToken: 'test-token',
    liveExecutionStore: new InMemoryExecutionStore(),
    dryRunExecutionStore: new InMemoryExecutionStore(),
    liveArtifactStore: new MemoryArtifactStore(),
    dryRunArtifactStore: new MemoryArtifactStore(),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const unauthenticated = await fetch(`http://127.0.0.1:${address.port}/v1/production-manifests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unauthenticated.status, 401);
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/production-manifests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ manifest: manifest([job('http-static-001', 'image_generation')]), mode: 'DRY_RUN', request_context: { ...IDS, mode: 'DRY_RUN' } }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.production_execution_results.status, 'COMPLETED');
    const poll = await fetch(`http://127.0.0.1:${address.port}/v1/production-manifests/${encodeURIComponent(body.execution_id)}`, {
      headers: { authorization: 'Bearer test-token' },
    });
    assert.equal(poll.status, 200);
    const polled = await poll.json();
    assert.equal(polled.production_execution_results.jobs[0].status, 'COMPLETED');
    assert.deepEqual(polled.production_execution_results.storage_writes, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
