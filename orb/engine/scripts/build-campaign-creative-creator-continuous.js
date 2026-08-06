#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW_ID = 'TxE9eMS1xfE6kq38';
const WORKFLOW_NAME = 'Campaign Creative Creator';
const ERROR_WORKFLOW_ID = 'ccg-campaign-creative-error-v3';
const ERROR_WORKFLOW_NAME = 'Campaign Creative Creator - Error Handler';
const BUILDER_VERSION = '4.1.3';
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
  'CCG-80 Validate Execution Policy',
  'CCG-80 Execution Allowed?',
  'CCG-80 Dispatch Production Manifest',
  'CCG-80 Poll Production Manifest',
  'CCG-80 Normalize Execution Results',
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

const EXECUTION_POLICY_CODE = String.raw`
const item = $input.first();
const root = item && item.json ? item.json : {};
const data = root && root.data && typeof root.data === 'object' ? root.data : root;
const request = data.production_request && typeof data.production_request === 'object' ? data.production_request : {};
const context = data.ccg_context && typeof data.ccg_context === 'object' ? data.ccg_context : {};
const moduleOutput = data.module_outputs && data.module_outputs.CCG_80 && typeof data.module_outputs.CCG_80 === 'object' ? data.module_outputs.CCG_80 : {};
const manifest = data.production_manifest && typeof data.production_manifest === 'object'
  ? data.production_manifest
  : moduleOutput.production_manifest && typeof moduleOutput.production_manifest === 'object' ? moduleOutput.production_manifest : {};
const policy = manifest.execution_policy && typeof manifest.execution_policy === 'object'
  ? manifest.execution_policy
  : request.provider_policy && typeof request.provider_policy === 'object' ? request.provider_policy : {};
function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function list(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return Array.from(new Set(list(values).map(text).filter(Boolean))); }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== ''); }
function numeric(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
const ids = {
  run_id: text(context.run_id || request.run_id),
  production_id: text(context.production_id || request.production_id),
  content_id: text(context.content_id || request.content_id),
  campaign_id: text(context.campaign_id || request.campaign_id),
  request_hash: text(context.request_hash || request.request_hash),
  idempotency_key: text(context.idempotency_key || request.idempotency_key)
};
const mode = text(context.mode || request.mode || manifest.mode || 'DRY_RUN').toUpperCase() === 'LIVE' ? 'LIVE' : 'DRY_RUN';
const jobs = list(manifest.jobs || manifest.job_plan || manifest.production_jobs);
const allowedProviders = unique(policy.allowed_providers || manifest.allowed_providers || request.provider_policy?.allowed_providers);
const maxJobs = numeric(firstDefined(policy.max_jobs, policy.maximum_jobs, manifest.max_jobs, manifest.budget?.max_jobs, request.budget?.max_jobs));
const maxRevisions = numeric(firstDefined(policy.max_revisions, manifest.max_revisions, manifest.budget?.max_revisions, request.budget?.max_revisions));
const maxCostRaw = firstDefined(policy.max_cost, policy.maximum_cost, manifest.max_cost, manifest.budget?.max_cost, manifest.budget?.maximum_cost, request.budget?.max_cost);
const maxCost = numeric(maxCostRaw);
const approval = object(firstDefined(data.human_approval, data.approval_record, request.human_approval, request.approval_record, policy.human_approval));
const approvalGranted = approval.approved === true || approval.verified === true || ['APPROVED', 'VERIFIED', 'GRANTED'].includes(text(approval.status).toUpperCase());
const blockers = [];
for (const key of Object.keys(ids)) if (!ids[key]) blockers.push('LINEAGE_REQUIRED:' + key);
if (!jobs.length) blockers.push('NO_JOBS');
if (!maxJobs || jobs.length > maxJobs) blockers.push('MAX_JOBS_EXCEEDED');
if (maxRevisions === null || maxRevisions < 0 || jobs.some((job) => numeric(job.revision || job.revision_number) > maxRevisions)) blockers.push('MAX_REVISIONS_EXCEEDED');
if (manifest.status === 'BLOCKED' || list(manifest.review?.hard_blockers).length) blockers.push('MANIFEST_BLOCKED');
if (data.publish_allowed === true || data.publish_requested === true || request.publish_allowed === true || request.publish_requested === true || manifest.publish_allowed === true || manifest.publish_requested === true) blockers.push('PUBLICATION_FORBIDDEN');
if (mode === 'LIVE' && !allowedProviders.length) blockers.push('PROVIDER_ALLOWLIST_REQUIRED');
if (mode === 'LIVE' && maxCost === null) blockers.push('MAX_COST_REQUIRED');
if (mode === 'LIVE' && !approvalGranted) blockers.push('HUMAN_APPROVAL_REQUIRED');
for (const job of jobs) {
  const consent = object(firstDefined(job.consent, job.consent_record, data.consent, data.consent_record));
  const identifiable = job.identifiable_person === true || job.requires_identifiable_consent === true || job.consent_required === true;
  const consentGranted = job.identifiable_person === false || (!identifiable || consent.verified === true || ['VERIFIED', 'GRANTED', 'APPROVED'].includes(text(consent.status).toUpperCase()));
  if (!consentGranted) blockers.push('CONSENT_REQUIRED:' + text(job.job_id || job.id));
}
const dispatchAllowed = blockers.length === 0;
const executorEndpoint = text(firstDefined(
  policy.executor_base_url,
  policy.executor_endpoint,
  request.provider_policy?.executor_base_url,
  request.executor_endpoint,
  'n8n-env:CCG_EXECUTOR_BASE_URL'
));
const blockedJobs = jobs.map((job, index) => ({
  job_id: text(job.job_id || job.id || 'job-' + (index + 1)),
  status: 'NEEDS_REVIEW',
  provider: mode === 'DRY_RUN' ? 'mock' : text(job.provider || job.provider_id),
  provider_id: mode === 'DRY_RUN' ? 'mock' : text(job.provider || job.provider_id),
  attempt: 0,
  attempts: 0,
  started_at: null,
  finished_at: new Date().toISOString(),
  artifact_uri: '',
  preview_uri: '',
  mime_type: '',
  width: null,
  height: null,
  duration_seconds: null,
  file_size: null,
  sha256: '',
  cost: { amount: 0, currency: text(policy.currency || manifest.budget?.currency || 'BRL'), recorded: true, simulated: mode === 'DRY_RUN' },
  warnings: ['NO_EXTERNAL_CALL_DISPATCH_BLOCKED'],
  error: { code: blockers[0] || 'EXECUTION_POLICY_BLOCKED', retryable: false },
  provenance: { executor: 'campaign-creative-executor', policy_blocked: true },
  artifacts: [],
  ...ids
}));
const blockedExecution = {
  execution_id: text(ids.run_id) + ':policy-blocked',
  mode,
  dry_run: mode === 'DRY_RUN',
  status: 'NEEDS_REVIEW',
  jobs: blockedJobs,
  results: blockedJobs,
  total_cost: 0,
  currency: text(policy.currency || manifest.budget?.currency || 'BRL'),
  cost: { amount: 0, currency: text(policy.currency || manifest.budget?.currency || 'BRL'), recorded: true, simulated: mode === 'DRY_RUN' },
  warnings: blockers,
  error: blockers.length ? { code: blockers[0], retryable: false } : null,
  external_calls: [],
  storage_writes: [],
  receipts: [],
  checkpoint: { completed_job_ids: [], pending_job_ids: blockedJobs.map((job) => job.job_id), failed_job_ids: [], resume_supported: true },
  policy: { allowed_providers: allowedProviders, max_jobs: maxJobs, max_revisions: maxRevisions, max_cost: maxCost, max_cost_configured: maxCost !== null, dispatch_allowed: false },
  publish_allowed: false,
  publish_requested: false,
  ...ids
};
const executorManifest = {
  ...manifest,
  allowed_providers: allowedProviders,
  execution_policy: {
    ...policy,
    allowed_providers: allowedProviders,
    max_jobs: maxJobs,
    max_revisions: maxRevisions,
    max_cost: maxCost,
    currency: text(policy.currency || manifest.budget?.currency || 'BRL')
  },
  publish_allowed: false,
  publish_requested: false,
  ...ids
};
return [{
  json: {
    ...root,
    ...data,
    production_manifest: executorManifest,
    executor_dispatch_allowed: dispatchAllowed,
    executor_request: dispatchAllowed ? {
      manifest: executorManifest,
      mode,
      request_context: {
        ...ids,
        mode,
        production_request: request,
        ccg_context: context,
        human_approval: approval,
        consent: data.consent || data.consent_record
      }
    } : null,
    production_execution_results: dispatchAllowed ? (data.production_execution_results || null) : blockedExecution,
    execution_handoff: {
      execution_id: dispatchAllowed ? '' : blockedExecution.execution_id,
      dispatch_allowed: dispatchAllowed,
      dispatch_requested: mode === 'LIVE' || mode === 'DRY_RUN',
      executor_endpoint: executorEndpoint,
      publish_allowed: false,
      publish_requested: false,
      policy_blockers: blockers
    },
    next_module: 'CCG-90',
    status: 'DONE',
    module_status: 'DONE',
    output_type: 'CCG_MODULE_RESULT'
  },
  binary: item && item.binary
}];
`;

