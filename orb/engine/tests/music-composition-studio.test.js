#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { definitions, validate, check } = require('../music-composition-studio/lib/contracts');
const { hash } = require('../music-composition-studio/lib/canonical');
const { MusicLedger } = require('../music-composition-studio/lib/ledger');
const {
  MockMusicProvider,
  HttpMusicProvider,
  enforceBudget,
  executeProviderJob,
  pollControlled,
  providerCatalog,
} = require('../music-composition-studio/lib/providers');
const { DIMENSIONS, buildCompatibilityMatrix, compositionDna } = require('../music-composition-studio/lib/compatibility');
const { invalidationPlan } = require('../music-composition-studio/lib/invalidation');
const { renderFixture, analyzeArtifact } = require('../music-composition-studio/services/audio-service');
const {
  TIER,
  STATES,
  JOB_STATES,
  baseRequest,
  runProduction,
  buildConstitution,
  selectiveReprocess,
  executeSelectiveReprocess,
} = require('../music-composition-studio/pipeline');
const { organizerInput, workflowOutput } = require('../music-composition-studio/adapters');
const { handleError } = require('../music-composition-studio/error-handler');

function jsonResponse(status, value) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(value),
  };
}

function assertClosedSchema(schema, location) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    assert.notStrictEqual(schema.additionalProperties, undefined, `${location} must declare its additionalProperties policy`);
    for (const [name, child] of Object.entries(schema.properties || {})) assertClosedSchema(child, `${location}.${name}`);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') assertClosedSchema(schema.additionalProperties, `${location}.*`);
  }
  if (schema.type === 'array') assertClosedSchema(schema.items, `${location}[]`);
}

