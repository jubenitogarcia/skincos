import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[1-9][0-9]*$/;
const CANDIDATE_CONTRACT = "skincos/ponto-core-staging-candidate/v1";
const DRILL_CONTRACT = "skincos/ponto-core-staging-rollback-drill/v1";
const CANONICAL_CORE_WORKFLOW = ".github/workflows/deploy-core-workers.yml";
const CORE_WORKER = "skincos-ponto-core-staging";
const IDENTITY_WORKER = "skincos-insumos-staging";
const TIMEKEEPING_WORKER = "skincos-timekeeping-staging";
const IDENTITY_ROUTE = "api-staging.skincos.com.br/insumos/*";

function fail(code) {
  throw new Error(`PONTO_CORE_STAGING_CANDIDATE_INVALID:${code}`);
}

function required(value, code) {
  if (value === undefined || value === null || value === "") fail(code);
  return value;
}

function asString(value, code) {
  return String(required(value, code)).trim();
}

function exactBoolean(value, code) {
  if (value !== true && value !== false) fail(code);
  return value;
}

function sameList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function exactUuid(value, code) {
  const normalized = asString(value, code).toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}

function exactSha(value, code) {
  const normalized = asString(value, code).toLowerCase();
  if (!SHA.test(normalized)) fail(code);
  return normalized;
}

function exactRunId(value, code) {
  const normalized = asString(value, code);
  if (!RUN_ID.test(normalized)) fail(code);
  return normalized;
}

function normalizedWorkflowPath(value) {
  return String(value || "").trim().replace(/@refs\/(?:heads|tags)\/[^\s]+$/, "");
}

/**
 * A canonical Ponto child normally executes from protected main, but the
 * governed coordinator dispatches it from the immutable release tag.  Treat
 * that tag as a source identity, not as a broad alternative branch: it must
 * have the deterministic name for this SHA and resolve to this exact commit.
 */
export function validateCanonicalDrillSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("DRILL_SOURCE_SHAPE");
  const ref = asString(source.ref, "DRILL_SOURCE_REF");
  const sha = exactSha(source.sha, "DRILL_SOURCE_SHA");
  const releaseSha = exactSha(source.releaseSha, "DRILL_RELEASE_SHA");
  const refTargetSha = exactSha(source.refTargetSha, "DRILL_SOURCE_REF_TARGET_SHA");
  if (sha !== releaseSha || Number(source.runAttempt) !== 1) fail("DRILL_SOURCE_PROVENANCE");
  if (ref === "refs/heads/main") {
    if (refTargetSha !== sha) fail("DRILL_SOURCE_MAIN");
    return { ref, logicalBranch: "main", refTargetSha, runAttempt: 1 };
  }
  if (ref !== `refs/tags/skincos/release/ponto/${sha}` || refTargetSha !== sha) fail("DRILL_SOURCE_TAG");
  return { ref, logicalBranch: "main", refTargetSha, runAttempt: 1 };
}

function assertRun(run, { workflowPath, sourceSha, repository, code }) {
  if (!run || typeof run !== "object" || Array.isArray(run)) fail(`${code}_RUN_SHAPE`);
  const runId = exactRunId(run.runId ?? run.id, `${code}_RUN_ID`);
  const headSha = exactSha(run.headSha ?? run.head_sha, `${code}_RUN_SOURCE_SHA`);
  if (
    normalizedWorkflowPath(run.workflowPath ?? run.path) !== workflowPath
    || String(run.event || "") !== "workflow_dispatch"
    || String(run.status || "") !== "completed"
    || String(run.conclusion || "") !== "success"
    || Number(run.runAttempt ?? run.run_attempt) !== 1
    || headSha !== sourceSha
    || String(run.repository || run.repositoryName || "") !== repository
    || String(run.headRepository || run.head_repository || "") !== repository
  ) fail(`${code}_RUN_PROVENANCE`);
  const headBranch = String(run.headBranch ?? run.head_branch ?? "");
  if (headBranch === "main") {
    return {
      runId,
      headSha,
      headBranch,
      sourceRef: "refs/heads/main",
      logicalBranch: "main",
      refTargetSha: sourceSha,
    };
  }
  const expectedTag = `skincos/release/ponto/${sourceSha}`;
  const releaseRef = String(run.releaseRef || "");
  const releaseTagObjectType = String(run.releaseTagObjectType || "");
  const releaseTagTarget = exactSha(run.releaseTagTarget, `${code}_RUN_TAG_TARGET`);
  if (
    headBranch !== expectedTag
    || releaseRef !== `refs/tags/${expectedTag}`
    || releaseTagObjectType !== "commit"
    || releaseTagTarget !== sourceSha
  ) fail(`${code}_RUN_TAG`);
  return {
    runId,
    headSha,
    headBranch,
    sourceRef: releaseRef,
    logicalBranch: "main",
    refTargetSha: releaseTagTarget,
  };
}

function assertSurface(surface, { code, sourceSha, runId, kind }) {
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) fail(`${code}_SURFACE_SHAPE`);
  if (
    surface.schemaVersion !== 1
    || String(surface.stage || "") !== "staging"
    || exactSha(surface.sourceSha, `${code}_SURFACE_SOURCE_SHA`) !== sourceSha
    || exactRunId(surface.runId, `${code}_SURFACE_RUN_ID`) !== runId
  ) fail(`${code}_SURFACE_PROVENANCE`);

  const candidateVersionId = exactUuid(surface.candidateVersionId, `${code}_CANDIDATE_VERSION`);
  const incumbentVersionId = exactUuid(surface.incumbentVersionId, `${code}_INCUMBENT_VERSION`);
  const deploymentId = kind === "timekeeping" ? null : exactUuid(surface.deploymentId, `${code}_DEPLOYMENT`);
  if (candidateVersionId === incumbentVersionId) fail(`${code}_VERSION_COLLISION`);
  if (Number(surface.candidatePercent) !== 100 || Number(surface.incumbentPercent) !== 0) fail(`${code}_TRAFFIC`);

  const tags = {
    timekeeping: `ponto:timekeeping:${sourceSha}`,
    core: `ponto:coreApi:${sourceSha}`,
    identity: `ponto:identityWorkforce:${sourceSha}`,
  };
  const names = { timekeeping: "timekeeping", core: "coreApi", identity: "identityWorkforce" };
  if (surface.surface !== names[kind] || String(surface.candidateTag || "") !== tags[kind]) fail(`${code}_IDENTITY`);
  return { candidateVersionId, incumbentVersionId, deploymentId, candidateTag: tags[kind] };
}

function assertMutation(mutation, { code, sourceSha, runId, surface }) {
  if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) fail(`${code}_MUTATION_SHAPE`);
  if (
    mutation.schemaVersion !== 1
    || mutation.surface !== surface
    || mutation.stage !== "staging"
    || exactSha(mutation.sourceSha, `${code}_MUTATION_SOURCE_SHA`) !== sourceSha
    || exactRunId(mutation.runId, `${code}_MUTATION_RUN_ID`) !== runId
    || mutation.mutationStarted !== true
    || mutation.mutationCompleted !== true
    || mutation.rollbackCompleted !== false
    || mutation.compensationDisposition !== "not-run"
    || mutation.credentialsIncluded !== false
    || mutation.piiIncluded !== false
  ) fail(`${code}_MUTATION_PROVENANCE`);
}

