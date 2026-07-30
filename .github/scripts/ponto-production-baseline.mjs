import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [mode, file] = process.argv.slice(2);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const VALID_INITIAL_STATES = new Set(["active", "maintenance"]);
const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const validate = (baseline) => {
  assert(baseline?.schemaVersion === 1, "baseline schemaVersion must be 1");
  assert(SHA.test(baseline.releaseSha), "baseline releaseSha is invalid");
  assert(/^[0-9]+$/.test(String(baseline.stagingRunId || "")), "baseline stagingRunId is invalid");
  assert(/^[0-9]+$/.test(String(baseline.runId || "")), "baseline runId is invalid");
  assert(/^[0-9]+$/.test(String(baseline.orchestratorRunId || "")), "baseline orchestratorRunId is invalid");
  assert(baseline.repository?.includes("/"), "baseline repository is invalid");
  for (const unit of ["timekeeping", "coreApi", "identityWorkforce"]) {
    const surface = baseline.surfaces?.[unit];
    assert(UUID.test(surface?.versionId), `${unit} baseline version is invalid`);
    assert(UUID.test(surface?.deploymentId), `${unit} baseline deployment is invalid`);
    assert(surface.percentage === 100, `${unit} baseline must be exactly 100 percent`);
    assert(typeof surface.tag === "string" && typeof surface.message === "string", `${unit} baseline metadata is missing`);
  }
  assert(UUID.test(baseline.surfaces?.crmPages?.deploymentId), "Pages baseline deployment is invalid");
  assert(SHA.test(baseline.surfaces?.crmPages?.commitHash), "Pages baseline commit hash is invalid");
  assert(
    baseline.surfaces?.crmPages?.commitHash.toLowerCase() !== baseline.releaseSha.toLowerCase(),
    "Pages baseline incumbent cannot already be the release candidate",
  );
  assert(
    baseline.surfaces?.crmPages?.status === "success"
      && baseline.surfaces?.crmPages?.latestStage?.name === "deploy"
      && Number.isFinite(Date.parse(String(baseline.surfaces?.crmPages?.latestStage?.endedOn || "")))
      && baseline.surfaces?.crmPages?.isSkipped === false,
    "Pages baseline must be an unskipped completed deploy success",
  );
  assert(baseline.surfaces?.crmPages?.project === "skincos", "Pages baseline project is not canonical production");
  assert(baseline.surfaces?.crmPages?.environment === "production", "Pages baseline environment is not production");
  assert(baseline.surfaces?.crmPages?.canonical === true, "Pages baseline deployment is not canonical");
  assert(
    baseline.surfaces?.crmPages?.alias === "https://crm.skincos.com.br",
    "Pages baseline canonical alias is invalid",
  );
  assert(
    baseline.surfaces?.crmPages?.sourceControl?.deploymentsEnabled === false
      && baseline.surfaces?.crmPages?.sourceControl?.productionDeploymentsEnabled === false
      && baseline.surfaces?.crmPages?.sourceControl?.previewDeploymentSetting === "none",
    "Pages source auto-deploy controls are not fully disabled",
  );
  assert(/^[0-9]+$/.test(String(baseline.bootstrapCore?.workflowRunId || "")), "Core bootstrap workflow run is invalid");
  assert(/^[0-9]+$/.test(String(baseline.bootstrapCore?.artifactId || "")), "Core bootstrap artifact ID is invalid");
  assert(/^sha256:[0-9a-f]{64}$/.test(String(baseline.bootstrapCore?.artifactDigest || "")), "Core bootstrap artifact digest is invalid");
  assert(SHA.test(baseline.bootstrapCore?.sourceSha), "Core bootstrap source SHA is invalid");
  assert(
    baseline.bootstrapCore?.liveAttested === true
      && baseline.bootstrapCore?.deploymentId === baseline.surfaces.coreApi.deploymentId
      && baseline.bootstrapCore?.versionId === baseline.surfaces.coreApi.versionId,
    "Core bootstrap live predecessor differs from the captured Core incumbent",
  );
  const initialState = String(baseline.health?.state || "");
  assert(
    baseline.health?.passed === true && VALID_INITIAL_STATES.has(initialState),
    "baseline initial module state must be active or maintenance",
  );
  assert(
    baseline.health?.ready === (initialState === "active"),
    "baseline initial readiness is inconsistent with module state",
  );
  assert(baseline.credentialsIncluded === false && baseline.piiIncluded === false, "baseline privacy attestation is invalid");
  const { sha256, ...unsigned } = baseline;
  assert(/^[0-9a-f]{64}$/.test(String(sha256 || "")) && digest(unsigned) === sha256, "baseline digest differs");
  return baseline;
};

