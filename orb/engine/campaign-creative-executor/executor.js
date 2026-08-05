'use strict';

const {
  NON_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  consentVerified,
  costAmount,
  errorRecord,
  firstDefined,
  expectedArtifacts,
  lineageFrom,
  list,
  missingLineage,
  normalizeJob,
  now,
  object,
  resolvePolicy,
  sha256,
  stableId,
  text,
} = require('./contracts');
const { MemoryArtifactStore } = require('./storage');
const { InMemoryExecutionStore } = require('./store');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function jobResultsById(value) {
  return new Map(asArray(value).filter((item) => item && text(item.job_id)).map((item) => [text(item.job_id), item]));
}

function jobResultBase(job, lineage, provider) {
  return {
    ...lineage,
    job_id: job.job_id,
    status: 'PLANNED',
    provider: text(provider || job.provider),
    provider_id: text(provider || job.provider),
    provider_job_id: '',
    started_at: null,
    finished_at: null,
    attempt: 0,
    attempts: 0,
    artifact_uri: '',
    preview_uri: '',
    mime_type: '',
    width: null,
    height: null,
    duration_seconds: null,
    file_size: null,
    sha256: '',
    cost: { amount: 0, currency: 'BRL', recorded: true, simulated: false },
    warnings: [],
    error: null,
    provenance: {},
    artifacts: [],
  };
}

function artifactOutputFor(outputs, expectation, index) {
  const values = asArray(outputs);
  const key = text(expectation.artifact_key);
  return values.find((output) => text(output.artifact_key || output.key) === key)
    || (values.length === 1 && index === 0 ? values[0] : null);
}

function artifactSpecMatches(artifact, expectation) {
  const expectedMime = text(expectation.mime_type);
  if (expectedMime && text(artifact.mime_type) && expectedMime !== text(artifact.mime_type)) {
    return 'ARTIFACT_MIME_MISMATCH';
  }
  if (expectation.width !== null && Number(expectation.width) > 0 && Number(artifact.width) !== Number(expectation.width)) {
    return 'ARTIFACT_WIDTH_MISMATCH';
  }
  if (expectation.height !== null && Number(expectation.height) > 0 && Number(artifact.height) !== Number(expectation.height)) {
    return 'ARTIFACT_HEIGHT_MISMATCH';
  }
  if (expectation.duration_seconds !== null && Number(expectation.duration_seconds) > 0 && Number(artifact.duration_seconds) !== Number(expectation.duration_seconds)) {
    return 'ARTIFACT_DURATION_MISMATCH';
  }
  return '';
}

async function verifyStoredArtifact(artifactStore, artifact) {
  if (!text(artifact.artifact_uri)) return { valid: false, reason: 'ARTIFACT_URI_MISSING' };
  if (text(artifact.artifact_uri).startsWith('data:') || artifact.base64 || artifact.data) {
    return { valid: false, reason: 'INLINE_ARTIFACT_FORBIDDEN' };
  }
  if (!text(artifact.mime_type)) return { valid: false, reason: 'ARTIFACT_MIME_MISSING' };
  if (!text(artifact.sha256 || artifact.checksum?.value)) return { valid: false, reason: 'ARTIFACT_CHECKSUM_MISSING' };
  if (!Number.isFinite(Number(artifact.file_size)) || Number(artifact.file_size) < 0) return { valid: false, reason: 'ARTIFACT_SIZE_MISSING' };
  if (!artifactStore || typeof artifactStore.verify !== 'function') return { valid: false, reason: 'ARTIFACT_STORE_UNAVAILABLE' };
  const verification = await artifactStore.verify(artifact);
  if (!verification.valid) return { valid: false, reason: verification.reason || 'ARTIFACT_CHECKSUM_MISMATCH', sha256: verification.sha256 };
  if (text(verification.sha256) !== text(artifact.sha256 || artifact.checksum?.value)) {
    return { valid: false, reason: 'ARTIFACT_CHECKSUM_MISMATCH', sha256: verification.sha256 };
  }
  return { valid: true, sha256: verification.sha256 };
}

