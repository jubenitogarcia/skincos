import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseTagFor } from "./ponto-release-identity.mjs";

const NON_TERMINAL = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
const CORRELATED_TITLE_SUFFIX =
  /orchestrator=([1-9][0-9]*)(?: nonce=([0-9a-f]{32}))?$/;

export const isBodylessResponseStatus = (status) => status === 202 || status === 204;
export const readGitHubResponse = (response) => (
  isBodylessResponseStatus(response.status) ? null : response.json()
);

export function isCorrelatedChild(run, {
  repository,
  orchestratorRunId,
  orchestratorHeadSha = "",
  releaseSha = orchestratorHeadSha,
}) {
  const titleMatch = CORRELATED_TITLE_SUFFIX.exec(String(run?.display_title || ""));
  const expectedReleaseSha = String(releaseSha || "").trim().toLowerCase();
  const expectedBranch = /^[0-9a-f]{40}$/.test(expectedReleaseSha)
    ? releaseTagFor("ponto", expectedReleaseSha)
    : "main";
  return String(run?.id || "") !== String(orchestratorRunId)
    && run?.event === "workflow_dispatch"
    && run?.head_branch === expectedBranch
    && (!expectedReleaseSha || String(run?.head_sha || "").trim().toLowerCase() === expectedReleaseSha)
    && run?.repository?.full_name === repository
    && titleMatch?.[1] === String(orchestratorRunId)
    && String(run?.path || "").startsWith(".github/workflows/");
}

export function isTerminalRun(run) {
  return run?.status === "completed" && !NON_TERMINAL.has(String(run?.status || ""));
}

export function matchesPendingDispatch(run, pending) {
  const workflowName = String(run?.path || "").split("@")[0].split("/").at(-1) || "";
  const requestedAt = Date.parse(String(pending?.dispatchRequestedAt || ""));
  const createdAt = Date.parse(String(run?.created_at || ""));
  const orchestratorRunId = String(pending?.orchestratorRunId || "");
  const dispatchNonce = String(pending?.dispatchNonce || "");
  return pending?.workflow === workflowName
    && /^[1-9][0-9]*$/.test(orchestratorRunId)
    && /^[0-9a-f]{32}$/.test(dispatchNonce)
    && String(run?.display_title || "").endsWith(
      `orchestrator=${orchestratorRunId} nonce=${dispatchNonce}`,
    )
    && Number.isFinite(requestedAt)
    && Number.isFinite(createdAt)
    && createdAt >= requestedAt - 2_000;
}

export function isJournalAuthorizedRun(run, savedEntries) {
  const workflowPath = String(run?.path || "").split("@")[0];
  const workflowName = workflowPath.split("/").at(-1) || "";
  return (savedEntries || []).some((saved) => {
    const sameWorkflow = saved?.workflow === workflowName
      && saved?.workflowPath === workflowPath
      && Number(saved?.workflowId) === Number(run?.workflow_id);
    if (!sameWorkflow) return false;
    if (String(saved?.runId || "") === String(run?.id || "")) return true;
    return saved?.status === "dispatch-requested"
      && !saved?.runId
      && matchesPendingDispatch(run, saved);
  });
}

