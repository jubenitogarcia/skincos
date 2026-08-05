#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW_ID = 'TxE9eMS1xfE6kq38';
const WORKFLOW_NAME = 'Campaign Creative Creator';
const ERROR_WORKFLOW_ID = 'ccg-campaign-creative-creator-error-handler-v3';
const ERROR_WORKFLOW_NAME = 'Campaign Creative Creator - Error Handler';
const BUILDER_VERSION = '3.2.0';
const ALL_FIXTURE_NAMES = [
  'Build CCG-00 dry-run fixture',
  'Build CCG-10 dry-run fixture',
  'Build CCG-20 dry-run fixture',
  'Build CCG-30 dry-run fixture',
  'Build CCG-40 dry-run fixture',
  'Build CCG-50 dry-run fixture',
  'Build CCG-60 dry-run fixture',
  'Build CCG-70 dry-run fixture',
  'Build CCG-80 dry-run fixture',
  'Build CCG-90 dry-run fixture',
  'Build CCG-99 retryable fixture',
];
const INTERMEDIATE_FIXTURES = [
  ...ALL_FIXTURE_NAMES.slice(1, 10),
];
const ERROR_HANDLER_NODE_NAMES = [
  'Error Trigger',
  'CCG-99 Normalize & Redact Error Event',
  'CCG-99 Classify & Decide Recovery',
  'CCG-99 Switch Recovery Action',
  'CCG-99 Build Retry Handoff',
  'CCG-99 Build Resume Handoff',
  'CCG-99 Build Review Handoff',
  'CCG-99 Build Termination Handoff',
  'CCG-99 Finalize Incident & Ledger',
  'CCG-99 Return Error Handler Result',
];
const GENERATED_NODE_NAMES = [
  'Operational Production Request',
  'CCG-60 Optional Applicability Gate',
  'CCG-60 Optional Skip Result',
  'CCG-70 Optional Applicability Gate',
  'CCG-70 Optional Skip Result',
];
const MODULES = ['CCG-00', 'CCG-10', 'CCG-20', 'CCG-30', 'CCG-40', 'CCG-50', 'CCG-60', 'CCG-70', 'CCG-80', 'CCG-90'];
const REQUIRED_MODULE_NODES = [
  'CCG-00 Parse & Normalize',
  'CCG-00 Return Module Result',
  'CCG-10 Validate CCG-00 Input',
  'CCG-10 Return Module Result',
  'CCG-20 Validate CCG-10 Input',
  'CCG-20 Return Module Result',
  'CCG-30 Validate CCG-20 Input',
  'CCG-30 Return Module Result',
  'CCG-40 Validate CCG-30 Input',
  'CCG-40 Return Module Result',
  'CCG-50 Validate CCG-40 Input',
  'CCG-50 Return Module Result',
  'CCG-60 Validate CCG-50 Input',
  'CCG-60 Return Module Result',
  'CCG-70 Validate CCG-60 Input',
  'CCG-70 Return Module Result',
  'CCG-80 Validate CCG-70 Input',
  'CCG-80 Return Module Result',
  'CCG-90 Validate CCG-80 Input',
];

