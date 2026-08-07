const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ALL_FIXTURE_NAMES,
  ERROR_HANDLER_NODE_NAMES,
  ERROR_WORKFLOW_ID,
  INTERMEDIATE_FIXTURES,
  MODULES,
  REQUIRED_MODULE_NODES,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  buildWorkflowPackage,
  ensureStructuredParserModels,
  transformWorkflow,
} = require('../scripts/build-campaign-creative-creator-continuous');
const {
  hasEdge,
  validateErrorWorkflow,
  validateFixturesWorkflow,
  validateWorkflow,
} = require('../scripts/validate-campaign-creative-creator-continuous');
const { createDefaultRegistry, executeProductionManifest } = require('../campaign-creative-executor');

function node(name, index, extra = {}) {
  return {
    id: 'fixture-' + index,
    name,
    type: extra.type || 'n8n-nodes-base.code',
    typeVersion: extra.typeVersion || 2,
    position: [index * 10, 0],
    parameters: extra.parameters || {},
  };
}

function moduleReturnCode(moduleName, outputType = 'CCG_MODULE_RESULT') {
  return `const item = $input.first();
const data = item.json || {};
const output = data.module_outputs?.${moduleName.replace('-', '_')};
if (!output || output.status !== 'DONE') throw new Error('module output missing');
return [{ json: { ...data, output_type: '${outputType}', module_result: { module: '${moduleName}', status: 'DONE' } }, binary: item.binary } }];`;
}