async function testContracts() {
  assert.strictEqual(Object.keys(definitions).length, 23);
  for (const [name, schema] of Object.entries(definitions)) {
    assert.strictEqual(schema.additionalProperties, false, `${name} root must be closed`);
    assertClosedSchema(schema, name);
    check(schema, schema.examples[0]);
    assert.throws(
      () => check(schema, schema['x-invalid-examples'][0]),
      `${name} invalid example must fail`,
    );
  }
  const request = baseRequest();
  validate('musicProductionRequest', request);
  assert.throws(
    () => validate('musicProductionRequest', { ...request, unknown: true }),
    /not allowed/,
  );
  assert.strictEqual(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.strictEqual(
    organizerInput({ music_production_request: request }).production_id,
    request.production_id,
  );
  assert.throws(
    () => validate('musicProductionRequest', {
      ...request,
      brief: { ...request.brief, references: [{ ...request.brief.references[0], leaked: true }] },
    }),
    /not allowed/,
  );
  assert.throws(
    () => validate('musicConstitution', {
      ...definitions.music_constitution.examples[0],
      vocal_profile: { ...definitions.music_constitution.examples[0].vocal_profile, unknown: true },
    }),
    /not allowed/,
  );
  assert.throws(
    () => validate('harmonyCandidate', { ...definitions.harmony_candidate.examples[0], progression: [] }),
    /at least 1/,
  );
}

async function testLedgerAndIdempotency() {
  const request = baseRequest();
  const ledger = new MusicLedger();
  const begun = ledger.begin({ ...request, composition_id: 'CMP-1' });
  assert.strictEqual(ledger.begin({ ...request, composition_id: 'CMP-1' }).reused, true);
  assert.throws(
    () => ledger.begin({ ...request, composition_id: 'CMP-1', production_tier: 'STANDARD' }),
    /IDEMPOTENCY_CONFLICT/,
  );
  const first = ledger.upsertJob({
    composition_id: 'CMP-1',
    module: 'MSC-50',
    component_id: 'bass',
    revision: 1,
    input_hash: 'same',
    status: 'QUEUED',
  });
  ledger.completeJob(first.job_key, { uri: 'storage://bass.wav' });
  const repeat = ledger.upsertJob({
    composition_id: 'CMP-1',
    module: 'MSC-50',
    component_id: 'bass',
    revision: 1,
    input_hash: 'same',
    status: 'QUEUED',
  });
  assert.strictEqual(repeat.reused, true);
  assert.strictEqual(
    ledger.recordCallback({
      provider: 'mock',
      provider_request_id: 'abc',
      payload: { changed_delivery_shape: true },
    }).duplicate,
    false,
  );
  assert.strictEqual(
    ledger.recordCallback({
      provider: 'mock',
      provider_request_id: 'abc',
      payload: {},
    }).duplicate,
    true,
  );
  const artifact = {
    uri: 'storage://artifact.wav',
    checksum: 'checksum',
    kind: 'stem',
  };
  assert.strictEqual(ledger.recordArtifact(artifact).reused, false);
  assert.strictEqual(ledger.recordArtifact(artifact).reused, true);
  ledger.addDependency('mix', 'arrangement');
  assert.deepStrictEqual(ledger.snapshot().dependencies[0], { component_id: 'mix', depends_on: ['arrangement'] });
  await assert.rejects(
    () => ledger.transaction(async (transaction) => {
      transaction.recordCost({ provider: 'mock', amount: 3, currency: 'USD' });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.strictEqual(ledger.totalCost(), 0);
  assert.strictEqual(begun.reused, false);
}

async function testProviders() {
  const mock = new MockMusicProvider();
  const submitted = await mock.submit({
    input_hash: 'x',
    module: 'MSC-10',
    component_id: 'x',
    dry_run: true,
    provider_policy: { mode: 'mock' },
  });
  const polled = await pollControlled({
    provider: mock,
    request_id: submitted.request_id,
    maxAttempts: 1,
    sleep: async () => {},
  });
  assert.strictEqual(polled.status, 'COMPLETED');
  assert.ok(providerCatalog().mastering_provider.mock);
  assert.throws(
    () => enforceBudget({ budget_limits: { max_cost: 0 } }, 1),
    /BUDGET_EXCEEDED/,
  );
  await assert.rejects(
    () => new HttpMusicProvider({}).submit({
      input_hash: 'x',
      dry_run: true,
      provider_policy: { mode: 'mock' },
    }),
    /disabled/,
  );

  const calls = [];
  const live = new HttpMusicProvider({
    name: 'controlled-test-provider',
    model: 'test-model-v1',
    endpoint: 'https://provider.invalid/v1',
    enabled: true,
    maxRetries: 0,
    sleep: async () => {},
    headersProvider: async () => ({ authorization: 'Bearer injected-in-test' }),
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        method: options.method,
        hasAuthorization: Boolean(options.headers.authorization),
      });
      if (url.endsWith('/result')) return jsonResponse(200, { uri: 'storage://result.wav' });
      if (url.endsWith('/cancel')) return jsonResponse(200, { status: 'CANCELLED' });
      if (options.method === 'POST') return jsonResponse(202, { request_id: 'REQ-1', status: 'SUBMITTED' });
      return jsonResponse(200, { request_id: 'REQ-1', status: 'COMPLETED' });
    },
  });
  const liveJob = {
    input_hash: 'live-hash',
    module: 'MSC-50',
    component_id: 'bass',
    dry_run: false,
    provider_policy: { mode: 'live' },
  };
  const liveSubmit = await live.submit(liveJob);
  assert.strictEqual(liveSubmit.model, 'test-model-v1');
  assert.strictEqual((await live.status(liveSubmit.request_id)).status, 'COMPLETED');
  assert.strictEqual((await live.result(liveSubmit.request_id)).uri, 'storage://result.wav');
  assert.strictEqual((await live.cancel(liveSubmit.request_id)).status, 'CANCELLED');
  assert.strictEqual(calls.length, 4);
  assert.ok(calls.every((call) => call.hasAuthorization));

  const asyncMock = new MockMusicProvider({ processingPolls: 2 });
  const asyncSubmit = await asyncMock.submit({
    input_hash: 'async',
    module: 'MSC-30',
    component_id: 'lab',
    dry_run: true,
    provider_policy: { mode: 'mock' },
  });
  assert.strictEqual((await pollControlled({
    provider: asyncMock,
    request_id: asyncSubmit.request_id,
    maxAttempts: 2,
    sleep: async () => {},
  })).status, 'COMPLETED');

  const request = baseRequest({ production_id: 'MSC-PROVIDER-CACHE' });
  const ledger = new MusicLedger();
  ledger.begin({ ...request, composition_id: 'CMP-CACHE' });
  const cachedProvider = new MockMusicProvider();
  const providerJob = { composition_id: 'CMP-CACHE', module: 'MSC-30', component_id: 'lab', revision: 1, input_hash: 'cache-hash', status: 'QUEUED' };
  const first = await executeProviderJob({ ledger, provider: cachedProvider, request, job: providerJob });
  const second = await executeProviderJob({ ledger, provider: cachedProvider, request, job: providerJob });
  assert.strictEqual(first.reused, false);
  assert.strictEqual(second.reused, true);
  assert.strictEqual(cachedProvider.submitCount, 1);
  assert.strictEqual(ledger.snapshot().costs.length, 1);

  const fallbackRequest = baseRequest({
    production_id: 'MSC-PROVIDER-FALLBACK',
    provider_policy: { mode: 'mock', max_cost: 0, max_jobs: 10, allowed_providers: ['failing-mock', 'mock'] },
  });
  const fallbackLedger = new MusicLedger();
  fallbackLedger.begin({ ...fallbackRequest, composition_id: 'CMP-FALLBACK' });
  const failingProvider = {
    name: 'failing-mock',
    model: 'failure-fixture-v1',
    mode: 'mock',
    maxRetries: 0,
    estimateCost: () => 0,
    submit: async () => { throw new Error('PROVIDER_ERROR: injected failure'); },
    status: async () => ({ status: 'FAILED' }),
    result: async () => ({}),
    cancel: async () => ({ status: 'CANCELLED' }),
  };
  const fallback = await executeProviderJob({
    ledger: fallbackLedger,
    provider: failingProvider,
    fallbackProvider: new MockMusicProvider({ name: 'fallback-mock' }),
    request: fallbackRequest,
    job: { composition_id: 'CMP-FALLBACK', module: 'MSC-30', component_id: 'lab', revision: 1, input_hash: 'fallback', status: 'QUEUED' },
  });
  assert.strictEqual(fallback.fallback, true);
  assert.strictEqual(fallback.provider, 'fallback-mock');

  const rateLimited = new MockMusicProvider({ rateLimit: 1 });
  await rateLimited.submit({ input_hash: 'one', module: 'MSC-10', component_id: 'one', dry_run: true, provider_policy: { mode: 'mock' } });
  await assert.rejects(
    () => rateLimited.submit({ input_hash: 'two', module: 'MSC-10', component_id: 'two', dry_run: true, provider_policy: { mode: 'mock' } }),
    /RATE_LIMIT/,
  );

  const timeoutProvider = new MockMusicProvider({ processingPolls: 10 });
  const timeoutSubmit = await timeoutProvider.submit({ input_hash: 'timeout', module: 'MSC-10', component_id: 'timeout', dry_run: true, provider_policy: { mode: 'mock' } });
  await assert.rejects(
    () => pollControlled({ provider: timeoutProvider, request_id: timeoutSubmit.request_id, maxAttempts: 1, sleep: async () => {} }),
    /TIMEOUT/,
  );

  const budgetLedger = new MusicLedger();
  const budgetRequest = baseRequest({ production_id: 'MSC-PROVIDER-BUDGET' });
  budgetLedger.begin({ ...budgetRequest, composition_id: 'CMP-BUDGET' });
  await assert.rejects(
    () => executeProviderJob({
      ledger: budgetLedger,
      provider: new MockMusicProvider({ cost: 1 }),
      request: budgetRequest,
      job: { composition_id: 'CMP-BUDGET', module: 'MSC-30', component_id: 'lab', revision: 1, input_hash: 'budget', status: 'QUEUED' },
    }),
    /BUDGET_EXCEEDED/,
  );
}

async function testAudioService() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msc-audio-'));
  const audio = renderFixture({
    outputDir,
    kind: 'test',
    compositionId: 'CMP-1',
    seconds: 60,
  });
  assert.ok(fs.existsSync(audio.path));
  assert.strictEqual(fs.readFileSync(audio.path).subarray(0, 4).toString(), 'RIFF');
  assert.strictEqual(audio.duration_seconds, 60);
  assert.strictEqual(audio.rendered_duration_seconds, 2);
  assert.strictEqual(audio.binary_in_control_plane, false);
  assert.ok(fs.statSync(audio.path).size < 100_000);
  assert.deepStrictEqual(
    { duration_seconds: analyzeArtifact(audio).duration_seconds, integrity: analyzeArtifact(audio).integrity },
    { duration_seconds: 2, integrity: 'VALID' },
  );
}

