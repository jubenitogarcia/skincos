import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseTagFor } from "./ponto-release-identity.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "pending", "requested", "waiting"]);
const RETRYABLE_DISPATCH_STATUSES = new Set([429, 500, 502, 503, 504]);
const DISPATCH_RECONCILIATION_ATTEMPTS = 3;
const DISPATCH_RECONCILIATION_DELAY_MS = 2_000;

export const REQUIRED_CHECK_WORKFLOWS = Object.freeze([
  {
    workflow: "ci-smoke.yml",
    checks: ["CI Smoke (Assert)"],
  },
  {
    workflow: "central-e2e-smoke.yml",
    checks: ["Central E2E Smoke"],
  },
  {
    workflow: "lint-format-static.yml",
    checks: ["JS/TS Checks (workspace)"],
  },
  {
    workflow: "security-secrets-audit.yml",
    checks: ["Dependency Audit (JS/TS)", "Scan for secrets (Gitleaks)"],
  },
]);

function normalizedReleaseSha(value) {
  const releaseSha = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(releaseSha)) throw new Error("Ponto release SHA must be a full commit SHA");
  return releaseSha;
}

function normalizedRepository(value) {
  const repository = String(value || "").trim();
  if (!REPOSITORY.test(repository)) throw new Error("GitHub repository is invalid");
  return repository;
}

function normalizedReleaseTag(releaseSha, value) {
  const expected = releaseTagFor("ponto", releaseSha);
  const tag = String(value || "").trim();
  if (tag !== expected) throw new Error("immutable Ponto release tag is absent or differs from the release SHA");
  return tag;
}

function matchingRuns({ runs, repository, releaseSha, releaseTag }) {
  return (Array.isArray(runs) ? runs : []).filter((run) => (
    run?.event === "workflow_dispatch"
    && run?.head_branch === releaseTag
    && String(run?.head_sha || "").trim().toLowerCase() === releaseSha
    && Number(run?.run_attempt) === 1
    && run?.repository?.full_name === repository
    && run?.head_repository?.full_name === repository
  ));
}

function workflowRunsPath(repository, workflow, releaseTag) {
  return `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(releaseTag)}&per_page=100`;
}

function retryableDispatchStatus(error) {
  const direct = Number(error?.status);
  if (Number.isInteger(direct)) return direct;
  const match = /returned\s+(\d{3})\b/.exec(String(error?.message || error));
  return match ? Number(match[1]) : null;
}

function isRetryableDispatchError(error) {
  return RETRYABLE_DISPATCH_STATUSES.has(retryableDispatchStatus(error));
}