function updatePrimaryFields(result) {
  const primary = result.artifacts[0] || {};
  result.artifact_uri = text(primary.artifact_uri || primary.uri);
  result.preview_uri = text(primary.preview_uri || primary.artifact_uri || primary.uri);
  result.mime_type = text(primary.mime_type);
  result.width = primary.width === null || primary.width === undefined ? null : Number(primary.width);
  result.height = primary.height === null || primary.height === undefined ? null : Number(primary.height);
  result.duration_seconds = primary.duration_seconds === null || primary.duration_seconds === undefined ? null : Number(primary.duration_seconds);
  result.file_size = primary.file_size === null || primary.file_size === undefined ? null : Number(primary.file_size);
  result.sha256 = text(primary.sha256 || primary.checksum?.value);
}

function dependenciesReady(job, results) {
  return job.dependencies.every((dependency) => {
    const result = results.get(dependency);
    return result && result.status === 'COMPLETED';
  });
}

function topologicalOrder(jobs) {
  const byId = new Map(jobs.map((job) => [job.job_id, job]));
  const remaining = new Set(byId.keys());
  const ordered = [];
  while (remaining.size) {
    const ready = Array.from(remaining).filter((jobId) => {
      const job = byId.get(jobId);
      return job.dependencies.every((dependency) => byId.has(dependency) && !remaining.has(dependency));
    });
    if (!ready.length) {
      const cycle = Array.from(remaining).join(', ');
      const error = new Error(`Job dependency graph contains a cycle or unknown dependency: ${cycle}`);
      error.code = 'DEPENDENCY_GRAPH_INVALID';
      error.retryable = false;
      throw error;
    }
    for (const jobId of ready) {
      remaining.delete(jobId);
      ordered.push(byId.get(jobId));
    }
  }
  return ordered;
}

function lineageAndManifest(manifest, requestContext) {
  const context = object(requestContext);
  const request = object(context.production_request || context.request);
  const ccgContext = object(context.ccg_context);
  return lineageFrom(manifest, context, request, ccgContext);
}

function jobsFromManifest(manifest) {
  const candidate = object(manifest);
  const expectations = asArray(candidate.artifact_expectations || candidate.expected_artifacts);
  const byJob = new Map();
  for (const expectation of expectations) {
    const sourceJobId = text(expectation.source_job_id || expectation.job_id);
    if (!sourceJobId) continue;
    if (!byJob.has(sourceJobId)) byJob.set(sourceJobId, []);
    byJob.get(sourceJobId).push(expectation);
  }
  const planned = asArray(candidate.jobs || candidate.job_plan || candidate.production_jobs);
  return planned.map((job, index) => {
    const candidateJob = object(job);
    const id = text(candidateJob.job_id || candidateJob.id || `job-${index + 1}`);
    return normalizeJob({
      ...candidateJob,
      expected_artifacts: asArray(candidateJob.expected_artifacts || candidateJob.artifact_expectations || candidateJob.outputs).length
        ? (candidateJob.expected_artifacts || candidateJob.artifact_expectations || candidateJob.outputs)
        : byJob.get(id) || undefined,
    }, index);
  });
}

function policyError(code, message, retryable = false) {
  return { code, message, retryable, status_code: null };
}

