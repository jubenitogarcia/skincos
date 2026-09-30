import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { githubJson } from "./codex-github-integration-candidate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

export function workflowEvents(source) {
  const lines = String(source || "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^(?:on|['"]on['"]):(?:\s|$)/.test(line));
  if (start < 0) throw new Error("workflow trigger declaration is unavailable");
  const inline = lines[start].replace(/^(?:on|['"]on['"]):\s*/, "").replace(/\s+#.*$/, "").trim();
  const events = [];
  if (inline) {
    const values = inline.replace(/^\[/, "").replace(/\]$/, "").split(",").map((value) => value.trim());
    if (values.some((value) => !/^[a-z_]+$/.test(value))) throw new Error("workflow inline triggers are ambiguous");
    events.push(...values.map((name) => ({ name, block: "" })));
  } else {
    const section = [];
    for (const line of lines.slice(start + 1)) {
      if (line && !/^\s|^#/.test(line)) break;
      section.push(line);
    }
    for (let index = 0; index < section.length; index += 1) {
      const match = section[index].match(/^  ([a-z_]+):(?:\s*(.*))?$/);
      if (!match) continue;
      const inlineValue = String(match[2] || "").replace(/\s+#.*$/, "").trim();
      if (inlineValue && inlineValue !== "{}") {
        throw new Error(`workflow inline event configuration is ambiguous: ${match[1]}`);
      }
      const following = [];
      for (const line of section.slice(index + 1)) {
        if (/^  [a-z_]+:(?:\s|$)/.test(line)) break;
        following.push(line);
      }
      events.push({ name: match[1], block: following.join("\n") });
    }
    if (!events.length) throw new Error("workflow mapped triggers are ambiguous");
  }
  return events;
}

export function mergeTriggeredActionsEvents(source) {
  const events = workflowEvents(source);
  const triggered = [];
  for (const event of events) {
    if (["push", "status", "delete", "check_run", "check_suite"].includes(event.name)) triggered.push(event.name);
    if (["pull_request", "pull_request_target"].includes(event.name) && /\bclosed\b/.test(event.block)) triggered.push(`${event.name}:closed`);
  }
  return triggered;
}

async function workflowCatalog(repository, githubJsonImpl) {
  const catalog = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubJsonImpl(repository, `/actions/workflows?per_page=100&page=${page}`);
    const workflows = response?.workflows;
    if (!Array.isArray(workflows)) throw new Error("GitHub Actions workflow catalog is unavailable");
    catalog.push(...workflows);
    if (workflows.length < 100) return catalog;
  }
  throw new Error("GitHub Actions workflow catalog exceeded the bounded native merge audit");
}

async function activeWorkflowCatalog(repository, githubJsonImpl) {
  return (await workflowCatalog(repository, githubJsonImpl)).filter((workflow) => workflow?.state === "active");
}

export async function assertNoActionsTriggeredByMerge({ repository, githubJsonImpl = githubJson, root = ROOT, candidateRoot, changedPaths = [] }) {
  const permissions = await githubJsonImpl(repository, "/actions/permissions");
  if (permissions?.enabled === false) return { actionsEnabled: false, activeWorkflows: 0 };
  if (permissions?.enabled !== true) throw new Error("GitHub Actions repository enablement cannot be verified");
  const catalog = await workflowCatalog(repository, githubJsonImpl);
  const byPath = new Map();
  for (const workflow of catalog) {
    const relative = String(workflow?.path || "").replaceAll("\\", "/");
    if (!byPath.has(relative)) byPath.set(relative, []);
    byPath.get(relative).push(workflow);
  }
  if (candidateRoot) {
    const candidateWorkflows = path.resolve(candidateRoot, ".github/workflows");
    if (fs.existsSync(candidateWorkflows)) {
      for (const entry of fs.readdirSync(candidateWorkflows, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
        const relative = `.github/workflows/${entry.name}`;
        const triggers = mergeTriggeredActionsEvents(fs.readFileSync(path.join(candidateWorkflows, entry.name), "utf8"));
        if (!triggers.length) continue;
        const registered = byPath.get(relative) || [];
        if (!registered.length || registered.some((workflow) => workflow.state === "active")) {
          throw new Error(`candidate merge tree would start GitHub Actions workflow ${relative} through ${triggers.join(",")}`);
        }
        if (registered.some((workflow) => workflow.state !== "disabled_manually")) {
          throw new Error(`candidate workflow ${relative} is not proven manually disabled`);
        }
      }
    }
    // Any workflow change is also checked against the active main catalog below.
    // A newly added workflow can be auto-enabled by GitHub on the merge commit.
    for (const changed of changedPaths) {
      if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(changed)) continue;
      const absolute = path.resolve(candidateRoot, changed);
      if (!absolute.startsWith(`${candidateRoot}${path.sep}`)) throw new Error("candidate workflow path escaped checkout");
      if (fs.existsSync(absolute) && !fs.statSync(absolute).isFile()) throw new Error("candidate workflow is not a regular file");
    }
  }
  let inspected = 0;
  for (const workflow of catalog) {
      if (workflow?.state !== "active") continue;
      const relative = String(workflow.path || "").replaceAll("\\", "/");
      if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(relative)) {
        throw new Error("active GitHub Actions workflow has an unexpected path");
      }
      const absolute = path.resolve(root, relative);
      if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
        throw new Error(`active GitHub Actions workflow is absent from trusted main: ${relative}`);
      }
      const triggers = mergeTriggeredActionsEvents(fs.readFileSync(absolute, "utf8"));
      if (triggers.length) {
        throw new Error(`native merge would start GitHub Actions workflow ${relative} through ${triggers.join(",")}`);
      }
    inspected += 1;
  }
  return { actionsEnabled: true, activeWorkflows: inspected };
}

export async function inventoryActiveActions({ repository, githubJsonImpl = githubJson, root = ROOT }) {
  const workflows = await activeWorkflowCatalog(repository, githubJsonImpl);
  const counts = { push: 0, pull_request: 0, pull_request_target: 0, workflow_run: 0, schedule: 0, workflow_dispatch: 0 };
  const mergeTriggered = [];
  const missingFromMain = [];
  const scheduled = [];
  const workflowRun = [];
  for (const workflow of workflows) {
    const relative = String(workflow.path || "").replaceAll("\\", "/");
    const absolute = path.resolve(root, relative);
    if (!relative.startsWith(".github/workflows/") || !fs.existsSync(absolute)) {
      missingFromMain.push({ id: workflow.id, name: workflow.name, path: relative });
      continue;
    }
    const source = fs.readFileSync(absolute, "utf8");
    const events = workflowEvents(source);
    for (const event of events) if (Object.hasOwn(counts, event.name)) counts[event.name] += 1;
    if (events.some((event) => event.name === "schedule")) scheduled.push({ id: workflow.id, name: workflow.name, path: relative });
    if (events.some((event) => event.name === "workflow_run")) workflowRun.push({ id: workflow.id, name: workflow.name, path: relative });
    const triggers = mergeTriggeredActionsEvents(source);
    if (triggers.length) mergeTriggered.push({ id: workflow.id, name: workflow.name, path: relative, triggers });
  }
  return { active: workflows.length, counts, mergeTriggered, scheduled, workflowRun, missingFromMain };
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    if (!process.env.GH_TOKEN) {
      const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (result.error || result.status !== 0 || !String(result.stdout || "").trim()) throw new Error("native GitHub authentication is unavailable");
      process.env.GH_TOKEN = result.stdout.trim();
    }
    const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
    if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required");
    process.stdout.write(`${JSON.stringify(await inventoryActiveActions({ repository }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