function plannedExistingRun({ workflow, result, repository, releaseSha, releaseTag }) {
  if (!Array.isArray(result?.workflow_runs)) {
    throw new Error(`GitHub required-check workflow ${workflow} returned an invalid runs payload`);
  }
  const matches = matchingRuns({
    runs: result.workflow_runs,
    repository,
    releaseSha,
    releaseTag,
  });
  if (matches.length > 1) {
    throw new Error(`immutable required-check workflow ${workflow} is ambiguous for this release tag`);
  }
  if (matches.length === 0) return null;

  const run = matches[0];
  if (run.status === "completed") {
    if (run.conclusion !== "success") {
      throw new Error(`immutable required-check workflow ${workflow} ended ${String(run.conclusion || "without-success")}`);
    }
    return { state: "reconciled-success", runId: String(run.id) };
  }
  if (!ACTIVE_RUN_STATUSES.has(String(run.status || ""))) {
    throw new Error(`immutable required-check workflow ${workflow} has an unknown status`);
  }
  return { state: "reconciled-active", runId: String(run.id) };
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function planRequiredCheckDispatches({ repository, releaseSha, releaseTag, runsByWorkflow } = {}) {
  const normalizedRepositoryName = normalizedRepository(repository);
  const normalizedSha = normalizedReleaseSha(releaseSha);
  const normalizedTag = normalizedReleaseTag(normalizedSha, releaseTag);
  const plans = [];

  for (const spec of REQUIRED_CHECK_WORKFLOWS) {
    const matches = matchingRuns({
      runs: runsByWorkflow?.[spec.workflow],
      repository: normalizedRepositoryName,
      releaseSha: normalizedSha,
      releaseTag: normalizedTag,
    });
    if (matches.length > 1) {
      throw new Error(`immutable required-check workflow ${spec.workflow} is ambiguous for this release tag`);
    }
    if (matches.length === 0) {
      plans.push({ ...spec, state: "dispatch", runId: null });
      continue;
    }

    const run = matches[0];
    if (run.status === "completed") {
      if (run.conclusion !== "success") {
        throw new Error(`immutable required-check workflow ${spec.workflow} ended ${String(run.conclusion || "without-success")}`);
      }
      plans.push({ ...spec, state: "reused-success", runId: String(run.id) });
      continue;
    }
    if (!ACTIVE_RUN_STATUSES.has(String(run.status || ""))) {
      throw new Error(`immutable required-check workflow ${spec.workflow} has an unknown status`);
    }
    plans.push({ ...spec, state: "reused-active", runId: String(run.id) });
  }
  return plans;
}

async function githubRequest({ apiBase, token, pathname, init = {} }) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub API ${init.method || "GET"} ${pathname} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function ensureRequiredCheckDispatches({
  repository,
  releaseSha,
  releaseTag,
  request,
  wait = sleep,
} = {}) {
  const normalizedRepositoryName = normalizedRepository(repository);
  const normalizedSha = normalizedReleaseSha(releaseSha);
  const normalizedTag = normalizedReleaseTag(normalizedSha, releaseTag);
  if (typeof request !== "function") throw new Error("GitHub request function is required");

  const runsByWorkflow = {};
  for (const { workflow } of REQUIRED_CHECK_WORKFLOWS) {
    const result = await request(
      workflowRunsPath(normalizedRepositoryName, workflow, normalizedTag),
    );
    if (!Array.isArray(result?.workflow_runs)) {
      throw new Error(`GitHub required-check workflow ${workflow} returned an invalid runs payload`);
    }
    runsByWorkflow[workflow] = result.workflow_runs;
  }

  const plans = planRequiredCheckDispatches({
    repository: normalizedRepositoryName,
    releaseSha: normalizedSha,
    releaseTag: normalizedTag,
    runsByWorkflow,
  });
  const results = [];
  for (const plan of plans) {
    if (plan.state !== "dispatch") {
      results.push(plan);
      continue;
    }
    let lastError = null;
    for (let attempt = 1; attempt <= DISPATCH_RECONCILIATION_ATTEMPTS; attempt += 1) {
      try {
        await request(
          `/repos/${normalizedRepositoryName}/actions/workflows/${encodeURIComponent(plan.workflow)}/dispatches`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: normalizedTag }),
          },
        );
        results.push({ ...plan, state: "requested" });
        break;
      } catch (error) {
        if (!isRetryableDispatchError(error)) throw error;
        lastError = error;
        await wait(DISPATCH_RECONCILIATION_DELAY_MS);
        const existing = plannedExistingRun({
          workflow: plan.workflow,
          result: await request(workflowRunsPath(normalizedRepositoryName, plan.workflow, normalizedTag)),
          repository: normalizedRepositoryName,
          releaseSha: normalizedSha,
          releaseTag: normalizedTag,
        });
        if (existing) {
          results.push({ ...plan, ...existing });
          break;
        }
        if (attempt === DISPATCH_RECONCILIATION_ATTEMPTS) throw lastError;
      }
    }
  }
  return {
    schemaVersion: 1,
    repository: normalizedRepositoryName,
    releaseSha: normalizedSha,
    releaseTag: normalizedTag,
    workflows: results,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function writeReport(file, report) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolved);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    const [outputFile] = process.argv.slice(2);
    const token = String(process.env.GH_TOKEN || "").trim();
    const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
    const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
    const releaseTag = String(process.env.PONTO_RELEASE_TAG || "").trim();
    const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
    if (!outputFile || !token) throw new Error("output file and GH_TOKEN are required for immutable required-check dispatch");
    const report = await ensureRequiredCheckDispatches({
      repository,
      releaseSha,
      releaseTag,
      request: (pathname, init) => githubRequest({ apiBase, token, pathname, init }),
    });
    writeReport(outputFile, report);
    process.stdout.write(`Immutable required checks are ${report.workflows.map((entry) => `${entry.workflow}:${entry.state}`).join(", ")}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
