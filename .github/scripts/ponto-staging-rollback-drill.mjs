import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isTerminalPagesDeployment } from "./ponto-rollback-ownership.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const WORKER_SURFACES = ["timekeeping", "identityWorkforce", "coreApi"];
const SURFACE_SOURCE_PATTERNS = {
  timekeeping: /ponto:timekeeping:([0-9a-f]{40})/i,
  identityWorkforce: /ponto:identityWorkforce:([0-9a-f]{40})/i,
  coreApi: /ponto:coreApi:([0-9a-f]{40})/i,
};

class DrillFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "DrillFailure";
    this.code = code;
  }
}

const digest = (value) => crypto.createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(value),
).digest("hex");

const publicFailureCode = (error) => (
  error instanceof DrillFailure && /^[A-Z0-9_]{3,80}$/.test(error.code)
    ? error.code
    : "UNEXPECTED_FAILURE"
);

export function validateSourceEvidence(sourceSha, expectedSha = null) {
  const normalized = String(sourceSha || "").trim().toLowerCase() || null;
  if (normalized !== null && !SHA.test(normalized)) {
    throw new DrillFailure("SOURCE_SHA_INVALID");
  }
  if (expectedSha !== null) {
    const expected = String(expectedSha || "").trim().toLowerCase();
    if (!SHA.test(expected)) throw new DrillFailure("EXPECTED_SOURCE_SHA_INVALID");
    if (normalized !== expected) throw new DrillFailure("SOURCE_SHA_MISMATCH");
  }
  return normalized;
}

export function validateIncumbentProvenance(ids, evidence) {
  if (evidence?.passed !== true) throw new DrillFailure("INCUMBENT_CONTROL_PLANE_INVALID");
  const validated = { passed: true };
  for (const surface of WORKER_SURFACES) {
    const proof = evidence[surface];
    if (
      proof?.passed !== true
      || proof.worker !== ids[surface].worker
      || String(proof.versionId || "").toLowerCase() !== ids[surface].incumbent.toLowerCase()
    ) throw new DrillFailure("INCUMBENT_CONTROL_PLANE_INVALID");
    validated[surface] = {
      passed: true,
      worker: ids[surface].worker,
      versionId: ids[surface].incumbent,
      sourceSha: validateSourceEvidence(proof.sourceSha),
    };
  }
  const pages = evidence.crmPages;
  if (
    pages?.passed !== true
    || String(pages.deploymentId || "").toLowerCase() !== ids.crmPages.incumbent.toLowerCase()
  ) throw new DrillFailure("INCUMBENT_CONTROL_PLANE_INVALID");
  validated.crmPages = {
    passed: true,
    deploymentId: ids.crmPages.incumbent,
    sourceSha: validateSourceEvidence(pages.sourceSha),
  };
  return validated;
}

const versionSet = (ids, side) => ({
  timekeeping: ids.timekeeping[side],
  coreApi: ids.coreApi[side],
  identityWorkforce: ids.identityWorkforce[side],
});

const baseReport = (config) => ({
  schemaVersion: 2,
  releaseSha: config.releaseSha,
  runId: config.runId,
  orchestratorRunId: config.orchestratorRunId,
  predecessor: {
    workflow: "timekeeping-staging-journey.yml",
    runId: config.predecessorRunId,
  },
  startedAt: new Date().toISOString(),
  preflight: { attempted: false, passed: false },
  rollback: { attempted: false, passed: false, surfaces: {} },
  moduleControl: {
    incumbentActive: { attempted: false, passed: false },
    preRestorationMaintenance: { attempted: false, passed: false },
    candidateActive: { attempted: false, passed: false },
    finalMaintenance: { attempted: false, passed: false },
    preFailureCompensationMaintenance: { attempted: false, passed: false },
    postCompensationMaintenance: { attempted: false, passed: false },
  },
  restoration: { attempted: false, passed: false, surfaces: {} },
  failureCompensation: { attempted: false, passed: false, surfaces: {} },
  functionalValidation: {
    implemented: true,
    incumbentJourney: { attempted: false, passed: false },
    protectedCandidateContract: { attempted: false, passed: false },
    candidateJourney: { attempted: false, passed: false },
  },
  teardown: {
    incumbent: { attempted: false, passed: false },
    candidate: { attempted: false, passed: false },
  },
  failures: [],
  passed: false,
  credentialsIncluded: false,
  piiIncluded: false,
});

const recordFailure = (report, phase, error) => {
  report.failures.push({ phase, code: publicFailureCode(error) });
};

async function mutateEverySurface({
  config,
  runtime,
  phase,
  side,
  expectedSha,
  report,
}) {
  const target = report[phase];
  target.attempted = true;
  for (const surface of WORKER_SURFACES) {
    try {
      target.surfaces[surface] = await runtime.deployWorker(
        surface,
        config.ids[surface][side],
        phase,
        expectedSha,
      );
    } catch (error) {
      target.surfaces[surface] = {
        passed: false,
        worker: config.ids[surface].worker,
        versionId: config.ids[surface][side],
        reason: `${phase}-failed`,
      };
      recordFailure(report, `${phase}.${surface}`, error);
    }
  }

  try {
    target.surfaces.crmPages = await runtime.deployPages(
      config.ids.crmPages[side],
      phase,
      expectedSha,
    );
  } catch (error) {
    target.surfaces.crmPages = {
      passed: false,
      sourceDeploymentId: config.ids.crmPages[side],
      reason: `${phase}-failed`,
    };
    recordFailure(report, `${phase}.crmPages`, error);
  }

  target.passed = Object.keys(target.surfaces).length === 4
    && Object.values(target.surfaces).every((surface) => surface?.passed === true);
  return target.surfaces.crmPages;
}

async function validateFixture({
  label,
  pages,
  expected,
  includeProtectedContract,
  runtime,
  report,
}) {
  let handle;
  let fixtureReady = false;
  try {
    handle = await runtime.prepareFixture(label);
    await runtime.provisionFixture(handle);
    fixtureReady = true;
  } catch (error) {
    recordFailure(report, `${label}.provision`, error);
  }

  if (fixtureReady && includeProtectedContract) {
    report.functionalValidation.protectedCandidateContract.attempted = true;
    try {
      report.functionalValidation.protectedCandidateContract = {
        attempted: true,
        ...await runtime.verifyProtectedContract(handle, pages.url, expected),
      };
    } catch (error) {
      recordFailure(report, `${label}.protected-contract`, error);
    }
  }

  const journeyKey = label === "incumbent" ? "incumbentJourney" : "candidateJourney";
  if (fixtureReady && (!includeProtectedContract || report.functionalValidation.protectedCandidateContract.passed)) {
    report.functionalValidation[journeyKey].attempted = true;
    try {
      report.functionalValidation[journeyKey] = {
        attempted: true,
        ...await runtime.runJourney(handle, pages.url, expected),
      };
    } catch (error) {
      recordFailure(report, `${label}.journey`, error);
    }
  }

  if (handle) {
    report.teardown[label].attempted = true;
    try {
      report.teardown[label] = {
        attempted: true,
        ...await runtime.teardownFixture(handle),
      };
      if (!report.teardown[label].passed) {
        recordFailure(report, `${label}.teardown`, new DrillFailure("TEARDOWN_ATTESTATION_FAILED"));
      }
    } catch (error) {
      recordFailure(report, `${label}.teardown`, error);
    }
  }
}

