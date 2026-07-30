import {
  isInventoryWorkflowState,
  NON_TERMINAL_STATUSES,
  parseCoordinator,
} from "./ponto-emergency-stop.mjs";

const token = String(process.env.GH_TOKEN || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const target = String(process.env.PONTO_EMERGENCY_TARGET || "").trim().toLowerCase();
if (!token || !repository.includes("/") || !["staging", "production"].includes(target)) {
  throw new Error("Ponto idle assertion custody is invalid");
}

const request = async (pathname) => {
  const response = await fetch(`${apiBase}${pathname}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API GET ${pathname} returned ${response.status}`);
  return response.json();
};

const workflow = await request(`/repos/${repository}/actions/workflows/ponto-progressive-release.yml`);
if (
  !isInventoryWorkflowState(workflow?.state)
  || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
  || workflow?.name !== "Ponto progressive release"
  || !Number.isInteger(workflow?.id)
) throw new Error("canonical Ponto coordinator workflow is unavailable");
const active = new Map();
for (const status of NON_TERMINAL_STATUSES) {
  let exhausted = false;
  for (let page = 1; page <= 20; page += 1) {
    const payload = await request(`/repos/${repository}/actions/runs?branch=main&status=${status}&per_page=100&page=${page}`);
    const rows = payload?.workflow_runs || [];
    for (const run of rows) {
      const parsed = parseCoordinator(run, {
        repository,
        workflowId: workflow.id,
        workflowName: workflow.name,
        target,
      });
      if (parsed && parsed.status !== "completed") active.set(parsed.runId, parsed);
    }
    if (rows.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) {
    throw new Error(`non-terminal ${status} coordinator inventory exceeds the governed discovery bound`);
  }
}
if (active.size) {
  throw new Error(`target has non-terminal Ponto coordinators: ${[...active.keys()].join(",")}`);
}
process.stdout.write(`No non-terminal Ponto coordinator targets ${target}.\n`);
