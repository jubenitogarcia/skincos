'use strict';

const crypto = require('crypto');

const CAPABILITIES = Object.freeze([
  'asset_retrieval',
  'image_generation',
  'video_generation',
  'image_sequence',
  'text_to_speech',
  'music_generation',
  'caption_generation',
  'image_composition',
  'audio_mix',
  'still_frame_rendering',
  'temporal_video_rendering',
  'artifact_storage',
]);

const TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'FAILED', 'NEEDS_REVIEW']);
const NON_TERMINAL_STATUSES = Object.freeze(['PLANNED', 'RUNNING']);

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
  return Array.from(new Set(list(values).map(text).filter(Boolean)));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .reduce((result, key) => {
        result[key] = canonical(value[key]);
        return result;
      }, {});
  }
  return value;
}

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(canonical(value)));
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stableId(prefix, value) {
  return `${text(prefix) || 'id'}-${sha256(value).slice(0, 24)}`;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normaliseCapability(value) {
  const raw = text(value).toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    ASSET_RETRIEVAL: 'asset_retrieval',
    RETRIEVAL: 'asset_retrieval',
    VISUAL_GENERATION: 'image_generation',
    IMAGE_GENERATION: 'image_generation',
    IMAGE: 'image_generation',
    VIDEO_GENERATION: 'video_generation',
    VIDEO: 'video_generation',
    IMAGE_SEQUENCE: 'image_sequence',
    SEQUENCE_GENERATION: 'image_sequence',
    TEXT_TO_SPEECH: 'text_to_speech',
    TTS: 'text_to_speech',
    MUSIC_GENERATION: 'music_generation',
    MUSIC: 'music_generation',
    CAPTION_GENERATION: 'caption_generation',
    CAPTIONS: 'caption_generation',
    VISUAL_COMPOSITION: 'image_composition',
    IMAGE_COMPOSITION: 'image_composition',
    COMPOSITION: 'image_composition',
    AUDIO_MIX: 'audio_mix',
    STILL_FRAME_RENDERING: 'still_frame_rendering',
    STILL_RENDER: 'still_frame_rendering',
    FINAL_RENDER: 'still_frame_rendering',
    TEMPORAL_VIDEO_RENDERING: 'temporal_video_rendering',
    VIDEO_RENDER: 'temporal_video_rendering',
    ARTIFACT_STORAGE: 'artifact_storage',
    STORAGE: 'artifact_storage',
  };
  return aliases[raw] || (CAPABILITIES.includes(value) ? value : '');
}

function inferCapability(job) {
  const candidate = object(job);
  const direct = normaliseCapability(firstDefined(candidate.capability, candidate.capability_id, candidate.provider_capability, candidate.job_type, candidate.type));
  if (direct) return direct;
  const category = text(candidate.category).toUpperCase();
  if (category === 'AUDIO') {
    const audioType = text(candidate.audio_type || candidate.kind).toUpperCase();
    if (audioType.includes('MUSIC')) return 'music_generation';
    if (audioType.includes('VOICE') || audioType.includes('SPEECH') || audioType.includes('TTS')) return 'text_to_speech';
    if (audioType.includes('MIX')) return 'audio_mix';
  }
  if (category === 'FINAL_RENDER') {
    const modality = text(candidate.modality || candidate.output_type || candidate.content_type).toUpperCase();
    return modality.includes('VIDEO') ? 'temporal_video_rendering' : 'still_frame_rendering';
  }
  if (category === 'VISUAL_COMPOSITION') return 'image_composition';
  if (category === 'VISUAL_GENERATION') {
    const modality = text(candidate.modality || candidate.output_type || candidate.content_type).toUpperCase();
    return modality.includes('VIDEO') ? 'video_generation' : 'image_generation';
  }
  if (category === 'ASSET_RETRIEVAL') return 'asset_retrieval';
  return '';
}

function artifactExpectation(value, index) {
  const candidate = object(value);
  const key = text(firstDefined(candidate.artifact_key, candidate.key, candidate.id, candidate.type, `artifact-${index + 1}`));
  const expectedOutput = object(candidate.expected_output_spec || candidate.output_spec || candidate.spec);
  const dimensions = object(candidate.dimensions || expectedOutput.dimensions);
  return {
    artifact_key: key,
    mime_type: text(firstDefined(candidate.mime_type, candidate.mimeType, candidate.content_type, expectedOutput.mime_type, expectedOutput.container ? `image/${expectedOutput.container}` : 'application/octet-stream')),
    width: numberOrNull(firstDefined(candidate.width, dimensions.width, expectedOutput.width)),
    height: numberOrNull(firstDefined(candidate.height, dimensions.height, expectedOutput.height)),
    duration_seconds: numberOrNull(firstDefined(candidate.duration_seconds, candidate.duration, expectedOutput.duration_seconds)),
    checksum_required: candidate.checksum_required !== false,
    metadata_required: candidate.metadata_required !== false,
    preview: candidate.preview === true,
  };
}

function expectedArtifacts(job) {
  const candidate = object(job);
  const values = list(firstDefined(candidate.expected_artifacts, candidate.artifact_expectations, candidate.outputs));
  return values.length ? values.map(artifactExpectation) : [artifactExpectation({ artifact_key: 'primary' }, 0)];
}