function policyBlockedExecution({ executionId, mode, lineage, jobs, policy, errors, startedAt, manifestHash }) {
  const primary = errors[0] || policyError('EXECUTION_POLICY_BLOCKED', 'Execution policy blocked dispatch');
  const results = jobs.map((job) => ({
    ...jobResultBase(job, lineage, mode === 'DRY_RUN' ? 'mock' : job.provider),
    status: 'NEEDS_REVIEW',
    finished_at: startedAt,
    error: primary,
    warnings: ['NO_EXTERNAL_CALL_DISPATCH_BLOCKED'],
    provenance: { executor: 'campaign-creative-executor', policy_blocked: true },
  }));
  return {
    ...lineage,
    execution_id: executionId,
    manifest_sha256: manifestHash,
    mode,
    dry_run: mode === 'DRY_RUN',
    status: 'NEEDS_REVIEW',
    started_at: startedAt,
    finished_at: startedAt,
    jobs: results,
    results,
    total_cost: 0,
    cost: { amount: 0, currency: policy.currency, recorded: true, simulated: mode === 'DRY_RUN' },
    currency: policy.currency,
    warnings: errors.map((error) => error.code),
    error: primary,
    external_calls: [],
    storage_writes: [],
    receipts: [],
    checkpoint: {
      execution_id: executionId,
      status: 'NEEDS_REVIEW',
      completed_job_ids: [],
      pending_job_ids: jobs.map((job) => job.job_id),
      failed_job_ids: [],
      last_job_id: '',
      resume_supported: true,
    },
    policy: {
      allowed_providers: policy.allowed_providers,
      max_jobs: policy.max_jobs,
      max_revisions: policy.max_revisions,
      max_cost: policy.max_cost,
      max_cost_configured: policy.max_cost_configured,
      human_approval: policy.human_approval,
      dispatch_allowed: false,
    },
    publish_allowed: false,
    publish_requested: false,
    provenance: { executor: 'campaign-creative-executor', manifest_hash: manifestHash },
  };
}

function checkpointFor(executionId, results, status, lastJobId) {
  return {
    execution_id: executionId,
    status,
    completed_job_ids: results.filter((result) => result.status === 'COMPLETED').map((result) => result.job_id),
    pending_job_ids: results.filter((result) => NON_TERMINAL_STATUSES.includes(result.status)).map((result) => result.job_id),
    failed_job_ids: results.filter((result) => result.status === 'FAILED' || result.status === 'NEEDS_REVIEW').map((result) => result.job_id),
    last_job_id: text(lastJobId),
    resume_supported: true,
  };
}

function buildExecutionEnvelope({ executionId, manifestHash, mode, lineage, startedAt, finishedAt, results, totalCost, policy, externalCalls, storageWrites, warnings, error, lastJobId }) {
  const status = results.some((result) => result.status === 'FAILED')
    ? 'FAILED'
    : results.some((result) => result.status === 'NEEDS_REVIEW')
      ? 'NEEDS_REVIEW'
      : results.some((result) => NON_TERMINAL_STATUSES.includes(result.status))
        ? 'RUNNING'
        : 'COMPLETED';
  const receipts = results.map((result) => ({
    job_id: result.job_id,
    provider: result.provider,
    provider_job_id: result.provider_job_id,
    attempt: result.attempt,
    status: result.status,
    artifact_uri: result.artifact_uri,
    sha256: result.sha256,
  }));
  return {
    ...lineage,
    execution_id: executionId,
    manifest_sha256: manifestHash,
    mode,
    dry_run: mode === 'DRY_RUN',
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    jobs: results,
    results,
    total_cost: totalCost,
    cost: { amount: totalCost, currency: policy.currency, recorded: true, simulated: mode === 'DRY_RUN' },
    currency: policy.currency,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    error: error || null,
    external_calls: mode === 'DRY_RUN' ? [] : externalCalls,
    storage_writes: mode === 'DRY_RUN' ? [] : storageWrites,
    receipts,
    checkpoint: checkpointFor(executionId, results, status, lastJobId),
    policy: {
      allowed_providers: policy.allowed_providers,
      max_jobs: policy.max_jobs,
      max_revisions: policy.max_revisions,
      max_cost: policy.max_cost,
      max_cost_configured: policy.max_cost_configured,
      human_approval: policy.human_approval,
      dispatch_allowed: true,
    },
    publish_allowed: false,
    publish_requested: false,
    provenance: { executor: 'campaign-creative-executor', manifest_hash: manifestHash, checkpoint_resume: true },
  };
}