function sourceFixture() {
  const names = Array.from(new Set([
    ...REQUIRED_MODULE_NODES,
    ...ALL_FIXTURE_NAMES,
    ...ERROR_HANDLER_NODE_NAMES,
    'Manual safe dry-run smoke',
    'CCG-00 Validate Contract',
    'CCG-60 Switch Audio Direction Mode',
    'CCG-70 Switch Timeline Mode',
    'CCG-10 Prepare Evidence Dossier',
    'CCG-40 Prepare Asset Inventory',
    'CCG-50 Prepare Scene Planning Brief',
    'CCG-60 Prepare Audio Planning Brief',
    'CCG-70 Prepare Timeline Planning Brief',
    'CCG-90 Return Content Package',
  ]));
  const nodes = names.map((name, index) => node(name, index, {
    type: name === 'Error Trigger' ? 'n8n-nodes-base.errorTrigger'
      : name.includes('Switch') ? 'n8n-nodes-base.switch' : undefined,
    typeVersion: name === 'Error Trigger' ? 1 : name.includes('Switch') ? 3.4 : 2,
  }));

  const byName = (name) => nodes.find((candidate) => candidate.name === name);
  byName('CCG-10 Prepare Evidence Dossier').parameters.jsCode = [
    'function extractPdfText() { return require(\'fs\').readFileSync(\'/tmp/a\'); }',
    'const tierLimits = {};',
    "const crypto = require('crypto');",
    'const requestSourceId = "source";',
  ].join('\n');
  byName('CCG-40 Prepare Asset Inventory').parameters.jsCode = [
    "try { const crypto = require('crypto'); asset.sha256 = crypto.createHash('sha256').update(buffer).digest('hex'); } catch (error) {}",
  ].join('\n');
  byName('CCG-50 Prepare Scene Planning Brief').parameters.jsCode = [
    "const contentMode = text(job.content_mode);",
    "const sceneType = contentMode === 'SHORT_VIDEO' ? 'VIDEO_SCENE' : contentMode === 'CAROUSEL' ? 'CAROUSEL_PAGE' : 'STATIC_FRAME';",
    "duration_seconds: contentMode === 'SHORT_VIDEO' ? Math.max(1, Number(job.duration_seconds || frame.duration_seconds || 3)) : 0",
  ].join('\n');
  byName('CCG-50 Validate CCG-40 Input').parameters.jsCode = "const validModes = new Set(['STATIC_SINGLE','CAROUSEL','SHORT_VIDEO']);";
  byName('CCG-60 Prepare Audio Planning Brief').parameters.jsCode = [
    "const applicable = mode === 'SHORT_VIDEO';",
    'const productions = list(sceneManifest.productions).map((production) => ({ content_mode: production.content_mode, audio_applicable: applicable }));',
    'const brief = {};',
    'return [{ json: { ...data, audio_planning_brief: brief }, binary: item.binary }];',
  ].join('\n');
  byName('CCG-70 Prepare Timeline Planning Brief').parameters.jsCode = [
    "if (text(production.content_mode) !== 'SHORT_VIDEO') { return []; }",
    "const timelineType = mode === 'SHORT_VIDEO'\n    ? 'TEMPORAL_VIDEO'\n    : mode === 'CAROUSEL'\n      ? 'FRAME_SEQUENCE'\n      : 'STILL_FRAME';",
    "duration_frames: mode === 'SHORT_VIDEO'\n      ? quantize(Number(production.total_duration_seconds || 0))\n      : scenes.length,",
    "duration_seconds: mode === 'SHORT_VIDEO'\n      ? Number((quantize(Number(production.total_duration_seconds || 0)) / fps).toFixed(6))\n      : 0,",
    'const brief = {};',
    'return [{ json: { ...data, timeline_planning_brief: brief }, binary: item.binary }];',
  ].join('\n');

  for (const moduleName of MODULES.slice(0, 9)) {
    const returnName = `${moduleName} Return Module Result`;
    const candidate = byName(returnName);
    if (candidate) candidate.parameters.jsCode = moduleReturnCode(moduleName);
  }
  byName('CCG-90 Return Content Package').parameters.jsCode = [
    'const item = $input.first();',
    'const data = item.json || {};',
    'const output = data.module_outputs?.CCG_90;',
    'const packageValue = output?.content_package || data.content_package;',
    "if (!output || output.status !== 'DONE' || !packageValue) throw new Error('package missing');",
    "return [{ json: { ...data, output_type: 'CONTENT_PACKAGE_RESULT', module_result: { module: 'CCG-90', status: 'DONE', output_type: 'CONTENT_PACKAGE' } }, binary: item.binary }];",
  ].join('\n');

  const connections = {
    'Manual safe dry-run smoke': { main: [[{ node: 'Build CCG-00 dry-run fixture', type: 'main', index: 0 }]] },
    'Build CCG-00 dry-run fixture': { main: [[{ node: 'CCG-00 Parse & Normalize', type: 'main', index: 0 }]] },
    'CCG-00 Return Module Result': { main: [[{ node: 'Build CCG-10 dry-run fixture', type: 'main', index: 0 }]] },
    'CCG-60 Prepare Audio Planning Brief': { main: [[{ node: 'CCG-60 Switch Audio Direction Mode', type: 'main', index: 0 }]] },
    'CCG-70 Prepare Timeline Planning Brief': { main: [[{ node: 'CCG-70 Switch Timeline Mode', type: 'main', index: 0 }]] },
    'Error Trigger': { main: [[{ node: 'CCG-99 Normalize & Redact Error Event', type: 'main', index: 0 }]] },
    'CCG-99 Normalize & Redact Error Event': { main: [[{ node: 'CCG-99 Classify & Decide Recovery', type: 'main', index: 0 }]] },
    'CCG-99 Classify & Decide Recovery': { main: [[{ node: 'CCG-99 Switch Recovery Action', type: 'main', index: 0 }]] },
    'CCG-99 Switch Recovery Action': { main: [
      [{ node: 'CCG-99 Build Retry Handoff', type: 'main', index: 0 }],
      [{ node: 'CCG-99 Build Resume Handoff', type: 'main', index: 0 }],
      [{ node: 'CCG-99 Build Review Handoff', type: 'main', index: 0 }],
      [{ node: 'CCG-99 Build Termination Handoff', type: 'main', index: 0 }],
    ] },
    'CCG-99 Build Retry Handoff': { main: [[{ node: 'CCG-99 Finalize Incident & Ledger', type: 'main', index: 0 }]] },
    'CCG-99 Build Resume Handoff': { main: [[{ node: 'CCG-99 Finalize Incident & Ledger', type: 'main', index: 0 }]] },
    'CCG-99 Build Review Handoff': { main: [[{ node: 'CCG-99 Finalize Incident & Ledger', type: 'main', index: 0 }]] },
    'CCG-99 Build Termination Handoff': { main: [[{ node: 'CCG-99 Finalize Incident & Ledger', type: 'main', index: 0 }]] },
    'CCG-99 Finalize Incident & Ledger': { main: [[{ node: 'CCG-99 Return Error Handler Result', type: 'main', index: 0 }]] },
  };

  while (nodes.length < 107) nodes.push(node('Fixture filler ' + nodes.length, nodes.length));
  return {
    id: WORKFLOW_ID,
    name: WORKFLOW_NAME,
    nodes,
    connections,
    active: true,
    settings: {},
    meta: {},
    versionId: 'fixture-version',
  };
}