function normalizeJob(job, index) {
  const candidate = object(job);
  const jobId = text(firstDefined(candidate.job_id, candidate.id, `job-${index + 1}`));
  const provider = text(firstDefined(candidate.provider, candidate.provider_id, candidate.selected_provider_id, object(candidate.selected_provider).provider_id, candidate.adapter, 'mock'));
  const dependencyValues = firstDefined(candidate.dependencies, candidate.depends_on, candidate.dependsOn, candidate.prerequisites);
  const revision = numberOrNull(firstDefined(candidate.revision, candidate.revision_number)) || 0;
  return {
    ...candidate,
    job_id: jobId,
    capability: inferCapability(candidate) || 'asset_retrieval',
    provider,
    provider_id: provider,
    dependencies: unique(dependencyValues),
    expected_artifacts: expectedArtifacts(candidate),
    revision,
    max_revisions: numberOrNull(firstDefined(candidate.max_revisions, candidate.revision_limit)),
    max_attempts: numberOrNull(firstDefined(candidate.max_attempts, candidate.retry_policy && candidate.retry_policy.max_attempts)),
    estimated_cost: numberOrNull(firstDefined(candidate.estimated_cost, candidate.cost && candidate.cost.amount, candidate.cost_estimate)),
  };
}

function lineageFrom(...sources) {
  const result = {};
  for (const key of ['run_id', 'production_id', 'content_id', 'campaign_id', 'request_hash', 'idempotency_key']) {
    result[key] = text(sources.map((source) => object(source)[key]).find(Boolean));
  }
  return result;
}

function missingLineage(lineage) {
  return Object.keys(lineage).filter((key) => !text(lineage[key]));
}

function consentVerified(job, context, manifest) {
  const candidate = object(job);
  if (candidate.identifiable_person === false || candidate.requires_identifiable_consent === false) return true;
  if (candidate.identifiable_person !== true && candidate.requires_identifiable_consent !== true && candidate.consent_required !== true) return true;
  const consent = object(firstDefined(candidate.consent, candidate.consent_record, object(context).consent, object(manifest).consent));
  const status = text(consent.status).toUpperCase();
  return consent.verified === true || consent.verified_at && Boolean(text(consent.consent_id || consent.id)) || ['VERIFIED', 'GRANTED', 'APPROVED'].includes(status);
}

function resolvePolicy(manifest, context, mode) {
  const candidate = object(manifest);
  const policy = object(firstDefined(candidate.execution_policy, candidate.runtime_policy, object(context).execution_policy));
  const budget = object(candidate.budget);
  const request = object(context.production_request || context.request);
  const allowedProviders = unique(firstDefined(policy.allowed_providers, candidate.allowed_providers, request.allowed_providers));
  const maxJobs = numberOrNull(firstDefined(policy.max_jobs, policy.maximum_jobs, candidate.max_jobs, budget.max_jobs, request.max_jobs));
  const maxRevisions = numberOrNull(firstDefined(policy.max_revisions, candidate.max_revisions, budget.max_revisions, request.max_revisions));
  const maxCostRaw = firstDefined(policy.max_cost, policy.maximum_cost, candidate.max_cost, budget.max_cost, budget.maximum_cost, request.max_cost);
  const maxCost = numberOrNull(maxCostRaw);
  const approval = object(firstDefined(candidate.human_approval, candidate.approval_record, policy.human_approval, context.human_approval, request.human_approval));
  return {
    mode: text(mode || context.mode || candidate.mode || 'DRY_RUN').toUpperCase(),
    allowed_providers: allowedProviders,
    max_jobs: maxJobs,
    max_revisions: maxRevisions,
    max_cost: maxCost,
    max_cost_configured: maxCost !== null,
    currency: text(firstDefined(policy.currency, candidate.currency, budget.currency, request.currency, 'BRL')),
    human_approval: approval.approved === true || approval.verified === true || ['APPROVED', 'VERIFIED', 'GRANTED'].includes(text(approval.status).toUpperCase()),
    publish_allowed: candidate.publish_allowed === true || request.publish_allowed === true,
    publish_requested: candidate.publish_requested === true || request.publish_requested === true,
    dispatch_enabled: policy.dispatch_enabled !== false,
    retry_policy: object(firstDefined(policy.retry_policy, candidate.retry_policy)),
  };
}

function costAmount(value) {
  if (value && typeof value === 'object') return numberOrNull(firstDefined(value.amount, value.value, value.cost)) || 0;
  return numberOrNull(value) || 0;
}

function errorRecord(error, fallbackCode = 'EXECUTOR_ERROR') {
  const candidate = error && typeof error === 'object' ? error : {};
  const statusCode = numberOrNull(candidate.statusCode || candidate.status);
  const code = text(candidate.code || (statusCode === 429 ? 'RATE_LIMIT' : fallbackCode)) || fallbackCode;
  const retryable = candidate.retryable === true || statusCode === 429 || [408, 425, 500, 502, 503, 504].includes(statusCode);
  return {
    code,
    message: text(candidate.message || error || code).slice(0, 500),
    retryable,
    status_code: statusCode,
  };
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  CAPABILITIES,
  NON_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  artifactExpectation,
  canonical,
  consentVerified,
  costAmount,
  errorRecord,
  expectedArtifacts,
  firstDefined,
  inferCapability,
  lineageFrom,
  list,
  missingLineage,
  normalizeJob,
  normaliseCapability,
  now,
  numberOrNull,
  object,
  resolvePolicy,
  sha256,
  stableId,
  text,
  unique,
};