async function saveCheckpoint(executionStore, record, lineage, results) {
  await executionStore.save(record.execution_id, record);
  for (const result of results) {
    if (result.status !== 'COMPLETED') continue;
    const key = `idempotency:${sha256(`${text(lineage.idempotency_key)}:${text(result.job_id)}`)}`;
    await executionStore.save(key, {
      execution_id: record.execution_id,
      job_id: result.job_id,
      status: result.status,
      result,
    });
  }
}

function resultWithError(result, status, error, finishedAt) {
  return {
    ...result,
    status,
    finished_at: finishedAt,
    error: errorRecord(error, error && error.code ? error.code : 'EXECUTOR_ERROR'),
  };
}

async function executeProductionManifest({
  manifest,
  mode,
  requestContext = {},
  registry,
  executionStore = new InMemoryExecutionStore(),
  artifactStore = new MemoryArtifactStore(),
  liveEnabled = false,
  clock = { now },
} = {}) {
  const candidateManifest = object(manifest);
  const context = object(requestContext);
  const activeRegistry = registry || require('./registry').createDefaultRegistry();
  const actualMode = text(mode || context.mode || candidateManifest.mode || 'DRY_RUN').toUpperCase() === 'LIVE' ? 'LIVE' : 'DRY_RUN';
  const lineage = lineageAndManifest(candidateManifest, context);
  const manifestHash = sha256(candidateManifest);
  const executionId = stableId('ccg-execution', {
    idempotency_key: lineage.idempotency_key,
    production_id: lineage.production_id,
    request_hash: lineage.request_hash,
    manifest_hash: manifestHash,
  });
  const startedAt = clock.now();
  const jobs = jobsFromManifest(candidateManifest);
  const policy = resolvePolicy(candidateManifest, context, actualMode);
  const errors = [];

  if (missingLineage(lineage).length) errors.push(policyError('LINEAGE_REQUIRED', `Missing lineage fields: ${missingLineage(lineage).join(', ')}`));
  if (!jobs.length) errors.push(policyError('NO_JOBS', 'Production manifest does not contain jobs'));
  if (!policy.max_jobs || jobs.length > policy.max_jobs) errors.push(policyError('MAX_JOBS_EXCEEDED', 'Production manifest exceeds max_jobs'));
  if (policy.max_revisions === null || policy.max_revisions < 0 || jobs.some((job) => job.revision > policy.max_revisions)) errors.push(policyError('MAX_REVISIONS_EXCEEDED', 'Production manifest exceeds max_revisions'));
  if (policy.publish_allowed || policy.publish_requested || candidateManifest.publish_allowed === true || candidateManifest.publish_requested === true) errors.push(policyError('PUBLICATION_FORBIDDEN', 'The executor never publishes or activates ads'));
  if (!policy.allowed_providers.length && actualMode === 'LIVE') errors.push(policyError('PROVIDER_ALLOWLIST_REQUIRED', 'LIVE execution requires allowed_providers'));
  if (actualMode === 'LIVE' && !policy.max_cost_configured) errors.push(policyError('MAX_COST_REQUIRED', 'LIVE execution requires max_cost'));
  if (actualMode === 'LIVE' && !policy.human_approval) errors.push(policyError('HUMAN_APPROVAL_REQUIRED', 'LIVE execution requires human approval'));
  if (actualMode === 'LIVE' && !liveEnabled) errors.push(policyError('LIVE_EXECUTION_DISABLED', 'LIVE execution is disabled in this executor runtime'));
  if (actualMode === 'DRY_RUN') policy.allowed_providers = policy.allowed_providers.length ? policy.allowed_providers : ['mock'];
  if (actualMode === 'LIVE') {
    for (const job of jobs) {
      if (!policy.allowed_providers.includes(job.provider)) errors.push(policyError('PROVIDER_NOT_ALLOWLISTED', `Provider is not allowlisted for ${job.job_id}: ${job.provider}`));
      if (!consentVerified(job, context, candidateManifest)) errors.push(policyError('CONSENT_REQUIRED', `Verified consent is required for ${job.job_id}`));
    }
  }
  let orderedJobs;
  try {
    orderedJobs = topologicalOrder(jobs);
  } catch (error) {
    errors.push(errorRecord(error, 'DEPENDENCY_GRAPH_INVALID'));
    orderedJobs = jobs;
  }
  if (errors.length) {
    const blocked = policyBlockedExecution({ executionId, mode: actualMode, lineage, jobs, policy, errors, startedAt, manifestHash });
    await executionStore.save(executionId, blocked);
    return blocked;
  }

  const existing = await executionStore.get(executionId);
  if (existing && existing.status === 'COMPLETED') return { ...existing, reused: true };
  const previousResults = jobResultsById(existing && existing.jobs);
  const results = new Map(previousResults);
  const externalCalls = [];
  const warnings = [];
  let totalCost = Array.from(results.values()).reduce((sum, result) => sum + costAmount(result.cost), 0);
  let fatalError = null;
  let lastJobId = '';
  const record = {
    ...lineage,
    execution_id: executionId,
    manifest_sha256: manifestHash,
    mode: actualMode,
    status: 'RUNNING',
    started_at: existing?.started_at || startedAt,
    finished_at: null,
    jobs: orderedJobs.map((job) => results.get(job.job_id) || jobResultBase(job, lineage, actualMode === 'DRY_RUN' ? 'mock' : job.provider)),
    checkpoint: checkpointFor(executionId, Array.from(results.values()), 'RUNNING', ''),
  };
  await saveCheckpoint(executionStore, record, lineage, Array.from(results.values()));
  if (typeof artifactStore.resetWrites === 'function') artifactStore.resetWrites();

  for (const job of orderedJobs) {
    lastJobId = job.job_id;
    const existingResult = results.get(job.job_id);
    if (existingResult && existingResult.status === 'COMPLETED') {
      const verified = await Promise.all(asArray(existingResult.artifacts).map((artifact) => verifyStoredArtifact(artifactStore, artifact)));
      if (verified.every((item) => item.valid)) continue;
      results.set(job.job_id, resultWithError({ ...existingResult, status: 'RUNNING' }, 'NEEDS_REVIEW', policyError('ARTIFACT_CHECKSUM_MISMATCH', `Stored artifact for ${job.job_id} cannot be verified`), clock.now()));
      fatalError = policyError('ARTIFACT_CHECKSUM_MISMATCH', `Stored artifact for ${job.job_id} cannot be verified`);
      break;
    }
    const idempotencyIndex = `idempotency:${sha256(`${text(lineage.idempotency_key)}:${text(job.job_id)}`)}`;
    const idempotent = await executionStore.get(idempotencyIndex);
    if (idempotent && idempotent.status === 'COMPLETED' && idempotent.result) {
      const verified = await Promise.all(asArray(idempotent.result.artifacts).map((artifact) => verifyStoredArtifact(artifactStore, artifact)));
      if (verified.every((item) => item.valid)) {
        results.set(job.job_id, { ...idempotent.result, reused: true });
        continue;
      }
    }
    if (!dependenciesReady(job, results)) {
      const result = resultWithError(jobResultBase(job, lineage, actualMode === 'DRY_RUN' ? 'mock' : job.provider), 'NEEDS_REVIEW', policyError('DEPENDENCY_FAILED', `Dependencies for ${job.job_id} did not complete`), clock.now());
      results.set(job.job_id, result);
      fatalError = result.error;
      await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'NEEDS_REVIEW', lastJobId) }, lineage, Array.from(results.values()));
      break;
    }

    const provider = actualMode === 'DRY_RUN' ? 'mock' : job.provider;
    const registration = activeRegistry.resolve(provider, job.capability);
    if (!registration) {
      const result = resultWithError(jobResultBase(job, lineage, provider), 'NEEDS_REVIEW', policyError('PROVIDER_ADAPTER_UNAVAILABLE', `No adapter for ${provider}/${job.capability}`), clock.now());
      results.set(job.job_id, result);
      fatalError = result.error;
      await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'NEEDS_REVIEW', lastJobId) }, lineage, Array.from(results.values()));
      break;
    }
    const adapter = registration.adapter;
    const estimatedCost = Number.isFinite(Number(job.estimated_cost)) ? Number(job.estimated_cost) : Number(adapter.configuredCost);
    if (actualMode === 'LIVE' && (!Number.isFinite(estimatedCost) || estimatedCost < 0)) {
      const result = resultWithError(jobResultBase(job, lineage, provider), 'NEEDS_REVIEW', policyError('COST_UNCONFIGURED', `Cost is not configured for ${job.job_id}`), clock.now());
      results.set(job.job_id, result);
      fatalError = result.error;
      await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'NEEDS_REVIEW', lastJobId) }, lineage, Array.from(results.values()));
      break;
    }
    if (actualMode === 'LIVE' && policy.max_cost !== null && Number.isFinite(estimatedCost) && totalCost + estimatedCost > policy.max_cost) {
      const result = resultWithError(jobResultBase(job, lineage, provider), 'NEEDS_REVIEW', policyError('COST_EXCEEDED', `Estimated cost for ${job.job_id} exceeds the remaining max_cost`), clock.now());
      results.set(job.job_id, result);
      fatalError = result.error;
      break;
    }
    if (!consentVerified(job, context, candidateManifest)) {
      const result = resultWithError(jobResultBase(job, lineage, provider), 'NEEDS_REVIEW', policyError('CONSENT_REQUIRED', `Verified consent is required for ${job.job_id}`), clock.now());
      results.set(job.job_id, result);
      fatalError = result.error;
      break;
    }

    const maxAttempts = Math.max(1, Math.min(10, Number(job.max_attempts || policy.retry_policy.max_attempts || 1)));
    let result = jobResultBase(job, lineage, registration.provider);
    result.status = 'RUNNING';
    result.started_at = clock.now();
    results.set(job.job_id, result);
    await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'RUNNING', lastJobId) }, lineage, Array.from(results.values()));
    let succeeded = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result.attempt = attempt;
      result.attempts = attempt;
      try {
        if (actualMode === 'LIVE') externalCalls.push({ provider: registration.provider, capability: job.capability, job_id: job.job_id, attempt });
        const output = await adapter.execute({
          job,
          manifest: candidateManifest,
          context,
          dependencyArtifacts: job.dependencies.flatMap((dependency) => asArray(results.get(dependency)?.artifacts)),
          attempt,
        });
        const artifacts = [];
        for (let index = 0; index < expectedArtifacts(job).length; index += 1) {
          const expectation = expectedArtifacts(job)[index];
          const produced = artifactOutputFor(output.outputs, expectation, index);
          if (!produced || !Buffer.isBuffer(produced.bytes) && !(produced.bytes instanceof Uint8Array)) {
            throw Object.assign(new Error(`Artifact output is missing for ${job.job_id}/${expectation.artifact_key}`), { code: 'ARTIFACT_MISSING', retryable: false });
          }
          const stored = await artifactStore.put({
            executionId,
            jobId: job.job_id,
            artifactKey: expectation.artifact_key,
            bytes: Buffer.from(produced.bytes),
            metadata: { ...object(produced.metadata), mime_type: text(produced.metadata?.mime_type || expectation.mime_type || 'application/octet-stream') },
          });
          const mismatch = artifactSpecMatches(stored, expectation);
          if (mismatch && !(actualMode === 'DRY_RUN' && stored.simulated)) {
            throw Object.assign(new Error(`${mismatch} for ${job.job_id}/${expectation.artifact_key}`), { code: mismatch, retryable: false });
          }
          const verification = await verifyStoredArtifact(artifactStore, stored);
          if (!verification.valid) throw Object.assign(new Error(`${verification.reason} for ${job.job_id}/${expectation.artifact_key}`), { code: verification.reason, retryable: false });
          artifacts.push(stored);
        }
        const amount = costAmount(output.cost);
        totalCost += amount;
        result = {
          ...result,
          status: 'COMPLETED',
          provider: registration.provider,
          provider_id: registration.provider,
          provider_job_id: text(output.provider_job_id || stableId('provider-job', { executionId, job: job.job_id, attempt })),
          finished_at: clock.now(),
          cost: { amount, currency: text(output.currency || policy.currency), recorded: true, simulated: actualMode === 'DRY_RUN' },
          warnings: asArray(output.warnings),
          error: null,
          provenance: { ...(output.provenance || {}), executor_execution_id: executionId, idempotency_key: lineage.idempotency_key },
          artifacts,
        };
        updatePrimaryFields(result);
        results.set(job.job_id, result);
        warnings.push(...result.warnings);
        succeeded = true;
        if (actualMode === 'LIVE' && policy.max_cost !== null && totalCost > policy.max_cost) {
          result.status = 'NEEDS_REVIEW';
          result.error = policyError('COST_EXCEEDED', 'Actual execution cost exceeded max_cost');
          fatalError = result.error;
          results.set(job.job_id, result);
        }
        break;
      } catch (error) {
        const normalized = errorRecord(error, 'ADAPTER_EXECUTION_FAILED');
        result = { ...result, error: normalized, warnings: Array.from(new Set([...(result.warnings || []), normalized.retryable ? 'RETRYABLE_ADAPTER_ERROR' : 'PERMANENT_ADAPTER_ERROR'])) };
        if (!normalized.retryable || attempt >= maxAttempts) {
          result.status = normalized.code === 'COST_EXCEEDED' || normalized.code.includes('ARTIFACT') || normalized.code === 'CONSENT_REQUIRED' ? 'NEEDS_REVIEW' : 'FAILED';
          result.finished_at = clock.now();
          results.set(job.job_id, result);
          fatalError = normalized;
          break;
        }
        results.set(job.job_id, { ...result, status: 'RUNNING' });
        await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'RUNNING', lastJobId) }, lineage, Array.from(results.values()));
      }
    }
    if (!succeeded && fatalError) break;
    await saveCheckpoint(executionStore, { ...record, jobs: Array.from(results.values()), checkpoint: checkpointFor(executionId, Array.from(results.values()), 'RUNNING', lastJobId) }, lineage, Array.from(results.values()));
    if (fatalError) break;
  }

  for (const job of orderedJobs) {
    if (results.has(job.job_id)) continue;
    const result = resultWithError(jobResultBase(job, lineage, actualMode === 'DRY_RUN' ? 'mock' : job.provider), 'NEEDS_REVIEW', fatalError || policyError('EXECUTION_HALTED', 'Execution stopped before this job was dispatched'), clock.now());
    results.set(job.job_id, result);
  }
  const orderedResults = orderedJobs.map((job) => results.get(job.job_id)).filter(Boolean);
  const storageWrites = typeof artifactStore.drainWrites === 'function' ? artifactStore.drainWrites() : [];
  const finishedAt = clock.now();
  const envelope = buildExecutionEnvelope({
    executionId,
    manifestHash,
    mode: actualMode,
    lineage,
    startedAt: existing?.started_at || startedAt,
    finishedAt,
    results: orderedResults,
    totalCost,
    policy,
    externalCalls,
    storageWrites,
    warnings,
    error: fatalError,
    lastJobId,
  });
  await executionStore.save(executionId, envelope);
  for (const result of orderedResults) {
    if (result.status !== 'COMPLETED') continue;
    const key = `idempotency:${sha256(`${text(lineage.idempotency_key)}:${text(result.job_id)}`)}`;
    await executionStore.save(key, { execution_id: executionId, job_id: result.job_id, status: result.status, result });
  }
  return envelope;
}

module.exports = {
  artifactSpecMatches,
  executeProductionManifest,
  jobsFromManifest,
  topologicalOrder,
  verifyStoredArtifact,
};
