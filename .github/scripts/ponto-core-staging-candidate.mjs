import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[1-9][0-9]*$/;
const CANDIDATE_CONTRACT = "skincos/ponto-core-staging-candidate/v1";
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
  if (!["main", `skincos/release/ponto/${sourceSha}`].includes(headBranch)) fail(`${code}_RUN_BRANCH`);
  return { runId, headSha, headBranch };
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

  return {
    source: { repository: sourceRepository, sha: sourceSha, tree: sourceTree, candidateRunId },
    timekeeping: { ...timekeeping, runId: timekeepingRun.runId },
    core: { ...core, runId: coreRun.runId, service: CORE_WORKER },
    identity: { ...identity, runId: identityRun.runId, service: IDENTITY_WORKER },
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
export function buildCandidateReceipt({ input, remote, identityHealth, rollback, expected = {} }) {
  const candidate = validateCandidateInput(input, expected);
  const remoteCandidate = validateRemoteCandidate(remote, candidate);
  validateIdentityHealth(identityHealth, candidate);
  validateRollbackProof(rollback, candidate);
  return {
    schemaVersion: 1,
    contractId: CANDIDATE_CONTRACT,
    target: "staging",
    sourceRepository: candidate.source.repository,
    sourceSha: candidate.source.sha,
    sourceTree: candidate.source.tree,
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
      mode: "control-plane-and-exposed-identity-health",
    },
    rollback: {
      passed: true,
      mode: "same-artifact-staging-weight-drill",
      core: {
        incumbentVersionId: candidate.core.incumbentVersionId,
        candidateVersionId: candidate.core.candidateVersionId,
      },
      identity: {
        incumbentVersionId: candidate.identity.incumbentVersionId,
        candidateVersionId: candidate.identity.candidateVersionId,
      },
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
    serviceBinding: String(service(expected.serviceBindingName) || ""),
    timekeepingVersionId: String(plain("TIMEKEEPING_VERSION_ID") || "").toLowerCase(),
    routeOnly: plain("PONTO_ROUTE_ONLY") === "true",
    versionMetadata: bindings.get("CF_VERSION_METADATA")?.type === "version_metadata",
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
  if (command === "build-receipt") {
    const [inputFile, remoteFile, healthFile, rollbackFile, outputFile] = args;
    if (!inputFile || !remoteFile || !healthFile || !rollbackFile || !outputFile) fail("USAGE");
    writeJson(outputFile, buildCandidateReceipt({
      input: readJson(inputFile, "INPUT_JSON"),
      remote: readJson(remoteFile, "REMOTE_JSON"),
      identityHealth: readJson(healthFile, "HEALTH_JSON"),
      rollback: readJson(rollbackFile, "ROLLBACK_JSON"),
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