const EXECUTOR_CODE = String.raw`
const input = $input.first();
const root = input && input.json ? input.json : {};
const data = root && root.data && typeof root.data === 'object' ? root.data : root;
const request = data.production_request && typeof data.production_request === 'object'
  ? data.production_request
  : {};
const context = data.ccg_context && typeof data.ccg_context === 'object' ? data.ccg_context : {};
const moduleOutput = data.module_outputs && data.module_outputs.CCG_80 && typeof data.module_outputs.CCG_80 === 'object'
  ? data.module_outputs.CCG_80
  : {};
const manifest = data.production_manifest && typeof data.production_manifest === 'object'
  ? data.production_manifest
  : moduleOutput.production_manifest && typeof moduleOutput.production_manifest === 'object'
    ? moduleOutput.production_manifest
    : {};
const policy = request.provider_policy && typeof request.provider_policy === 'object'
  ? request.provider_policy
  : {};
const supplied = data.production_execution_results && typeof data.production_execution_results === 'object'
  ? data.production_execution_results
  : data.execution_results && typeof data.execution_results === 'object'
    ? data.execution_results
    : null;

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function list(value) {
  return Array.isArray(value) ? value : [];
}
function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(text)));
}
function fnv1a(value) {
  let hash = 2166136261;
  const input = text(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}
function lineage() {
  const ids = {
    run_id: text(context.run_id || request.run_id),
    production_id: text(context.production_id || request.production_id),
    content_id: text(context.content_id || request.content_id),
    campaign_id: text(context.campaign_id || request.campaign_id),
    request_hash: text(context.request_hash || request.request_hash),
    idempotency_key: text(context.idempotency_key || request.idempotency_key),
  };
  const missing = Object.keys(ids).filter((key) => !ids[key]);
  if (missing.length) {
    throw new Error('CCG-80 executor lineage missing: ' + missing.join(', '));
  }
  return ids;
}
function assertNoPublicationFlags(value) {
  const candidate = object(value);
  if (candidate.publish_allowed === true || candidate.publish_requested === true) {
    throw new Error('CCG-80 executor refuses publication flags');
  }
}
function approvalGranted() {
  const approval = object(data.human_approval || data.approval_record || request.human_approval || request.approval_record);
  return approval.approved === true || approval.verified === true || text(approval.status).toUpperCase() === 'APPROVED';
}
function allowedProviders() {
  return unique(list(policy.allowed_providers || manifest.allowed_providers));
}
function maxJobs() {
  const value = Number(
    policy.max_jobs !== undefined && policy.max_jobs !== null
      ? policy.max_jobs
      : manifest.budget && manifest.budget.max_jobs !== undefined && manifest.budget.max_jobs !== null
        ? manifest.budget.max_jobs
        : request.budget && request.budget.max_jobs !== undefined && request.budget.max_jobs !== null
          ? request.budget.max_jobs
          : 0,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function maxCost() {
  const value = Number(
    policy.max_cost !== undefined && policy.max_cost !== null
      ? policy.max_cost
      : manifest.budget && manifest.budget.max_cost !== undefined && manifest.budget.max_cost !== null
        ? manifest.budget.max_cost
        : request.budget && request.budget.max_cost !== undefined && request.budget.max_cost !== null
          ? request.budget.max_cost
          : 0,
  );
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function jobsFromManifest() {
  return list(manifest.jobs || manifest.job_plan || manifest.production_jobs);
}
function expectationsFor(job) {
  return list(job.expected_artifacts || job.artifact_expectations || job.outputs);
}
function artifactMime(expectation) {
  const value = object(expectation);
  return text(value.mime_type || value.mimeType || value.content_type || 'application/octet-stream');
}
function dryRunArtifact(job, expectation, ordinal, ids) {
  const expectationObject = object(expectation);
  const key = text(expectationObject.artifact_key || expectationObject.key || expectationObject.type || 'artifact-' + ordinal);
  return {
    artifact_key: key,
    artifact_id: ids.production_id + ':' + text(job.job_id || job.id || 'job') + ':' + key,
    uri: 'simulated://ccg80/' + encodeURIComponent(ids.run_id) + '/' + encodeURIComponent(key),
    mime_type: artifactMime(expectationObject),
    dimensions: object(expectationObject.dimensions || { width: 1, height: 1 }),
    checksum: { algorithm: 'FNV1A32-SIMULATED', value: fnv1a(ids.run_id + ':' + key), simulated: true },
    simulated: true,
  };
}
function dryRunJob(job, ordinal, ids) {
  const jobId = text(job.job_id || job.id || 'job-' + (ordinal + 1));
  const artifacts = expectationsFor(job).map((expectation, index) => dryRunArtifact(job, expectation, index + 1, ids));
  if (!artifacts.length) {
    artifacts.push(dryRunArtifact(job, { artifact_key: 'primary', mime_type: 'application/octet-stream' }, 1, ids));
  }
  return {
    job_id: jobId,
    status: 'COMPLETED',
    provider_id: 'mock',
    model: text(job.model || job.model_id || 'mock-production-v1'),
    attempts: 1,
    cost: { amount: 0, currency: 'BRL', recorded: true, simulated: true },
    provider_receipt: 'SIMULATED-RECEIPT-' + jobId,
    artifacts,
    qa: { status: 'PASS', simulated: true },
    simulated: true,
    ...ids,
  };
}
function assertLineageMatches(candidate, ids) {
  for (const key of Object.keys(ids)) {
    if (candidate[key] && text(candidate[key]) !== ids[key] && !(key === 'idempotency_key' && text(candidate[key]).startsWith(ids[key] + ':'))) {
      throw new Error('CCG-80 executor result lineage mismatch: ' + key);
    }
  }
}
function validateExternalResults(candidate, jobs, ids, providers, limitJobs, limitCost) {
  assertLineageMatches(candidate, ids);
  const resultJobs = list(candidate.jobs || candidate.results);
  if (!resultJobs.length || resultJobs.length > limitJobs || resultJobs.length > jobs.length) {
    throw new Error('CCG-80 executor result job count is outside the approved limit');
  }
  let totalCost = 0;
  for (const result of resultJobs) {
    const provider = text(result.provider_id || result.provider || result.providerId);
    if (!provider || !providers.includes(provider)) {
      throw new Error('CCG-80 executor provider is not allowlisted: ' + provider);
    }
    const cost = object(result.cost);
    const amount = Number(cost.amount);
    if (!Number.isFinite(amount) || cost.recorded !== true || amount < 0) {
      throw new Error('CCG-80 executor result cost is not recorded');
    }
    totalCost += amount;
    for (const artifact of list(result.artifacts)) {
      if (artifact.base64 || artifact.data || artifact.data_uri || text(artifact.uri).startsWith('data:')) {
        throw new Error('CCG-80 executor rejects inline or base64 artifacts');
      }
      if (!text(artifact.uri || artifact.artifact_id) || !text(artifact.mime_type || artifact.mimeType)) {
        throw new Error('CCG-80 executor artifact is missing URI or MIME type');
      }
      const dimensions = object(artifact.dimensions);
      if (!text(artifact.checksum && (artifact.checksum.value || artifact.checksum))) {
        throw new Error('CCG-80 executor artifact is missing checksum');
      }
      if (!(Number(dimensions.width) > 0 && Number(dimensions.height) > 0)) {
        throw new Error('CCG-80 executor artifact is missing dimensions');
      }
    }
  }
  if (totalCost > limitCost) {
    throw new Error('CCG-80 executor result cost exceeds the approved limit');
  }
  return {
    ...candidate,
    ...ids,
    mode: 'LIVE',
    dry_run: false,
    source: 'external_executor',
    dispatched_by_this_workflow: false,
    publish_allowed: false,
    publish_requested: false,
    total_cost: totalCost,
  };
}
function blockedExecution(jobs, ids, reason) {
  return {
    execution_id: ids.run_id + ':blocked-execution',
    mode: 'LIVE',
    dry_run: false,
    status: 'POLICY_BLOCKED',
    reason_code: reason,
    jobs: jobs.map((job, index) => ({
      job_id: text(job.job_id || job.id || 'job-' + (index + 1)),
      status: 'POLICY_BLOCKED',
      error: { code: reason, retryable: false },
      approval_required: true,
      ...ids,
    })),
    external_calls: [],
    storage_writes: [],
    total_cost: 0,
    publish_allowed: false,
    publish_requested: false,
    dispatched_by_this_workflow: false,
    adapter_required: true,
    ...ids,
  };
}

const ids = lineage();
assertNoPublicationFlags(request);
assertNoPublicationFlags(data);
const jobs = jobsFromManifest();
const limitJobs = maxJobs();
const limitCost = maxCost();
const providers = allowedProviders();
const dryRun = text(context.mode || request.mode).toUpperCase() === 'DRY_RUN' || request.dry_run === true;
let execution;

if (!jobs.length || !limitJobs || jobs.length > limitJobs) {
  execution = blockedExecution(jobs, ids, 'JOB_LIMIT_INVALID');
} else if (dryRun) {
  execution = {
    execution_id: ids.run_id + ':dry-run-execution',
    mode: 'DRY_RUN',
    dry_run: true,
    simulated: true,
    status: 'COMPLETED',
    jobs: jobs.map((job, index) => dryRunJob(job, index, ids)),
    external_calls: [],
    storage_writes: [],
    total_cost: 0,
    currency: 'BRL',
    executor: 'ccg-80-production-executor',
    source: 'inline_dry_run_simulation',
    publish_allowed: false,
    publish_requested: false,
    dispatched_by_this_workflow: false,
    ...ids,
  };
} else if (!approvalGranted()) {
  execution = blockedExecution(jobs, ids, 'HUMAN_APPROVAL_REQUIRED');
} else if (!providers.length || limitCost < 0) {
  execution = blockedExecution(jobs, ids, 'PROVIDER_POLICY_INVALID');
} else if (supplied) {
  try {
    execution = validateExternalResults(supplied, jobs, ids, providers, limitJobs, limitCost);
  } catch (error) {
    execution = blockedExecution(jobs, ids, 'EXECUTOR_RESULT_INVALID');
    execution.validation_error = text(error && error.message);
  }
} else {
  execution = blockedExecution(jobs, ids, 'EXECUTOR_ADAPTER_NOT_CONFIGURED');
}

return [{
  json: {
    ...root,
    data: {
      ...data,
      production_execution_results: execution,
      execution_handoff: {
        execution_id: execution.execution_id,
        mode: execution.mode,
        dispatch_requested: false,
        dispatched_by_this_workflow: false,
        adapter_required: execution.adapter_required === true,
        human_approval_required: true,
        publish_allowed: false,
        publish_requested: false,
      },
      ccg_executor: {
        name: 'CCG-80 Production Executor',
        version: '3.1.0',
        external_effects: false,
        status: execution.status,
      },
    },
  },
  binary: input && input.binary,
}];
`;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--input', '--output', '--error-output', '--fixtures-output', '--manifest-output'].includes(arg)) {
      const key = {
        '--input': 'input',
        '--output': 'output',
        '--error-output': 'errorOutput',
        '--fixtures-output': 'fixturesOutput',
        '--manifest-output': 'manifestOutput',
      }[arg];
      result[key] = argv[++index];
    } else if (arg === '--allow-noncanonical-source') {
      result.allowNoncanonicalSource = true;
    }
  }
  return result;
}