async function testPipelines() {
  const request = baseRequest();
  const fast = await runProduction(baseRequest({
    production_id: 'MSC-TEST-FAST',
  }));
  const standard = await runProduction(baseRequest({
    production_id: 'MSC-TEST-STANDARD',
    production_tier: 'STANDARD',
    brief: { ...request.brief, duration_target_seconds: 75 },
  }));
  const premium = await runProduction(baseRequest({
    production_id: 'MSC-TEST-PREMIUM',
    production_tier: 'PREMIUM',
    brief: {
      ...request.brief,
      duration_target_seconds: 120,
      voice_requested: true,
    },
    voice_consent: {
      status: 'GRANTED',
      voice_id: 'synthetic-test-voice',
    },
  }));

  for (const result of [fast, standard, premium]) {
    assert.strictEqual(result.music_package.status, 'READY');
    assert.ok(result.composition_dna.length >= 3);
    assert.strictEqual(result.song_animatics.length, result.composition_dna.length);
    assert.ok(result.song_animatic.uri.startsWith('file://'));
    assert.ok(result.stem_jobs.length);
    assert.strictEqual(result.music_package.costs.total, 0);
    assert.strictEqual(result.music_package.costs.events.length, 1);
    assert.deepStrictEqual(Object.keys(result.compatibility_matrix.entries[0].dimensions).sort(), [...DIMENSIONS].sort());
    assert.ok(result.compatibility_matrix.evaluated_combinations > result.compatibility_matrix.entries.length);
    assert.ok(result.ledger.dependencies.length > 0);
    assert.ok(result.ledger.jobs.some((job) => job.module === 'MSC-50'));
    assert.ok(result.ledger.jobs.some((job) => job.component_id === 'master'));
    assert.ok(result.transitions.includes('READY'));
    assert.ok(
      result.transitions.indexOf('ANIMATICS_READY')
      < result.transitions.indexOf('STEMS_PRODUCING'),
    );
    assert.strictEqual(
      result.music_package.deliverables.stems.some((uri) => uri.includes('base64')),
      false,
    );
    assert.ok(result.source_material_manifest.length);
    assert.ok(result.source_material_manifest.every((item) => item.source_uri.startsWith('storage://')));
  }
  assert.strictEqual(fast.arrangement_candidates.length, TIER.FAST.arrangements);
  assert.strictEqual(standard.arrangement_candidates.length, TIER.STANDARD.arrangements);
  assert.strictEqual(premium.arrangement_candidates.length, TIER.PREMIUM.arrangements);
  assert.strictEqual(premium.mix_candidates.length, TIER.PREMIUM.mixes);
  assert.ok(premium.vocal_manifest.artifacts.length >= 4);
  assert.ok(standard.stem_jobs.length > fast.stem_jobs.length);
  assert.strictEqual(workflowOutput(fast.music_package).publish_requested, false);

  const cacheRequest = baseRequest({ production_id: 'MSC-TEST-PIPELINE-CACHE' });
  const cacheLedger = new MusicLedger();
  const cacheProvider = new MockMusicProvider();
  const cachedFirst = await runProduction(cacheRequest, { ledger: cacheLedger, provider: cacheProvider });
  const artifactCount = cachedFirst.ledger.artifacts.length;
  const cachedSecond = await runProduction(cacheRequest, { ledger: cacheLedger, provider: cacheProvider, outputDir: cachedFirst.output_dir });
  assert.strictEqual(cacheProvider.submitCount, 1);
  assert.strictEqual(cachedSecond.provider_execution.reused, true);
  assert.strictEqual(cachedSecond.music_package.provider_usage['mock-music'], 0);
  assert.strictEqual(cachedSecond.ledger.artifacts.length, artifactCount);

  const blocked = await runProduction(baseRequest({
    production_id: 'MSC-TEST-SIMILAR',
    brief: {
      ...request.brief,
      purpose: 'Copy exactly a recognizable artist melody',
    },
  }));
  assert.strictEqual(blocked.music_package.status, 'FAILED');
  assert.ok(blocked.qa_report.blocking_issues.includes('SIMILARITY_BLOCK'));
  await assert.rejects(
    () => runProduction(baseRequest({
      production_id: 'MSC-TEST-CONSENT',
      brief: { ...request.brief, voice_requested: true },
      voice_consent: { status: 'DENIED', voice_id: 'x' },
    })),
    /AUTHORIZATION_ERROR/,
  );
}