async function main() {
  const [artifactRoot, reportFile] = process.argv.slice(2);
  const token = String(process.env.GH_TOKEN || "").trim();
  const cancellationToken = String(process.env.PONTO_RECONCILIATION_CANCEL_TOKEN || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const orchestratorRunId = String(
    process.env.PONTO_COORDINATOR_RUN_ID || process.env.GITHUB_RUN_ID || "",
  ).trim();
  const orchestratorHeadSha = String(
    process.env.PONTO_COORDINATOR_SHA || process.env.GITHUB_SHA || "",
  ).trim().toLowerCase();
  const reconciliationTimeoutSeconds = Number(process.env.PONTO_RECONCILIATION_TIMEOUT_SECONDS || "600");
  if (!artifactRoot || !reportFile) throw new Error("artifact root and reconciliation report path are required");
  if (
    !token
    || !cancellationToken
    || !repository.includes("/")
    || !/^[0-9]+$/.test(orchestratorRunId)
    || !/^[0-9a-f]{40}$/.test(orchestratorHeadSha)
  ) {
    throw new Error("GitHub cancellation custody is unavailable");
  }
  if (
    !Number.isInteger(reconciliationTimeoutSeconds)
    || reconciliationTimeoutSeconds < 150
    || reconciliationTimeoutSeconds > 1_200
  ) throw new Error("child reconciliation timeout is outside the governed range");

  const request = async (pathname, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const requestToken = ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? cancellationToken
      : token;
    const response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${requestToken}`,
        "x-github-api-version": "2022-11-28",
        ...(init.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${init.method || "GET"} ${pathname} returned ${response.status}`);
    return readGitHubResponse(response);
  };

  const runsDir = path.join(artifactRoot, "runs");
  const journalAuthorizes = (run) => {
    if (!fs.existsSync(runsDir)) return false;
    const savedEntries = [];
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(path.join(runsDir, entry.name), "utf8"));
      } catch {
        continue;
      }
      savedEntries.push(saved);
    }
    return isJournalAuthorizedRun(run, savedEntries);
  };

  const discover = async () => {
    const found = new Map();
    for (let page = 1; page <= 5; page += 1) {
      const payload = await request(`/repos/${repository}/actions/runs?event=workflow_dispatch&per_page=100&page=${page}`);
      const rows = payload?.workflow_runs || [];
      for (const run of rows) {
        if (
          isCorrelatedChild(run, { repository, orchestratorRunId, orchestratorHeadSha })
          && journalAuthorizes(run)
        ) {
          found.set(String(run.id), run);
        }
      }
      if (rows.length < 100) break;
    }
    const runsDir = path.join(artifactRoot, "runs");
    if (fs.existsSync(runsDir)) {
      for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        let saved;
        try { saved = JSON.parse(fs.readFileSync(path.join(runsDir, entry.name), "utf8")); } catch { continue; }
        if (!/^[0-9]+$/.test(String(saved?.runId || ""))) continue;
        const run = await request(`/repos/${repository}/actions/runs/${saved.runId}`);
        if (
          isCorrelatedChild(run, { repository, orchestratorRunId, orchestratorHeadSha })
          && journalAuthorizes(run)
        ) {
          found.set(String(run.id), run);
        }
      }
    }
    return found;
  };

  const updateKnownRunFile = (run) => {
    const runsDir = path.join(artifactRoot, "runs");
    if (!fs.existsSync(runsDir)) return;
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(runsDir, entry.name);
      let saved;
      try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
      const exactId = String(saved?.runId || "") === String(run.id);
      const pendingWorkflow = !saved?.runId
        && matchesPendingDispatch(run, saved);
      if (!exactId && !pendingWorkflow) continue;
      fs.writeFileSync(file, `${JSON.stringify({
        ...saved,
        runId: String(run.id),
        status: run.status,
        conclusion: run.conclusion || "unknown",
        headSha: run.head_sha,
        url: run.html_url,
        cancellationReconciled: true,
      }, null, 2)}\n`, { mode: 0o600 });
    }
  };

  const pendingDispatches = new Map();
  if (fs.existsSync(runsDir)) {
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let saved;
      try { saved = JSON.parse(fs.readFileSync(path.join(runsDir, entry.name), "utf8")); } catch { continue; }
      if (saved?.status === "dispatch-requested" && !saved?.runId && typeof saved?.workflow === "string") {
        pendingDispatches.set(entry.name, {
          workflow: saved.workflow,
          dispatchRequestedAt: String(saved.dispatchRequestedAt || ""),
          orchestratorRunId: String(saved.orchestratorRunId || ""),
          dispatchNonce: String(saved.dispatchNonce || ""),
        });
      }
    }
  }
  const cancellation = {};
  const reconciliationDeadline = Date.now() + reconciliationTimeoutSeconds * 1_000;
  let quietSince = null;
  while (Date.now() < reconciliationDeadline) {
    const discovered = await discover();
    for (const [runId, discoveredRun] of discovered) {
      let run = discoveredRun;
      for (const [pendingFile, pending] of pendingDispatches) {
        if (matchesPendingDispatch(run, pending)) pendingDispatches.delete(pendingFile);
      }
      const record = cancellation[runId] || {
        workflowPath: run.path,
        initialStatus: run.status,
        cancelRequested: false,
        forceCancelRequested: false,
        firstObservedAt: new Date().toISOString(),
      };
      if (!isTerminalRun(run) && !record.cancelRequested) {
        try {
          await request(`/repos/${repository}/actions/runs/${runId}/cancel`, { method: "POST" });
          record.cancelRequested = true;
          record.cancelRequestedAt = Date.now();
        } catch (error) {
          record.cancelError = String(error?.message || error);
        }
      }
      if (!isTerminalRun(run)) {
        run = await request(`/repos/${repository}/actions/runs/${runId}`);
        if (
          !isTerminalRun(run)
          && !record.forceCancelRequested
          && Number(record.cancelRequestedAt || 0) > 0
          && Date.now() - record.cancelRequestedAt >= 60_000
        ) {
          try {
            await request(`/repos/${repository}/actions/runs/${runId}/force-cancel`, { method: "POST" });
            record.forceCancelRequested = true;
          } catch (error) {
            record.forceCancelError = String(error?.message || error);
          }
        }
      }
      updateKnownRunFile(run);
      record.finalStatus = run.status;
      record.conclusion = run.conclusion || "unknown";
      record.terminal = isTerminalRun(run);
      cancellation[runId] = record;
    }
    const active = Object.values(cancellation).some((item) => item.terminal !== true);
    if (!active && pendingDispatches.size === 0) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= 30_000) break;
    } else {
      quietSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  const unresolved = Object.entries(cancellation)
    .filter(([, item]) => item.terminal !== true)
    .map(([runId, item]) => ({ runId, workflowPath: item.workflowPath, reason: "child-not-terminal" }));
  for (const [runFile, pending] of pendingDispatches) {
    unresolved.push({ runFile, workflow: pending.workflow, reason: "dispatch-requested-run-never-observed" });
  }
  const report = {
    schemaVersion: 1,
    orchestratorRunId,
    orchestratorHeadSha,
    discoveredChildren: Object.keys(cancellation).length,
    cancellation,
    unresolved,
    passed: unresolved.length === 0,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!report.passed) throw new Error("one or more governed child runs remained non-terminal");
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) await main();