const EXECUTION_NORMALIZER_CODE = String.raw`
const item = $input.first();
const input = item && item.json ? item.json : {};
let base = input;
try { base = $('CCG-80 Validate Execution Policy').first().json || input; } catch (error) { base = input; }
const response = input && input.production_execution_results ? input : input;
const candidate = response.production_execution_results && typeof response.production_execution_results === 'object'
  ? response.production_execution_results
  : response.result && response.result.production_execution_results && typeof response.result.production_execution_results === 'object'
    ? response.result.production_execution_results
    : base.production_execution_results && typeof base.production_execution_results === 'object' ? base.production_execution_results : {};
function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function lineageMatches(result, key, expected) { return !result[key] || !expected || text(result[key]) === text(expected); }
const ids = {
  run_id: text(base.ccg_context?.run_id || base.production_request?.run_id),
  production_id: text(base.ccg_context?.production_id || base.production_request?.production_id),
  content_id: text(base.ccg_context?.content_id || base.production_request?.content_id),
  campaign_id: text(base.ccg_context?.campaign_id || base.production_request?.campaign_id),
  request_hash: text(base.ccg_context?.request_hash || base.production_request?.request_hash),
  idempotency_key: text(base.ccg_context?.idempotency_key || base.production_request?.idempotency_key)
};
const expectedJobs = list(base.production_manifest?.jobs || base.production_manifest?.job_plan || base.production_manifest?.production_jobs);
const expectedIds = new Set(expectedJobs.map((job) => text(job.job_id || job.id)).filter(Boolean));
const sourceJobs = list(candidate.jobs || candidate.results);
const normalizedJobs = sourceJobs.map((raw) => {
  const result = object(raw);
  const artifacts = list(result.artifacts).map((artifact) => {
    const value = object(artifact);
    return {
      ...value,
      artifact_uri: text(value.artifact_uri || value.uri),
      preview_uri: text(value.preview_uri || value.artifact_uri || value.uri),
      mime_type: text(value.mime_type || value.mimeType),
      width: number(value.width || value.dimensions?.width),
      height: number(value.height || value.dimensions?.height),
      duration_seconds: number(value.duration_seconds || value.duration),
      file_size: number(value.file_size || value.size),
      sha256: text(value.sha256 || value.checksum?.value || (typeof value.checksum === 'string' ? value.checksum : ''))
    };
  });
  if (!artifacts.length && text(result.artifact_uri)) artifacts.push({ artifact_uri: text(result.artifact_uri), preview_uri: text(result.preview_uri || result.artifact_uri), mime_type: text(result.mime_type), width: number(result.width), height: number(result.height), duration_seconds: number(result.duration_seconds), file_size: number(result.file_size), sha256: text(result.sha256) });
  const inline = Boolean(result.base64 || result.data || result.data_uri || artifacts.some((artifact) => artifact.base64 || artifact.data || text(artifact.artifact_uri).startsWith('data:')));
  const missingArtifactEvidence = ['COMPLETED', 'FAILED'].includes(text(result.status).toUpperCase()) && text(result.status).toUpperCase() === 'COMPLETED' && artifacts.some((artifact) => !artifact.artifact_uri || !artifact.mime_type || !artifact.sha256);
  const status = ['PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW'].includes(text(result.status).toUpperCase()) ? text(result.status).toUpperCase() : 'NEEDS_REVIEW';
  const normalized = {
    ...result,
    ...ids,
    job_id: text(result.job_id || result.id),
    status: inline || missingArtifactEvidence ? 'NEEDS_REVIEW' : status,
    provider: text(result.provider || result.provider_id),
    provider_id: text(result.provider || result.provider_id),
    provider_job_id: text(result.provider_job_id || result.provider_receipt_id || result.provider_receipt),
    attempt: number(result.attempt || result.attempts) || 0,
    attempts: number(result.attempts || result.attempt) || 0,
    started_at: result.started_at || null,
    finished_at: result.finished_at || null,
    artifact_uri: text(result.artifact_uri || artifacts[0]?.artifact_uri),
    preview_uri: text(result.preview_uri || artifacts[0]?.preview_uri || artifacts[0]?.artifact_uri),
    mime_type: text(result.mime_type || artifacts[0]?.mime_type),
    width: number(result.width || artifacts[0]?.width),
    height: number(result.height || artifacts[0]?.height),
    duration_seconds: number(result.duration_seconds || artifacts[0]?.duration_seconds),
    file_size: number(result.file_size || artifacts[0]?.file_size),
    sha256: text(result.sha256 || artifacts[0]?.sha256),
    cost: typeof result.cost === 'object' ? result.cost : { amount: number(result.cost) || 0, currency: text(candidate.currency || 'BRL'), recorded: true },
    warnings: [...list(result.warnings), ...(inline ? ['INLINE_ARTIFACT_FORBIDDEN'] : []), ...(missingArtifactEvidence ? ['ARTIFACT_CHECKSUM_OR_URI_MISSING'] : [])],
    error: inline ? { code: 'INLINE_ARTIFACT_FORBIDDEN', retryable: false } : missingArtifactEvidence ? { code: 'ARTIFACT_CHECKSUM_OR_URI_MISSING', retryable: false } : (result.error || null),
    artifacts
  };
  if (!expectedIds.has(normalized.job_id)) normalized.status = 'NEEDS_REVIEW';
  for (const key of Object.keys(ids)) if (!lineageMatches(normalized, key, ids[key])) normalized.status = 'NEEDS_REVIEW';
  return normalized;
});
const derivedStatus = normalizedJobs.some((job) => job.status === 'FAILED')
  ? 'FAILED'
  : normalizedJobs.some((job) => job.status === 'NEEDS_REVIEW')
    ? 'NEEDS_REVIEW'
    : normalizedJobs.some((job) => ['PLANNED', 'RUNNING'].includes(job.status))
      ? 'RUNNING'
      : text(candidate.status || 'COMPLETED').toUpperCase();
const execution = {
  ...candidate,
  ...ids,
  status: derivedStatus,
  jobs: normalizedJobs,
  results: normalizedJobs,
  total_cost: number(candidate.total_cost || candidate.cost?.amount) || normalizedJobs.reduce((sum, job) => sum + (number(job.cost?.amount) || 0), 0),
  mode: text(candidate.mode || base.ccg_context?.mode || 'DRY_RUN').toUpperCase(),
  source: 'campaign-creative-executor',
  executor_endpoint: text(
    base.execution_handoff?.executor_endpoint ||
    base.executor_handoff?.executor_endpoint ||
    base.production_request?.executor_endpoint ||
    'n8n-env:CCG_EXECUTOR_BASE_URL'
  ),
  publish_allowed: false,
  publish_requested: false,
  external_calls: list(candidate.external_calls),
  storage_writes: list(candidate.storage_writes),
  checkpoint: object(candidate.checkpoint)
};
return [{
  json: {
    ...base,
    production_execution_results: execution,
    executor_handoff: {
      ...(base.executor_handoff || {}),
      execution_id: text(execution.execution_id),
      status: execution.status,
      checkpoint: execution.checkpoint,
      dispatch_completed: true,
      publish_allowed: false,
      publish_requested: false
    },
    next_module: 'CCG-90',
    status: 'DONE',
    module_status: 'DONE',
    output_type: 'CCG_MODULE_RESULT'
  },
  binary: item && item.binary
}];
`;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--input', '--output', '--error-output', '--fixtures-output', '--manifest-output', '--error-workflow-id'].includes(arg)) {
      const key = {
        '--input': 'input',
        '--output': 'output',
        '--error-output': 'errorOutput',
        '--fixtures-output': 'fixturesOutput',
        '--manifest-output': 'manifestOutput',
        '--error-workflow-id': 'errorWorkflowId',
      }[arg];
      result[key] = argv[++index];
    } else if (arg === '--allow-noncanonical-source') {
      result.allowNoncanonicalSource = true;
    }
  }
  return result;
}