export async function runStagingRollbackDrill(config, runtime) {
  const report = baseReport(config);
  let rollbackPages = null;
  let restoredPages = null;
  let mutationStarted = false;

  report.preflight.attempted = true;
  try {
    const preflight = await runtime.attestInitialState(config);
    const incumbents = validateIncumbentProvenance(config.ids, preflight.incumbents);
    report.preflight = {
      attempted: true,
      passed: true,
      moduleControl: preflight.moduleControl,
      surfaces: preflight.surfaces,
      incumbents,
    };
  } catch (error) {
    recordFailure(report, "preflight", error);
  }

  if (report.preflight.passed) {
    mutationStarted = true;
    rollbackPages = await mutateEverySurface({
      config,
      runtime,
      phase: "rollback",
      side: "incumbent",
      expectedSha: null,
      report,
    });

    if (report.rollback.passed) {
      report.moduleControl.incumbentActive.attempted = true;
      try {
        report.moduleControl.incumbentActive = {
          attempted: true,
          ...await runtime.setModuleState("active", {
            // The drill's signed coordinator lease covers this direct mutation;
            // incumbent source evidence remains independently attested per surface.
            releaseSha: config.releaseSha,
            versions: versionSet(config.ids, "incumbent"),
          }, "incumbent-active"),
        };
      } catch (error) {
        recordFailure(report, "module-control.incumbent-active", error);
      }

      if (report.moduleControl.incumbentActive.passed) {
        await validateFixture({
          label: "incumbent",
          pages: rollbackPages,
          expected: {
            releaseSha: config.releaseSha,
            sourceSha: null,
            pagesActiveDeploymentId: rollbackPages.activeDeploymentId,
            timekeepingVersionId: config.ids.timekeeping.incumbent,
            identityVersionId: config.ids.identityWorkforce.incumbent,
            coreVersionId: config.ids.coreApi.incumbent,
          },
          includeProtectedContract: false,
          runtime,
          report,
        });
      }
    }
  }

  if (mutationStarted) {
    report.moduleControl.preRestorationMaintenance.attempted = true;
    try {
      report.moduleControl.preRestorationMaintenance = {
        attempted: true,
        ...await runtime.setModuleState("maintenance", {}, "pre-restoration-maintenance"),
      };
    } catch (error) {
      recordFailure(report, "module-control.pre-restoration-maintenance", error);
    }

    restoredPages = await mutateEverySurface({
      config,
      runtime,
      phase: "restoration",
      side: "candidate",
      expectedSha: config.releaseSha,
      report,
    });

    if (report.restoration.passed && report.moduleControl.preRestorationMaintenance.passed) {
      report.moduleControl.candidateActive.attempted = true;
      try {
        report.moduleControl.candidateActive = {
          attempted: true,
          ...await runtime.setModuleState("active", {
            releaseSha: config.releaseSha,
            versions: versionSet(config.ids, "candidate"),
          }, "candidate-active"),
        };
      } catch (error) {
        recordFailure(report, "module-control.candidate-active", error);
      }

      if (report.moduleControl.candidateActive.passed) {
        await validateFixture({
          label: "candidate",
          pages: restoredPages,
          expected: {
            releaseSha: config.releaseSha,
            sourceSha: config.releaseSha,
            pagesActiveDeploymentId: restoredPages.activeDeploymentId,
            timekeepingVersionId: config.ids.timekeeping.candidate,
            identityVersionId: config.ids.identityWorkforce.candidate,
            coreVersionId: config.ids.coreApi.candidate,
          },
          includeProtectedContract: true,
          runtime,
          report,
        });
      }
    }
  }

  report.moduleControl.finalMaintenance.attempted = true;
  try {
    report.moduleControl.finalMaintenance = {
      attempted: true,
      ...await runtime.setModuleState("maintenance", {}, "final-maintenance"),
    };
  } catch (error) {
    recordFailure(report, "module-control.final-maintenance", error);
  }

  const normalPassed = report.failures.length === 0
    && report.preflight.passed
    && report.rollback.passed
    && report.moduleControl.incumbentActive.passed
    && report.functionalValidation.incumbentJourney.passed
    && report.teardown.incumbent.passed
    && report.moduleControl.preRestorationMaintenance.passed
    && report.restoration.passed
    && report.moduleControl.candidateActive.passed
    && report.functionalValidation.protectedCandidateContract.passed
    && report.functionalValidation.candidateJourney.passed
    && report.teardown.candidate.passed
    && report.moduleControl.finalMaintenance.passed;

  if (mutationStarted && !normalPassed) {
    if (report.moduleControl.finalMaintenance.passed) {
      report.moduleControl.preFailureCompensationMaintenance = {
        attempted: false,
        passed: true,
        reusedFinalMaintenance: true,
        state: "maintenance",
      };
    } else {
      report.moduleControl.preFailureCompensationMaintenance.attempted = true;
      try {
        report.moduleControl.preFailureCompensationMaintenance = {
          attempted: true,
          ...await runtime.setModuleState("maintenance", {}, "pre-failure-compensation-maintenance"),
        };
      } catch (error) {
        recordFailure(report, "module-control.pre-failure-compensation-maintenance", error);
      }
    }

    if (report.moduleControl.preFailureCompensationMaintenance.passed) {
      await mutateEverySurface({
        config,
        runtime,
        phase: "failureCompensation",
        side: "incumbent",
        expectedSha: null,
        report,
      });
    }

    report.moduleControl.postCompensationMaintenance.attempted = true;
    try {
      report.moduleControl.postCompensationMaintenance = {
        attempted: true,
        ...await runtime.setModuleState("maintenance", {}, "post-compensation-maintenance"),
      };
    } catch (error) {
      recordFailure(report, "module-control.post-compensation-maintenance", error);
    }
  }

  report.recovery = {
    required: mutationStarted && !normalPassed,
    passed: !mutationStarted || normalPassed || (
      report.failureCompensation.passed
      && report.moduleControl.preFailureCompensationMaintenance.passed
      && report.moduleControl.postCompensationMaintenance.passed
    ),
    disposition: normalPassed
      ? "candidate-restored-under-maintenance"
      : (report.failureCompensation.passed ? "incumbents-restored-under-maintenance" : "unresolved"),
  };
  report.completedAt = new Date().toISOString();
  report.passed = normalPassed;
  return report;
}