/**
 * Validates only sanitized, immutable child-run evidence. It deliberately
 * avoids accepting a manually supplied version UUID without the canonical
 * Deploy Core Worker / Deploy Workforce Timekeeping evidence that created it.
 */
export function validateCandidateInput(input, expected = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1) fail("INPUT_SHAPE");
  const source = input.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("SOURCE_SHAPE");
  const sourceRepository = asString(source.repository, "SOURCE_REPOSITORY");
  const sourceSha = exactSha(source.sha, "SOURCE_SHA");
  const sourceTree = exactSha(source.tree, "SOURCE_TREE");
  const candidateRunId = exactRunId(source.candidateRunId, "CANDIDATE_RUN_ID");
  if (expected.repository && sourceRepository !== expected.repository) fail("SOURCE_REPOSITORY");
  if (expected.sourceSha && sourceSha !== String(expected.sourceSha).toLowerCase()) fail("SOURCE_SHA");
  if (expected.sourceTree && sourceTree !== String(expected.sourceTree).toLowerCase()) fail("SOURCE_TREE");
  if (expected.candidateRunId && candidateRunId !== String(expected.candidateRunId)) fail("CANDIDATE_RUN_ID");

  const upstream = input.upstream;
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) fail("UPSTREAM_SHAPE");
  const timekeepingRun = assertRun(upstream.timekeeping?.run, {
    code: "TIMEKEEPING", workflowPath: ".github/workflows/deploy-timekeeping.yml", sourceSha, repository: sourceRepository,
  });
  const timekeeping = assertSurface(upstream.timekeeping?.surface, {
    code: "TIMEKEEPING", sourceSha, runId: timekeepingRun.runId, kind: "timekeeping",
  });

  const coreRun = assertRun(upstream.core?.run, {
    code: "CORE", workflowPath: ".github/workflows/deploy-core-workers.yml", sourceSha, repository: sourceRepository,
  });
  const core = assertSurface(upstream.core?.surface, {
    code: "CORE", sourceSha, runId: coreRun.runId, kind: "core",
  });
  if (upstream.core.surface.serviceName !== CORE_WORKER || upstream.core.surface.routeIsolated !== true) fail("CORE_PRIVATE_SURFACE");
  assertMutation(upstream.core?.mutation, {
    code: "CORE", sourceSha, runId: coreRun.runId, surface: "coreApi",
  });

  const identityRun = assertRun(upstream.identity?.run, {
    code: "IDENTITY", workflowPath: ".github/workflows/deploy-core-workers.yml", sourceSha, repository: sourceRepository,
  });
  const identity = assertSurface(upstream.identity?.surface, {
    code: "IDENTITY", sourceSha, runId: identityRun.runId, kind: "identity",
  });
  if (exactUuid(upstream.identity.surface.timekeepingVersionId, "IDENTITY_TIMEKEEPING_VERSION") !== timekeeping.candidateVersionId) {
    fail("IDENTITY_TIMEKEEPING_AFFINITY");
  }
  assertMutation(upstream.identity?.mutation, {
    code: "IDENTITY", sourceSha, runId: identityRun.runId, surface: "identityWorkforce",
  });
  const childRuns = [timekeepingRun, coreRun, identityRun];
  if (childRuns.some((run) => (
    run.sourceRef !== timekeepingRun.sourceRef
    || run.logicalBranch !== timekeepingRun.logicalBranch
    || run.refTargetSha !== timekeepingRun.refTargetSha
  ))) fail("UPSTREAM_SOURCE_REF");

  return {
    source: {
      repository: sourceRepository,
      sha: sourceSha,
      tree: sourceTree,
      candidateRunId,
      ref: timekeepingRun.sourceRef,
      logicalBranch: timekeepingRun.logicalBranch,
      refTargetSha: timekeepingRun.refTargetSha,
    },
    timekeeping: { ...timekeeping, ...timekeepingRun },
    core: { ...core, ...coreRun, service: CORE_WORKER },
    identity: { ...identity, ...identityRun, service: IDENTITY_WORKER },
  };
}

function exactExposure(exposure, expected, code) {
  if (!exposure || typeof exposure !== "object" || Array.isArray(exposure)) fail(`${code}_EXPOSURE_SHAPE`);
  const routes = [...(exposure.workerRoutes || [])].map(String).sort();
  const domains = [...(exposure.customDomains || [])].map(String).sort();
  const sortedExpectedRoutes = [...expected.routes].sort();
  if (
    Number(exposure.workerRouteCount) !== sortedExpectedRoutes.length
    || !sameList(routes, sortedExpectedRoutes)
    || Number(exposure.customDomainCount) !== 0
    || !sameList(domains, [])
    || exposure.workersDevEnabled !== false
    || exposure.previewUrlsEnabled !== false
  ) fail(`${code}_EXPOSURE`);
  return {
    workerRouteCount: sortedExpectedRoutes.length,
    workerRoutes: sortedExpectedRoutes,
    customDomainCount: 0,
    customDomains: [],
    workersDevEnabled: false,
    previewUrlsEnabled: false,
  };
}

function exactRemoteSurface(surface, expected, code) {
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) fail(`${code}_REMOTE_SHAPE`);
  const versionId = exactUuid(surface.activeVersionId, `${code}_REMOTE_VERSION`);
  const deploymentId = exactUuid(surface.activeDeploymentId, `${code}_REMOTE_DEPLOYMENT`);
  if (
    String(surface.worker || "") !== expected.worker
    || versionId !== expected.versionId
    || String(surface.environment || "") !== "staging"
  ) fail(`${code}_REMOTE_IDENTITY`);
  if (expected.tag !== undefined && String(surface.versionMessage || "") !== expected.tag) fail(`${code}_REMOTE_TAG`);
  if (expected.sourceSha !== undefined && exactSha(surface.appVersion, `${code}_REMOTE_APP_VERSION`) !== expected.sourceSha) {
    fail(`${code}_REMOTE_APP_VERSION`);
  }
  if (expected.serviceBinding && String(surface.serviceBinding || "") !== expected.serviceBinding) fail(`${code}_REMOTE_BINDING`);
  if (
    expected.timekeepingVersionId
    && exactUuid(surface.timekeepingVersionId, `${code}_TIMEKEEPING_AFFINITY`) !== expected.timekeepingVersionId
  ) fail(`${code}_TIMEKEEPING_AFFINITY`);
  if (expected.routeOnly === true && surface.routeOnly !== true) fail(`${code}_REMOTE_ROUTE_ONLY`);
  if (expected.versionMetadata === true && surface.versionMetadata !== true) fail(`${code}_VERSION_METADATA`);
  return {
    versionId,
    deploymentId,
    exposure: exactExposure(surface.exposure, { routes: expected.routes }, code),
  };
}

