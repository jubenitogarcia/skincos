import fs from "node:fs";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const versionId = value => String(value?.version_id || value?.id || "").toLowerCase();

export function activeDeploymentId(payload) {
  return String(payload?.id || payload?.deployment_id || payload?.latest?.id || "").toLowerCase();
}

export function normalizedVersions(payload) {
  const versions = payload?.versions || payload?.latest?.versions || [];
  if (!Array.isArray(versions)) throw new Error("active Worker versions are not an array");
  return versions.map((version) => {
    const id = versionId(version);
    const percentage = Number(version?.percentage);
    if (!UUID.test(id) || !Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
      throw new Error("active Worker version identity or percentage is invalid");
    }
    return { id, percentage };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function sameVersions(actual, expected) {
  return actual.length === expected.length
    && actual.every((item, index) => item.id === expected[index].id && item.percentage === expected[index].percentage);
}

function expectedCandidateVersions(item, stage) {
  if (["pilot", "canary"].includes(stage)) {
    return [
      { id: item.candidateVersionId.toLowerCase(), percentage: 0 },
      { id: item.incumbentVersionId.toLowerCase(), percentage: 100 },
    ].sort((left, right) => left.id.localeCompare(right.id));
  }
  return [{ id: item.candidateVersionId.toLowerCase(), percentage: 100 }];
}

export function classifyWorkerRollbackOwnership(payload, item, stage) {
  if (
    !["staging", "pilot", "canary", "production"].includes(stage)
    || !UUID.test(item?.candidateVersionId || "")
    || !UUID.test(item?.incumbentVersionId || "")
    || item.candidateVersionId.toLowerCase() === item.incumbentVersionId.toLowerCase()
  ) {
    throw new Error("Worker rollback ownership inputs are invalid");
  }
  const actual = normalizedVersions(payload);
  const deploymentId = activeDeploymentId(payload);
  const expectedDeploymentId = String(item.deploymentId || "").toLowerCase();
  const candidateOwned = sameVersions(actual, expectedCandidateVersions(item, stage))
    && (!expectedDeploymentId || deploymentId === expectedDeploymentId);
  if (candidateOwned) return "candidate-owned";
  const authorizedReplacementMessage = String(item?.authorizedReplacementMessage || "");
  const reconciledCandidateOwned = sameVersions(actual, expectedCandidateVersions(item, stage))
    && Boolean(expectedDeploymentId)
    && deploymentId !== expectedDeploymentId
    && /^ponto:auto-abort:[0-9a-f]{40}:orchestrator-[1-9][0-9]*$/.test(authorizedReplacementMessage)
    && String(payload?.annotations?.["workers/message"] || "") === authorizedReplacementMessage;
  if (reconciledCandidateOwned) return "candidate-owned-reconciled";
  const incumbentOnly = [{ id: item.incumbentVersionId.toLowerCase(), percentage: 100 }];
  if (sameVersions(actual, incumbentOnly)) return "already-incumbent";
  return "ownership-conflict";
}

export function classifyWorkerPublisherCompensationOwnership(payload, item, stage) {
  if (
    !["staging", "pilot", "canary", "production", "rollback"].includes(stage)
    || !UUID.test(item?.candidateVersionId || "")
    || !UUID.test(item?.incumbentVersionId || "")
    || item.candidateVersionId.toLowerCase() === item.incumbentVersionId.toLowerCase()
  ) {
    throw new Error("Worker publisher compensation ownership inputs are invalid");
  }
  const actual = normalizedVersions(payload);
  const incumbentOnly = [{ id: item.incumbentVersionId.toLowerCase(), percentage: 100 }];
  if (sameVersions(actual, incumbentOnly)) return "already-incumbent";

  // A failed explicit rollback is never compensated forward. Only an exact
  // successful publisher deployment can own a compensating rollback.
  if (stage === "rollback" || !UUID.test(item?.deploymentId || "")) return "ownership-conflict";
  return classifyWorkerRollbackOwnership(payload, item, stage);
}

const aliasHost = (value) => {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return String(value).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

export function latestProductionPagesDeployment(payload, { alias = "" } = {}) {
  if (payload?.success !== true || !Array.isArray(payload?.result)) {
    throw new Error("Pages deployment inventory is invalid");
  }
  const production = payload.result
    .filter(item => item?.environment === "production")
    .sort((left, right) => String(right?.created_on || "").localeCompare(String(left?.created_on || "")));
  const expectedAlias = alias ? aliasHost(alias) : "";
  const aliased = expectedAlias
    ? production.filter(item => (item?.aliases || []).map(aliasHost).includes(expectedAlias))
    : [];
  return (aliased.length ? aliased : production)[0] || null;
}

export function isTerminalPagesDeployment(deployment) {
  const stage = deployment?.latest_stage;
  return stage?.name === "deploy"
    && stage?.status === "success"
    && Number.isFinite(Date.parse(String(stage?.ended_on || "")))
    && deployment?.is_skipped === false;
}

export function classifyPagesRollbackOwnership(payload, item) {
  if (!UUID.test(item?.incumbentDeploymentId || "")) {
    throw new Error("Pages rollback incumbent identity is invalid");
  }
  const latest = latestProductionPagesDeployment(payload, { alias: item?.alias });
  const latestId = String(latest?.id || "").toLowerCase();
  const candidateId = String(item?.candidateDeploymentId || "").toLowerCase();
  const incumbentId = String(item.incumbentDeploymentId).toLowerCase();
  const restoredId = String(item?.restoredDeploymentId || "").toLowerCase();
  if (candidateId && !UUID.test(candidateId)) throw new Error("Pages rollback candidate identity is invalid");
  if (restoredId && !UUID.test(restoredId)) throw new Error("Pages restored deployment identity is invalid");
  if (!isTerminalPagesDeployment(latest)) return "ownership-conflict";
  if (candidateId && latestId === candidateId) return "candidate-owned";
  if (restoredId && latestId === restoredId) return "already-restored";
  if (latestId === incumbentId) return "already-incumbent";
  return "ownership-conflict";
}

function main() {
  const [mode, statusFile, stage, candidateVersionId, incumbentVersionId, deploymentId, reportFile] = process.argv.slice(2);
  if (mode !== "classify-worker-compensation" || !statusFile || !stage || !reportFile) {
    throw new Error(
      "usage: ponto-rollback-ownership.mjs classify-worker-compensation <status.json> <stage> <candidate-version> <incumbent-version> <deployment-id> <report.json>",
    );
  }
  const payload = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  let ownership;
  let error = "";
  try {
    ownership = classifyWorkerPublisherCompensationOwnership(payload, {
      candidateVersionId,
      incumbentVersionId,
      deploymentId,
    }, stage);
  } catch (cause) {
    ownership = "ownership-conflict";
    error = String(cause?.message || cause);
  }
  fs.writeFileSync(reportFile, `${JSON.stringify({
    schemaVersion: 1,
    ownership,
    stage,
    activeDeploymentId: activeDeploymentId(payload),
    publisherDeploymentId: String(deploymentId || "").toLowerCase(),
    candidateVersionId: String(candidateVersionId || "").toLowerCase(),
    incumbentVersionId: String(incumbentVersionId || "").toLowerCase(),
    mutationPerformed: false,
    credentialsIncluded: false,
    piiIncluded: false,
    ...(error ? { error } : {}),
  }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(ownership);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Ponto rollback ownership failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export function attestPagesIncumbentState(incumbent, active, {
  incumbentDeploymentId,
  activeDeploymentId,
  project,
  branch,
  alias,
}) {
  const incumbentCommit = String(incumbent?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();
  const activeCommit = String(active?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();
  const activeAliasHosts = new Set((active?.aliases || []).map((value) => {
    try { return new URL(value).hostname; } catch { return String(value).replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
  }));
  const passed = UUID.test(incumbentDeploymentId || "")
    && UUID.test(activeDeploymentId || "")
    && incumbent?.id === incumbentDeploymentId
    && incumbent?.project_name === project
    && incumbent?.environment === "production"
    && incumbent?.deployment_trigger?.metadata?.branch === branch
    && /^[0-9a-f]{40}$/.test(incumbentCommit)
    && isTerminalPagesDeployment(incumbent)
    && active?.id === activeDeploymentId
    && active?.project_name === project
    && active?.environment === "production"
    && active?.deployment_trigger?.metadata?.branch === branch
    && activeCommit === incumbentCommit
    && isTerminalPagesDeployment(active)
    && activeAliasHosts.has(alias);
  return { passed, sourceCommitSha: incumbentCommit };
}