if (mode === "capture") {
  const releaseSha = required("PONTO_BASELINE_RELEASE_SHA").toLowerCase();
  const stagingRunId = required("PONTO_BASELINE_STAGING_RUN_ID");
  const runId = required("GITHUB_RUN_ID");
  const orchestratorRunId = required("PONTO_BASELINE_ORCHESTRATOR_RUN_ID");
  const repository = required("GITHUB_REPOSITORY");
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = required("CLOUDFLARE_API_TOKEN");
  const pagesProject = required("CLOUDFLARE_PAGES_PROJECT");
  assert(SHA.test(releaseSha) && /^[0-9]+$/.test(stagingRunId) && /^[0-9]+$/.test(runId) && /^[0-9]+$/.test(orchestratorRunId), "invalid baseline provenance");
  assert(/^[0-9a-f]{32}$/.test(accountId) && pagesProject === "skincos", "invalid production Cloudflare target");

  const runWranglerJson = (args) => {
    const result = spawnSync("npx", ["--yes", "wrangler@4.112.0", ...args], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 2).join(" ")} failed`);
    return JSON.parse(result.stdout);
  };
  const workerBaseline = (name) => {
    const status = runWranglerJson(["deployments", "status", "--name", name, "--json"]);
    const versions = status.versions || status.latest?.versions || [];
    assert(versions.length === 1 && Number(versions[0]?.percentage) === 100, `${name} is not on a single 100 percent incumbent`);
    const versionId = String(versions[0]?.version_id || versions[0]?.id || "");
    const deploymentId = String(status.id || status.deployment_id || status.latest?.id || "");
    assert(UUID.test(versionId) && UUID.test(deploymentId), `${name} deployment identity is invalid`);
    const view = runWranglerJson(["versions", "view", versionId, "--name", name, "--json"]);
    const annotations = view.annotations && typeof view.annotations === "object" ? view.annotations : {};
    return {
      versionId,
      deploymentId,
      percentage: 100,
      tag: String(view.tag || annotations["workers/tag"] || ""),
      message: String(view.message || annotations["workers/message"] || ""),
      createdOn: String(view.created_on || view.createdOn || ""),
    };
  };
  const cloudflare = async (pathname) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${apiToken}`, accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare API returned ${response.status}`);
    return payload;
  };
  const pagesPayload = await cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}`);
  const project = pagesPayload.result;
  const pages = project?.canonical_deployment;
  const pagesStatus = String(pages?.latest_stage?.status || "").toLowerCase();
  const pagesStageName = String(pages?.latest_stage?.name || "").toLowerCase();
  const pagesStageEndedOn = String(pages?.latest_stage?.ended_on || "");
  const commitHash = String(pages?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();
  const aliases = Array.isArray(pages?.aliases) ? pages.aliases.map(value => String(value)) : [];
  const sourceConfig = project?.source?.config;
  const canonicalAlias = aliases.find(value =>
    value === "https://crm.skincos.com.br" || value === "crm.skincos.com.br");
  assert(
    project?.name === pagesProject
      && project?.subdomain === "skincos.pages.dev"
      && project?.production_branch === "main"
      && UUID.test(pages?.id)
      && pages?.environment === "production"
      && SHA.test(commitHash)
      && commitHash !== releaseSha
      && pagesStatus === "success"
      && pagesStageName === "deploy"
      && Number.isFinite(Date.parse(pagesStageEndedOn))
      && pages?.is_skipped === false
      && sourceConfig?.deployments_enabled === false
      && sourceConfig?.production_deployments_enabled === false
      && sourceConfig?.preview_deployment_setting === "none"
      && Boolean(canonicalAlias),
    "production Pages canonical deployment/provenance or source freeze is not attested",
  );

  const accessHeaders = {};
  if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
    assert(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET, "partial Cloudflare Access credential");
    accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  const healthResponse = await fetch("https://crm.skincos.com.br/api/ponto/health", {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", ...accessHeaders },
  });
  const health = await healthResponse.json().catch(() => null);
  const dependencies = health?.dependencies && typeof health.dependencies === "object" ? Object.entries(health.dependencies) : [];
  const hasDependencyContract = dependencies.length > 0;
  const dependencyContractSafe = !hasDependencyContract || (
    health?.ok === false
    && health?.ready === false
    && health?.dependencies?.module_control?.state === "unavailable"
    && health?.dependencies?.module_control?.reason === "MODULE_MAINTENANCE"
    && dependencies.every(([name, dependency]) => name === "module_control" || dependency?.required !== true || dependency?.state === "healthy")
  );
  const activeReady = healthResponse.status === 200
    && health?.availability?.state === "active"
    && health?.ok === true
    && health?.ready === true
    && hasDependencyContract
    && health?.dependencies?.module_control?.state === "healthy"
    && dependencies.every(([, dependency]) => dependency?.required !== true || dependency?.state === "healthy");
  const maintenanceOnly = healthResponse.status === 200
    && health?.availability?.state === "maintenance"
    && dependencyContractSafe;
  assert(activeReady || maintenanceOnly, "external Ponto initial health is not valid active or maintenance");
  const initialState = activeReady ? "active" : "maintenance";
  const identityResponse = await fetch("https://api.skincos.com.br/insumos/health", {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", ...accessHeaders },
  });
  assert(identityResponse.status === 200, "external Identity health failed");

  const timekeeping = workerBaseline("skincos-timekeeping");
  const coreApi = workerBaseline("skincos-ponto-core");
  const identityWorkforce = workerBaseline("skincos-insumos");
  const bootstrapCore = {
    workflowRunId: required("PONTO_CORE_BOOTSTRAP_WORKFLOW_RUN_ID"),
    artifactId: required("PONTO_CORE_BOOTSTRAP_ARTIFACT_ID"),
    artifactDigest: required("PONTO_CORE_BOOTSTRAP_ARTIFACT_DIGEST"),
    sourceSha: required("PONTO_CORE_BOOTSTRAP_SOURCE_SHA").toLowerCase(),
    deploymentId: required("PONTO_CORE_BOOTSTRAP_DEPLOYMENT_ID").toLowerCase(),
    versionId: required("PONTO_CORE_BOOTSTRAP_VERSION_ID").toLowerCase(),
    liveAttested: required("PONTO_CORE_BOOTSTRAP_LIVE_ATTESTED") === "true",
  };
  assert(
    coreApi.deploymentId.toLowerCase() === bootstrapCore.deploymentId
      && coreApi.versionId.toLowerCase() === bootstrapCore.versionId
      && coreApi.message === `ponto-core-baseline:${bootstrapCore.sourceSha}`
      && bootstrapCore.liveAttested,
    "production Ponto Core is not the exact live-attested immutable bootstrap predecessor",
  );

  const unsigned = {
    schemaVersion: 1,
    releaseSha,
    stagingRunId,
    runId,
    orchestratorRunId,
    repository,
    capturedAt: new Date().toISOString(),
    surfaces: {
      timekeeping,
      coreApi,
      identityWorkforce,
      crmPages: {
        deploymentId: pages.id,
        commitHash,
        createdOn: String(pages.created_on || ""),
        status: pagesStatus,
        latestStage: {
          name: pagesStageName,
          endedOn: pagesStageEndedOn,
        },
        isSkipped: pages.is_skipped,
        project: pagesProject,
        environment: pages.environment,
        canonical: true,
        alias: canonicalAlias.startsWith("https://") ? canonicalAlias : `https://${canonicalAlias}`,
        sourceControl: {
          deploymentsEnabled: sourceConfig.deployments_enabled,
          productionDeploymentsEnabled: sourceConfig.production_deployments_enabled,
          previewDeploymentSetting: sourceConfig.preview_deployment_setting,
        },
      },
    },
    bootstrapCore,
    health: {
      passed: true,
      state: initialState,
      ready: activeReady,
      changedAt: String(health?.availability?.changedAt || ""),
      crmStatus: healthResponse.status,
      identityStatus: identityResponse.status,
      observation: "external-production",
    },
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const baseline = validate({ ...unsigned, sha256: digest(unsigned) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Captured immutable production baseline ${baseline.sha256}.\n`);
} else if (mode === "verify") {
  const baseline = validate(JSON.parse(fs.readFileSync(file, "utf8")));
  assert(baseline.releaseSha === required("PONTO_EXPECTED_BASELINE_RELEASE_SHA").toLowerCase(), "baseline release SHA differs");
  assert(String(baseline.stagingRunId) === required("PONTO_EXPECTED_BASELINE_STAGING_RUN_ID"), "baseline staging run differs");
  if (process.env.PONTO_EXPECTED_BASELINE_RUN_ID) {
    assert(String(baseline.runId) === process.env.PONTO_EXPECTED_BASELINE_RUN_ID, "baseline run ID differs");
  }
  assert(baseline.repository === required("PONTO_EXPECTED_BASELINE_REPOSITORY"), "baseline repository differs");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
      `baseline_run_id=${baseline.runId}`,
      `baseline_sha256=${baseline.sha256}`,
      `baseline_timekeeping_version_id=${baseline.surfaces.timekeeping.versionId}`,
      `baseline_timekeeping_deployment_id=${baseline.surfaces.timekeeping.deploymentId}`,
      `baseline_core_version_id=${baseline.surfaces.coreApi.versionId}`,
      `baseline_core_deployment_id=${baseline.surfaces.coreApi.deploymentId}`,
      `baseline_identity_version_id=${baseline.surfaces.identityWorkforce.versionId}`,
      `baseline_identity_deployment_id=${baseline.surfaces.identityWorkforce.deploymentId}`,
      `baseline_pages_deployment_id=${baseline.surfaces.crmPages.deploymentId}`,
      `baseline_core_bootstrap_workflow_run_id=${baseline.bootstrapCore.workflowRunId}`,
      `baseline_core_bootstrap_artifact_id=${baseline.bootstrapCore.artifactId}`,
      `baseline_core_bootstrap_artifact_digest=${baseline.bootstrapCore.artifactDigest}`,
      "",
    ].join("\n"));
  }
  process.stdout.write(`Verified immutable production baseline ${baseline.sha256}.\n`);
} else {
  throw new Error("usage: ponto-production-baseline.mjs capture|verify <file>");
}