function nodeByName(nodes, name) {
  return nodes.find((node) => node.name === name);
}

function assertSourceShape(source, options = {}) {
  if (!source || typeof source !== 'object') throw new Error('Workflow export must be an object');
  if (source.id !== WORKFLOW_ID) throw new Error('Unexpected workflow id: ' + source.id);
  if (!options.allowNoncanonicalSource && source.name !== WORKFLOW_NAME) {
    throw new Error('Unexpected workflow name: ' + source.name);
  }
  if (!Array.isArray(source.nodes)) {
    throw new Error('Workflow export nodes must be an array');
  }
  if (options.strictSource !== false && source.nodes.length !== 107) {
    throw new Error('Expected the current 107-node export, received ' + (source.nodes || []).length);
  }
  for (const name of REQUIRED_MODULE_NODES) {
    if (!nodeByName(source.nodes, name)) throw new Error('Missing required source node: ' + name);
  }
  if (options.strictSource !== false) {
    for (const name of ALL_FIXTURE_NAMES) {
      if (!nodeByName(source.nodes, name)) throw new Error('Missing source fixture: ' + name);
    }
    if (!nodeByName(source.nodes, 'Error Trigger')) throw new Error('Missing source Error Trigger');
  }
}

function removeNodesAndEdges(workflow, names) {
  const removed = new Set([
    ...names,
    ...GENERATED_NODE_NAMES,
    ...ERROR_HANDLER_NODE_NAMES,
    'CCG-80 Production Executor',
  ]);
  workflow.nodes = workflow.nodes.filter((node) => !removed.has(node.name));
  for (const [source, output] of Object.entries(workflow.connections || {})) {
    if (removed.has(source)) {
      delete workflow.connections[source];
      continue;
    }
    for (const [connectionType, branches] of Object.entries(output || {})) {
      if (!Array.isArray(branches)) continue;
      output[connectionType] = branches.map((branch) => Array.isArray(branch)
        ? branch.filter((edge) => edge && !removed.has(edge.node))
        : branch);
    }
  }
}

function replaceMainEdge(workflow, sourceName, targetName) {
  workflow.connections[sourceName] = {
    main: [[{ node: targetName, type: 'main', index: 0 }]],
  };
}

function replaceCode(code, startMarker, endMarker, replacement) {
  const start = code.indexOf(startMarker);
  const end = code.indexOf(endMarker, start + Math.max(startMarker.length, 1));
  if (start < 0 || end < 0 || end <= start) return code;
  return code.slice(0, start) + replacement + code.slice(end);
}

function patchCcg10Code(code) {
  let updated = code;
  updated = replaceCode(
    updated,
    'function extractPdfText(',
    '\nconst tierLimits =',
    `function extractPdfText() {
  return { text: '', status: 'DEFERRED_UNSUPPORTED_RUNTIME' };
}
`,
  );
  const safeBinaryBlock = `let binaryIndex = 0;
for (const [binaryKey, metaValue] of Object.entries(binary || {})) {
  const meta = metaValue && typeof metaValue === 'object' ? metaValue : {};
  const fileName = text(meta.fileName || meta.file_name || binaryKey);
  const mimeType = text(meta.mimeType || meta.mime_type || meta.contentType).toLowerCase();
  let buffer = null;
  try {
    if (this.helpers && typeof this.helpers.getBinaryDataBuffer === 'function') {
      buffer = await this.helpers.getBinaryDataBuffer(0, binaryKey);
    }
  } catch (error) {
    buffer = null;
  }
  const suppliedChecksum = text(meta.sha256 || meta.content_sha256 || (typeof meta.checksum === 'string' ? meta.checksum : meta.checksum && meta.checksum.value));
  const isPdf = mimeType === 'application/pdf' || /\\.pdf$/i.test(fileName);
  const isTextBinary = mimeType.startsWith('text/') || /\\.(txt|md|csv|json)$/i.test(fileName);
  const isImage = mimeType.startsWith('image/');
  let excerpt = '';
  let textExtractionStatus = 'NOT_APPLICABLE';
  if (isPdf) {
    textExtractionStatus = 'DEFERRED_UNSUPPORTED_RUNTIME';
  } else if (isTextBinary && buffer) {
    excerpt = redact(buffer.toString('utf8')).slice(0, 12000);
    textExtractionStatus = 'EXTRACTED_FROM_TEXT_BINARY';
  } else if (!isImage) {
    textExtractionStatus = 'UNSUPPORTED_BINARY';
  }
  sourceRecords.push({
    source_id: 'production-request:binary:' + binaryIndex,
    source_type: isImage ? 'IMAGE' : isPdf ? 'PDF' : 'BINARY',
    file_name: fileName,
    mime_type: mimeType,
    usable: Boolean(excerpt || isImage),
    excerpt,
    content_sha256: suppliedChecksum,
    text_extraction_status: textExtractionStatus,
    metadata: {
      checksum_source: suppliedChecksum ? 'provided_metadata' : 'missing',
      size_bytes: Number(meta.fileSize || meta.file_size || 0) || null,
    },
  });
  binaryIndex += 1;
}
`;
  updated = replaceCode(updated, "const crypto = require('crypto');", '\nconst requestSourceId', safeBinaryBlock);
  return updated;
}