const requireValue = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new DrillFailure(`MISSING_${name.replaceAll(/[^A-Z0-9]/g, "_")}`);
  return value;
};

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const reportFile = String(argv[0] || "").trim();
  const releaseSha = requireValue(env, "RELEASE_SHA").toLowerCase();
  const runId = requireValue(env, "GITHUB_RUN_ID");
  const repository = requireValue(env, "GITHUB_REPOSITORY");
  const repositoryId = requireValue(env, "GITHUB_REPOSITORY_ID");
  const orchestratorRunId = requireValue(env, "ORCHESTRATOR_RUN_ID");
  const orchestratorStage = requireValue(env, "ORCHESTRATOR_STAGE");
  const predecessorRunId = requireValue(env, "STAGING_JOURNEY_RUN_ID");
  const accountId = requireValue(env, "CLOUDFLARE_ACCOUNT_ID").toLowerCase();
  const apiToken = requireValue(env, "CLOUDFLARE_API_TOKEN");
  const idempotencyKey = requireValue(env, "PONTO_IDEMPOTENCY_KEY");
  const releaseProbeKey = crypto.createHmac("sha256", idempotencyKey)
    .update("skincos/ponto/release-probe/v1")
    .digest("base64url");
  const moduleControlNamespaceId = requireValue(env, "PONTO_MODULE_CONTROL_STAGING_KV_ID").toLowerCase();
  const runnerTemp = requireValue(env, "RUNNER_TEMP");
  const pagesProject = requireValue(env, "PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING");
  const ids = {
    timekeeping: {
      worker: "skincos-timekeeping-staging",
      candidate: requireValue(env, "TIMEKEEPING_CANDIDATE_VERSION_ID"),
      incumbent: requireValue(env, "TIMEKEEPING_INCUMBENT_VERSION_ID"),
    },
    identityWorkforce: {
      worker: "skincos-insumos-staging",
      candidate: requireValue(env, "IDENTITY_CANDIDATE_VERSION_ID"),
      incumbent: requireValue(env, "IDENTITY_INCUMBENT_VERSION_ID"),
    },
    coreApi: {
      worker: "skincos-ponto-core-staging",
      candidate: requireValue(env, "CORE_CANDIDATE_VERSION_ID"),
      incumbent: requireValue(env, "CORE_INCUMBENT_VERSION_ID"),
    },
    crmPages: {
      candidate: requireValue(env, "PAGES_CANDIDATE_DEPLOYMENT_ID"),
      incumbent: requireValue(env, "PAGES_INCUMBENT_DEPLOYMENT_ID"),
    },
  };

  if (!reportFile) throw new DrillFailure("REPORT_PATH_REQUIRED");
  if (!SHA.test(releaseSha)) throw new DrillFailure("RELEASE_SHA_INVALID");
  if (![runId, orchestratorRunId, predecessorRunId].every((value) => /^[0-9]{1,20}$/.test(value))) {
    throw new DrillFailure("RUN_PROVENANCE_INVALID");
  }
  if (orchestratorStage !== "staging") throw new DrillFailure("DRILL_STAGE_INVALID");
  if (!repository.includes("/") || !/^[1-9][0-9]*$/.test(repositoryId) || !/^[0-9a-f]{32}$/.test(accountId) || !/^[0-9a-f]{32}$/.test(moduleControlNamespaceId)) {
    throw new DrillFailure("STAGING_CUSTODY_INVALID");
  }
  if (Buffer.byteLength(idempotencyKey, "utf8") < 32) throw new DrillFailure("IDEMPOTENCY_KEY_INVALID");
  if (pagesProject !== "skincos-staging") throw new DrillFailure("PAGES_PROJECT_INVALID");
  for (const [surface, identity] of Object.entries(ids)) {
    if (
      !UUID.test(identity.candidate)
      || !UUID.test(identity.incumbent)
      || identity.candidate.toLowerCase() === identity.incumbent.toLowerCase()
    ) throw new DrillFailure(`${surface.toUpperCase()}_IDENTITIES_INVALID`);
  }
  const accessId = String(env.CF_ACCESS_CLIENT_ID || "");
  const accessSecret = String(env.CF_ACCESS_CLIENT_SECRET || "");
  if (Boolean(accessId) !== Boolean(accessSecret)) throw new DrillFailure("ACCESS_CREDENTIAL_PARTIAL");
  if (
    String(env.STAGING_CORE_D1_DATABASE || "skincos-db-staging") !== "skincos-db-staging"
    || String(env.STAGING_TIMEKEEPING_D1_DATABASE || "skincos-timekeeping-staging") !== "skincos-timekeeping-staging"
  ) throw new DrillFailure("D1_TARGET_INVALID");

  return {
    reportFile,
    releaseSha,
    runId,
    repository,
    repositoryId,
    orchestratorRunId,
    orchestratorStage,
    predecessorRunId,
    accountId,
    apiToken,
    releaseProbeKey,
    moduleControlNamespaceId,
    runnerTemp,
    pagesProject,
    ids,
    accessHeaders: accessId ? {
      "CF-Access-Client-Id": accessId,
      "CF-Access-Client-Secret": accessSecret,
    } : {},
    coreDatabase: "skincos-db-staging",
    timekeepingDatabase: "skincos-timekeeping-staging",
  };
}