/** Verifies the read-only Cloudflare control-plane snapshot before and after the drill. */
export function validateRemoteCandidate(remote, candidate) {
  if (!remote || typeof remote !== "object" || Array.isArray(remote) || remote.schemaVersion !== 1) fail("REMOTE_SHAPE");
  const core = exactRemoteSurface(remote.core, {
    worker: CORE_WORKER,
    versionId: candidate.core.candidateVersionId,
    tag: candidate.core.candidateTag,
    sourceSha: candidate.source.sha,
    serviceBinding: TIMEKEEPING_WORKER,
    timekeepingVersionId: candidate.timekeeping.candidateVersionId,
    routeOnly: true,
    versionMetadata: true,
    routes: [],
  }, "CORE");
  const identity = exactRemoteSurface(remote.identity, {
    worker: IDENTITY_WORKER,
    versionId: candidate.identity.candidateVersionId,
    tag: candidate.identity.candidateTag,
    sourceSha: candidate.source.sha,
    serviceBinding: TIMEKEEPING_WORKER,
    timekeepingVersionId: candidate.timekeeping.candidateVersionId,
    versionMetadata: true,
    routes: [IDENTITY_ROUTE],
  }, "IDENTITY");
  return { core, identity };
}

export function validateIdentityHealth(health, candidate) {
  if (!health || typeof health !== "object" || Array.isArray(health)) fail("IDENTITY_HEALTH_SHAPE");
  if (
    health.passed !== true
    || exactSha(health.version, "IDENTITY_HEALTH_VERSION") !== candidate.source.sha
    || String(health.environment || "") !== "staging"
    || exactUuid(health.workerVersionId, "IDENTITY_HEALTH_WORKER_VERSION") !== candidate.identity.candidateVersionId
    || String(health.workerVersionTag || "") !== candidate.identity.candidateTag
  ) fail("IDENTITY_HEALTH");
  return { passed: true };
}

const DRILL_SUBJECTS = Object.freeze({
  coreApi: Object.freeze({
    worker: CORE_WORKER,
    tag: (sha) => `ponto:coreApi:${sha}`,
    serviceBindingName: "TIMEKEEPING",
    serviceBinding: TIMEKEEPING_WORKER,
    routeOnly: true,
    routes: [],
  }),
  identityWorkforce: Object.freeze({
    worker: IDENTITY_WORKER,
    tag: (sha) => `ponto:identityWorkforce:${sha}`,
    serviceBindingName: "WORKFORCE",
    serviceBinding: TIMEKEEPING_WORKER,
    routeOnly: false,
    routes: [IDENTITY_ROUTE],
  }),
});

function requiredObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

/**
 * The canonical deploy workflow writes this compact input immediately before a
 * drill.  It names only versions that the same workflow has just published or
 * has explicitly attested as its incumbent; it never accepts a free-form
 * traffic target from the candidate-attester workflow.
 */
export function validateDrillInput(input) {
  requiredObject(input, "DRILL_INPUT_SHAPE");
  if (input.schemaVersion !== 1) fail("DRILL_INPUT_SCHEMA");
  const source = requiredObject(input.source, "DRILL_SOURCE_SHAPE");
  const sourceRepository = asString(source.repository, "DRILL_SOURCE_REPOSITORY");
  const sourceSha = exactSha(source.sha, "DRILL_SOURCE_SHA");
  const sourceTree = exactSha(source.tree, "DRILL_SOURCE_TREE");
  const runId = exactRunId(source.runId, "DRILL_RUN_ID");
  const sourceProvenance = validateCanonicalDrillSource({
    ref: source.ref,
    sha: sourceSha,
    releaseSha: source.releaseSha,
    refTargetSha: source.refTargetSha,
    runAttempt: source.runAttempt,
  });

  const subject = requiredObject(input.subject, "DRILL_SUBJECT_SHAPE");
  const surface = String(subject.surface || "");
  const definition = DRILL_SUBJECTS[surface];
  if (!definition) fail("DRILL_SUBJECT_SURFACE");
  const candidateVersionId = exactUuid(subject.candidateVersionId, "DRILL_CANDIDATE_VERSION");
  const incumbentVersionId = exactUuid(subject.incumbentVersionId, "DRILL_INCUMBENT_VERSION");
  const timekeepingVersionId = exactUuid(subject.timekeepingVersionId, "DRILL_TIMEKEEPING_VERSION");
  if (candidateVersionId === incumbentVersionId) fail("DRILL_VERSION_COLLISION");

  const coreCandidateVersionId = surface === "identityWorkforce"
    ? exactUuid(input.coreCandidateVersionId, "DRILL_CORE_CANDIDATE_VERSION")
    : "";
  return {
    source: {
      repository: sourceRepository,
      sha: sourceSha,
      tree: sourceTree,
      runId,
      ...sourceProvenance,
    },
    subject: {
      surface,
      worker: definition.worker,
      candidateVersionId,
      incumbentVersionId,
      candidateTag: definition.tag(sourceSha),
      timekeepingVersionId,
      definition,
    },
    coreCandidateVersionId,
  };
}

function timekeepingExpected(config) {
  return {
    code: "TIMEKEEPING",
    worker: TIMEKEEPING_WORKER,
    versionId: config.subject.timekeepingVersionId,
    tag: `ponto:timekeeping:${config.source.sha}`,
    sourceSha: config.source.sha,
    versionMetadata: true,
    versionMetadataBindingName: "VERSION_METADATA",
    routes: [],
  };
}

function subjectExpected(config, versionId, code, { candidate = false } = {}) {
  const { subject } = config;
  const expected = {
    code,
    worker: subject.worker,
    versionId,
    serviceBinding: subject.definition.serviceBinding,
    serviceBindingName: subject.definition.serviceBindingName,
    versionMetadata: true,
    routes: subject.definition.routes,
  };
  if (candidate) {
    expected.tag = subject.candidateTag;
    expected.sourceSha = config.source.sha;
    expected.timekeepingVersionId = subject.timekeepingVersionId;
    if (subject.definition.routeOnly) expected.routeOnly = true;
  }
  return expected;
}

function validateTimekeepingSnapshot(snapshot, config) {
  return exactRemoteSurface(snapshot, timekeepingExpected(config), "TIMEKEEPING");
}

function normalizeTimekeepingPreflight(preflight, config) {
  requiredObject(preflight, "TIMEKEEPING_PREFLIGHT_SHAPE");
  const observed = requiredObject(preflight.observed, "TIMEKEEPING_PREFLIGHT_OBSERVED");
  if (
    preflight.schemaVersion !== 1
    || preflight.passed !== true
    || String(preflight.configuredPhysicalWorker || "") !== TIMEKEEPING_WORKER
    || exactUuid(preflight.expectedVersionId, "TIMEKEEPING_PREFLIGHT_EXPECTED_VERSION") !== config.subject.timekeepingVersionId
    || String(preflight.expectedTag || "") !== `ponto:timekeeping:${config.source.sha}`
    || String(preflight.expectedSourceSha || "").toLowerCase() !== config.source.sha
    || observed.state !== "exact"
    || String(observed.worker || "") !== TIMEKEEPING_WORKER
    || exactUuid(observed.activeVersionId, "TIMEKEEPING_PREFLIGHT_ACTIVE_VERSION") !== config.subject.timekeepingVersionId
    || !UUID.test(String(observed.activeDeploymentId || ""))
  ) fail("TIMEKEEPING_PREFLIGHT");
  return {
    configuredPhysicalWorker: TIMEKEEPING_WORKER,
    observedWorker: TIMEKEEPING_WORKER,
    activeVersionId: config.subject.timekeepingVersionId,
    activeDeploymentId: String(observed.activeDeploymentId).toLowerCase(),
    state: "exact",
  };
}