function patchCcg40Code(code) {
  const checksumBlock = `const suppliedChecksum = text(meta.sha256 || meta.content_sha256 || (typeof meta.checksum === 'string' ? meta.checksum : meta.checksum && meta.checksum.value));
asset.sha256 = suppliedChecksum;
asset.metadata = { ...(asset.metadata || {}), checksum_source: suppliedChecksum ? 'provided_metadata' : 'missing' };
if (!suppliedChecksum) {
  asset.blockers = Array.from(new Set([...(asset.blockers || []), 'CHECKSUM_MISSING']));
  asset.usage_status = 'blocked';
  asset.can_use = false;
}
`;
  const unsafeStart = code.indexOf("try { const crypto = require('crypto');");
  if (unsafeStart < 0) return code;
  const catchStart = code.indexOf('} catch', unsafeStart);
  const lineEnd = catchStart < 0 ? -1 : code.indexOf('\n', catchStart);
  const unsafeEnd = lineEnd < 0 ? code.length : lineEnd;
  return code.slice(0, unsafeStart) + checksumBlock + code.slice(unsafeEnd + (lineEnd < 0 ? 0 : 1));
}

function replaceAllText(code, search, replacement) {
  return code.split(search).join(replacement);
}

function patchCcg50Code(code) {
  let updated = code;
  updated = updated.replace(
    "const sceneType = contentMode === 'SHORT_VIDEO' ? 'VIDEO_SCENE' : contentMode === 'CAROUSEL' ? 'CAROUSEL_PAGE' : 'STATIC_FRAME';",
    "const sceneType = ['SHORT_VIDEO', 'HYBRID'].includes(contentMode) ? 'VIDEO_SCENE' : contentMode === 'CAROUSEL' ? 'CAROUSEL_PAGE' : 'STATIC_FRAME';",
  );
  updated = replaceAllText(
    updated,
    "contentMode === 'SHORT_VIDEO' ? Math.max(1, Number(job.duration_seconds || frame.duration_seconds || 3)) : 0",
    "['SHORT_VIDEO', 'HYBRID'].includes(contentMode) ? Math.max(1, Number(job.duration_seconds || frame.duration_seconds || 3)) : 0",
  );
  return updated;
}

function patchCcg50Validator(code) {
  return code.replace(
    "const validModes = new Set(['STATIC_SINGLE','CAROUSEL','SHORT_VIDEO']);",
    "const validModes = new Set(['STATIC_SINGLE','CAROUSEL','SHORT_VIDEO','HYBRID']);",
  );
}

function patchCcg60PrepareCode(code) {
  let updated = code.replace(
    "const applicable = mode === 'SHORT_VIDEO';",
    "const applicable = ['SHORT_VIDEO', 'HYBRID'].includes(mode);",
  );
  if (!updated.includes('const ccgOptionalSkip =')) {
    updated = updated.replace(
      'const brief = {',
      `const ccgOptionalSkip = productions.length > 0 && !productions.some((production) => production.audio_applicable === true);

const brief = {`,
    );
  }
  if (!updated.includes('CCG_60: ccgOptionalSkip')) {
    updated = updated.replace(
      '...data,\n    audio_planning_brief: brief,',
      `...data,
    ccg_optional_modules: {
      ...(data.ccg_optional_modules || {}),
      CCG_60: ccgOptionalSkip
        ? { status: 'SKIPPED_NOT_REQUIRED', reason_code: 'CONTENT_MODE_NOT_APPLICABLE', module: 'CCG-60' }
        : { status: 'REQUIRED', module: 'CCG-60' }
    },
    audio_planning_brief: brief,`,
    );
  }
  return updated;
}

function patchCcg70PrepareCode(code) {
  let updated = code;
  updated = updated.replace(
    "if (text(production.content_mode) !== 'SHORT_VIDEO') {",
    "if (!['SHORT_VIDEO', 'HYBRID'].includes(text(production.content_mode))) {",
  );
  updated = updated.replace(
    `const timelineType = mode === 'SHORT_VIDEO'
    ? 'TEMPORAL_VIDEO'
    : mode === 'CAROUSEL'
      ? 'FRAME_SEQUENCE'
      : 'STILL_FRAME';`,
    `const timelineType = ['SHORT_VIDEO', 'HYBRID'].includes(mode)
    ? 'TEMPORAL_VIDEO'
    : mode === 'CAROUSEL'
      ? 'FRAME_SEQUENCE'
      : 'STILL_FRAME';`,
  );
  updated = replaceAllText(
    updated,
    "mode === 'SHORT_VIDEO'\n      ? quantize(Number(production.total_duration_seconds || 0))\n      : scenes.length",
    "['SHORT_VIDEO', 'HYBRID'].includes(mode)\n      ? quantize(Number(production.total_duration_seconds || 0))\n      : scenes.length",
  );
  updated = replaceAllText(
    updated,
    "mode === 'SHORT_VIDEO'\n      ? Number((quantize(Number(production.total_duration_seconds || 0)) / fps).toFixed(6))\n      : 0",
    "['SHORT_VIDEO', 'HYBRID'].includes(mode)\n      ? Number((quantize(Number(production.total_duration_seconds || 0)) / fps).toFixed(6))\n      : 0",
  );
  if (!updated.includes('const ccgOptionalSkip =')) {
    updated = updated.replace(
      'const brief = {',
      `const ccgOptionalSkip = productions.length > 0 && productions.every((production) => text(production.content_mode) === 'STATIC_SINGLE');

const brief = {`,
    );
  }
  if (!updated.includes('CCG_70: ccgOptionalSkip')) {
    updated = updated.replace(
      '...data,\n    timeline_planning_brief: brief,',
      `...data,
    ccg_optional_modules: {
      ...(data.ccg_optional_modules || {}),
      CCG_70: ccgOptionalSkip
        ? { status: 'SKIPPED_NOT_REQUIRED', reason_code: 'CONTENT_MODE_NOT_APPLICABLE', module: 'CCG-70' }
        : { status: 'REQUIRED', module: 'CCG-70' }
    },
    timeline_planning_brief: brief,`,
    );
  }
  return updated;
}

function patchCcg60ReturnCode(code) {
  let updated = code.replace(
    "if (!output || output.status !== 'DONE' || !manifest) {",
    "if (!output || !['DONE', 'SKIPPED_NOT_REQUIRED'].includes(output.status) || !manifest) {",
  );
  updated = updated.replace(
    "module: 'CCG-60',\n      status: 'DONE',",
    "module: 'CCG-60',\n      status: output.status,",
  );
  return updated;
}

function patchCcg70ReturnCode(code) {
  let updated = code.replace(
    "if (!output || output.status !== 'DONE' || !timeline) {",
    "if (!output || !['DONE', 'SKIPPED_NOT_REQUIRED'].includes(output.status) || !timeline) {",
  );
  updated = updated.replace(
    "module: 'CCG-70',\n      status: 'DONE',",
    "module: 'CCG-70',\n      status: output.status,",
  );
  return updated;
}