function createRealRuntime(config, env = process.env) {
  const runCommand = (command, args, options = {}) => {
    const childEnv = { ...env, ...(options.env || {}) };
    delete childEnv.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY;
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: childEnv,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) throw new DrillFailure(options.code || "GOVERNED_COMMAND_FAILED");
    return result.stdout;
  };
  const wrangler = (args, code = "WRANGLER_COMMAND_FAILED") => runCommand(
    "npx",
    ["--yes", "wrangler@4.112.0", ...args],
    { code },
  );
  const wranglerJson = (args, code) => {
    try {
      return JSON.parse(wrangler(args, code));
    } catch (error) {
      if (error instanceof DrillFailure) throw error;
      throw new DrillFailure("WRANGLER_JSON_INVALID");
    }
  };
  const cloudflare = async (pathname, init = {}) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) throw new DrillFailure("CLOUDFLARE_API_FAILED");
    return payload.result;
  };

  const workerStatus = (surface) => {
    const payload = wranglerJson([
      "deployments",
      "status",
      "--name",
      config.ids[surface].worker,
      "--json",
    ], "WORKER_STATUS_FAILED");
    return payload;
  };
  const assertWorkerAt = (surface, expectedVersionId) => {
    const payload = workerStatus(surface);
    const versions = payload.versions || payload.latest?.versions || [];
    const passed = versions.length === 1
      && String(versions[0]?.version_id || versions[0]?.id || "").toLowerCase() === expectedVersionId.toLowerCase()
      && Number(versions[0]?.percentage) === 100;
    if (!passed) throw new DrillFailure("WORKER_CONTROL_PLANE_MISMATCH");
    return {
      passed: true,
      worker: config.ids[surface].worker,
      versionId: expectedVersionId,
      deploymentId: String(payload.id || payload.deployment_id || payload.latest?.id || ""),
      percentage: 100,
    };
  };
  const collectVersionShas = (value, surface, output = new Set()) => {
    if (typeof value === "string") {
      const match = value.match(SURFACE_SOURCE_PATTERNS[surface]);
      if (match) output.add(match[1].toLowerCase());
      return output;
    }
    if (!value || typeof value !== "object") return output;
    const bindingName = String(value.name || value.binding || value.key || "").toUpperCase();
    if (bindingName === "APP_VERSION") {
      for (const candidate of [value.value, value.text, value.plain_text, value.content]) {
        if (SHA.test(String(candidate || ""))) output.add(String(candidate).toLowerCase());
      }
    }
    for (const nested of Object.values(value)) collectVersionShas(nested, surface, output);
    return output;
  };
  const workerVersionDetails = (surface, versionId) => {
    const view = wranglerJson([
      "versions",
      "view",
      versionId,
      "--name",
      config.ids[surface].worker,
      "--json",
    ], "WORKER_VERSION_VIEW_FAILED");
    const returnedVersionId = String(view?.id || view?.version_id || view?.versionId || "");
    if (returnedVersionId && returnedVersionId.toLowerCase() !== versionId.toLowerCase()) {
      throw new DrillFailure("WORKER_VERSION_ID_MISMATCH");
    }
    const values = [...collectVersionShas(view, surface)];
    if (values.length > 1) throw new DrillFailure("WORKER_SOURCE_PROVENANCE_INVALID");
    return {
      passed: true,
      worker: config.ids[surface].worker,
      versionId,
      sourceSha: validateSourceEvidence(values[0]),
    };
  };
  const assertWorkerSource = (surface, versionId, expectedSha) => {
    const details = workerVersionDetails(surface, versionId);
    try {
      validateSourceEvidence(details.sourceSha, expectedSha);
    } catch (error) {
      if (error instanceof DrillFailure && error.code === "SOURCE_SHA_MISMATCH") {
        throw new DrillFailure("WORKER_SOURCE_SHA_MISMATCH");
      }
      throw error;
    }
    return details;
  };

  const pagesPath = `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(config.pagesProject)}`;
  const pagesDeployment = async (deploymentId) => cloudflare(
    `${pagesPath}/deployments/${encodeURIComponent(deploymentId)}`,
  );
  const pageDetails = (deployment, { allowPending = false } = {}) => {
    const id = String(deployment?.id || "");
    const url = String(deployment?.url || "");
    const status = String(deployment?.latest_stage?.status || "").toLowerCase();
    const rawCommitHash = String(
      deployment?.deployment_trigger?.metadata?.commit_hash || "",
    ).trim().toLowerCase();
    const commitHash = SHA.test(rawCommitHash) ? rawCommitHash : null;
    const terminal = isTerminalPagesDeployment(deployment);
    const pending = ["active", "queued", "waiting", "pending", "building", "initializing"].includes(status);
    let origin;
    try { origin = new URL(url); } catch { throw new DrillFailure("PAGES_DEPLOYMENT_INVALID"); }
    if (
      !UUID.test(id)
      || deployment?.environment !== "production"
      || (!terminal && !(allowPending && pending))
      || origin.protocol !== "https:"
      || !origin.hostname.endsWith(".skincos-staging.pages.dev")
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) throw new DrillFailure("PAGES_DEPLOYMENT_INVALID");
    return { id, url: origin.href, status, commitHash, terminal };
  };
  const pagesDeploymentDetails = async (deploymentId) => {
    const details = pageDetails(await pagesDeployment(deploymentId));
    if (details.id.toLowerCase() !== deploymentId.toLowerCase()) {
      throw new DrillFailure("PAGES_DEPLOYMENT_ID_MISMATCH");
    }
    return details;
  };
  const latestPagesDeployment = async ({ allowPending = false } = {}) => {
    const deployments = await cloudflare(`${pagesPath}/deployments?env=production&per_page=25`);
    const ordered = (Array.isArray(deployments) ? deployments : [])
      .filter((item) => item?.environment === "production")
      .sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)));
    if (!ordered[0]) throw new DrillFailure("PAGES_LATEST_DEPLOYMENT_MISSING");
    return pageDetails(ordered[0], { allowPending });
  };
  const assertPagesActive = async (deploymentId, expectedSha = null) => {
    const source = await pagesDeploymentDetails(deploymentId);
    const latest = await latestPagesDeployment();
    if (source.id.toLowerCase() !== latest.id.toLowerCase()) {
      throw new DrillFailure("PAGES_CONTROL_PLANE_MISMATCH");
    }
    if (expectedSha !== null) {
      try {
        validateSourceEvidence(source.commitHash, expectedSha);
      } catch (error) {
        if (error instanceof DrillFailure && error.code === "SOURCE_SHA_MISMATCH") {
          throw new DrillFailure("PAGES_SOURCE_SHA_MISMATCH");
        }
        throw error;
      }
    }
    return source;
  };

  const readModuleControl = () => {
    const raw = wrangler([
      "kv",
      "key",
      "get",
      "module-control:timekeeping",
      "--namespace-id",
      config.moduleControlNamespaceId,
      "--remote",
    ], "MODULE_CONTROL_READ_FAILED");
    try {
      return JSON.parse(raw);
    } catch {
      throw new DrillFailure("MODULE_CONTROL_INVALID");
    }
  };
  const readEmergencyLatch = () => {
    const raw = wrangler([
      "kv",
      "key",
      "get",
      "module-control:timekeeping:emergency-latch",
      "--namespace-id",
      config.moduleControlNamespaceId,
      "--remote",
    ], "EMERGENCY_LATCH_READ_FAILED");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new DrillFailure("EMERGENCY_LATCH_INVALID");
    }
    if (
      value?.schemaVersion !== 1
      || value?.module !== "timekeeping"
      || value?.latched !== false
      || !Number.isFinite(Date.parse(String(value?.changedAt || "")))
      || !String(value?.changedBy || "").trim()
    ) throw new DrillFailure("EMERGENCY_LATCH_NOT_OPEN");
    return {
      passed: true,
      latched: false,
      changedAt: value.changedAt,
    };
  };
  const assertModuleControl = (state, details = {}) => {
    const value = readModuleControl();
    if (value?.state !== state) throw new DrillFailure("MODULE_CONTROL_STATE_MISMATCH");
    if (state === "active") {
      if (
        value.schemaVersion !== 2
        || value.syntheticOnly !== true
        || value.releaseSha !== details.releaseSha
      ) throw new DrillFailure("MODULE_CONTROL_ACTIVE_INVALID");
      for (const surface of WORKER_SURFACES) {
        if (String(value.versions?.[surface]?.candidate || "").toLowerCase() !== details.versions[surface].toLowerCase()) {
          throw new DrillFailure("MODULE_CONTROL_VERSION_MISMATCH");
        }
      }
    }
    return {
      passed: true,
      state,
      releaseSha: state === "active" ? value.releaseSha : "",
      changedAt: String(value.changedAt || ""),
    };
  };
  const setModuleStateDirectly = async (state, details, phase) => {
    if (!["active", "maintenance"].includes(state)) throw new DrillFailure("MODULE_STATE_INVALID");
    const latchBefore = readEmergencyLatch();
    const payload = {
      schemaVersion: 2,
      state,
      message: `Ponto staging rollback drill ${phase}.`,
      changedAt: new Date().toISOString(),
      changedBy: `ponto-staging-rollback-drill:${config.runId}`,
    };
    if (state === "active") {
      if (
        !SHA.test(String(details?.releaseSha || ""))
        || !WORKER_SURFACES.every((surface) => UUID.test(String(details?.versions?.[surface] || "")))
      ) throw new DrillFailure("MODULE_ACTIVE_PAYLOAD_INVALID");
      Object.assign(payload, {
        rolloutStage: "staging",
        releaseSha: details.releaseSha.toLowerCase(),
        syntheticOnly: true,
        versions: Object.fromEntries(WORKER_SURFACES.map((surface) => [
          surface,
          { candidate: details.versions[surface].toLowerCase() },
        ])),
      });
    }
    const payloadFile = path.join(
      config.runnerTemp,
      `ponto-staging-drill-module-${phase}-${config.runId}.json`,
    );
    fs.writeFileSync(payloadFile, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    try {
      wrangler([
        "kv",
        "key",
        "put",
        "module-control:timekeeping",
        "--path",
        payloadFile,
        "--namespace-id",
        config.moduleControlNamespaceId,
        "--remote",
      ], "MODULE_CONTROL_WRITE_FAILED");
    } finally {
      fs.rmSync(payloadFile, { force: true });
    }
    const proof = assertModuleControl(state, details);
    const latchAfter = readEmergencyLatch();
    return {
      ...proof,
      mutation: "direct-signed-drill",
      runId: config.runId,
      workflow: "ponto-staging-rollback-drill.yml",
      emergencyLatch: {
        before: latchBefore,
        after: latchAfter,
      },
    };
  };

  const d1Execute = (database, configPath, args, code) => wrangler([
    "d1",
    "execute",
    database,
    "--config",
    configPath,
    "--env",
    "staging",
    "--remote",
    ...args,
  ], code);
  const d1Rows = (database, configPath, sql) => {
    let payload;
    try {
      payload = JSON.parse(d1Execute(database, configPath, ["--command", sql, "--json"], "D1_QUERY_FAILED"));
    } catch (error) {
      if (error instanceof DrillFailure) throw error;
      throw new DrillFailure("D1_QUERY_JSON_INVALID");
    }
    const entries = Array.isArray(payload) ? payload : [payload];
    if (entries.some((entry) => entry?.success === false)) throw new DrillFailure("D1_QUERY_FAILED");
    return entries.flatMap((entry) => entry?.results || entry?.result?.results || []);
  };
  const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const numeric = (value) => Number(value || 0);

  const prepareFixture = async (label) => {
    if (!["incumbent", "candidate"].includes(label)) throw new DrillFailure("FIXTURE_LABEL_INVALID");
    const directory = path.join(config.runnerTemp, "ponto-staging-rollback", label);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const handle = {
      label,
      directory,
      fixturePath: path.join(directory, "fixture.json"),
      coreProvisionPath: path.join(directory, "core-provision.sql"),
      timekeepingProvisionPath: path.join(directory, "timekeeping-provision.sql"),
      coreTeardownPath: path.join(directory, "core-teardown.sql"),
      timekeepingTeardownPath: path.join(directory, "timekeeping-teardown.sql"),
      journeyReportPath: path.join(directory, "journey-report.json"),
    };
    runCommand(process.execPath, [
      "workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs",
      "--action", "provision",
      "--run-id", config.runId,
      "--fixture-id", label,
      "--fixtures", handle.fixturePath,
      "--core-sql", handle.coreProvisionPath,
      "--timekeeping-sql", handle.timekeepingProvisionPath,
    ], { code: "FIXTURE_GENERATION_FAILED" });
    const fixture = JSON.parse(fs.readFileSync(handle.fixturePath, "utf8"));
    if (
      fixture?.environment !== "staging"
      || fixture?.runId !== config.runId
      || fixture?.fixtureId !== label
      || fixture?.role !== "CONSULTOR"
      || JSON.stringify(fixture?.allowedModules) !== JSON.stringify(["atendimento", "ponto"])
    ) throw new DrillFailure("FIXTURE_CONTRACT_INVALID");
    handle.fixture = fixture;
    return handle;
  };
  const provisionFixture = async (handle) => {
    d1Execute(config.coreDatabase, "inventory/wrangler.toml", ["--file", handle.coreProvisionPath], "CORE_FIXTURE_PROVISION_FAILED");
    d1Execute(config.timekeepingDatabase, "workforce/timekeeping/wrangler.toml", ["--file", handle.timekeepingProvisionPath], "TIMEKEEPING_FIXTURE_PROVISION_FAILED");
    return { passed: true };
  };

  const verifyActiveSet = async (expected) => {
    const surfaces = {};
    for (const surface of WORKER_SURFACES) {
      const versionId = expected[`${surface === "coreApi" ? "core" : surface === "identityWorkforce" ? "identity" : "timekeeping"}VersionId`];
      const source = expected.sourceSha === null
        ? workerVersionDetails(surface, versionId)
        : assertWorkerSource(surface, versionId, expected.sourceSha);
      surfaces[surface] = {
        ...assertWorkerAt(surface, versionId),
        sourceSha: source.sourceSha,
      };
    }
    const pages = await assertPagesActive(expected.pagesActiveDeploymentId, expected.sourceSha);
    return { surfaces, pages };
  };
  const sanitizedJourney = (raw, expected, controlPlane) => {
    const report = JSON.parse(raw);
    const navigation = report?.navigation || {};
    const journey = report?.journey || {};
    const valid = report?.schemaVersion === 1
      && report.environment === "staging"
      && report.role === "CONSULTOR"
      && report.credentialsIncluded === false
      && report.piiIncluded === false
      && navigation.atendimentoVisible === true
      && navigation.pontoVisible === true
      && navigation.administrativeNavigationHidden === true
      && JSON.stringify(navigation.visibleModuleKeys) === JSON.stringify(["atendimento", "ponto"])
      && journey.auth?.status === 200
      && journey.me?.status === 200
      && journey.profile?.status === 200
      && journey.presence?.status === 200
      && journey.invalidPin?.status === 401
      && journey.punch?.status === 201
      && journey.idempotentRetry?.status === 200
      && journey.crossUnitDenied?.status === 403
      && journey.correction?.status === 201
      && journey.adminDenied?.status === 403
      && report.identityOnboarding?.adminAuth?.status === 200
      && [200, 201].includes(report.identityOnboarding?.create?.status)
      && report.identityOnboarding?.terminate?.status === 200
      && report.identityOnboarding?.ledger?.status === 200
      && report.identityOnboarding?.hmacContract === "v2"
      && report.identityOnboarding?.actorRole === "GESTOR"
      && JSON.stringify(report.identityOnboarding?.actorModuleKeys) === JSON.stringify(["insumos"])
      && report.identityOnboarding?.actorUnitCount === 1
      && report.identityOnboarding?.inviteIssued === false
      && report.identityOnboarding?.auditPreserved === true;
    if (!valid) throw new DrillFailure("AUTHENTICATED_JOURNEY_INVALID");
    return {
      passed: true,
      digest: digest(raw),
      roleClass: "CONSULTOR",
      moduleKeys: ["atendimento", "ponto"],
      requestCount: Array.isArray(report.pontoRequests) ? report.pontoRequests.length : 0,
      pagesActiveDeploymentId: controlPlane.pages.id,
      coreVersionId: expected.coreVersionId,
      identityVersionId: expected.identityVersionId,
      timekeepingVersionId: expected.timekeepingVersionId,
      writesSyntheticOnly: true,
      credentialsIncluded: false,
      piiIncluded: false,
    };
  };
  const runJourney = async (handle, url, expected) => {
    const origin = new URL(url);
    if (
      origin.protocol !== "https:"
      || !origin.hostname.endsWith(".skincos-staging.pages.dev")
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) throw new DrillFailure("JOURNEY_ORIGIN_INVALID");
    runCommand(process.execPath, ["crm/console/scripts/ponto-staging-journey.cjs"], {
      code: "AUTHENTICATED_JOURNEY_FAILED",
      env: {
        PONTO_STAGING_CRM_URL: origin.href,
        PONTO_STAGING_FIXTURES_FILE: handle.fixturePath,
        PONTO_STAGING_REPORT_FILE: handle.journeyReportPath,
        NODE_PATH: path.resolve("crm/console/node_modules"),
      },
    });
    const raw = fs.readFileSync(handle.journeyReportPath, "utf8");
    const controlPlane = await verifyActiveSet(expected);
    return sanitizedJourney(raw, expected, controlPlane);
  };
  const verifyProtectedContract = async (handle, url, expected) => {
    const origin = new URL(url);
    const pathname = "/api/ponto/_release-contract";
    const rawBody = JSON.stringify({
      email: handle.fixture.email,
      password: handle.fixture.password,
    });
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(32).toString("base64url");
    // This is request canonicalization inside a keyed HMAC, not a stored
    // password verifier. The receiver computes the same SHA-256 body digest.
    const bodyHash = digest(rawBody);
    const signature = crypto.createHmac("sha256", config.releaseProbeKey)
      .update(`ponto-release-probe/v1.${timestamp}.${nonce}.POST.${pathname}.${bodyHash}.${expected.releaseSha}`)
      .digest("base64url");
    const response = await fetch(new URL("/api/ponto/_release-contract", origin), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-skincos-release-probe-ts": timestamp,
        "x-skincos-release-probe-nonce": nonce,
        "x-skincos-release-probe-signature-version": "1",
        "x-skincos-release-probe-sig": signature,
        ...config.accessHeaders,
      },
      body: rawBody,
    });
    const body = await response.json().catch(() => null);
    const summary = {
      passed: response.status === 200
        && response.headers.get("x-skincos-pages-release-sha") === expected.releaseSha
        && response.headers.get("x-skincos-pages-environment") === "staging"
        && body?.ok === true
        && body?.ready === true
        && body?.releaseSha === expected.releaseSha
        && String(body?.identityVersionId || "").toLowerCase() === expected.identityVersionId.toLowerCase()
        && body?.contract === "identity-workforce-hmac-v2"
        && body?.roleClass === "CONSULTOR"
        && JSON.stringify(body?.modules) === JSON.stringify(["atendimento", "ponto"])
        && body?.sessionRead === true
        && body?.sessionRevoked === true
        && body?.credentialsIncluded === false
        && body?.piiIncluded === false,
      contract: "identity-workforce-hmac-v2",
      identityVersionId: expected.identityVersionId,
      roleClass: "CONSULTOR",
      moduleKeys: ["atendimento", "ponto"],
      sessionRead: body?.sessionRead === true,
      sessionRevoked: body?.sessionRevoked === true,
      credentialsIncluded: false,
      piiIncluded: false,
    };
    if (!summary.passed) throw new DrillFailure("PROTECTED_CANDIDATE_CONTRACT_FAILED");
    return { ...summary, digest: digest(summary) };
  };

  const teardownFixture = async (handle) => {
    const failures = [];
    let fixture = handle.fixture;
    try {
      const currentFixture = JSON.parse(fs.readFileSync(handle.fixturePath, "utf8"));
      if (
        currentFixture?.environment !== "staging"
        || currentFixture?.runId !== config.runId
        || currentFixture?.fixtureId !== handle.label
        || currentFixture?.prefix !== handle.fixture?.prefix
      ) throw new DrillFailure("PRIVATE_FIXTURE_RELOAD_INVALID");
      fixture = currentFixture;
      handle.fixture = currentFixture;
    } catch {
      failures.push("PRIVATE_FIXTURE_RELOAD_FAILED");
    }
    let coreBefore = [];
    let timekeepingBefore = [];
    let coreAfter = [];
    let timekeepingAfter = [];
    const capture = (code, fn, fallback = []) => {
      try { return fn(); } catch { failures.push(code); return fallback; }
    };
    const coreBeforeSql = `SELECT COUNT(*) AS audit_count FROM audit_log WHERE entity='staging_synthetic_ponto' AND entity_id=${sql(fixture.username)};`;
    const timekeepingBeforeSql = `SELECT
      (SELECT id FROM workforce_employees WHERE canonical_employee_id=${sql(`identity:${fixture.onboardingId}`)} LIMIT 1) AS identity_employee_id,
      (SELECT GROUP_CONCAT(id) FROM timekeeping_events WHERE employee_id=${sql(fixture.employeeId)}) AS event_ids,
      (SELECT COUNT(*) FROM timekeeping_audit_events WHERE actor_id=${sql(fixture.username)} OR (actor_id='identity-service' AND after_json LIKE ${sql(`%"onboardingId":"${fixture.onboardingId}"%`)})) AS audit_count;`;
    coreBefore = capture("CORE_PRE_TEARDOWN_QUERY_FAILED", () => d1Rows(
      config.coreDatabase,
      "inventory/wrangler.toml",
      coreBeforeSql,
    ));
    timekeepingBefore = capture("TIMEKEEPING_PRE_TEARDOWN_QUERY_FAILED", () => d1Rows(
      config.timekeepingDatabase,
      "workforce/timekeeping/wrangler.toml",
      timekeepingBeforeSql,
    ));

    capture("FIXTURE_TEARDOWN_GENERATION_FAILED", () => runCommand(process.execPath, [
      "workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs",
      "--action", "teardown",
      "--run-id", config.runId,
      "--fixture-id", handle.label,
      "--fixtures", handle.fixturePath,
      "--core-sql", handle.coreTeardownPath,
      "--timekeeping-sql", handle.timekeepingTeardownPath,
    ], { code: "FIXTURE_TEARDOWN_GENERATION_FAILED" }), "");
    if (fs.existsSync(handle.timekeepingTeardownPath)) {
      capture("TIMEKEEPING_TEARDOWN_FAILED", () => d1Execute(
        config.timekeepingDatabase,
        "workforce/timekeeping/wrangler.toml",
        ["--file", handle.timekeepingTeardownPath],
        "TIMEKEEPING_TEARDOWN_FAILED",
      ), "");
    } else failures.push("TIMEKEEPING_TEARDOWN_MISSING");
    if (fs.existsSync(handle.coreTeardownPath)) {
      capture("CORE_TEARDOWN_FAILED", () => d1Execute(
        config.coreDatabase,
        "inventory/wrangler.toml",
        ["--file", handle.coreTeardownPath],
        "CORE_TEARDOWN_FAILED",
      ), "");
    } else failures.push("CORE_TEARDOWN_MISSING");

    const identityEmployeeId = String(timekeepingBefore[0]?.identity_employee_id || "");
    const eventIds = String(timekeepingBefore[0]?.event_ids || "")
      .split(",")
      .filter((id) => UUID.test(id));
    const requestIds = Array.from(new Set(handle.fixture.teardownRequestIds || []))
      .filter((requestId) => /^[A-Za-z0-9._:-]{1,180}$/.test(String(requestId)));
    const employeeIds = [fixture.employeeId, ...(UUID.test(identityEmployeeId) ? [identityEmployeeId] : [])];
    const employeeList = employeeIds.map(sql).join(",");
    const eventList = eventIds.length ? eventIds.map(sql).join(",") : "''";
    const requestIdList = requestIds.length ? requestIds.map(sql).join(",") : "''";
    const coreAfterSql = `SELECT
      (SELECT COUNT(*) FROM crm_users WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS users,
      (SELECT COUNT(*) FROM crm_identity_sessions WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS sessions,
      (SELECT COUNT(*) FROM auth_attempts WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS auth_attempts,
      (SELECT COUNT(*) FROM crm_user_prefs WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS prefs,
      (SELECT COUNT(*) FROM crm_employee_onboarding WHERE id=${sql(fixture.onboardingId)}) AS onboarding,
      (SELECT COUNT(*) FROM audit_log WHERE entity='staging_synthetic_ponto' AND entity_id=${sql(fixture.username)}) AS audit_count,
      (SELECT COUNT(*) FROM audit_log WHERE entity='staging_synthetic_ponto' AND entity_id=${sql(fixture.username)} AND action='STAGING_SYNTHETIC_PONTO_TORN_DOWN') AS teardown_audit;`;
    const timekeepingAfterSql = `SELECT
      (SELECT COUNT(*) FROM workforce_employees WHERE id IN (${employeeList}) OR canonical_employee_id=${sql(`identity:${fixture.onboardingId}`)}) AS employees,
      (SELECT COUNT(*) FROM timekeeping_employee_units WHERE employee_id IN (${employeeList})) AS employee_units,
      (SELECT COUNT(*) FROM workforce_employee_profiles WHERE employee_id IN (${employeeList})) AS profiles,
      (SELECT COUNT(*) FROM workforce_employee_unit_hierarchy WHERE employee_id IN (${employeeList})) AS hierarchy,
      (SELECT COUNT(*) FROM timekeeping_events WHERE employee_id=${sql(fixture.employeeId)}) AS events,
      (SELECT COUNT(*) FROM timekeeping_punch_evidence WHERE event_id IN (${eventList})) AS evidence,
      (SELECT COUNT(*) FROM timekeeping_corrections WHERE event_id IN (${eventList})) AS corrections,
      (SELECT COUNT(*) FROM timekeeping_pin_failures WHERE employee_id=${sql(fixture.employeeId)}) AS pin_failures,
      (SELECT COUNT(*) FROM timekeeping_pin_credentials WHERE employee_id=${sql(fixture.employeeId)}) AS pin_credentials,
      (SELECT COUNT(*) FROM timekeeping_request_nonces WHERE request_id IN (${requestIdList})) AS request_nonces,
      (SELECT COUNT(*) FROM workforce_departments WHERE normalized_name=${sql(fixture.onboardingDepartment.toLowerCase())}) AS departments,
      (SELECT COUNT(*) FROM timekeeping_unit_presence_policies WHERE unit_id=${sql(fixture.unitId)} AND updated_by=${sql(`${fixture.prefix}:presence-policy`)}) AS policies,
      (SELECT COUNT(*) FROM timekeeping_audit_events WHERE actor_id=${sql(fixture.username)} OR (actor_id='identity-service' AND after_json LIKE ${sql(`%"onboardingId":"${fixture.onboardingId}"%`)})) AS audit_count;`;
    coreAfter = capture("CORE_POST_TEARDOWN_QUERY_FAILED", () => d1Rows(
      config.coreDatabase,
      "inventory/wrangler.toml",
      coreAfterSql,
    ));
    timekeepingAfter = capture("TIMEKEEPING_POST_TEARDOWN_QUERY_FAILED", () => d1Rows(
      config.timekeepingDatabase,
      "workforce/timekeeping/wrangler.toml",
      timekeepingAfterSql,
    ));

    const coreRow = coreAfter[0] || {};
    const timekeepingRow = timekeepingAfter[0] || {};
    const coreResidualCount = ["users", "sessions", "auth_attempts", "prefs", "onboarding"]
      .reduce((total, key) => total + numeric(coreRow[key]), 0);
    const timekeepingResidualCount = [
      "employees",
      "employee_units",
      "profiles",
      "hierarchy",
      "events",
      "evidence",
      "corrections",
      "pin_failures",
      "pin_credentials",
      "request_nonces",
      "departments",
      "policies",
    ].reduce((total, key) => total + numeric(timekeepingRow[key]), 0);
    const coreAuditPreserved = numeric(coreRow.audit_count) >= numeric(coreBefore[0]?.audit_count)
      && numeric(coreRow.teardown_audit) >= 1;
    const timekeepingAuditPreserved = numeric(timekeepingRow.audit_count) === numeric(timekeepingBefore[0]?.audit_count);
    try {
      fs.rmSync(handle.directory, { recursive: true, force: true });
    } catch {
      failures.push("PRIVATE_FIXTURE_REMOVAL_FAILED");
    }
    return {
      passed: failures.length === 0
        && coreResidualCount === 0
        && timekeepingResidualCount === 0
        && coreAuditPreserved
        && timekeepingAuditPreserved,
      coreResidualCount,
      timekeepingResidualCount,
      coreAuditPreserved,
      timekeepingAuditPreserved,
      timekeepingAuditCountBefore: numeric(timekeepingBefore[0]?.audit_count),
      timekeepingAuditCountAfter: numeric(timekeepingRow.audit_count),
      verificationFailures: failures,
      credentialsIncluded: false,
      piiIncluded: false,
    };
  };

  return {
    async attestInitialState() {
      const emergencyLatch = readEmergencyLatch();
      const moduleControl = assertModuleControl("maintenance");
      const surfaces = {};
      const incumbents = { passed: true };
      for (const surface of WORKER_SURFACES) {
        const candidateSource = assertWorkerSource(
          surface,
          config.ids[surface].candidate,
          config.releaseSha,
        );
        surfaces[surface] = {
          ...assertWorkerAt(surface, config.ids[surface].candidate),
          sourceSha: candidateSource.sourceSha,
        };
        incumbents[surface] = workerVersionDetails(surface, config.ids[surface].incumbent);
      }
      surfaces.crmPages = await assertPagesActive(config.ids.crmPages.candidate, config.releaseSha);
      const incumbentPages = await pagesDeploymentDetails(config.ids.crmPages.incumbent);
      incumbents.crmPages = {
        passed: true,
        deploymentId: incumbentPages.id,
        sourceSha: incumbentPages.commitHash,
      };
      return {
        moduleControl: { ...moduleControl, emergencyLatch },
        surfaces: { passed: true, ...surfaces },
        incumbents: validateIncumbentProvenance(config.ids, incumbents),
      };
    },
    async deployWorker(surface, versionId, phase, expectedSha) {
      if (!WORKER_SURFACES.includes(surface)) throw new DrillFailure("WORKER_SURFACE_INVALID");
      if (phase === "rollback") {
        wrangler([
          "rollback",
          versionId,
          "--name",
          config.ids[surface].worker,
          "--yes",
          "--message",
          `ponto:staging-rollback-drill:${config.releaseSha}:run-${config.runId}`,
        ], "WORKER_ROLLBACK_FAILED");
      } else {
        wrangler([
          "versions",
          "deploy",
          `${versionId}@100%`,
          "--name",
          config.ids[surface].worker,
          "--yes",
          "--message",
          `ponto:staging-rollback-drill-restore:${config.releaseSha}:run-${config.runId}`,
        ], "WORKER_RESTORATION_FAILED");
      }
      const proof = assertWorkerAt(surface, versionId);
      const source = expectedSha === null
        ? workerVersionDetails(surface, versionId)
        : assertWorkerSource(surface, versionId, expectedSha);
      return { ...proof, sourceSha: source.sourceSha };
    },
    async deployPages(sourceDeploymentId, phase, expectedSha) {
      const source = await pagesDeploymentDetails(sourceDeploymentId);
      if (expectedSha !== null) {
        try {
          validateSourceEvidence(source.commitHash, expectedSha);
        } catch (error) {
          if (error instanceof DrillFailure && error.code === "SOURCE_SHA_MISMATCH") {
            throw new DrillFailure("PAGES_SOURCE_SHA_MISMATCH");
          }
          throw error;
        }
      }
      const created = await cloudflare(
        `${pagesPath}/deployments/${encodeURIComponent(sourceDeploymentId)}/rollback`,
        { method: "POST", body: "{}" },
      );
      const createdId = String(created?.id || "");
      if (!UUID.test(createdId)) throw new DrillFailure("PAGES_ROLLBACK_RESPONSE_INVALID");
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const active = pageDetails(await pagesDeployment(createdId), { allowPending: true });
        const latest = await latestPagesDeployment({ allowPending: true });
        if (
          active.terminal
          && latest.terminal
          && active.id.toLowerCase() === latest.id.toLowerCase()
          && active.commitHash === source.commitHash
        ) {
          return {
            passed: true,
            sourceDeploymentId,
            activeDeploymentId: active.id,
            url: active.url,
            commitHash: active.commitHash,
            project: config.pagesProject,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      throw new DrillFailure(`PAGES_${phase.toUpperCase()}_ATTESTATION_FAILED`);
    },
    setModuleState: setModuleStateDirectly,
    prepareFixture,
    provisionFixture,
    runJourney,
    verifyProtectedContract,
    teardownFixture,
  };
}

function writeReport(reportFile, report) {
  const directory = path.dirname(reportFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${reportFile}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, reportFile);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const requestedReportFile = String(process.argv[2] || "");
  let report;
  try {
    const config = loadConfig();
    report = await runStagingRollbackDrill(config, createRealRuntime(config));
  } catch (error) {
    report = {
      schemaVersion: 2,
      releaseSha: SHA.test(String(process.env.RELEASE_SHA || "")) ? String(process.env.RELEASE_SHA).toLowerCase() : "",
      runId: /^[0-9]+$/.test(String(process.env.GITHUB_RUN_ID || "")) ? String(process.env.GITHUB_RUN_ID) : "",
      orchestratorRunId: /^[0-9]+$/.test(String(process.env.ORCHESTRATOR_RUN_ID || "")) ? String(process.env.ORCHESTRATOR_RUN_ID) : "",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      failures: [{ phase: "initialization", code: publicFailureCode(error) }],
      passed: false,
      credentialsIncluded: false,
      piiIncluded: false,
    };
  }
  if (requestedReportFile) writeReport(requestedReportFile, report);
  if (!report.passed) {
    process.stderr.write("Staging rollback drill failed closed; sanitized evidence was written and final maintenance/restoration attempts are recorded.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`Staging rollback drill passed for ${report.releaseSha}; every exact candidate was restored and both synthetic fixtures were removed.\n`);
  }
}