function resolveErrorWorkflowId(value) {
  const id = String(value || ERROR_WORKFLOW_ID).trim();
  if (!id || id.length > 36 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('error workflow id must contain only letters, numbers, hyphens, or underscores and be at most 36 characters');
  }
  return id;
}

function nodeByName(nodes, name) {
  return nodes.find((node) => node.name === name);
}

const LANGCHAIN_MODEL_TYPE = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
const LANGCHAIN_STRUCTURED_PARSER_TYPE = '@n8n/n8n-nodes-langchain.outputParserStructured';

function hasTypedConnection(workflow, source, outputType, target, targetType = outputType) {
  const branches = workflow.connections?.[source]?.[outputType];
  return Array.isArray(branches) && branches.some((branch) => Array.isArray(branch)
    && branch.some((edge) => edge?.node === target && edge?.type === targetType));
}

function addTypedConnection(workflow, source, outputType, target, targetType = outputType, index = 0) {
  workflow.connections ||= {};
  workflow.connections[source] ||= {};
  workflow.connections[source][outputType] ||= [];
  const branches = workflow.connections[source][outputType];
  while (branches.length <= index) branches.push([]);
  if (!Array.isArray(branches[index])) branches[index] = [];
  if (!hasTypedConnection(workflow, source, outputType, target, targetType)) {
    branches[index].push({ node: target, type: targetType, index: 0 });
  }
}

function incomingTypedConnections(workflow, target, targetType) {
  const matches = [];
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    for (const [outputType, branches] of Object.entries(outputs || {})) {
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        for (const edge of Array.isArray(branch) ? branch : []) {
          if (edge?.node === target && edge?.type === targetType) {
            matches.push({ source, outputType, edge });
          }
        }
      }
    }
  }
  return matches;
}

function ensureStructuredParserModels(workflow) {
  const parsers = workflow.nodes.filter((node) => node.type === LANGCHAIN_STRUCTURED_PARSER_TYPE
    && node.parameters?.autoFix !== false);
  for (const parser of parsers) {
    const parserBranches = workflow.connections?.[parser.name]?.ai_outputParser;
    const parserAgents = (Array.isArray(parserBranches) ? parserBranches : [])
      .flatMap((branch) => Array.isArray(branch) ? branch : [])
      .filter((edge) => edge?.type === 'ai_outputParser' && edge?.node)
      .map((edge) => edge.node);
    for (const agentName of parserAgents) {
      const modelMatch = incomingTypedConnections(workflow, agentName, 'ai_languageModel')
        .find((match) => workflow.nodes.some((node) => node.name === match.source && node.type === LANGCHAIN_MODEL_TYPE));
      if (!modelMatch) continue;
      addTypedConnection(workflow, modelMatch.source, 'ai_languageModel', parser.name, 'ai_languageModel');
      break;
    }
  }
  return workflow;
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
  updated = updated.replace(
    "if (request.provider_policy?.publish_allowed === true) {\n  errors.push('CCG-80 não aceita publish_allowed=true.');\n}",
    "if (request.provider_policy?.publish_allowed === true || request.provider_policy?.publish_requested === true || data.posting_payload?.publish_allowed === true || data.posting_payload?.publish_requested === true) {\n  errors.push('CCG-80 não aceita flags de publicação habilitadas.');\n}",
  );
  updated = updated.replace(
    "  if (dispatchEnabled && !text(execution.adapter_orchestrator_workflow_id)) {\n    errors.push('dispatch_enabled=true exige adapter_orchestrator_workflow_id.');\n  }",
    "  if (dispatchEnabled && !text(execution.adapter_orchestrator_workflow_id)) {\n    warnings.push('dispatch_enabled usa o executor nativo CCG_EXECUTOR_BASE_URL.');\n  }",
  );
  updated = updated.replace(
    "if (dispatchEnabled && mode !== 'LIVE') {",
    "const maxRevisionsRaw = request.provider_policy?.max_revisions ?? request.production_execution?.max_revisions ?? data.module_outputs?.CCG_00?.intake_manifest?.limits?.max_revisions;\nconst maxRevisions = Number(maxRevisionsRaw);\nif (maxRevisionsRaw === undefined || maxRevisionsRaw === null || maxRevisionsRaw === '' || !Number.isFinite(maxRevisions) || maxRevisions < 0) {\n  errors.push('Execução exige max_revisions configurado.');\n}\nif (mode === 'LIVE') {\n  const maxCostRaw = request.provider_policy?.max_cost ?? request.production_execution?.max_cost ?? request.budget?.max_cost ?? data.module_outputs?.CCG_00?.intake_manifest?.limits?.max_cost;\n  const maxCost = Number(maxCostRaw);\n  if (maxCostRaw === undefined || maxCostRaw === null || maxCostRaw === '' || !Number.isFinite(maxCost) || maxCost < 0) errors.push('Execução LIVE exige max_cost configurado.');\n}\n\nif (dispatchEnabled && mode !== 'LIVE') {",
  );
  return updated;
}