async function testSelectiveReprocessing() {
  const fast = await runProduction(baseRequest({
    production_id: 'MSC-TEST-REPROCESS',
  }));
  assert.deepStrictEqual(invalidationPlan('metadata'), ['package']);
  assert.deepStrictEqual(
    invalidationPlan('bass_timbre'),
    ['bass', 'affected_sections', 'arrangement', 'mix', 'master', 'package'],
  );
  assert.deepStrictEqual(invalidationPlan('loudness'), ['master', 'package']);
  assert.ok(invalidationPlan('chorus').includes('stems_chorus'));
  const revised = selectiveReprocess('constitution', fast.music_constitution);
  assert.strictEqual(revised.next_constitution.revision, 2);
  assert.ok(revised.next_constitution.lock_hash);
  assert.notStrictEqual(revised.next_constitution.lock_hash, fast.music_constitution.lock_hash);
  assert.deepStrictEqual(
    selectiveReprocess('metadata', fast.music_constitution).invalidated,
    ['package'],
  );
  const dna = compositionDna({
    candidates: fast.candidate_set,
    constitution: fast.music_constitution,
    topK: 3,
    beamWidth: 3,
  });
  assert.strictEqual(dna.length, 3);
  const updated = buildConstitution(
    { ...fast.request, composition_id: fast.request.composition_id },
    fast.reference_analyses,
    fast.music_constitution,
  );
  assert.strictEqual(updated.revision, 2);
  assert.notStrictEqual(updated.lock_hash, fast.music_constitution.lock_hash);

  const metadata = executeSelectiveReprocess({ result: fast, change: 'metadata', patch: { cta: 'updated' } });
  assert.strictEqual(metadata.result.music_package.deliverables.master_wav, fast.music_package.deliverables.master_wav);
  assert.deepStrictEqual(metadata.result.music_package.deliverables.stems, fast.music_package.deliverables.stems);
  assert.deepStrictEqual(metadata.regenerated, ['package']);

  const loudness = executeSelectiveReprocess({ result: fast, change: 'loudness', patch: { master_lufs: -16 } });
  assert.notStrictEqual(loudness.result.music_package.deliverables.master_wav, fast.music_package.deliverables.master_wav);
  assert.strictEqual(loudness.result.music_package.deliverables.pre_master, fast.music_package.deliverables.pre_master);
  assert.deepStrictEqual(loudness.regenerated, ['master', 'package']);

  const bass = executeSelectiveReprocess({ result: fast, change: 'bass_timbre', patch: { timbre: 'round' } });
  const preservedStemUris = fast.stem_artifacts.filter((artifact) => artifact.stem_role !== 'BASS').map((artifact) => artifact.uri);
  assert.ok(preservedStemUris.every((uri) => bass.result.music_package.deliverables.stems.includes(uri)));
  assert.ok(bass.invalidated_jobs.length > 0);
  assert.ok(bass.regenerated.includes('bass'));

  const chorus = executeSelectiveReprocess({ result: fast, change: 'chorus', patch: { hook: 'variation-b' } });
  const chorusSections = new Set(fast.song_blueprint.sections.filter((section) => section.type === 'CHORUS').map((section) => section.section_id));
  const nonChorusUris = fast.stem_artifacts.filter((artifact) => !chorusSections.has(artifact.section_id)).map((artifact) => artifact.uri);
  assert.ok(nonChorusUris.every((uri) => chorus.result.music_package.deliverables.stems.includes(uri)));
  assert.ok(chorus.regenerated.includes('stems_chorus'));
}