function patchCcg70Validator(code) {
  let updated = code;
  updated = updated.replace(
    "if (!output || output.status !== 'DONE') errors.push('CCG-60 não foi concluído.');",
    "if (!output || !['DONE', 'SKIPPED_NOT_REQUIRED'].includes(output.status)) errors.push('CCG-60 não foi concluído.');",
  );
  updated = updated.replace(
    "const errors = [];\nconst warnings = [];",
    "const errors = [];\nconst warnings = [];\nconst audioSkipped = output?.status === 'SKIPPED_NOT_REQUIRED' || text(audioManifest?.status) === 'SKIPPED_NOT_REQUIRED';",
  );
  updated = updated.replace(
    "if (!['READY', 'NEEDS_REVIEW'].includes(text(audioManifest?.status))) {",
    "if (!audioSkipped && !['READY', 'NEEDS_REVIEW'].includes(text(audioManifest?.status))) {",
  );
  updated = updated.replace(
    "if (!['PROCEED', 'PROCEED_WITH_GUARDRAILS'].includes(text(audioManifest?.routing_decision))) {",
    "if (!audioSkipped && !['PROCEED', 'PROCEED_WITH_GUARDRAILS'].includes(text(audioManifest?.routing_decision))) {",
  );
  updated = updated.replace(
    "if (list(audioManifest?.review?.hard_blockers).length) {",
    "if (!audioSkipped && list(audioManifest?.review?.hard_blockers).length) {",
  );
  updated = updated.replace(
    'for (const [productionId, production] of sceneProductions.entries()) {',
    'if (!audioSkipped) for (const [productionId, production] of sceneProductions.entries()) {',
  );
  updated = updated.replace(
    "if (['cloned', 'custom_identity', 'voice_clone'].includes(voiceMode) && text(consent.status).toUpperCase() !== 'GRANTED') {",
    "if (!audioSkipped && ['cloned', 'custom_identity', 'voice_clone'].includes(voiceMode) && text(consent.status).toUpperCase() !== 'GRANTED') {",
  );
  updated = updated.replace(
    "if (text(data.ccg_context?.mode) === 'LIVE') {\n  const providers = list(request.provider_policy?.allowed_providers).map((value) => text(value).toLowerCase());",
    "if (!audioSkipped && text(data.ccg_context?.mode) === 'LIVE') {\n  const providers = list(request.provider_policy?.allowed_providers).map((value) => text(value).toLowerCase());",
  );
  return updated;
}

function patchCcg80Validator(code) {
  let updated = code;
  updated = updated.replace(
    "if (!output || output.status !== 'DONE') errors.push('CCG-70 não foi concluído.');",
    "if (!output || !['DONE', 'SKIPPED_NOT_REQUIRED'].includes(output.status)) errors.push('CCG-70 não foi concluído.');",
  );
  updated = updated.replace(
    "const errors = [];\nconst warnings = [];",
    "const errors = [];\nconst warnings = [];\nconst timelineSkipped = output?.status === 'SKIPPED_NOT_REQUIRED' || text(timeline?.status) === 'SKIPPED_NOT_REQUIRED';\nconst audioSkipped = text(audioManifest?.status) === 'SKIPPED_NOT_REQUIRED';",
  );
  updated = updated.replace(
    "if (!['READY', 'NEEDS_REVIEW'].includes(text(manifest?.status))) {\n    errors.push(`${name}.status não permite produção: ${text(manifest?.status, 'vazio')}.`);\n  }",
    "if (!((name === 'timeline' && timelineSkipped) || (name === 'audio_manifest' && audioSkipped)) && !['READY', 'NEEDS_REVIEW'].includes(text(manifest?.status))) {\n    errors.push(`${name}.status não permite produção: ${text(manifest?.status, 'vazio')}.`);\n  }",
  );
  return updated;
}

function patchModuleReturnCode(code, moduleName, options = {}) {
  let updated = code;
  if (options.allowSkipped) {
    updated = updated.replace(
      options.guard,
      options.guard.replace("output.status !== 'DONE'", "!['DONE', 'SKIPPED_NOT_REQUIRED'].includes(output.status)"),
    );
    updated = updated.replace(
      `module: '${moduleName}',\n      status: 'DONE',`,
      `module: '${moduleName}',\n      status: output.status,`,
    );
  }
  if (options.finalOutputType) {
    updated = updated.replace("output_type: 'CONTENT_PACKAGE_RESULT'", `output_type: '${options.finalOutputType}'`);
  }
  const continuityMarker = `event_id: (data.ccg_context?.run_id || 'unknown') + ':${moduleName}'`;
  if (options.addContinuity !== false && !updated.includes(continuityMarker)) {
    const marker = '...data,';
    const index = updated.indexOf(marker);
    if (index >= 0) {
      const continuity = `...data,
    module_trace: [
      ...(data.module_trace || []),
      ...((data.module_trace || []).some((entry) => entry && entry.module === '${moduleName}') ? [] : [{
        module: '${moduleName}',
        status: output?.status || 'DONE',
        run_id: data.ccg_context?.run_id,
        idempotency_key: data.ccg_context?.idempotency_key
      }])
    ],
    ledger_events: [
      ...(data.ledger_events || []),
      ...((data.ledger_events || []).some((entry) => entry && (entry.module === '${moduleName}' || entry.event_id === data.ccg_context?.run_id + ':${moduleName}')) ? [] : [{
        event_name: 'ccg.module.completed',
        event_id: (data.ccg_context?.run_id || 'unknown') + ':${moduleName}',
        module: '${moduleName}',
        status: output?.status || 'DONE',
        idempotency_key: data.ccg_context?.idempotency_key
      }])
    ],`;
      updated = updated.slice(0, index) + continuity + updated.slice(index + marker.length);
    }
  }
  return updated;
}