function patchCcg80PrepareCode(code) {
  let updated = code;
  updated = replaceCode(
    updated,
    'const maximumJobs = Math.max(',
    'const brief = {',
    `const maxJobsRaw = request.provider_policy?.max_jobs ?? request.production_execution?.max_jobs ?? data.module_outputs?.CCG_00?.intake_manifest?.limits?.max_jobs ?? 120;
const maximumJobs = Math.max(1, Number.isFinite(Number(maxJobsRaw)) ? Number(maxJobsRaw) : 120);
const maxRevisionsRaw = request.provider_policy?.max_revisions ?? request.production_execution?.max_revisions ?? data.module_outputs?.CCG_00?.intake_manifest?.limits?.max_revisions ?? 0;
const maximumRevisions = Math.max(0, Number.isFinite(Number(maxRevisionsRaw)) ? Number(maxRevisionsRaw) : 0);
const maximumCostRaw = request.provider_policy?.max_cost ?? request.production_execution?.max_cost ?? request.budget?.max_cost ?? data.module_outputs?.CCG_00?.intake_manifest?.limits?.max_cost;
const maximumCostConfigured = maximumCostRaw !== undefined && maximumCostRaw !== null && maximumCostRaw !== '' && Number.isFinite(Number(maximumCostRaw));
const maximumCost = maximumCostConfigured ? Math.max(0, Number(maximumCostRaw)) : null;`,
  );
  updated = updated.replace(
    '    raw_job: job\n  };',
    `    raw_job: job,
    provider: text(job.provider || job.provider_id || job.selected_provider_id || job.selected_provider?.provider_id),
    provider_id: text(job.provider || job.provider_id || job.selected_provider_id || job.selected_provider?.provider_id),
    selected_model_id: text(job.selected_model_id || job.model_id),
    estimated_cost: Number.isFinite(Number(job.estimated_cost)) ? Number(job.estimated_cost) : null,
    max_revisions: Number.isFinite(Number(job.max_revisions)) ? Number(job.max_revisions) : null,
    expected_artifacts: list(job.expected_artifacts || job.artifact_expectations || job.outputs)
  };`,
  );
  updated = updated.replace(
    '  execution_policy: {\n    dispatch_requested:',
    `  execution_policy: {
    allowed_providers: [...allowedProviders],
    max_jobs: maximumJobs,
    max_revisions: maximumRevisions,
    max_cost: maximumCost,
    max_cost_configured: maximumCostConfigured,
    dispatch_requested:`,
  );
  return updated;
}

function patchCcg80FinalizeCode(code) {
  let updated = code;
  updated = updated.replace(
    '    status: dryRun ? \'PLANNED_DRY_RUN\' : \'READY_TO_DISPATCH\',',
    `    provider: text(selectedProvider?.provider_id, dryRun ? 'mock' : 'unresolved'),
    provider_id: text(selectedProvider?.provider_id, dryRun ? 'mock' : 'unresolved'),
    provider_job_id: '',
    capability,
    attempt: 0,
    attempts: 0,
    max_revisions: Number(job.max_revisions || brief.execution_policy?.max_revisions || 0),
    estimated_cost: Number(cost.amount || 0),
    expected_artifacts: list(job.expected_artifacts),
    status: dryRun ? 'PLANNED' : 'PLANNED',`,
  );
  updated = updated.replace(
    'const maximumCost = Number(brief.execution_policy?.maximum_cost || 0);',
    `const maximumJobs = Number(brief.execution_policy?.max_jobs || brief.execution_policy?.maximum_jobs || 0);
const maximumRevisions = Number(brief.execution_policy?.max_revisions || 0);
const maximumCostConfigured = brief.execution_policy?.max_cost_configured === true || (brief.execution_policy?.maximum_cost !== undefined && brief.execution_policy?.maximum_cost !== null);
const maximumCost = maximumCostConfigured ? Number(brief.execution_policy?.max_cost ?? brief.execution_policy?.maximum_cost) : null;`,
  );
  updated = updated.replace(
    `    require_human_approval: brief.execution_policy?.require_human_approval !== false,
    publish_allowed: false`,
    `    allowed_providers: list(brief.execution_policy?.allowed_providers || brief.allowed_provider_ids),
    max_jobs: maximumJobs,
    max_revisions: maximumRevisions,
    max_cost: maximumCost,
    max_cost_configured: maximumCostConfigured,
    require_human_approval: brief.execution_policy?.require_human_approval !== false,
    publish_allowed: false,
    publish_requested: false`,
  );
  updated = updated.replace(
    '    maximum_cost: maximumCost,\n    estimated_known_cost:',
    '    max_cost: maximumCost,\n    maximum_cost: maximumCost,\n    max_cost_configured: maximumCostConfigured,\n    max_jobs: maximumJobs,\n    max_revisions: maximumRevisions,\n    estimated_known_cost:',
  );
  updated = updated.replace(
    '    within_known_budget: maximumCost <= 0 || knownCosts <= maximumCost + 1e-9',
    '    within_known_budget: !maximumCostConfigured || knownCosts <= maximumCost + 1e-9',
  );
  updated = updated.replace(
    "['FINAL_RENDER', 'AUDIO', 'VISUAL_GENERATION', 'VISUAL_COMPOSITION']",
    "['ASSET_RETRIEVAL', 'FINAL_RENDER', 'AUDIO', 'VISUAL_GENERATION', 'VISUAL_COMPOSITION']",
  );
  updated = updated.replace(
    "blocking_failure_statuses: ['FAILED_BLOCKING', 'CANCELLED', 'POLICY_BLOCKED'],",
    "blocking_failure_statuses: ['FAILED', 'FAILED_BLOCKING', 'CANCELLED', 'POLICY_BLOCKED', 'NEEDS_REVIEW'],",
  );
  return updated;
}

