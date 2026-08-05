#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'TxE9eMS1xfE6kq38';
const WORKFLOW_NAME = 'Campaign Creative Creator';
const BUILDER_VERSION = '3.1.0';
const INTERMEDIATE_FIXTURES = [
  'Build CCG-10 dry-run fixture',
  'Build CCG-20 dry-run fixture',
  'Build CCG-30 dry-run fixture',
  'Build CCG-40 dry-run fixture',
  'Build CCG-50 dry-run fixture',
  'Build CCG-60 dry-run fixture',
  'Build CCG-70 dry-run fixture',
  'Build CCG-80 dry-run fixture',
  'Build CCG-90 dry-run fixture',
];
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
    if (arg === '--input' || arg === '--output') {
      result[arg.slice(2)] = argv[++index];
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
    for (const name of INTERMEDIATE_FIXTURES) {
      if (!nodeByName(source.nodes, name)) throw new Error('Missing intermediate fixture: ' + name);
    }
  }
}

function removeNodesAndEdges(workflow, names) {
  const removed = new Set(names);
  workflow.nodes = workflow.nodes.filter((node) => !removed.has(node.name) && node.name !== 'Operational Production Request' && node.name !== 'CCG-80 Production Executor');
  for (const [source, output] of Object.entries(workflow.connections || {})) {
    if (removed.has(source) || source === 'Operational Production Request' || source === 'CCG-80 Production Executor') {
      delete workflow.connections[source];
      continue;
    }
    for (const [connectionType, branches] of Object.entries(output || {})) {
      if (!Array.isArray(branches)) continue;
      output[connectionType] = branches.map((branch) => Array.isArray(branch)
        ? branch.filter((edge) => edge && !removed.has(edge.node) && edge.node !== 'Operational Production Request' && edge.node !== 'CCG-80 Production Executor')
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

function patchUnsafeRuntime(workflow) {
  const ccg10 = nodeByName(workflow.nodes, 'CCG-10 Prepare Evidence Dossier');
  if (ccg10 && ccg10.parameters && typeof ccg10.parameters.jsCode === 'string') {
    ccg10.parameters.jsCode = patchCcg10Code(ccg10.parameters.jsCode);
  }
  const ccg40 = nodeByName(workflow.nodes, 'CCG-40 Prepare Asset Inventory');
  if (ccg40 && ccg40.parameters && typeof ccg40.parameters.jsCode === 'string') {
    ccg40.parameters.jsCode = patchCcg40Code(ccg40.parameters.jsCode);
  }
}

function transformWorkflow(source, options = {}) {
  assertSourceShape(source, options);
  const workflow = JSON.parse(JSON.stringify(source));
  workflow.connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
  removeNodesAndEdges(workflow, INTERMEDIATE_FIXTURES);
  patchUnsafeRuntime(workflow);

  workflow.nodes.push({
    parameters: {},
    id: 'ccg-operational-production-request-trigger',
    name: 'Operational Production Request',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [-608, 180],
  });
  workflow.nodes.push({
    parameters: { mode: 'runOnceForAllItems', jsCode: EXECUTOR_CODE },
    id: 'ccg-production-executor',
    name: 'CCG-80 Production Executor',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [15520, 520],
  });

  replaceMainEdge(workflow, 'Operational Production Request', 'CCG-00 Parse & Normalize');
  replaceMainEdge(workflow, 'CCG-00 Return Module Result', 'CCG-10 Validate CCG-00 Input');
  replaceMainEdge(workflow, 'CCG-10 Return Module Result', 'CCG-20 Validate CCG-10 Input');
  replaceMainEdge(workflow, 'CCG-20 Return Module Result', 'CCG-30 Validate CCG-20 Input');
  replaceMainEdge(workflow, 'CCG-30 Return Module Result', 'CCG-40 Validate CCG-30 Input');
  replaceMainEdge(workflow, 'CCG-40 Return Module Result', 'CCG-50 Validate CCG-40 Input');
  replaceMainEdge(workflow, 'CCG-50 Return Module Result', 'CCG-60 Validate CCG-50 Input');
  replaceMainEdge(workflow, 'CCG-60 Return Module Result', 'CCG-70 Validate CCG-60 Input');
  replaceMainEdge(workflow, 'CCG-70 Return Module Result', 'CCG-80 Validate CCG-70 Input');
  replaceMainEdge(workflow, 'CCG-80 Return Module Result', 'CCG-80 Production Executor');
  replaceMainEdge(workflow, 'CCG-80 Production Executor', 'CCG-90 Validate CCG-80 Input');

  workflow.active = false;
  workflow.meta = {
    ...(workflow.meta || {}),
    codex_builder: 'campaign-creative-creator-continuous',
    codex_builder_version: BUILDER_VERSION,
    architecture: 'continuous-inline',
    source_workflow_id: WORKFLOW_ID,
    source_version_id: source.versionId || (source.meta && source.meta.source_version_id) || null,
    no_publication: true,
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
    throw new Error('Usage: build... --input <export.json> --output <candidate.json>');
  }
  const source = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, ''));
  const output = transformWorkflow(source, { allowNoncanonicalSource: args.allowNoncanonicalSource });
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(output, null, 2) + '\n');
  process.stdout.write('Built inactive continuous candidate: ' + outputPath + ' (' + output.nodes.length + ' nodes)\n');
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
  BUILDER_VERSION,
  EXECUTOR_CODE,
  INTERMEDIATE_FIXTURES,
  REQUIRED_MODULE_NODES,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  assertSourceShape,
  transformWorkflow,
};