function validateDrillState(state, config, phase) {
  requiredObject(state, "DRILL_STATE_SHAPE");
  if (state.schemaVersion !== 1 || String(state.phase || "") !== phase) fail("DRILL_STATE_PHASE");
  if (phase === "composite") {
    if (config.subject.surface !== "identityWorkforce") fail("DRILL_COMPOSITE_SURFACE");
    const core = exactRemoteSurface(state.core, {
      ...subjectExpected({
        ...config,
        subject: {
          ...config.subject,
          surface: "coreApi",
          worker: CORE_WORKER,
          candidateTag: `ponto:coreApi:${config.source.sha}`,
          definition: DRILL_SUBJECTS.coreApi,
          candidateVersionId: config.coreCandidateVersionId,
        },
      }, config.coreCandidateVersionId, "CORE", { candidate: true }),
    }, "CORE");
    const identity = exactRemoteSurface(
      state.identity,
      subjectExpected(config, config.subject.candidateVersionId, "IDENTITY", { candidate: true }),
      "IDENTITY",
    );
    const timekeeping = validateTimekeepingSnapshot(state.timekeeping, config);
    return { core, identity, timekeeping };
  }
  const candidate = phase === "candidate";
  const subject = exactRemoteSurface(
    state.subject,
    subjectExpected(
      config,
      candidate ? config.subject.candidateVersionId : config.subject.incumbentVersionId,
      candidate ? "DRILL_CANDIDATE" : "DRILL_INCUMBENT",
      { candidate },
    ),
    candidate ? "DRILL_CANDIDATE" : "DRILL_INCUMBENT",
  );
  const timekeeping = validateTimekeepingSnapshot(state.timekeeping, config);
  return { subject, timekeeping };
}

function validateDrillReadiness(readiness, config) {
  requiredObject(readiness, "DRILL_READINESS_SHAPE");
  if (config.subject.surface === "coreApi") {
    if (readiness.passed !== true || readiness.mode !== "control-plane-only") fail("DRILL_CORE_READINESS");
    return { passed: true, mode: "control-plane-only" };
  }
  const candidate = {
    source: { sha: config.source.sha },
    identity: {
      candidateVersionId: config.subject.candidateVersionId,
      candidateTag: config.subject.candidateTag,
    },
  };
  validateIdentityHealth(readiness, candidate);
  return { passed: true, mode: "identity-health" };
}

function drillConfigFromProof(proof) {
  const source = requiredObject(proof.source, "DRILL_PROOF_SOURCE_SHAPE");
  const producer = requiredObject(proof.producer, "DRILL_PROOF_PRODUCER_SHAPE");
  const target = requiredObject(proof.target, "DRILL_PROOF_TARGET_SHAPE");
  if (String(source.logicalBranch || "") !== "main") fail("DRILL_PROOF_SOURCE_LOGICAL_BRANCH");
  return validateDrillInput({
    schemaVersion: 1,
    source: {
      repository: source.repository,
      sha: source.sha,
      tree: source.tree,
      runId: producer.runId,
      ref: source.ref,
      releaseSha: source.sha,
      refTargetSha: source.refTargetSha,
      runAttempt: producer.runAttempt,
    },
    subject: {
      surface: target.surface,
      candidateVersionId: target.candidateVersionId,
      incumbentVersionId: target.incumbentVersionId,
      timekeepingVersionId: target.timekeepingVersionId,
    },
    ...(target.coreCandidateVersionId ? { coreCandidateVersionId: target.coreCandidateVersionId } : {}),
  });
}

/** Validates the sanitized proof emitted by one canonical Core/Identity run. */
export function validateDrillProof(proof, candidate, surface) {
  requiredObject(proof, "DRILL_PROOF_SHAPE");
  if (
    proof.schemaVersion !== 1
    || proof.contractId !== DRILL_CONTRACT
    || proof.passed !== true
    || proof.stage !== "staging"
    || proof.valuesIncluded !== false
    || proof.credentialsIncluded !== false
    || proof.piiIncluded !== false
  ) fail("DRILL_PROOF_SHAPE");
  const config = drillConfigFromProof(proof);
  if (
    String(proof.producer?.workflow || "") !== CANONICAL_CORE_WORKFLOW
    || String(proof.producer?.ref || "") !== config.source.ref
    || String(proof.producer?.logicalBranch || "") !== config.source.logicalBranch
    || exactSha(proof.producer?.refTargetSha, "DRILL_PROOF_PRODUCER_REF_TARGET") !== config.source.refTargetSha
    || config.source.repository !== candidate.source.repository
    || config.source.sha !== candidate.source.sha
    || config.source.tree !== candidate.source.tree
  ) fail("DRILL_PROOF_PROVENANCE");

  const upstream = surface === "coreApi" ? candidate.core : candidate.identity;
  if (
    config.subject.surface !== surface
    || config.source.runId !== upstream.runId
    || config.source.ref !== upstream.sourceRef
    || config.source.logicalBranch !== upstream.logicalBranch
    || config.source.refTargetSha !== upstream.refTargetSha
    || config.subject.candidateVersionId !== upstream.candidateVersionId
    || config.subject.incumbentVersionId !== upstream.incumbentVersionId
    || config.subject.timekeepingVersionId !== candidate.timekeeping.candidateVersionId
    || (surface === "identityWorkforce" && config.coreCandidateVersionId !== candidate.core.candidateVersionId)
  ) fail("DRILL_PROOF_BINDING");

  const maintenance = requiredObject(proof.maintenance, "DRILL_MAINTENANCE_SHAPE");
  const lease = requiredObject(proof.lease, "DRILL_LEASE_SHAPE");
  const recovery = requiredObject(proof.recovery, "DRILL_RECOVERY_SHAPE");
  const timekeeping = normalizeTimekeepingPreflight(proof.timekeeping, config);
  if (
    maintenance.passed !== true
    || maintenance.state !== "maintenance"
    || lease.resource !== "global:ponto-workers-writer"
    || lease.revalidatedBeforeRollback !== true
    || lease.revalidatedBeforeRestore !== true
    || recovery.attempted !== false
    || recovery.disposition !== "not-required"
  ) fail("DRILL_GUARDS");

  const before = validateDrillState(proof.before, config, "candidate");
  const rollback = requiredObject(proof.rollback, "DRILL_ROLLBACK_SHAPE");
  if (rollback.performed !== true) fail("DRILL_ROLLBACK_SHAPE");
  const rollbackState = validateDrillState(rollback.state, config, "incumbent");
  const restoration = requiredObject(proof.restoration, "DRILL_RESTORATION_SHAPE");
  if (restoration.completed !== true) fail("DRILL_RESTORATION_SHAPE");
  const restorationState = validateDrillState(restoration.state, config, "candidate");
  const readiness = validateDrillReadiness(proof.readiness, config);
  let composite = null;
  let bindingBefore = null;
  if (surface === "identityWorkforce") {
    bindingBefore = validateDrillState(proof.bindingBefore, config, "composite");
    composite = validateDrillState(restoration.composite, config, "composite");
  } else if (restoration.composite !== undefined || proof.bindingBefore !== undefined) {
    fail("DRILL_CORE_COMPOSITE");
  }
  const timekeepingSnapshots = [before.timekeeping, rollbackState.timekeeping, restorationState.timekeeping];
  if (bindingBefore) timekeepingSnapshots.push(bindingBefore.timekeeping);
  if (composite) timekeepingSnapshots.push(composite.timekeeping);
  if (timekeepingSnapshots.some((snapshot) => (
    snapshot.versionId !== config.subject.timekeepingVersionId
    || snapshot.deploymentId !== timekeeping.activeDeploymentId
  ))) fail("TIMEKEEPING_CONTINUITY");
  return { config, before, rollback: rollbackState, restoration: restorationState, readiness, bindingBefore, composite, timekeeping };
}

