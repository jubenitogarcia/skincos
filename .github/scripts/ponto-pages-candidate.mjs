import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;

const aliasHost = (value) => {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return String(value).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

const commitSha = (deployment) =>
  String(deployment?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();

const terminalDeployment = (deployment) => {
  const stage = deployment?.latest_stage;
  return stage?.name === "deploy"
    && stage?.status === "success"
    && Number.isFinite(Date.parse(String(stage?.ended_on || "")))
    && deployment?.is_skipped === false;
};

const candidateUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.skincos-staging\.pages\.dev$/.test(url.hostname)
      && (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
};

export function selectPagesCandidate(deployments, {
  project,
  branch = "staging",
  releaseSha,
  startedAt,
  alias = "crm-staging.skincos.com.br",
}) {
  const expectedProject = String(project || "");
  const expectedBranch = String(branch || "");
  const expectedSha = String(releaseSha || "").toLowerCase();
  const startedAtMs = Date.parse(String(startedAt || ""));
  const expectedAlias = aliasHost(alias);
  if (
    !expectedProject
    || !expectedBranch
    || !SHA.test(expectedSha)
    || !Number.isFinite(startedAtMs)
    || !expectedAlias
    || !Array.isArray(deployments)
  ) throw new Error("Pages candidate selection identity is invalid");

  return deployments
    .filter((deployment) => {
      const createdAtMs = Date.parse(String(deployment?.created_on || ""));
      const aliases = new Set((deployment?.aliases || []).map(aliasHost));
      return UUID.test(String(deployment?.id || ""))
        && deployment?.project_name === expectedProject
        && deployment?.environment === "production"
        && deployment?.deployment_trigger?.metadata?.branch === expectedBranch
        && commitSha(deployment) === expectedSha
        && Number.isFinite(createdAtMs)
        && createdAtMs >= startedAtMs
        && terminalDeployment(deployment)
        && aliases.has(expectedAlias)
        && candidateUrl(deployment?.url);
    })
    .sort((a, b) => Date.parse(String(b.created_on)) - Date.parse(String(a.created_on)))
    .map((deployment) => ({
      id: String(deployment.id),
      url: String(deployment.url),
      createdOn: String(deployment.created_on),
    }))[0] || null;
}

export function readPagesDeploymentInventory(directory) {
  const files = fs.readdirSync(directory)
    .filter((file) => /^page-[0-9]+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/[0-9]+/)[0]) - Number(b.match(/[0-9]+/)[0]));
  if (!files.length) throw new Error("Pages deployment inventory is empty");
  const payloads = files.map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
  if (payloads.some((payload) => payload?.success !== true || !Array.isArray(payload?.result))) {
    throw new Error("Pages deployment inventory contains an invalid page");
  }
  return payloads.flatMap((payload) => payload.result);
}

export function resolvePagesCandidate(directory, expectations) {
  return selectPagesCandidate(readPagesDeploymentInventory(directory), expectations);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory] = process.argv.slice(2);
  try {
    if (!directory) throw new Error("usage: ponto-pages-candidate.mjs <inventory-directory>");
    const selected = resolvePagesCandidate(directory, {
      project: process.env.PROJECT,
      branch: process.env.BRANCH || "staging",
      releaseSha: process.env.RELEASE_SHA,
      startedAt: process.env.PAGES_STAGING_DEPLOYMENT_STARTED_AT,
      alias: process.env.PAGES_STAGING_ALIAS || "crm-staging.skincos.com.br",
    });
    if (!selected) process.exit(2);
    process.stdout.write(`${selected.id}\t${selected.url}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