function contractE2E(contentType) {
  const ids = {
    run_id: `run-${contentType.toLowerCase()}`,
    production_id: `production-${contentType.toLowerCase()}`,
    content_id: `content-${contentType.toLowerCase()}`,
    campaign_id: 'campaign-test-001',
    request_hash: `request-${contentType.toLowerCase()}`,
    idempotency_key: `idempotency-${contentType.toLowerCase()}`,
  };
  const state = {
    ...ids,
    production_request: { ...ids, content_type: contentType, dry_run: true, publish_allowed: false, publish_requested: false },
    ccg_context: { ...ids, mode: 'DRY_RUN' },
    module_outputs: {},
    module_trace: [],
    ledger_events: [],
    posting_payload: { publish_allowed: false, publish_requested: false },
    binary_refs: [{ asset_id: 'asset-synthetic-001', uri: 'private://asset-synthetic-001', mime_type: 'image/png', checksum: 'synthetic' }],
    external_calls: [],
    storage_writes: [],
  };
  const path = [];
  for (const moduleName of MODULES) {
    path.push(moduleName);
    const moduleKey = moduleName.replace('-', '_');
    const skipped = (moduleName === 'CCG-60' || moduleName === 'CCG-70') && contentType === 'STATIC_SINGLE';
    state.module_outputs[moduleKey] = {
      status: skipped ? 'SKIPPED_NOT_REQUIRED' : 'DONE',
      run_id: ids.run_id,
      idempotency_key: ids.idempotency_key,
      content_type: contentType,
    };
    state.module_trace.push({ module: moduleName, status: state.module_outputs[moduleKey].status, run_id: ids.run_id, idempotency_key: ids.idempotency_key });
    state.ledger_events.push({ event_name: skipped ? 'ccg.module.skipped' : 'ccg.module.completed', module: moduleName, run_id: ids.run_id, idempotency_key: ids.idempotency_key });
    state.posting_payload = { ...state.posting_payload, publish_allowed: false, publish_requested: false };
  }
  state.content_package = { package_id: `${ids.run_id}:content-package`, output_type: 'CONTENT_PACKAGE', publication_gate: { publish_allowed: false, publish_requested: false } };
  state.output_type = 'CONTENT_PACKAGE';
  return { state, path };
}

function assertClosedWorldContract({ consentVerified = false, unsupportedOffer = false, unsupportedClaim = false } = {}) {
  if (!consentVerified) throw new Error('consentimento verificado ausente');
  return {
    status: unsupportedOffer || unsupportedClaim ? 'NEEDS_REVIEW' : 'APPROVED_FROM_EVIDENCE',
    routing_decision: unsupportedOffer || unsupportedClaim ? 'HOLD_FOR_REVIEW' : 'PROCEED',
    allowlists: { price_ids: unsupportedOffer ? [] : ['price-evidence-001'], claim_ids: unsupportedClaim ? [] : ['claim-evidence-001'] },
    review: { hard_blockers: [], reasons: unsupportedOffer || unsupportedClaim ? ['UNSUPPORTED_CLOSED_WORLD_INPUT'] : [] },
  };
}