function patchCcg90Validator(code) {
  let updated = code;
  updated = updated.replace(
    "if (!['READY', 'NEEDS_REVIEW'].includes(text(manifest?.status))) {",
    "if (!['READY', 'NEEDS_REVIEW', 'BLOCKED'].includes(text(manifest?.status))) {",
  );
  updated = updated.replace(
    "if (!['PROCEED', 'PROCEED_WITH_GUARDRAILS'].includes(text(manifest?.routing_decision))) {",
    "if (!['PROCEED', 'PROCEED_WITH_GUARDRAILS', 'HOLD_FOR_REVIEW'].includes(text(manifest?.routing_decision))) {",
  );
  updated = updated.replace(
    "if (list(manifest?.review?.hard_blockers).length) {\n  errors.push(`CCG-80 possui bloqueadores críticos: ${list(manifest.review.hard_blockers).join(', ')}.`);\n}",
    "if (list(manifest?.review?.hard_blockers).length) {\n  warnings.push(`CCG-80 bloqueadores serão selados no CONTENT_PACKAGE: ${list(manifest.review.hard_blockers).join(', ')}.`);\n}",
  );
  updated = updated.replace(
    'const resultIds = new Set();',
    "const resultIds = new Set();\nconst allowedProviders = new Set(list(manifest?.allowed_providers || manifest?.execution_policy?.allowed_providers || request.provider_policy?.allowed_providers).map((value) => text(value)));\nconst executionStatus = text(execution?.status).toUpperCase();\nif (!['PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW', 'BLOCKED'].includes(executionStatus)) warnings.push('production_execution_results.status não foi normalizado pelo executor.');",
  );
  updated = updated.replace(
    "  if (!jobIds.has(id)) warnings.push(`Resultado recebido para job desconhecido: ${id}.`);",
    "  if (!jobIds.has(id)) warnings.push(`Resultado recebido para job desconhecido: ${id}.`);\n  if (allowedProviders.size && result.provider && !allowedProviders.has(text(result.provider))) errors.push(`Provider fora da allowlist no resultado: ${text(result.provider)}.`);\n  if (!['PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW'].includes(text(result.status).toUpperCase())) errors.push(`Status de execução inválido para ${id}: ${text(result.status)}.`);",
  );
  return updated;
}

function patchCcg90PrepareCode(code) {
  let updated = code;
  updated = replaceCode(updated, 'if (dryRun && !list(execution.jobs).length) {', '\nconst moduleRegistry = [];', '');
  updated = updated.replace(
    '  provider_id: text(result.provider_id),\n  model_id: text(result.model_id),',
    '  provider: text(result.provider || result.provider_id),\n  provider_id: text(result.provider || result.provider_id),\n  model_id: text(result.model_id),\n  provider_job_id: text(result.provider_job_id || result.provider_receipt_id || result.provider_receipt),',
  );
  updated = updated.replace(
    '  attempts: Number(result.attempts || 0),',
    '  attempt: Number(result.attempt || result.attempts || 0),\n  attempts: Number(result.attempts || result.attempt || 0),',
  );
  updated = updated.replace(
    '  provider_receipt_id: text(result.provider_receipt_id || result.execution_receipt_id),\n  artifacts: list(result.artifacts),',
    `  provider_receipt_id: text(result.provider_receipt_id || result.provider_job_id || result.execution_receipt_id || result.provider_receipt),
  artifact_uri: text(result.artifact_uri || result.artifacts?.[0]?.artifact_uri || result.artifacts?.[0]?.uri),
  preview_uri: text(result.preview_uri || result.artifacts?.[0]?.preview_uri || result.artifacts?.[0]?.artifact_uri || result.artifacts?.[0]?.uri),
  mime_type: text(result.mime_type || result.artifacts?.[0]?.mime_type),
  width: Number(result.width || result.artifacts?.[0]?.width || 0) || null,
  height: Number(result.height || result.artifacts?.[0]?.height || 0) || null,
  duration_seconds: Number(result.duration_seconds || result.artifacts?.[0]?.duration_seconds || 0) || null,
  file_size: Number(result.file_size || result.artifacts?.[0]?.file_size || result.artifacts?.[0]?.file_size_bytes || 0) || null,
  sha256: text(result.sha256 || result.artifacts?.[0]?.sha256 || result.artifacts?.[0]?.checksum?.value),
  artifacts: list(result.artifacts).map((artifact) => {
    const value = obj(artifact);
    const checksum = obj(value.checksum);
    const metadata = { ...obj(value.metadata), width: value.width ?? value.dimensions?.width, height: value.height ?? value.dimensions?.height, duration_seconds: value.duration_seconds ?? value.duration, mime_type: value.mime_type || value.mimeType };
    return {
      ...value,
      artifact_id: text(value.artifact_id || value.id),
      artifact_key: text(value.artifact_key || value.key),
      uri: text(value.uri || value.artifact_uri),
      artifact_uri: text(value.artifact_uri || value.uri),
      preview_uri: text(value.preview_uri || value.artifact_uri || value.uri),
      mime_type: text(value.mime_type || value.mimeType),
      file_size_bytes: Number(value.file_size_bytes || value.file_size || value.size || 0),
      checksum: { ...checksum, algorithm: text(checksum.algorithm || 'SHA-256'), value: text(checksum.value || value.sha256), simulated: checksum.simulated === true || value.simulated === true },
      metadata,
    };
  }),`,
  );
  updated = updated.replace(
    '  execution_id: text(execution.execution_id),',
    '  execution_id: text(execution.execution_id),\n    execution_status: text(execution.status).toUpperCase(),',
  );
  updated = updated.replace(
    '    totals: obj(execution.totals)',
    "    totals: { ...obj(execution.totals), cost: Number(execution.total_cost || execution.cost?.amount || execution.totals?.cost || 0), currency: text(execution.currency, manifest.budget?.currency || 'USD') },\n    checkpoint: obj(execution.checkpoint),\n    receipts: list(execution.receipts)",
  );
  updated = updated.replace(
    ": ['FAILED_BLOCKING', 'CANCELLED', 'POLICY_BLOCKED']),",
    ": ['FAILED', 'FAILED_BLOCKING', 'CANCELLED', 'POLICY_BLOCKED', 'NEEDS_REVIEW']),",
  );
  return updated;
}