/**
 * Captures a read-only Cloudflare state from the canonical publisher. The
 * caller is the only workflow that can subsequently issue a traffic command;
 * this collector itself performs GET requests only.
 */
export async function attestDrillState({ config, phase, accountId, apiToken, fetchImpl = fetch }) {
  const validated = validateDrillInput(config);
  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  if (phase === "composite") {
    if (validated.subject.surface !== "identityWorkforce") fail("DRILL_COMPOSITE_SURFACE");
    const [core, identity, timekeeping] = await Promise.all([
      inspectWorker({
        get, accountId, worker: CORE_WORKER,
        expected: subjectExpected({
          ...validated,
          subject: {
            ...validated.subject,
            surface: "coreApi",
            worker: CORE_WORKER,
            candidateVersionId: validated.coreCandidateVersionId,
            candidateTag: `ponto:coreApi:${validated.source.sha}`,
            definition: DRILL_SUBJECTS.coreApi,
          },
        }, validated.coreCandidateVersionId, "CORE", { candidate: true }),
        fetchImpl,
      }),
      inspectWorker({
        get, accountId, worker: validated.subject.worker,
        expected: subjectExpected(validated, validated.subject.candidateVersionId, "IDENTITY", { candidate: true }),
        fetchImpl,
      }),
      inspectWorker({ get, accountId, worker: TIMEKEEPING_WORKER, expected: timekeepingExpected(validated), fetchImpl }),
    ]);
    return { schemaVersion: 1, phase, core, identity, timekeeping, valuesIncluded: false, credentialsIncluded: false, piiIncluded: false };
  }
  if (!["candidate", "incumbent"].includes(phase)) fail("DRILL_STATE_PHASE");
  const candidate = phase === "candidate";
  const [subject, timekeeping] = await Promise.all([
    inspectWorker({
      get,
      accountId,
      worker: validated.subject.worker,
      expected: subjectExpected(
        validated,
        candidate ? validated.subject.candidateVersionId : validated.subject.incumbentVersionId,
        candidate ? "DRILL_CANDIDATE" : "DRILL_INCUMBENT",
        { candidate },
      ),
      fetchImpl,
    }),
    inspectWorker({ get, accountId, worker: TIMEKEEPING_WORKER, expected: timekeepingExpected(validated), fetchImpl }),
  ]);
  return { schemaVersion: 1, phase, subject, timekeeping, valuesIncluded: false, credentialsIncluded: false, piiIncluded: false };
}

/**
 * Reports, without a traffic change, whether the physical Timekeeping Worker
 * configured by the Ponto Core/Identity bindings exists and is exactly the
 * published Timekeeping candidate. This turns source/runtime naming drift into
 * an artifact and a fail-closed precondition before any rollback command.
 */