function patchUnsafeRuntime(workflow) {
  const ccg10 = nodeByName(workflow.nodes, 'CCG-10 Prepare Evidence Dossier');
  if (ccg10 && ccg10.parameters && typeof ccg10.parameters.jsCode === 'string') {
    ccg10.parameters.jsCode = patchCcg10Code(ccg10.parameters.jsCode);
  }
  const ccg40 = nodeByName(workflow.nodes, 'CCG-40 Prepare Asset Inventory');
  if (ccg40 && ccg40.parameters && typeof ccg40.parameters.jsCode === 'string') {
    ccg40.parameters.jsCode = patchCcg40Code(ccg40.parameters.jsCode);
  }
  const ccg50Prepare = nodeByName(workflow.nodes, 'CCG-50 Prepare Scene Planning Brief');
  if (ccg50Prepare?.parameters && typeof ccg50Prepare.parameters.jsCode === 'string') {
    ccg50Prepare.parameters.jsCode = patchCcg50Code(ccg50Prepare.parameters.jsCode);
  }
  const ccg50Validator = nodeByName(workflow.nodes, 'CCG-50 Validate CCG-40 Input');
  if (ccg50Validator?.parameters && typeof ccg50Validator.parameters.jsCode === 'string') {
    ccg50Validator.parameters.jsCode = patchCcg50Validator(ccg50Validator.parameters.jsCode);
  }
  const ccg60Prepare = nodeByName(workflow.nodes, 'CCG-60 Prepare Audio Planning Brief');
  if (ccg60Prepare?.parameters && typeof ccg60Prepare.parameters.jsCode === 'string') {
    ccg60Prepare.parameters.jsCode = patchCcg60PrepareCode(ccg60Prepare.parameters.jsCode);
  }
  const ccg60Return = nodeByName(workflow.nodes, 'CCG-60 Return Module Result');
  if (ccg60Return?.parameters && typeof ccg60Return.parameters.jsCode === 'string') {
    ccg60Return.parameters.jsCode = patchCcg60ReturnCode(ccg60Return.parameters.jsCode);
  }
  const ccg70Prepare = nodeByName(workflow.nodes, 'CCG-70 Prepare Timeline Planning Brief');
  if (ccg70Prepare?.parameters && typeof ccg70Prepare.parameters.jsCode === 'string') {
    ccg70Prepare.parameters.jsCode = patchCcg70PrepareCode(ccg70Prepare.parameters.jsCode);
  }
  const ccg70Validator = nodeByName(workflow.nodes, 'CCG-70 Validate CCG-60 Input');
  if (ccg70Validator?.parameters && typeof ccg70Validator.parameters.jsCode === 'string') {
    ccg70Validator.parameters.jsCode = patchCcg70Validator(ccg70Validator.parameters.jsCode);
  }
  const ccg70Return = nodeByName(workflow.nodes, 'CCG-70 Return Module Result');
  if (ccg70Return?.parameters && typeof ccg70Return.parameters.jsCode === 'string') {
    ccg70Return.parameters.jsCode = patchCcg70ReturnCode(ccg70Return.parameters.jsCode);
  }
  const ccg80Validator = nodeByName(workflow.nodes, 'CCG-80 Validate CCG-70 Input');
  if (ccg80Validator?.parameters && typeof ccg80Validator.parameters.jsCode === 'string') {
    ccg80Validator.parameters.jsCode = patchCcg80Validator(ccg80Validator.parameters.jsCode);
  }
  for (const moduleName of MODULES.slice(0, 9)) {
    const returnNode = nodeByName(workflow.nodes, `${moduleName} Return Module Result`);
    if (!returnNode?.parameters || typeof returnNode.parameters.jsCode !== 'string') continue;
    const guard = moduleName === 'CCG-60'
      ? "if (!output || output.status !== 'DONE' || !manifest) {"
      : moduleName === 'CCG-70'
        ? "if (!output || output.status !== 'DONE' || !timeline) {"
        : null;
    returnNode.parameters.jsCode = moduleName === 'CCG-60'
      ? patchModuleReturnCode(returnNode.parameters.jsCode, moduleName, {
        allowSkipped: true,
        guard,
      })
      : moduleName === 'CCG-70'
        ? patchModuleReturnCode(returnNode.parameters.jsCode, moduleName, {
          allowSkipped: true,
          guard,
        })
        : patchModuleReturnCode(returnNode.parameters.jsCode, moduleName);
  }
  const ccg90Return = nodeByName(workflow.nodes, 'CCG-90 Return Content Package');
  if (ccg90Return?.parameters && typeof ccg90Return.parameters.jsCode === 'string') {
    ccg90Return.parameters.jsCode = patchModuleReturnCode(ccg90Return.parameters.jsCode, 'CCG-90', {
      finalOutputType: 'CONTENT_PACKAGE',
    });
  }
}

function optionalGateNode(moduleName, position) {
  const suffix = moduleName.replace('CCG-', '').toLowerCase();
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: `ccg-${suffix}-optional-condition`,
          leftValue: `={{ $json.ccg_optional_modules && $json.ccg_optional_modules.CCG_${moduleName.slice(4)} && $json.ccg_optional_modules.CCG_${moduleName.slice(4)}.status }}`,
          rightValue: 'SKIPPED_NOT_REQUIRED',
          operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: `ccg-${suffix}-optional-applicability-gate`,
    name: `${moduleName} Optional Applicability Gate`,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position,
  };
}

function optionalSkipCode(moduleName, manifestKey, outputType, nextModule, reason) {
  const moduleKey = moduleName.replace('-', '_');
  return String.raw`
const item = $input.first();
const data = item.json || {};
const now = new Date().toISOString();
const ids = {
  run_id: data.ccg_context?.run_id,
  production_id: data.ccg_context?.production_id || data.production_request?.production_id,
  content_id: data.ccg_context?.content_id || data.production_request?.content_id,
  campaign_id: data.ccg_context?.campaign_id || data.production_request?.campaign_id,
  request_hash: data.ccg_context?.request_hash || data.production_request?.request_hash,
  idempotency_key: data.ccg_context?.idempotency_key
};
const manifest = {
  status: 'SKIPPED_NOT_REQUIRED',
  routing_decision: 'PROCEED',
  next_module: '${nextModule}',
  module: '${moduleName}',
  skip_reason: '${reason}',
  productions: [],
  ${manifestKey === 'audio_manifest' ? 'audio_job_registry: [],' : 'timeline_job_registry: [],'}
  review: { required: false, reasons: ['${reason}'], hard_blockers: [] },
  publish_allowed: false,
  publish_requested: false,
  ...ids
};
const moduleOutput = {
  status: 'SKIPPED_NOT_REQUIRED',
  output_type: '${outputType}',
  ${manifestKey}: manifest,
  ...ids,
  started_at: now,
  finished_at: now
};
return [{
  json: {
    ...data,
    module_outputs: { ...(data.module_outputs || {}), ${moduleKey}: moduleOutput },
    ${manifestKey}: manifest,
    ccg_optional_modules: {
      ...(data.ccg_optional_modules || {}),
      ${moduleKey}: { status: 'SKIPPED_NOT_REQUIRED', reason_code: 'CONTENT_MODE_NOT_APPLICABLE', module: '${moduleName}' }
    },
    module_trace: [
      ...(data.module_trace || []),
      { module: '${moduleName}', status: 'SKIPPED_NOT_REQUIRED', reason_code: 'CONTENT_MODE_NOT_APPLICABLE', run_id: ids.run_id, idempotency_key: ids.idempotency_key }
    ],
    ledger_events: [
      ...(data.ledger_events || []),
      { event_name: 'ccg.module.skipped', event_id: (ids.run_id || 'unknown') + ':${moduleName}:skipped', module: '${moduleName}', status: 'SKIPPED_NOT_REQUIRED', idempotency_key: ids.idempotency_key }
    ],
    next_module: '${nextModule}',
    status: 'SKIPPED_NOT_REQUIRED',
    module_status: 'SKIPPED_NOT_REQUIRED',
    ccg_module: '${moduleName}',
    output_type: 'CCG_MODULE_RESULT',
    posting_payload: { ...(data.posting_payload || {}), publish_allowed: false, publish_requested: false }
  },
  binary: item.binary
}];
`;
}