async function testErrorHandling() {
  const error = handleError(
    {
      workflow: 'MSC-99',
      node: 'test',
      production_id: 'MSC-1',
      payload: { token: 'sensitive' },
    },
    new Error('BUDGET_EXCEEDED token=hidden'),
  );
  assert.strictEqual(error.error_code, 'BUDGET_EXCEEDED');
  assert.ok(error.cancel);
  assert.ok(error.message.includes('[REDACTED]'));
}

async function testMigrationAndWorkflowInventory() {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '20260724_music_composition_studio.sql'),
    'utf8',
  );
  for (const table of [
    'music_productions',
    'music_constitutions',
    'music_jobs',
    'music_artifacts',
    'music_dependencies',
    'music_candidates',
    'music_composition_dna',
    'music_sections',
    'music_stems',
    'music_arrangements',
    'music_mix_versions',
    'music_master_versions',
    'music_qa_reports',
    'music_provider_events',
    'music_cost_events',
    'music_reference_analyses',
  ]) assert.ok(migration.includes(table));
  assert.ok(!/\bdrop\b/i.test(migration));
  assert.ok(/\bbegin\s*;/i.test(migration));
  assert.ok(/\bcommit\s*;/i.test(migration));

  const generatedDir = path.join(
    __dirname,
    '..',
    'generated-workflows',
    'music-composition-studio',
  );
  const operational = fs.readdirSync(generatedDir)
    .filter((file) => file.endsWith('.json') && file !== 'package.json');
  assert.deepStrictEqual(operational, ['music-composition-studio.unified.json']);
  assert.strictEqual(fs.existsSync(path.join(generatedDir, 'archive')), false);
  const unified = JSON.parse(
    fs.readFileSync(path.join(generatedDir, operational[0]), 'utf8'),
  );
  const packageWorkflows = JSON.parse(
    fs.readFileSync(path.join(generatedDir, 'package.json'), 'utf8'),
  );
  assert.strictEqual(unified.active, false);
  assert.strictEqual(packageWorkflows.length, 1);
  assert.strictEqual(
    unified.nodes.some((node) => node.type === 'n8n-nodes-base.executeWorkflow'),
    false,
  );
  assert.ok(
    unified.nodes.some((node) => node.name === 'MSC-90 Evaluation and Package'),
  );
  const archiveDir = path.join(
    __dirname,
    '..',
    'archived-workflows',
    'music-composition-studio',
  );
  const archive = fs.readdirSync(archiveDir)
    .filter((file) => file.endsWith('.json'));
  assert.strictEqual(archive.length, 11);
}

async function main() {
  assert.strictEqual(new Set(STATES).size, 22);
  assert.strictEqual(new Set(JOB_STATES).size, 16);
  await testContracts();
  await testLedgerAndIdempotency();
  await testProviders();
  await testAudioService();
  await testPipelines();
  await testSelectiveReprocessing();
  await testErrorHandling();
  await testMigrationAndWorkflowInventory();
  console.log('Music Composition Studio tests: OK');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