export async function preflightTimekeepingWorker({ config, accountId, apiToken, fetchImpl = fetch }) {
  const validated = validateDrillInput(config);
  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  const report = {
    schemaVersion: 1,
    passed: false,
    configuredPhysicalWorker: TIMEKEEPING_WORKER,
    expectedVersionId: validated.subject.timekeepingVersionId,
    expectedTag: `ponto:timekeeping:${validated.source.sha}`,
    expectedSourceSha: validated.source.sha,
    observed: { state: "unavailable", worker: TIMEKEEPING_WORKER },
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const inventory = await get(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`, "scripts");
  if (!Array.isArray(inventory.result)) fail("TIMEKEEPING_PREFLIGHT_INVENTORY");
  if (!inventory.result.some((script) => script?.id === TIMEKEEPING_WORKER)) {
    report.observed = { state: "absent", worker: null };
    return report;
  }
  try {
    const snapshot = await inspectWorker({
      get,
      accountId,
      worker: TIMEKEEPING_WORKER,
      expected: timekeepingExpected(validated),
      fetchImpl,
    });
    report.passed = true;
    report.observed = {
      state: "exact",
      worker: TIMEKEEPING_WORKER,
      activeVersionId: snapshot.activeVersionId,
      activeDeploymentId: snapshot.activeDeploymentId,
    };
  } catch (error) {
    const match = String(error?.message || error).match(/^PONTO_CORE_STAGING_CANDIDATE_INVALID:([A-Z0-9_]+)$/);
    report.observed = {
      state: "mismatch",
      worker: TIMEKEEPING_WORKER,
      reason: match?.[1] || "REMOTE_READ_FAILED",
    };
  }
  return report;
}

export async function probeDrillIdentity({ config, fetchImpl = fetch }) {
  const validated = validateDrillInput(config);
  if (validated.subject.surface !== "identityWorkforce") fail("DRILL_IDENTITY_PROBE_SURFACE");
  return probeIdentityHealth({
    candidate: {
      source: { sha: validated.source.sha },
      identity: {
        candidateVersionId: validated.subject.candidateVersionId,
        candidateTag: validated.subject.candidateTag,
      },
    },
    fetchImpl,
  });
}

export function buildDrillProof({ config, before, rollback, restoration, composite = null, readiness, context }) {
  const validated = validateDrillInput(config);
  validateDrillState(before, validated, "candidate");
  validateDrillState(rollback, validated, "incumbent");
  validateDrillState(restoration, validated, "candidate");
  if (validated.subject.surface === "identityWorkforce") {
    validateDrillState(composite, validated, "composite");
    validateDrillState(context?.bindingBefore, validated, "composite");
  } else if (composite !== null || context?.bindingBefore !== undefined) fail("DRILL_CORE_COMPOSITE");
  validateDrillReadiness(readiness, validated);
  requiredObject(context, "DRILL_CONTEXT_SHAPE");
  if (
    context.maintenance?.passed !== true
    || context.maintenance?.state !== "maintenance"
    || context.lease?.resource !== "global:ponto-workers-writer"
    || context.lease?.revalidatedBeforeRollback !== true
    || context.lease?.revalidatedBeforeRestore !== true
    || context.recovery?.attempted !== false
    || context.recovery?.disposition !== "not-required"
  ) fail("DRILL_CONTEXT_GUARDS");
  normalizeTimekeepingPreflight(context.timekeepingPreflight, validated);
  return {
    schemaVersion: 1,
    contractId: DRILL_CONTRACT,
    passed: true,
    stage: "staging",
    producer: {
      workflow: CANONICAL_CORE_WORKFLOW,
      runId: validated.source.runId,
      runAttempt: 1,
      ref: validated.source.ref,
      logicalBranch: validated.source.logicalBranch,
      refTargetSha: validated.source.refTargetSha,
    },
    source: {
      repository: validated.source.repository,
      sha: validated.source.sha,
      tree: validated.source.tree,
      ref: validated.source.ref,
      logicalBranch: validated.source.logicalBranch,
      refTargetSha: validated.source.refTargetSha,
    },
    target: {
      surface: validated.subject.surface,
      worker: validated.subject.worker,
      candidateVersionId: validated.subject.candidateVersionId,
      incumbentVersionId: validated.subject.incumbentVersionId,
      candidateTag: validated.subject.candidateTag,
      timekeepingVersionId: validated.subject.timekeepingVersionId,
      ...(validated.coreCandidateVersionId ? { coreCandidateVersionId: validated.coreCandidateVersionId } : {}),
    },
    maintenance: { passed: true, state: "maintenance" },
    // Preserve the sanitized preflight receipt so downstream attesters can
    // validate the provider observation rather than trusting a lossy summary.
    timekeeping: context.timekeepingPreflight,
    lease: {
      resource: "global:ponto-workers-writer",
      revalidatedBeforeRollback: true,
      revalidatedBeforeRestore: true,
    },
    before,
    ...(validated.subject.surface === "identityWorkforce" ? { bindingBefore: context.bindingBefore } : {}),
    rollback: { performed: true, state: rollback },
    restoration: {
      completed: true,
      state: restoration,
      ...(composite ? { composite } : {}),
    },
    readiness,
    recovery: { attempted: false, disposition: "not-required" },
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

export function validateRollbackProof(rollback, candidate) {
  if (
    !rollback || typeof rollback !== "object" || Array.isArray(rollback)
    || rollback.passed !== true
    || rollback.valuesIncluded !== false
    || rollback.credentialsIncluded !== false
    || rollback.piiIncluded !== false
  ) fail("ROLLBACK_SHAPE");
  for (const [name, surface, worker] of [
    ["core", candidate.core, CORE_WORKER],
    ["identity", candidate.identity, IDENTITY_WORKER],
  ]) {
    const proof = rollback[name];
    if (
      !proof
      || proof.rolledBackToIncumbent !== true
      || proof.restoredCandidate !== true
      || exactUuid(proof.incumbentVersionId, `${name.toUpperCase()}_ROLLBACK_INCUMBENT`) !== surface.incumbentVersionId
      || exactUuid(proof.candidateVersionId, `${name.toUpperCase()}_ROLLBACK_CANDIDATE`) !== surface.candidateVersionId
      || String(proof.incumbentReadback?.worker || "") !== worker
      || exactUuid(proof.incumbentReadback?.activeVersionId, `${name.toUpperCase()}_ROLLBACK_READBACK_VERSION`) !== surface.incumbentVersionId
      || !UUID.test(String(proof.incumbentReadback?.activeDeploymentId || ""))
    ) fail(`${name.toUpperCase()}_ROLLBACK`);
  }
  return { passed: true };
}

/**
 * Produces the compact receipt consumed by the isolated Ponto Pages publisher.
 * This is intentionally a control-plane + exposed Identity health proof; the
 * later Pages synthetic smoke proves the private service-binding request path.
 */
export function buildCandidateReceipt({ input, coreDrill, identityDrill, expected = {} }) {
  const candidate = validateCandidateInput(input, expected);
  const core = validateDrillProof(coreDrill, candidate, "coreApi");
  const identity = validateDrillProof(identityDrill, candidate, "identityWorkforce");
  // Keep the raw, already-validated control-plane observation for the
  // existing remote-candidate validator. `validateDrillProof` also returns a
  // normalized form for receipt fields, which intentionally omits provider
  // field names such as `activeVersionId`.
  const compositeState = identityDrill.restoration?.composite;
  const remote = {
    schemaVersion: 1,
    core: compositeState?.core,
    identity: compositeState?.identity,
  };
  const remoteCandidate = validateRemoteCandidate(remote, candidate);
  validateTimekeepingSnapshot(compositeState?.timekeeping, identity.config);
  const rollback = {
    passed: true,
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
    core: {
      rolledBackToIncumbent: true,
      restoredCandidate: true,
      incumbentVersionId: candidate.core.incumbentVersionId,
      candidateVersionId: candidate.core.candidateVersionId,
      incumbentReadback: {
        worker: CORE_WORKER,
        activeVersionId: core.rollback.subject.versionId,
        activeDeploymentId: core.rollback.subject.deploymentId,
      },
    },
    identity: {
      rolledBackToIncumbent: true,
      restoredCandidate: true,
      incumbentVersionId: candidate.identity.incumbentVersionId,
      candidateVersionId: candidate.identity.candidateVersionId,
      incumbentReadback: {
        worker: IDENTITY_WORKER,
        activeVersionId: identity.rollback.subject.versionId,
        activeDeploymentId: identity.rollback.subject.deploymentId,
      },
    },
  };
  validateRollbackProof(rollback, candidate);
  return {
    schemaVersion: 1,
    contractId: CANDIDATE_CONTRACT,
    target: "staging",
    sourceRepository: candidate.source.repository,
    sourceSha: candidate.source.sha,
    sourceTree: candidate.source.tree,
    sourceRef: candidate.source.ref,
    sourceLogicalBranch: candidate.source.logicalBranch,
    sourceRefTargetSha: candidate.source.refTargetSha,
    producer: {
      workflow: ".github/workflows/ponto-core-staging-candidate.yml",
      workflowName: "Ponto Core staging candidate",
      runId: candidate.source.candidateRunId,
    },
    core: {
      service: candidate.core.service,
      versionId: candidate.core.candidateVersionId,
      deploymentId: remoteCandidate.core.deploymentId,
      candidateTag: candidate.core.candidateTag,
      timekeepingVersionId: candidate.timekeeping.candidateVersionId,
    },
    identity: {
      service: candidate.identity.service,
      versionId: candidate.identity.candidateVersionId,
      deploymentId: remoteCandidate.identity.deploymentId,
      candidateTag: candidate.identity.candidateTag,
      timekeepingVersionId: candidate.timekeeping.candidateVersionId,
    },
    readiness: {
      passed: true,
      mode: "canonical-control-plane-and-exposed-identity-health",
    },
    rollback: {
      passed: true,
      mode: "same-artifact-staging-weight-drill",
      core: {
        incumbentVersionId: candidate.core.incumbentVersionId,
        candidateVersionId: candidate.core.candidateVersionId,
        canonicalRunId: candidate.core.runId,
      },
      identity: {
        incumbentVersionId: candidate.identity.incumbentVersionId,
        candidateVersionId: candidate.identity.candidateVersionId,
        canonicalRunId: candidate.identity.runId,
      },
    },
    timekeeping: {
      service: TIMEKEEPING_WORKER,
      configuredPhysicalWorker: identity.timekeeping.configuredPhysicalWorker,
      observedPhysicalWorker: identity.timekeeping.observedWorker,
      versionId: candidate.timekeeping.candidateVersionId,
      deploymentId: identity.composite.timekeeping.deploymentId,
      candidateTag: candidate.timekeeping.candidateTag,
    },
    privateExposure: remoteCandidate.core.exposure,
    coreExposure: remoteCandidate.core.exposure,
    identityExposure: remoteCandidate.identity.exposure,
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function deploymentList(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.deployments) ? result.deployments : [];
}

function latestDeployment(result) {
  return [...deploymentList(result)].sort(
    (left, right) => Date.parse(String(right?.created_on || "")) - Date.parse(String(left?.created_on || "")),
  )[0];
}

function normalizedBindings(bindings) {
  const values = new Map();
  if (!Array.isArray(bindings)) fail("REMOTE_BINDINGS_SHAPE");
  for (const binding of bindings) if (binding?.name) values.set(String(binding.name), binding);
  return values;
}

function safeFailureCode(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function cloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  if (!/^[0-9a-f]{32}$/i.test(String(accountId || ""))) fail("CLOUDFLARE_ACCOUNT_ID");
  if (!String(apiToken || "").trim()) fail("CLOUDFLARE_TOKEN");
  return async (pathname, label, query = {}) => {
    const url = new URL(`https://api.cloudflare.com/client/v4${pathname}`);
    for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${apiToken}`, accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      // Avoid echoing the response: provider errors can reflect sensitive
      // configuration. The stable digest remains useful for troubleshooting.
      fail(`CLOUDFLARE_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${safeFailureCode(response.status)}`);
    }
    return { result: payload.result, resultInfo: payload.result_info || null };
  };
}

async function paginated(get, pathname, label, query = {}) {
  const values = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await get(pathname, label, { ...query, page, per_page: 100 });
    if (!Array.isArray(response.result)) fail(`${label.toUpperCase()}_SHAPE`);
    values.push(...response.result);
    const info = response.resultInfo;
    const totalPages = Number(info?.total_pages || 0);
    const totalCount = Number.isInteger(info?.total_count) ? info.total_count : null;
    if ((totalPages > 0 && page >= totalPages) || (totalCount !== null && values.length >= totalCount) || response.result.length < 100) {
      if (totalCount !== null && values.length !== totalCount) fail(`${label.toUpperCase()}_PAGINATION`);
      return values;
    }
  }
  fail(`${label.toUpperCase()}_PAGINATION`);
}

async function publicExposure(get, accountId, worker) {
  const zones = await paginated(get, "/zones", "zones", { "account.id": accountId });
  if (!zones.length || !zones.every((zone) => /^[0-9a-f]{32}$/i.test(String(zone?.id || "")) && zone?.account?.id === accountId)) {
    fail("ZONE_INVENTORY");
  }
  const routes = [];
  for (const zone of zones) {
    const response = await get(`/zones/${encodeURIComponent(zone.id)}/workers/routes`, "routes");
    if (!Array.isArray(response.result)) fail("ROUTE_INVENTORY");
    for (const route of response.result) {
      if (route?.script === worker || route?.service === worker) routes.push(String(route.pattern || ""));
    }
  }
  const domains = await paginated(get, `/accounts/${encodeURIComponent(accountId)}/workers/domains`, "domains");
  return {
    workerRouteCount: routes.length,
    workerRoutes: routes.sort(),
    customDomainCount: domains.filter((domain) => domain?.script === worker || domain?.service === worker).length,
    customDomains: domains
      .filter((domain) => domain?.script === worker || domain?.service === worker)
      .map((domain) => String(domain.hostname || domain.domain || ""))
      .sort(),
  };
}

async function inspectWorker({ get, accountId, worker, expected, fetchImpl }) {
  const [scripts, exposure, deploymentResponse, subdomainResponse] = await Promise.all([
    get(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`, "scripts"),
    publicExposure(get, accountId, worker),
    get(`/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/deployments`, "deployments"),
    get(`/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/subdomain`, "subdomain"),
  ]);
  if (!Array.isArray(scripts.result) || !scripts.result.some((script) => script?.id === worker)) fail("WORKER_INVENTORY");
  const active = latestDeployment(deploymentResponse.result);
  const activeVersionId = exactUuid(active?.versions?.[0]?.version_id || active?.versions?.[0]?.id, "ACTIVE_VERSION");
  const activeDeploymentId = exactUuid(active?.id, "ACTIVE_DEPLOYMENT");
  if (!Array.isArray(active?.versions) || active.versions.length !== 1 || Number(active.versions[0]?.percentage) !== 100) fail("ACTIVE_TRAFFIC");
  const versionResponse = await get(
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/versions/${encodeURIComponent(activeVersionId)}`,
    "version",
  );
  const version = versionResponse.result;
  if (exactUuid(version?.id, `${expected.code}_VERSION_DETAIL`) !== activeVersionId) fail(`${expected.code}_VERSION_DETAIL`);
  const bindings = normalizedBindings(version?.resources?.bindings);
  const plain = (name) => bindings.get(name)?.type === "plain_text" ? bindings.get(name)?.text : undefined;
  const service = (name) => bindings.get(name)?.type === "service" ? bindings.get(name)?.service : undefined;
  const remote = {
    worker,
    activeVersionId,
    activeDeploymentId,
    versionMessage: String(version?.annotations?.["workers/message"] || ""),
    appVersion: String(plain("APP_VERSION") || ""),
    environment: String(plain("ENVIRONMENT") || ""),
    serviceBinding: expected.serviceBindingName ? String(service(expected.serviceBindingName) || "") : "",
    timekeepingVersionId: String(plain("TIMEKEEPING_VERSION_ID") || "").toLowerCase(),
    routeOnly: plain("PONTO_ROUTE_ONLY") === "true",
    versionMetadata: bindings.get(expected.versionMetadataBindingName || "CF_VERSION_METADATA")?.type === "version_metadata",
    exposure: {
      ...exposure,
      workersDevEnabled: subdomainResponse.result?.enabled === true,
      previewUrlsEnabled: subdomainResponse.result?.previews_enabled === true,
    },
  };
  if (subdomainResponse.result?.enabled !== false || subdomainResponse.result?.previews_enabled !== false) {
    fail(`${expected.code}_SUBDOMAIN`);
  }
  // Keep this assertion local to the collector so a receipt cannot turn an
  // incomplete API snapshot into a successful candidate by omission.
  exactRemoteSurface(remote, expected, expected.code);
  return remote;
}

export async function attestRemoteCandidate({ candidate, accountId, apiToken, fetchImpl = fetch }) {
  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  const [core, identity] = await Promise.all([
    inspectWorker({
      get, accountId, worker: CORE_WORKER,
      expected: {
        code: "CORE", worker: CORE_WORKER, versionId: candidate.core.candidateVersionId,
        tag: candidate.core.candidateTag, sourceSha: candidate.source.sha,
        serviceBinding: TIMEKEEPING_WORKER, serviceBindingName: "TIMEKEEPING",
        timekeepingVersionId: candidate.timekeeping.candidateVersionId,
        routeOnly: true, versionMetadata: true, routes: [],
      },
      fetchImpl,
    }),
    inspectWorker({
      get, accountId, worker: IDENTITY_WORKER,
      expected: {
        code: "IDENTITY", worker: IDENTITY_WORKER, versionId: candidate.identity.candidateVersionId,
        tag: candidate.identity.candidateTag, sourceSha: candidate.source.sha,
        serviceBinding: TIMEKEEPING_WORKER, serviceBindingName: "WORKFORCE",
        timekeepingVersionId: candidate.timekeeping.candidateVersionId,
        versionMetadata: true, routes: [IDENTITY_ROUTE],
      },
      fetchImpl,
    }),
  ]);
  return { schemaVersion: 1, core, identity, valuesIncluded: false, credentialsIncluded: false, piiIncluded: false };
}

/**
 * Captures the control-plane point between rollback and restoration. The
 * incumbent may predate the current source SHA, so identity is bound only to
 * its exact UUID plus the permanent staging exposure and service contract.
 */
export async function attestRollbackIncumbents({ candidate, accountId, apiToken, fetchImpl = fetch }) {
  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  const [core, identity] = await Promise.all([
    inspectWorker({
      get, accountId, worker: CORE_WORKER,
      expected: {
        code: "CORE_ROLLBACK", worker: CORE_WORKER, versionId: candidate.core.incumbentVersionId,
        serviceBinding: TIMEKEEPING_WORKER, serviceBindingName: "TIMEKEEPING",
        routeOnly: true, versionMetadata: true, routes: [],
      },
      fetchImpl,
    }),
    inspectWorker({
      get, accountId, worker: IDENTITY_WORKER,
      expected: {
        code: "IDENTITY_ROLLBACK", worker: IDENTITY_WORKER, versionId: candidate.identity.incumbentVersionId,
        serviceBinding: TIMEKEEPING_WORKER, serviceBindingName: "WORKFORCE",
        versionMetadata: true, routes: [IDENTITY_ROUTE],
      },
      fetchImpl,
    }),
  ]);
  return { schemaVersion: 1, core, identity, valuesIncluded: false, credentialsIncluded: false, piiIncluded: false };
}

export async function probeIdentityHealth({ candidate, fetchImpl = fetch }) {
  const url = new URL("https://api-staging.skincos.com.br/insumos/health");
  url.searchParams.set("ponto_core_candidate_probe", `${Date.now()}-${crypto.randomUUID()}`);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  const result = {
    passed: response.status === 200
      && payload?.ok === true
      && payload?.ready === true
      && String(payload?.version || "").toLowerCase() === candidate.source.sha
      && String(payload?.environment || "") === "staging"
      && String(payload?.workerVersion?.id || "").toLowerCase() === candidate.identity.candidateVersionId
      && String(payload?.workerVersion?.tag || "") === candidate.identity.candidateTag,
    version: String(payload?.version || "").toLowerCase(),
    environment: String(payload?.environment || ""),
    workerVersionId: String(payload?.workerVersion?.id || "").toLowerCase(),
    workerVersionTag: String(payload?.workerVersion?.tag || ""),
    credentialsIncluded: false,
    piiIncluded: false,
  };
  validateIdentityHealth(result, candidate);
  return result;
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(code);
  }
}

function writeJson(file, payload) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function expectedFromEnv() {
  const expected = {};
  if (process.env.PONTO_CANDIDATE_SOURCE_REPOSITORY) expected.repository = process.env.PONTO_CANDIDATE_SOURCE_REPOSITORY;
  if (process.env.PONTO_CANDIDATE_SOURCE_SHA) expected.sourceSha = process.env.PONTO_CANDIDATE_SOURCE_SHA;
  if (process.env.PONTO_CANDIDATE_SOURCE_TREE) expected.sourceTree = process.env.PONTO_CANDIDATE_SOURCE_TREE;
  if (process.env.PONTO_CANDIDATE_RUN_ID) expected.candidateRunId = process.env.PONTO_CANDIDATE_RUN_ID;
  return expected;
}

async function retryRemoteAttestation(operation) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "assert-drill-source") {
    const [outputFile] = args;
    if (!outputFile) fail("USAGE");
    writeJson(outputFile, validateCanonicalDrillSource({
      ref: process.env.PONTO_DRILL_SOURCE_REF,
      sha: process.env.PONTO_DRILL_SOURCE_SHA,
      releaseSha: process.env.PONTO_DRILL_RELEASE_SHA,
      refTargetSha: process.env.PONTO_DRILL_SOURCE_REF_TARGET_SHA,
      runAttempt: process.env.PONTO_DRILL_RUN_ATTEMPT,
    }));
    return;
  }
  if (command === "validate-input") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    writeJson(outputFile, validateCandidateInput(readJson(inputFile, "INPUT_JSON"), expectedFromEnv()));
    return;
  }
  if (command === "attest-remote") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    const candidate = validateCandidateInput(readJson(inputFile, "INPUT_JSON"), expectedFromEnv());
    writeJson(outputFile, await retryRemoteAttestation(() => attestRemoteCandidate({
      candidate,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
    })));
    return;
  }
  if (command === "probe-identity") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    const candidate = validateCandidateInput(readJson(inputFile, "INPUT_JSON"), expectedFromEnv());
    writeJson(outputFile, await retryRemoteAttestation(() => probeIdentityHealth({ candidate })));
    return;
  }
  if (command === "attest-rollback-incumbents") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    const candidate = validateCandidateInput(readJson(inputFile, "INPUT_JSON"), expectedFromEnv());
    writeJson(outputFile, await retryRemoteAttestation(() => attestRollbackIncumbents({
      candidate,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
    })));
    return;
  }
  if (command === "attest-drill-state") {
    const [inputFile, phase, outputFile] = args;
    if (!inputFile || !phase || !outputFile) fail("USAGE");
    writeJson(outputFile, await retryRemoteAttestation(() => attestDrillState({
      config: readJson(inputFile, "DRILL_INPUT_JSON"),
      phase,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
    })));
    return;
  }
  if (command === "preflight-timekeeping-worker") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    const report = await retryRemoteAttestation(() => preflightTimekeepingWorker({
      config: readJson(inputFile, "DRILL_INPUT_JSON"),
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
    }));
    writeJson(outputFile, report);
    if (!report.passed) {
      fail(`TIMEKEEPING_PHYSICAL_${String(report.observed?.state || "unavailable").toUpperCase()}`);
    }
    return;
  }
  if (command === "build-drill-proof") {
    const [inputFile, beforeFile, rollbackFile, restorationFile, compositeFile, readinessFile, contextFile, outputFile] = args;
    if (!inputFile || !beforeFile || !rollbackFile || !restorationFile || !readinessFile || !contextFile || !outputFile) fail("USAGE");
    writeJson(outputFile, buildDrillProof({
      config: readJson(inputFile, "DRILL_INPUT_JSON"),
      before: readJson(beforeFile, "DRILL_BEFORE_JSON"),
      rollback: readJson(rollbackFile, "DRILL_ROLLBACK_JSON"),
      restoration: readJson(restorationFile, "DRILL_RESTORATION_JSON"),
      composite: compositeFile === "-" ? null : readJson(compositeFile, "DRILL_COMPOSITE_JSON"),
      readiness: readJson(readinessFile, "DRILL_READINESS_JSON"),
      context: readJson(contextFile, "DRILL_CONTEXT_JSON"),
    }));
    return;
  }
  if (command === "probe-drill-identity") {
    const [inputFile, outputFile] = args;
    if (!inputFile || !outputFile) fail("USAGE");
    writeJson(outputFile, await retryRemoteAttestation(() => probeDrillIdentity({
      config: readJson(inputFile, "DRILL_INPUT_JSON"),
    })));
    return;
  }
  if (command === "build-receipt") {
    const [inputFile, coreDrillFile, identityDrillFile, outputFile] = args;
    if (!inputFile || !coreDrillFile || !identityDrillFile || !outputFile) fail("USAGE");
    writeJson(outputFile, buildCandidateReceipt({
      input: readJson(inputFile, "INPUT_JSON"),
      coreDrill: readJson(coreDrillFile, "CORE_DRILL_JSON"),
      identityDrill: readJson(identityDrillFile, "IDENTITY_DRILL_JSON"),
      expected: expectedFromEnv(),
    }));
    return;
  }
  fail("USAGE");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = String(error?.message || error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