function connectionsForNodes(workflow, allowedNames) {
  const allowed = new Set(allowedNames);
  const connections = {};
  for (const [source, output] of Object.entries(workflow.connections || {})) {
    if (!allowed.has(source)) continue;
    const filteredOutput = {};
    for (const [connectionType, branches] of Object.entries(output || {})) {
      if (!Array.isArray(branches)) continue;
      filteredOutput[connectionType] = branches.map((branch) => Array.isArray(branch)
        ? branch.filter((edge) => edge && allowed.has(edge.node))
        : branch);
    }
    connections[source] = filteredOutput;
  }
  return connections;
}

function reachableNodeNames(workflow, startName) {
  const found = new Set();
  const queue = [startName];
  while (queue.length) {
    const source = queue.shift();
    if (found.has(source)) continue;
    found.add(source);
    const output = workflow.connections?.[source] || {};
    for (const branches of Object.values(output)) {
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        for (const edge of Array.isArray(branch) ? branch : []) {
          if (edge?.node && !found.has(edge.node)) queue.push(edge.node);
        }
      }
    }
  }
  return found;
}

function buildErrorWorkflow(source) {
  const reachable = reachableNodeNames(source, 'Error Trigger');
  const allowedNames = ERROR_HANDLER_NODE_NAMES.filter((name) => reachable.has(name) || name === 'Error Trigger');
  const nodes = source.nodes.filter((node) => allowedNames.includes(node.name));
  if (!nodes.some((node) => node.name === 'Error Trigger')) {
    throw new Error('Cannot build error workflow without Error Trigger');
  }
  const handler = {
    id: ERROR_WORKFLOW_ID,
    name: ERROR_WORKFLOW_NAME,
    active: false,
    nodes,
    connections: connectionsForNodes(source, new Set(nodes.map((node) => node.name))),
    settings: { ...(source.settings || {}) },
    meta: {
      codex_builder: 'campaign-creative-creator-continuous',
      codex_builder_version: BUILDER_VERSION,
      architecture: 'separate-error-workflow',
      source_workflow_id: WORKFLOW_ID,
      no_publication: true,
      recovery_handoffs: ['retry', 'resume', 'review', 'termination'],
    },
  };
  delete handler.settings.errorWorkflow;
  delete handler.versionId;
  return handler;
}

function buildFixturesWorkflow(source) {
  return {
    id: 'ccg-campaign-creative-creator-module-fixtures-v3',
    name: 'Campaign Creative Creator - Module Fixtures',
    active: false,
    nodes: source.nodes.filter((node) => ALL_FIXTURE_NAMES.includes(node.name)),
    connections: {},
    settings: {},
    meta: {
      codex_builder: 'campaign-creative-creator-continuous',
      codex_builder_version: BUILDER_VERSION,
      architecture: 'versioned-fixture-catalog',
      source_workflow_id: WORKFLOW_ID,
      no_publication: true,
      fixture_names: ALL_FIXTURE_NAMES,
    },
  };
}

function sanitizeWorkflow(value) {
  if (Array.isArray(value)) return value.map(sanitizeWorkflow);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^credentials?$/i.test(key) || /credential.*id/i.test(key)) continue;
    output[key] = sanitizeWorkflow(child);
  }
  return output;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildWorkflowPackage(source, options = {}) {
  assertSourceShape(source, options);
  const sourceSha256 = options.sourceSha256 || sha256(Buffer.from(JSON.stringify(source)));
  const errorHandler = transformForOutput(buildErrorWorkflow(source));
  const main = transformForOutput(transformWorkflow(source, options));
  const fixtures = transformForOutput(buildFixturesWorkflow(source));
  const manifest = {
    package_version: '3.2.0',
    builder: 'campaign-creative-creator-continuous',
    builder_version: BUILDER_VERSION,
    source: {
      workflow_id: WORKFLOW_ID,
      workflow_name: WORKFLOW_NAME,
      version_id: source.versionId || source.meta?.source_version_id || null,
      sha256: sourceSha256,
      baseline_reference: 'private-runtime/campaign-creative-creator/source-941bec10-3e41-49be-baed-753ca60787ad.json',
    },
    outputs: {
      main: 'campaign-creative-creator.v3.json',
      error_handler: 'campaign-creative-creator-error-handler.v3.json',
      fixtures: 'campaign-creative-creator.module-fixtures.v3.json',
    },
    contracts: {
      active: false,
      publish_allowed: false,
      publish_requested: false,
      error_workflow_id: ERROR_WORKFLOW_ID,
      operational_trigger: 'executeWorkflowTrigger',
      final_output_type: 'CONTENT_PACKAGE',
      credentials_stripped_for_git: true,
    },
    counts: {
      main_nodes: main.nodes.length,
      main_edges: countConnectionEdges(main),
      error_nodes: errorHandler.nodes.length,
      error_edges: countConnectionEdges(errorHandler),
      fixture_nodes: fixtures.nodes.length,
    },
  };
  return { main, errorHandler, fixtures, manifest };
}

function transformForOutput(workflow) {
  const output = sanitizeWorkflow(workflow);
  output.meta = { ...(output.meta || {}), credentials_stripped_for_git: true };
  return output;
}

function countConnectionEdges(workflow) {
  return Object.values(workflow.connections || {}).reduce((total, output) => total + Object.values(output || {}).reduce(
    (connectionTotal, branches) => connectionTotal + (Array.isArray(branches)
      ? branches.reduce((branchTotal, branch) => branchTotal + (Array.isArray(branch) ? branch.length : 0), 0)
      : 0),
    0,
  ), 0);
}