function generatedMain() {
  const file = path.join(__dirname, '../generated-workflows/campaign-creative-creator/campaign-creative-creator.v3.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function generatedError() {
  const file = path.join(__dirname, '../generated-workflows/campaign-creative-creator/campaign-creative-creator-error-handler.v3.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function runCodeNode(nodeValue, data, context = {}) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const code = nodeValue.parameters.jsCode;
  const result = await new AsyncFunction('$input', '$env', '$', code)(
    { first: () => ({ json: data, binary: {} }) },
    context.env || {},
    context.nodeLookup || {},
  );
  return result[0];
}

test('build package is valid, idempotent, and keeps the operational route fixture-free', () => {
  const source = sourceFixture();
  const first = transformWorkflow(source, { strictSource: false });
  const second = transformWorkflow(first, { strictSource: false });
  const packageValue = buildWorkflowPackage(source, { strictSource: false });

  assert.equal(first.active, false);
  assert.equal(first.nodes.filter((candidate) => candidate.name === 'Operational Production Request').length, 1);
  assert.equal(first.nodes.find((candidate) => candidate.name === 'Operational Production Request').parameters.inputSource, 'passthrough');
  assert.equal(first.nodes.some((candidate) => candidate.name === 'CCG-80 Production Executor'), false);
  for (const fixture of INTERMEDIATE_FIXTURES) assert.equal(first.nodes.some((candidate) => candidate.name === fixture), false, fixture);
  assert.equal(first.nodes.some((candidate) => candidate.name === 'Build CCG-99 retryable fixture'), false);
  assert.equal(first.connections['CCG-00 Return Module Result'].main[0][0].node, 'CCG-10 Validate CCG-00 Input');
  assert.equal(first.connections['CCG-80 Return Module Result'].main[0][0].node, 'CCG-80 Validate Execution Policy');
  assert.deepEqual(second, first);
  assert.doesNotThrow(() => validateWorkflow(first));
  assert.doesNotThrow(() => validateWorkflow(packageValue.main));
  assert.doesNotThrow(() => validateErrorWorkflow(packageValue.errorHandler));
  assert.doesNotThrow(() => validateFixturesWorkflow(packageValue.fixtures));
  assert.equal(packageValue.main.settings.errorWorkflow, ERROR_WORKFLOW_ID);
  assert.equal(packageValue.main.nodes.some((candidate) => candidate.credentials), false);
  assert.equal(packageValue.main.meta.credentials_stripped_for_git, true);
});

test('every generated Code node compiles before n8n import', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const workflow of [generatedMain(), generatedError()]) {
    for (const node of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(
        () => new AsyncFunction('$input', '$env', '$', '$execution', node.parameters.jsCode),
        node.name,
      );
    }
  }
});

test('generated executor nodes do not read blocked n8n environment access', () => {
  for (const nodeValue of generatedMain().nodes) {
    assert.doesNotMatch(JSON.stringify(nodeValue.parameters || {}), /\$env\b/, nodeValue.name);
  }
});