function patchCcg90FinalizeCode(code) {
  let updated = code;
  updated = updated.replace(
    "return ['FAIL', 'FAILED', 'REJECTED', 'BLOCKED', 'FAILED_BLOCKING', 'POLICY_BLOCKED', 'CANCELLED'].includes(text(value).toUpperCase());",
    "return ['FAIL', 'FAILED', 'REJECTED', 'BLOCKED', 'FAILED_BLOCKING', 'POLICY_BLOCKED', 'CANCELLED', 'NEEDS_REVIEW'].includes(text(value).toUpperCase());",
  );
  updated = updated.replace(
    'const awaitingExecution = !dryRun && noResults;',
    "let executionPending = ['PLANNED', 'RUNNING'].includes(text(brief.execution?.execution_status || brief.execution?.status).toUpperCase());\nconst executionStatus = text(brief.execution?.execution_status || brief.execution?.status).toUpperCase();\nconst awaitingExecution = !dryRun && (noResults || executionPending);",
  );
  updated = updated.replace(
    '  if (result && !complete && !blocking) {',
    "  if (result && ['PLANNED', 'RUNNING'].includes(status)) executionPending = true;\n  if (result && !complete && !blocking && !['PLANNED', 'RUNNING'].includes(status)) {",
  );
  updated = updated.replace(
    '    provider_id: text(result?.provider_id),\n    model_id: text(result?.model_id),',
    '    provider: text(result?.provider || result?.provider_id),\n    provider_id: text(result?.provider || result?.provider_id),\n    provider_job_id: text(result?.provider_job_id || result?.provider_receipt_id),\n    model_id: text(result?.model_id),',
  );
  updated = updated.replace(
    '    attempts: Number(result?.attempts || 0),',
    '    attempt: Number(result?.attempt || result?.attempts || 0),\n    attempts: Number(result?.attempts || result?.attempt || 0),',
  );
  updated = updated.replace(
    '    provider_receipt_id: text(result?.provider_receipt_id),',
    '    provider_receipt_id: text(result?.provider_receipt_id || result?.provider_job_id),\n    started_at: text(result?.started_at),\n    finished_at: text(result?.finished_at),',
  );
  updated = updated.replace(
    'const maximumCost = Number(brief.production_manifest?.budget?.maximum_cost || 0);',
    "const maximumCostConfigured = brief.production_manifest?.budget?.max_cost_configured === true || (brief.production_manifest?.budget?.maximum_cost !== undefined && brief.production_manifest?.budget?.maximum_cost !== null);\nconst maximumCost = maximumCostConfigured ? Number(brief.production_manifest?.budget?.max_cost ?? brief.production_manifest?.budget?.maximum_cost) : null;\nconst executorTotalCost = Number(brief.execution?.totals?.cost ?? actualCosts);",
  );
  updated = updated.replace(
    'if (maximumCost > 0 && actualCosts > maximumCost + 1e-9) {',
    'if (maximumCostConfigured && executorTotalCost > maximumCost + 1e-9) {',
  );
  updated = updated.replace(
    '  if (artifact && expectation.checksum_required && !checksumValid) {',
    "  if (artifact && (artifact.checksum_valid === false || (artifact.sha256 && checksum.value && artifact.sha256 !== checksum.value))) hardBlockers.push(`CHECKSUM_DIVERGENCE:${text(expectation.artifact_key)}`);\n  if (artifact && expectation.checksum_required && !checksumValid) {",
  );
  updated = updated.replace(
    'const corePackage = {',
    "const corePackage = {\n  execution_status: executionStatus || (dryRun ? 'COMPLETED' : 'PLANNED'),",
  );
  updated = updated.replace(
    '    totals: obj(brief.execution?.totals)',
    "    totals: { ...obj(brief.execution?.totals), cost: executorTotalCost, currency: text(brief.execution?.currency || 'USD') },\n    receipts: list(brief.execution?.receipts),\n    checkpoint: obj(brief.execution?.checkpoint)",
  );
  updated = updated.replace('actual_cost: Number(actualCosts.toFixed(6)),', 'actual_cost: Number(executorTotalCost.toFixed(6)),');
  updated = updated.replace('within_budget: maximumCost <= 0 || actualCosts <= maximumCost + 1e-9,', 'within_budget: !maximumCostConfigured || executorTotalCost <= maximumCost + 1e-9,');
  return updated;
}

function patchCcg99NormalizeCode(code) {
  let updated = code;
  updated = updated.replace(
    'const failedJobId = text(',
    `const productionExecution = obj(raw.production_execution_results || raw.data?.production_execution_results || envelope.production_execution_results || raw.execution_results);
const executorHandoff = obj(raw.executor_handoff || raw.data?.executor_handoff || envelope.executor_handoff);
const executorCheckpoint = obj(productionExecution.checkpoint || executorHandoff.checkpoint || context.checkpoint);
const productionJobId = text(context.failed_job_id || productionExecution.failed_job_id || productionExecution.failed_job?.job_id || executorHandoff.failed_job_id);
const executionJobEvidence = list(productionExecution.jobs || productionExecution.results).find((job) => text(job?.job_id) === productionJobId) || {};
const providerJobId = text(productionExecution.provider_job_id || productionExecution.failed_job?.provider_job_id || executionJobEvidence.provider_job_id || executorHandoff.provider_job_id);
const executorExecutionId = text(productionExecution.execution_id || executorHandoff.execution_id || executorCheckpoint.execution_id);
const failedJobId = text(`,
  );
  updated = updated.replace(
    '  context.failed_job_id ||',
    '  productionJobId ||\n  context.failed_job_id ||',
  );
  updated = updated.replace(
    "    failed_job_id: failedJobId\n  },",
    "    failed_job_id: failedJobId,\n    provider_job_id: providerJobId,\n    executor_execution_id: executorExecutionId,\n    execution_status: text(productionExecution.status),\n    checkpoint_id: text(executorCheckpoint.execution_id || context.checkpoint_id)\n  },",
  );
  updated = updated.replace(
    '    previous_checkpoint_id: text(context.checkpoint_id),\n    failed_job_id: failedJobId,',
    "    previous_checkpoint_id: text(context.checkpoint_id || executorCheckpoint.execution_id),\n    checkpoint_id: text(executorCheckpoint.execution_id || context.checkpoint_id),\n    executor_execution_id: executorExecutionId,\n    provider_job_id: providerJobId,\n    failed_job_id: failedJobId,\n    executor_checkpoint: executorCheckpoint,\n    production_execution_results: productionExecution,",
  );
  updated = updated.replace(
    '    input_has_binary: Boolean(item.binary && Object.keys(item.binary).length)\n  }',
    "    input_has_binary: Boolean(item.binary && Object.keys(item.binary).length),\n    executor_execution_id: executorExecutionId,\n    checkpoint_id: text(executorCheckpoint.execution_id),\n    provider_job_id: providerJobId\n  }",
  );
  return updated;
}

function patchCcg99ClassifyCode(code) {
  let updated = code;
  updated = updated.replace(
    "patterns: [/\\b429\\b/, /rate limit/, /too many requests/, /throttl/]",
    "patterns: [/\\b429\\b/, /rate[_ -]?limit/, /executor.*429/, /too many requests/, /throttl/]",
  );
  updated = updated.replace(
    "patterns: [/awaiting execution/, /missing job result/, /missing artifact/, /missing provider receipt/, /execution results?/]",
    "patterns: [/awaiting execution/, /missing job result/, /missing artifact/, /missing provider receipt/, /checksum/, /artifact.*(?:absent|missing|diverg)/, /execution results?/]",
  );
  updated = updated.replace(
    "    failed_job_id: text(source.failed_job_id || recovery.failed_job_id),\n    retry_scope:",
    "    failed_job_id: text(source.failed_job_id || recovery.failed_job_id),\n    provider_job_id: text(source.provider_job_id || recovery.provider_job_id),\n    executor_execution_id: text(source.executor_execution_id || recovery.executor_execution_id),\n    checkpoint_id: text(source.checkpoint_id || recovery.checkpoint_id),\n    retry_scope:",
  );
  return updated;
}

function patchCcg99RetryHandoffCode(code) {
  let updated = code;
  updated = updated.replace(
    '      maximum_attempts: decision.attempts?.maximum,',
    "      maximum_attempts: decision.attempts?.maximum,\n      failed_job_id: decision.recovery_scope?.failed_job_id || recovery.failed_job_id || '',\n      provider_job_id: decision.recovery_scope?.provider_job_id || recovery.provider_job_id || '',\n      executor_execution_id: decision.recovery_scope?.executor_execution_id || recovery.executor_execution_id || '',\n      checkpoint_id: decision.recovery_scope?.checkpoint_id || recovery.checkpoint_id || '',",
  );
  updated = updated.replace(
    '      dispatcher_contract: {',
    "      executor_checkpoint: {\n        execution_id: recovery.executor_execution_id || '',\n        checkpoint_id: recovery.checkpoint_id || '',\n        failed_job_id: recovery.failed_job_id || '',\n        provider_job_id: recovery.provider_job_id || ''\n      },\n      dispatcher_contract: {",
  );
  return updated;
}