function addOptionalNodes(workflow) {
  workflow.nodes.push(
    optionalGateNode('CCG-60', [13520, 640]),
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: optionalSkipCode('CCG-60', 'audio_manifest', 'AUDIO_MANIFEST', 'CCG-70', 'CONTENT_MODE_NOT_APPLICABLE') },
      id: 'ccg-60-optional-skip-result',
      name: 'CCG-60 Optional Skip Result',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [13760, 560],
    },
    optionalGateNode('CCG-70', [14800, 640]),
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: optionalSkipCode('CCG-70', 'timeline', 'TIMELINE', 'CCG-80', 'CONTENT_MODE_NOT_APPLICABLE') },
      id: 'ccg-70-optional-skip-result',
      name: 'CCG-70 Optional Skip Result',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [15040, 560],
    },
  );
}

function transformWorkflow(source, options = {}) {
  assertSourceShape(source, options);
  const workflow = JSON.parse(JSON.stringify(source));
  workflow.connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
  removeNodesAndEdges(workflow, [...INTERMEDIATE_FIXTURES, 'Build CCG-99 retryable fixture']);
  patchUnsafeRuntime(workflow);

  workflow.nodes.push({
    parameters: {},
    id: 'ccg-operational-production-request-trigger',
    name: 'Operational Production Request',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [-608, 180],
  });
  addOptionalNodes(workflow);

  replaceMainEdge(workflow, 'Operational Production Request', 'CCG-00 Parse & Normalize');
  replaceMainEdge(workflow, 'CCG-00 Return Module Result', 'CCG-10 Validate CCG-00 Input');
  replaceMainEdge(workflow, 'CCG-10 Return Module Result', 'CCG-20 Validate CCG-10 Input');
  replaceMainEdge(workflow, 'CCG-20 Return Module Result', 'CCG-30 Validate CCG-20 Input');
  replaceMainEdge(workflow, 'CCG-30 Return Module Result', 'CCG-40 Validate CCG-30 Input');
  replaceMainEdge(workflow, 'CCG-40 Return Module Result', 'CCG-50 Validate CCG-40 Input');
  replaceMainEdge(workflow, 'CCG-50 Return Module Result', 'CCG-60 Validate CCG-50 Input');
  replaceMainEdge(workflow, 'CCG-60 Return Module Result', 'CCG-70 Validate CCG-60 Input');
  replaceMainEdge(workflow, 'CCG-70 Return Module Result', 'CCG-80 Validate CCG-70 Input');
  replaceMainEdge(workflow, 'CCG-80 Return Module Result', 'CCG-90 Validate CCG-80 Input');

  replaceMainEdge(workflow, 'CCG-60 Prepare Audio Planning Brief', 'CCG-60 Optional Applicability Gate');
  workflow.connections['CCG-60 Optional Applicability Gate'] = {
    main: [
      [{ node: 'CCG-60 Optional Skip Result', type: 'main', index: 0 }],
      [{ node: 'CCG-60 Switch Audio Direction Mode', type: 'main', index: 0 }],
    ],
  };
  replaceMainEdge(workflow, 'CCG-60 Optional Skip Result', 'CCG-60 Return Module Result');
  replaceMainEdge(workflow, 'CCG-70 Prepare Timeline Planning Brief', 'CCG-70 Optional Applicability Gate');
  workflow.connections['CCG-70 Optional Applicability Gate'] = {
    main: [
      [{ node: 'CCG-70 Optional Skip Result', type: 'main', index: 0 }],
      [{ node: 'CCG-70 Switch Timeline Mode', type: 'main', index: 0 }],
    ],
  };
  replaceMainEdge(workflow, 'CCG-70 Optional Skip Result', 'CCG-70 Return Module Result');

  workflow.active = false;
  workflow.settings = {
    ...(workflow.settings || {}),
    errorWorkflow: ERROR_WORKFLOW_ID,
  };
  workflow.meta = {
    ...(workflow.meta || {}),
    codex_builder: 'campaign-creative-creator-continuous',
    codex_builder_version: BUILDER_VERSION,
    architecture: 'continuous-inline-with-separate-error-workflow',
    source_workflow_id: WORKFLOW_ID,
    source_version_id: source.versionId || (source.meta && source.meta.source_version_id) || null,
    no_publication: true,
    error_workflow_id: ERROR_WORKFLOW_ID,
    fixtures_catalog: 'Campaign Creative Creator - Module Fixtures',
    live_provider_adapter: 'external-input-only-until-reviewed',
  };
  delete workflow.versionId;
  return workflow;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input || process.env.CCG_SOURCE_FILE;
  const outputPath = args.output || process.env.CCG_OUTPUT_FILE;
  if (!inputPath || !outputPath) {
    throw new Error('Usage: build... --input <export.json> --output <candidate.json> [--error-output <error.json> --fixtures-output <fixtures.json> --manifest-output <manifest.json>]');
  }
  const sourceBuffer = fs.readFileSync(path.resolve(inputPath));
  const source = JSON.parse(sourceBuffer.toString('utf8').replace(/^\uFEFF/, ''));
  const outputDirectory = path.dirname(path.resolve(outputPath));
  const packageValue = buildWorkflowPackage(source, {
    allowNoncanonicalSource: args.allowNoncanonicalSource,
    sourceSha256: sha256(sourceBuffer),
  });
  const errorOutput = args.errorOutput || path.join(outputDirectory, 'campaign-creative-creator-error-handler.v3.json');
  const fixturesOutput = args.fixturesOutput || path.join(outputDirectory, 'campaign-creative-creator.module-fixtures.v3.json');
  const manifestOutput = args.manifestOutput || path.join(outputDirectory, 'campaign-creative-creator.package.json');
  for (const [target, value] of [
    [outputPath, packageValue.main],
    [errorOutput, packageValue.errorHandler],
    [fixturesOutput, packageValue.fixtures],
    [manifestOutput, packageValue.manifest],
  ]) {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(path.resolve(target), JSON.stringify(value, null, 2) + '\n');
  }
  process.stdout.write('Built inactive Campaign Creative Creator package: ' + outputPath + ' (' + packageValue.main.nodes.length + ' nodes)\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write((error && error.stack ? error.stack : error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  ALL_FIXTURE_NAMES,
  BUILDER_VERSION,
  EXECUTOR_CODE,
  ERROR_HANDLER_NODE_NAMES,
  ERROR_WORKFLOW_ID,
  ERROR_WORKFLOW_NAME,
  INTERMEDIATE_FIXTURES,
  MODULES,
  REQUIRED_MODULE_NODES,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  assertSourceShape,
  buildErrorWorkflow,
  buildFixturesWorkflow,
  buildWorkflowPackage,
  optionalSkipCode,
  sanitizeWorkflow,
  transformWorkflow,
};