test('manual smoke and operational subworkflow triggers are separate', () => {
  const workflow = buildWorkflowPackage(sourceFixture(), { strictSource: false }).main;
  assert.equal(workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.executeWorkflowTrigger').length, 1);
  assert.equal(hasEdge(workflow, 'Operational Production Request', 'CCG-00 Parse & Normalize'), true);
  assert.equal(hasEdge(workflow, 'CCG-00 Parse & Normalize', 'CCG-00 Capture Recovery Context'), true);
  assert.equal(hasEdge(workflow, 'CCG-00 Capture Recovery Context', 'CCG-00 Validate Contract'), true);
  assert.equal(hasEdge(workflow, 'Manual safe dry-run smoke', 'Build CCG-00 dry-run fixture'), true);
  assert.equal(hasEdge(workflow, 'Build CCG-00 dry-run fixture', 'CCG-00 Parse & Normalize'), true);
  for (const fixture of ALL_FIXTURE_NAMES.slice(1)) {
    assert.equal(workflow.nodes.some((candidate) => candidate.name === fixture), false, fixture);
  }
});

test('CCG-00 emits a sanitized recovery lineage before strict contract validation', async () => {
  const workflow = generatedMain();
  const capture = workflow.nodes.find((nodeValue) => nodeValue.name === 'CCG-00 Capture Recovery Context');
  const captured = await runCodeNode(capture, {
    production_request: {
      run_id: 'run-recovery-context',
      production_id: 'production-recovery-context',
      content_id: 'content-recovery-context',
      campaign_id: 'campaign-recovery-context',
      request_hash: 'request-recovery-context',
      idempotency_key: 'idempotency-recovery-context',
      production_tier: 'FAST',
      dry_run: true,
      unapproved_metadata: 'must-not-be-captured',
    },
  });
  assert.deepEqual(captured.json.ccg_recovery_context, {
    schema_version: '1.0.0',
    run_id: 'run-recovery-context',
    production_id: 'production-recovery-context',
    content_id: 'content-recovery-context',
    campaign_id: 'campaign-recovery-context',
    request_hash: 'request-recovery-context',
    idempotency_key: 'idempotency-recovery-context',
    production_tier: 'FAST',
    mode: 'DRY_RUN',
    module: 'CCG-00',
    checkpoint_module: 'CCG-00',
    current_attempt: 1,
    max_attempts: 2,
    recovery_policy: {
      dispatch_enabled: false,
      allow_execution_retry: true,
      allow_checkpoint_resume: true,
      maximum_backoff_seconds: 900,
    },
  });
  assert.equal(JSON.stringify(captured.json.ccg_recovery_context).includes('must-not-be-captured'), false);
});

test('structured parsers receive the same model used by their agents', () => {
  const workflow = {
    nodes: [
      node('Agent', 0, { type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2.2 }),
      node('Parser', 1, {
        type: '@n8n/n8n-nodes-langchain.outputParserStructured',
        typeVersion: 1.3,
        parameters: { autoFix: true },
      }),
      node('Model', 2, { type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2 }),
    ],
    connections: {
      Parser: { ai_outputParser: [[{ node: 'Agent', type: 'ai_outputParser', index: 0 }]] },
      Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
    },
  };

  ensureStructuredParserModels(workflow);
  ensureStructuredParserModels(workflow);
  assert.deepEqual(workflow.connections.Model.ai_languageModel, [[
    { node: 'Agent', type: 'ai_languageModel', index: 0 },
    { node: 'Parser', type: 'ai_languageModel', index: 0 },
  ]]);
});

test('each content type carries one lineage object through CCG-90', () => {
  for (const contentType of ['STATIC_SINGLE', 'CAROUSEL', 'SHORT_VIDEO', 'HYBRID']) {
    const result = contractE2E(contentType);
    assert.deepEqual(result.path, MODULES);
    assert.equal(result.state.output_type, 'CONTENT_PACKAGE');
    assert.equal(result.state.content_package.output_type, 'CONTENT_PACKAGE');
    assert.equal(result.state.production_request.publish_allowed, false);
    assert.equal(result.state.posting_payload.publish_allowed, false);
    assert.equal(result.state.posting_payload.publish_requested, false);
    assert.equal(new Set(result.state.module_trace.map((entry) => entry.run_id)).size, 1);
    assert.equal(new Set(result.state.module_trace.map((entry) => entry.idempotency_key)).size, 1);
    assert.equal(new Set(result.state.ledger_events.map((entry) => entry.run_id)).size, 1);
    assert.deepEqual(result.state.external_calls, []);
    assert.deepEqual(result.state.storage_writes, []);
    if (contentType === 'STATIC_SINGLE') {
      assert.equal(result.state.module_outputs.CCG_60.status, 'SKIPPED_NOT_REQUIRED');
      assert.equal(result.state.module_outputs.CCG_70.status, 'SKIPPED_NOT_REQUIRED');
    }
  }
});

test('CCG-10 and CCG-80 outputs feed the next validators directly', () => {
  const workflow = buildWorkflowPackage(sourceFixture(), { strictSource: false }).main;
  assert.equal(hasEdge(workflow, 'CCG-10 Return Module Result', 'CCG-20 Validate CCG-10 Input'), true);
  assert.equal(hasEdge(workflow, 'CCG-80 Return Module Result', 'CCG-80 Validate Execution Policy'), true);
  assert.equal(hasEdge(workflow, 'CCG-80 Dispatch Production Manifest', 'CCG-80 Poll Production Manifest'), true);
  assert.equal(hasEdge(workflow, 'CCG-80 Normalize Execution Results', 'CCG-90 Validate CCG-80 Input'), true);
  assert.equal(workflow.nodes.find((nodeValue) => nodeValue.name === 'CCG-90 Return Content Package').parameters.jsCode.includes("output_type: 'CONTENT_PACKAGE'"), true);
});

test('negative consent and unsupported factual inputs fail closed', () => {
  assert.throws(() => assertClosedWorldContract(), /consentimento verificado/);
  const unsupportedOffer = assertClosedWorldContract({ consentVerified: true, unsupportedOffer: true });
  assert.equal(unsupportedOffer.status, 'NEEDS_REVIEW');
  assert.deepEqual(unsupportedOffer.allowlists.price_ids, []);
  const unsupportedClaim = assertClosedWorldContract({ consentVerified: true, unsupportedClaim: true });
  assert.equal(unsupportedClaim.status, 'NEEDS_REVIEW');
  assert.deepEqual(unsupportedClaim.allowlists.claim_ids, []);
});

test('generated CCG-90 dry-run remains simulated and the final return is a CONTENT_PACKAGE', async () => {
  const workflow = generatedMain();
  const nodeByName = new Map(workflow.nodes.map((nodeValue) => [nodeValue.name, nodeValue]));
  const ids = {
    run_id: 'run-generated-dry-run',
    production_id: 'production-generated-dry-run',
    content_id: 'content-generated-dry-run',
    campaign_id: 'campaign-generated-dry-run',
    request_hash: 'request-generated-dry-run',
    idempotency_key: 'idempotency-generated-dry-run',
  };
  const data = {
    production_request: { ...ids, content_type: 'STATIC_SINGLE', brand_context: { brand_name: 'Synthetic' } },
    ccg_context: { ...ids, mode: 'DRY_RUN' },
    module_outputs: {
      CCG_80: {
        status: 'DONE',
        production_manifest: {
          ...ids,
          budget: { currency: 'BRL', max_jobs: 10, max_revisions: 0, max_cost: 0 },
          allowed_providers: ['mock'],
          execution_policy: { allowed_providers: ['mock'], max_jobs: 10, max_revisions: 0, max_cost: 0, currency: 'BRL' },
          jobs: [{ job_id: 'job-generated-001', category: 'FINAL_RENDER', selected_model_id: 'mock-render-v1' }],
          artifact_expectations: [{
            artifact_key: 'artifact-generated-001',
            source_job_id: 'job-generated-001',
            production_id: ids.production_id,
            category: 'FINAL_RENDER',
            expected_output_spec: { container: 'png' },
            checksum_required: true,
            metadata_required: true,
          }],
          completion_contract: { required_terminal_job_statuses: ['COMPLETED'] },
          review: { required: true, reasons: [] },
        },
      },
    },
    module_trace: [],
    ledger_events: [],
    posting_payload: { publish_allowed: false, publish_requested: false },
  };
  data.production_manifest = data.module_outputs.CCG_80.production_manifest;
  data.production_execution_results = await executeProductionManifest({
    manifest: data.production_manifest,
    mode: 'DRY_RUN',
    registry: createDefaultRegistry(),
  });
  const prepared = await runCodeNode(nodeByName.get('CCG-90 Prepare Evidence & Package Brief'), data);
  const execution = prepared.json.production_execution_results;
  assert.equal(execution.mode, 'DRY_RUN');
  assert.equal(execution.jobs[0].provider_id, 'mock');
  assert.equal(execution.jobs[0].cost.amount, 0);
  assert.match(execution.jobs[0].artifact_uri, /^mock:\/\//);
  assert.match(prepared.json.content_package_brief.execution.jobs[0].artifacts[0].uri, /^mock:\/\//);
  assert.deepEqual(execution.external_calls || [], []);
  assert.deepEqual(execution.storage_writes || [], []);

  const reviewed = await runCodeNode(nodeByName.get('CCG-90 Deterministic Dry-Run Review'), prepared.json);
  const sealed = await runCodeNode(nodeByName.get('CCG-90 Finalize & Seal Content Package'), reviewed.json);
  assert.equal(sealed.json.content_package.package_status, 'DRY_RUN_COMPLETE');
  assert.equal(sealed.json.content_package.publication_gate.publish_allowed, false);

  const final = await runCodeNode(nodeByName.get('CCG-90 Return Content Package'), {
    ...data,
    module_outputs: {
      ...data.module_outputs,
      CCG_90: { status: 'DONE', content_package: { package_id: 'package-generated-001', package_status: 'DRY_RUN_COMPLETE' } },
    },
    content_package: { package_id: 'package-generated-001', package_status: 'DRY_RUN_COMPLETE' },
  });
  assert.equal(final.json.output_type, 'CONTENT_PACKAGE');
});

test('CCG-80 policy and normalizer dispatch the executor contract into CCG-90', async () => {
  const workflow = generatedMain();
  const nodeByName = new Map(workflow.nodes.map((nodeValue) => [nodeValue.name, nodeValue]));
  const ids = {
    run_id: 'run-policy-normalizer',
    production_id: 'production-policy-normalizer',
    content_id: 'content-policy-normalizer',
    campaign_id: 'campaign-policy-normalizer',
    request_hash: 'request-policy-normalizer',
    idempotency_key: 'idempotency-policy-normalizer',
  };
  const data = {
    production_request: { ...ids, mode: 'DRY_RUN', publish_allowed: false, publish_requested: false },
    ccg_context: { ...ids, mode: 'DRY_RUN' },
    module_outputs: {
      CCG_80: {
        status: 'DONE',
        production_manifest: {
          ...ids,
          status: 'READY',
          routing_decision: 'PROCEED',
          mode: 'DRY_RUN',
          allowed_providers: ['mock'],
          execution_policy: { allowed_providers: ['mock'], max_jobs: 1, max_revisions: 0, max_cost: 0, currency: 'BRL' },
          budget: { max_jobs: 1, max_revisions: 0, max_cost: 0, currency: 'BRL' },
          jobs: [{ job_id: 'policy-job-001', category: 'VISUAL_GENERATION', capability: 'image_generation', expected_artifacts: [{ artifact_key: 'primary' }] }],
          artifact_expectations: [{ artifact_key: 'primary', source_job_id: 'policy-job-001', category: 'VISUAL_GENERATION', checksum_required: true, metadata_required: true }],
          completion_contract: { blocking_failure_statuses: ['FAILED', 'NEEDS_REVIEW'] },
          review: { hard_blockers: [] },
          publish_allowed: false,
          publish_requested: false,
        },
      },
    },
    posting_payload: { publish_allowed: false, publish_requested: false },
  };
  data.production_manifest = data.module_outputs.CCG_80.production_manifest;
  const policy = await runCodeNode(nodeByName.get('CCG-80 Validate Execution Policy'), data, { env: {} });
  assert.equal(policy.json.executor_dispatch_allowed, true);
  assert.equal(policy.json.executor_request.mode, 'DRY_RUN');
  const execution = await executeProductionManifest({
    manifest: policy.json.executor_request.manifest,
    mode: policy.json.executor_request.mode,
    requestContext: policy.json.executor_request.request_context,
    registry: createDefaultRegistry(),
  });
  const normalized = await runCodeNode(
    nodeByName.get('CCG-80 Normalize Execution Results'),
    { ...policy.json, production_execution_results: execution },
    { nodeLookup: () => ({ first: () => ({ json: policy.json }) }), env: {} },
  );
  assert.equal(normalized.json.next_module, 'CCG-90');
  assert.equal(normalized.json.production_execution_results.jobs[0].status, 'COMPLETED');
  assert.match(normalized.json.production_execution_results.jobs[0].artifact_uri, /^mock:\/\//);
  assert.equal(normalized.json.production_execution_results.publish_allowed, false);
});

test('CCG-99 classifies executor 429 and resumes from its checkpoint idempotently', async () => {
  const errorNodes = new Map(generatedError().nodes.map((nodeValue) => [nodeValue.name, nodeValue]));
  const ids = {
    run_id: 'run-ccg99-executor',
    production_id: 'production-ccg99-executor',
    content_id: 'content-ccg99-executor',
    campaign_id: 'campaign-ccg99-executor',
    request_hash: 'request-ccg99-executor',
    idempotency_key: 'idempotency-ccg99-executor',
  };
  const raw = {
    ...ids,
    ccg_context: { ...ids, mode: 'LIVE' },
    production_execution_results: {
      execution_id: 'executor-ccg99-001',
      status: 'FAILED',
      failed_job_id: 'job-ccg99-001',
      checkpoint: { execution_id: 'executor-ccg99-001', failed_job_ids: ['job-ccg99-001'] },
      jobs: [{ job_id: 'job-ccg99-001', status: 'FAILED', provider_job_id: 'provider-job-ccg99-001', attempt: 1 }],
    },
    error_event: {
      workflow: { id: 'TxE9eMS1xfE6kq38', name: 'Campaign Creative Creator' },
      execution: {
        id: 'n8n-execution-ccg99-001',
        mode: 'LIVE',
        lastNodeExecuted: 'CCG-80 Dispatch Production Manifest',
        error: { code: 'RATE_LIMIT', statusCode: 429, message: 'executor rate limit 429' },
      },
      recovery_context: { ...ids, checkpoint_module: 'CCG-80', max_attempts: 3, policy: { allow_execution_retry: true, allow_checkpoint_resume: true } },
    },
  };
  const normalized = await runCodeNode(errorNodes.get('CCG-99 Normalize & Redact Error Event'), raw);
  assert.equal(normalized.json.normalized_error_event.source.failed_job_id, 'job-ccg99-001');
  assert.equal(normalized.json.normalized_error_event.recovery_context.executor_execution_id, 'executor-ccg99-001');
  assert.equal(normalized.json.normalized_error_event.recovery_context.provider_job_id, 'provider-job-ccg99-001');
  assert.equal(normalized.json.normalized_error_event.ccg_context.request_hash, 'request-ccg99-executor');

  const classified = await runCodeNode(errorNodes.get('CCG-99 Classify & Decide Recovery'), normalized.json);
  assert.equal(classified.json.recovery_decision.category, 'RATE_LIMIT');
  assert.equal(classified.json.recovery_decision.action, 'RETRY_FAILED_EXECUTION');
  const retry = await runCodeNode(errorNodes.get('CCG-99 Build Retry Handoff'), classified.json);
  assert.equal(retry.json.recovery_handoff.failed_job_id, 'job-ccg99-001');
  assert.equal(retry.json.recovery_handoff.executor_execution_id, 'executor-ccg99-001');

  const missingEvidence = {
    normalized_error_event: {
      ...normalized.json.normalized_error_event,
      error: { ...normalized.json.normalized_error_event.error, code: 'MISSING_CHECKSUM', message: 'missing artifact checksum', normalized_message: 'missing artifact checksum', status_code: 0 },
    },
  };
  const resumeClassified = await runCodeNode(errorNodes.get('CCG-99 Classify & Decide Recovery'), missingEvidence);
  assert.equal(resumeClassified.json.recovery_decision.action, 'RESUME_FROM_CHECKPOINT');
  const resume = await runCodeNode(errorNodes.get('CCG-99 Build Resume Handoff'), resumeClassified.json);
  assert.equal(resume.json.recovery_handoff.executor_execution_id, 'executor-ccg99-001');
  assert.equal(resume.json.recovery_handoff.failed_job_id, 'job-ccg99-001');
});

test('CCG-99 accepts the sanitized lineage attached by the native n8n error dispatcher', async () => {
  const errorNodes = new Map(generatedError().nodes.map((nodeValue) => [nodeValue.name, nodeValue]));
  const event = {
    execution: {
      id: 'n8n-native-error-001',
      mode: 'integrated',
      lastNodeExecuted: 'CCG-00 Validate Contract',
      error: {
        name: 'NodeOperationError',
        message: '[CCG-00/CONTRACT] Requisição rejeitada: cta ausente',
        ccg_recovery_context: {
          schema_version: '1.0.0',
          run_id: 'run-native-lineage',
          production_id: 'production-native-lineage',
          content_id: 'content-native-lineage',
          campaign_id: 'campaign-native-lineage',
          request_hash: 'request-native-lineage',
          idempotency_key: 'idempotency-native-lineage',
          production_tier: 'STANDARD',
          mode: 'DRY_RUN',
          module: 'CCG-00',
          checkpoint_module: 'CCG-00',
          current_attempt: 1,
          max_attempts: 3,
          recovery_policy: {
            dispatch_enabled: false,
            allow_execution_retry: true,
            allow_checkpoint_resume: true,
            maximum_backoff_seconds: 900,
          },
        },
      },
    },
    workflow: { id: WORKFLOW_ID, name: WORKFLOW_NAME },
  };
  const normalized = await runCodeNode(errorNodes.get('CCG-99 Normalize & Redact Error Event'), event);
  assert.deepEqual(normalized.json.normalized_error_event.ccg_context, {
    run_id: 'run-native-lineage',
    idempotency_key: 'idempotency-native-lineage',
    production_id: 'production-native-lineage',
    campaign_id: 'campaign-native-lineage',
    content_id: 'content-native-lineage',
    request_hash: 'request-native-lineage',
    production_tier: 'STANDARD',
    mode: 'DRY_RUN',
  });
  assert.equal(normalized.json.normalized_error_event.source.execution_id, 'n8n-native-error-001');
  assert.equal(normalized.json.normalized_error_event.recovery_context.checkpoint_module, 'CCG-00');
  const classified = await runCodeNode(errorNodes.get('CCG-99 Classify & Decide Recovery'), normalized.json);
  assert.equal(classified.json.recovery_decision.category, 'VALIDATION_OR_CONTRACT');
  assert.equal(classified.json.recovery_decision.action, 'HOLD_FOR_REVIEW');
  const handoff = await runCodeNode(errorNodes.get('CCG-99 Build Review Handoff'), classified.json);
  const finalized = await runCodeNode(errorNodes.get('CCG-99 Finalize Incident & Ledger'), handoff.json);
  assert.equal(finalized.json.incident_report.context.request_hash, 'request-native-lineage');
});

test('no later-module fixture id appears in an E2E route started by CCG-00', () => {
  const laterFixtureNames = new Set(ALL_FIXTURE_NAMES.slice(1));
  for (const contentType of ['STATIC_SINGLE', 'CAROUSEL', 'SHORT_VIDEO', 'HYBRID']) {
    const result = contractE2E(contentType);
    assert.equal(result.path.some((name) => laterFixtureNames.has(name)), false);
  }
});