function patchCcg99ResumeHandoffCode(code) {
  let updated = code;
  updated = updated.replace(
    "      previous_checkpoint_id: recovery.previous_checkpoint_id || '',",
    "      previous_checkpoint_id: recovery.previous_checkpoint_id || recovery.checkpoint_id || '',\n      executor_execution_id: recovery.executor_execution_id || '',\n      provider_job_id: recovery.provider_job_id || '',\n      executor_checkpoint: recovery.executor_checkpoint || {},",
  );
  updated = updated.replace(
    "        'execution_results_or_adapter_receipts',",
    "        'production_execution_results_or_executor_checkpoint',\n        'execution_results_or_adapter_receipts',",
  );
  return updated;
}

function patchCcg99FinalizeCode(code) {
  let updated = code;
  updated = updated.replace(
    '    input_has_binary: event.raw_evidence?.input_has_binary === true\n  }',
    "    input_has_binary: event.raw_evidence?.input_has_binary === true,\n    executor_execution_id: text(event.source?.executor_execution_id || event.recovery_context?.executor_execution_id),\n    checkpoint_id: text(event.source?.checkpoint_id || event.recovery_context?.checkpoint_id),\n    provider_job_id: text(event.source?.provider_job_id || event.recovery_context?.provider_job_id),\n    failed_job_id: text(event.source?.failed_job_id || event.recovery_context?.failed_job_id)\n  }",
  );
  updated = updated.replace(
    '    next_attempt: decision.attempts?.next_attempt\n  }',
    "    next_attempt: decision.attempts?.next_attempt,\n    executor_execution_id: text(event.recovery_context?.executor_execution_id),\n    checkpoint_id: text(event.recovery_context?.checkpoint_id),\n    provider_job_id: text(event.recovery_context?.provider_job_id)\n  }",
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
  const ccg80Prepare = nodeByName(workflow.nodes, 'CCG-80 Prepare Production Planning Brief');
  if (ccg80Prepare?.parameters && typeof ccg80Prepare.parameters.jsCode === 'string') {
    ccg80Prepare.parameters.jsCode = patchCcg80PrepareCode(ccg80Prepare.parameters.jsCode);
  }
  const ccg80Finalize = nodeByName(workflow.nodes, 'CCG-80 Finalize & Guardrail Production Manifest');
  if (ccg80Finalize?.parameters && typeof ccg80Finalize.parameters.jsCode === 'string') {
    ccg80Finalize.parameters.jsCode = patchCcg80FinalizeCode(ccg80Finalize.parameters.jsCode);
  }
  const ccg90Validator = nodeByName(workflow.nodes, 'CCG-90 Validate CCG-80 Input');
  if (ccg90Validator?.parameters && typeof ccg90Validator.parameters.jsCode === 'string') {
    ccg90Validator.parameters.jsCode = patchCcg90Validator(ccg90Validator.parameters.jsCode);
  }
  const ccg90Prepare = nodeByName(workflow.nodes, 'CCG-90 Prepare Evidence & Package Brief');
  if (ccg90Prepare?.parameters && typeof ccg90Prepare.parameters.jsCode === 'string') {
    ccg90Prepare.parameters.jsCode = patchCcg90PrepareCode(ccg90Prepare.parameters.jsCode);
  }
  const ccg90Finalize = nodeByName(workflow.nodes, 'CCG-90 Finalize & Seal Content Package');
  if (ccg90Finalize?.parameters && typeof ccg90Finalize.parameters.jsCode === 'string') {
    ccg90Finalize.parameters.jsCode = patchCcg90FinalizeCode(ccg90Finalize.parameters.jsCode);
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

function patchErrorWorkflow(workflow) {
  const patches = new Map([
    ['CCG-99 Normalize & Redact Error Event', patchCcg99NormalizeCode],
    ['CCG-99 Classify & Decide Recovery', patchCcg99ClassifyCode],
    ['CCG-99 Build Retry Handoff', patchCcg99RetryHandoffCode],
    ['CCG-99 Build Resume Handoff', patchCcg99ResumeHandoffCode],
    ['CCG-99 Finalize Incident & Ledger', patchCcg99FinalizeCode],
  ]);
  for (const node of workflow.nodes) {
    const patch = patches.get(node.name);
    if (patch && node.parameters && typeof node.parameters.jsCode === 'string') {
      node.parameters.jsCode = patch(node.parameters.jsCode);
    }
  }
  workflow.meta = {
    ...(workflow.meta || {}),
    executor_contract: 'v1',
    checkpoint_resume: true,
    idempotent_retry: true,
  };
  return workflow;
}

function buildErrorWorkflow(source, options = {}) {
  const errorWorkflowId = resolveErrorWorkflowId(options.errorWorkflowId);
  const reachable = reachableNodeNames(source, 'Error Trigger');
  const allowedNames = ERROR_HANDLER_NODE_NAMES.filter((name) => reachable.has(name) || name === 'Error Trigger');
  const nodes = source.nodes.filter((node) => allowedNames.includes(node.name));
  if (!nodes.some((node) => node.name === 'Error Trigger')) {
    throw new Error('Cannot build error workflow without Error Trigger');
  }
  const handler = {
    id: errorWorkflowId,
    name: ERROR_WORKFLOW_NAME,
    active: false,
    nodes,
    connections: connectionsForNodes(source, new Set(nodes.map((node) => node.name))),
    settings: { ...(source.settings || {}) },
    meta: {
      codex_builder: 'campaign-creative-creator-continuous',
      codex_builder_version: BUILDER_VERSION,
      architecture: 'separate-error-workflow-with-executor-recovery',
      source_workflow_id: WORKFLOW_ID,
      no_publication: true,
      recovery_handoffs: ['retry', 'resume', 'review', 'termination'],
    },
  };
  delete handler.settings.errorWorkflow;
  delete handler.versionId;
  return patchErrorWorkflow(handler);
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
  const errorWorkflowId = resolveErrorWorkflowId(options.errorWorkflowId);
  const sourceSha256 = options.sourceSha256 || sha256(Buffer.from(JSON.stringify(source)));
  const errorHandler = transformForOutput(buildErrorWorkflow(source, { ...options, errorWorkflowId }));
  const main = transformForOutput(transformWorkflow(source, { ...options, errorWorkflowId }));
  const fixtures = transformForOutput(buildFixturesWorkflow(source));
  const manifest = {
    package_version: '4.0.0',
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
      error_workflow_id: errorWorkflowId,
      operational_trigger: 'executeWorkflowTrigger',
      final_output_type: 'CONTENT_PACKAGE',
      credentials_stripped_for_git: true,
      executor_endpoint: 'CCG_EXECUTOR_BASE_URL',
      executor_contract: 'v1',
      no_paid_calls_in_ci: true,
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

function executionPolicyNode(position) {
  return {
    parameters: { mode: 'runOnceForAllItems', jsCode: EXECUTION_POLICY_CODE },
    id: 'ccg-80-execution-policy',
    name: 'CCG-80 Validate Execution Policy',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function executionAllowedNode(position) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'ccg-80-execution-allowed-condition',
          leftValue: '={{ $json.executor_dispatch_allowed }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals', name: 'filter.operator.equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'ccg-80-execution-allowed',
    name: 'CCG-80 Execution Allowed?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position,
  };
}

function executorHeaders() {
  return {
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: "={{ $env.CCG_EXECUTOR_AUTH_TOKEN ? 'Bearer ' + $env.CCG_EXECUTOR_AUTH_TOKEN : '' }}" },
        { name: 'Content-Type', value: 'application/json' },
      ],
    },
  };
}

function executionDispatchNode(position) {
  return {
    parameters: {
      method: 'POST',
      url: "={{ ($env.CCG_EXECUTOR_BASE_URL || 'http://127.0.0.1:8790') + '/v1/production-manifests' }}",
      ...executorHeaders(),
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={{ JSON.stringify($json.executor_request) }}',
      options: { timeout: 120000 },
    },
    id: 'ccg-80-dispatch-production-manifest',
    name: 'CCG-80 Dispatch Production Manifest',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  };
}

function executionPollNode(position) {
  return {
    parameters: {
      method: 'GET',
      url: "={{ ($env.CCG_EXECUTOR_BASE_URL || 'http://127.0.0.1:8790') + '/v1/production-manifests/' + encodeURIComponent($json.execution_id || $json.production_execution_results?.execution_id || '') }}",
      ...executorHeaders(),
      options: { timeout: 120000 },
    },
    id: 'ccg-80-poll-production-manifest',
    name: 'CCG-80 Poll Production Manifest',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  };
}

function executionNormalizerNode(position) {
  return {
    parameters: { mode: 'runOnceForAllItems', jsCode: EXECUTION_NORMALIZER_CODE },
    id: 'ccg-80-normalize-execution-results',
    name: 'CCG-80 Normalize Execution Results',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function addExecutionNodes(workflow) {
  workflow.nodes.push(
    executionPolicyNode([15456, 920]),
    executionAllowedNode([15696, 920]),
    executionDispatchNode([15936, 800]),
    executionPollNode([16176, 800]),
    executionNormalizerNode([16416, 920]),
  );
}

function transformWorkflow(source, options = {}) {
  assertSourceShape(source, options);
  const workflow = JSON.parse(JSON.stringify(source));
  workflow.connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
  removeNodesAndEdges(workflow, [...INTERMEDIATE_FIXTURES, 'Build CCG-99 retryable fixture']);
  patchUnsafeRuntime(workflow);
  ensureStructuredParserModels(workflow);

  workflow.nodes.push({
    // n8n 2.8 validates the Execute Workflow Trigger's default input schema
    // before starting a child execution. The operational contract already
    // carries its own versioned envelope, so pass that envelope through
    // unchanged instead of forcing the trigger to maintain a second schema.
    parameters: { inputSource: 'passthrough' },
    id: 'ccg-operational-request-trigger',
    name: 'Operational Production Request',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [-608, 180],
  });
  addOptionalNodes(workflow);
  addExecutionNodes(workflow);

  replaceMainEdge(workflow, 'Operational Production Request', 'CCG-00 Parse & Normalize');
  replaceMainEdge(workflow, 'CCG-00 Return Module Result', 'CCG-10 Validate CCG-00 Input');
  replaceMainEdge(workflow, 'CCG-10 Return Module Result', 'CCG-20 Validate CCG-10 Input');
  replaceMainEdge(workflow, 'CCG-20 Return Module Result', 'CCG-30 Validate CCG-20 Input');
  replaceMainEdge(workflow, 'CCG-30 Return Module Result', 'CCG-40 Validate CCG-30 Input');
  replaceMainEdge(workflow, 'CCG-40 Return Module Result', 'CCG-50 Validate CCG-40 Input');
  replaceMainEdge(workflow, 'CCG-50 Return Module Result', 'CCG-60 Validate CCG-50 Input');
  replaceMainEdge(workflow, 'CCG-60 Return Module Result', 'CCG-70 Validate CCG-60 Input');
  replaceMainEdge(workflow, 'CCG-70 Return Module Result', 'CCG-80 Validate CCG-70 Input');
  replaceMainEdge(workflow, 'CCG-80 Return Module Result', 'CCG-80 Validate Execution Policy');
  workflow.connections['CCG-80 Validate Execution Policy'] = {
    main: [[{ node: 'CCG-80 Execution Allowed?', type: 'main', index: 0 }]],
  };
  workflow.connections['CCG-80 Execution Allowed?'] = {
    main: [
      [{ node: 'CCG-80 Dispatch Production Manifest', type: 'main', index: 0 }],
      [{ node: 'CCG-80 Normalize Execution Results', type: 'main', index: 0 }],
    ],
  };
  workflow.connections['CCG-80 Dispatch Production Manifest'] = {
    main: [[{ node: 'CCG-80 Poll Production Manifest', type: 'main', index: 0 }]],
  };
  workflow.connections['CCG-80 Poll Production Manifest'] = {
    main: [[{ node: 'CCG-80 Normalize Execution Results', type: 'main', index: 0 }]],
  };
  workflow.connections['CCG-80 Normalize Execution Results'] = {
    main: [[{ node: 'CCG-90 Validate CCG-80 Input', type: 'main', index: 0 }]],
  };

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
    errorWorkflow: resolveErrorWorkflowId(options.errorWorkflowId),
  };
  workflow.meta = {
    ...(workflow.meta || {}),
    codex_builder: 'campaign-creative-creator-continuous',
    codex_builder_version: BUILDER_VERSION,
    architecture: 'continuous-with-native-production-executor-and-separate-error-workflow',
    source_workflow_id: WORKFLOW_ID,
    source_version_id: source.versionId || (source.meta && source.meta.source_version_id) || null,
    no_publication: true,
    error_workflow_id: resolveErrorWorkflowId(options.errorWorkflowId),
    fixtures_catalog: 'Campaign Creative Creator - Module Fixtures',
    live_provider_adapter: 'campaign-creative-executor-registry',
    executor_endpoint: 'CCG_EXECUTOR_BASE_URL',
    executor_contract: 'v1',
  };
  delete workflow.versionId;
  return workflow;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input || process.env.CCG_SOURCE_FILE;
  const outputPath = args.output || process.env.CCG_OUTPUT_FILE;
  if (!inputPath || !outputPath) {
    throw new Error('Usage: build... --input <export.json> --output <candidate.json> [--error-output <error.json> --fixtures-output <fixtures.json> --manifest-output <manifest.json> --error-workflow-id <n8n-id>]');
  }
  const sourceBuffer = fs.readFileSync(path.resolve(inputPath));
  const source = JSON.parse(sourceBuffer.toString('utf8').replace(/^\uFEFF/, ''));
  const outputDirectory = path.dirname(path.resolve(outputPath));
  const packageValue = buildWorkflowPackage(source, {
    allowNoncanonicalSource: args.allowNoncanonicalSource,
    errorWorkflowId: args.errorWorkflowId,
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
  ensureStructuredParserModels,
  optionalSkipCode,
  sanitizeWorkflow,
  transformWorkflow,
};
