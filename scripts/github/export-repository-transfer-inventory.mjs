import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repo = option("--repo");
const output = option("--output");
if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  throw new Error("Usage: node scripts/github/export-repository-transfer-inventory.mjs --repo owner/repository [--output <private-path>]");
}

function ghJson(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function listFromEnvelope(endpoint, property) {
  const separator = endpoint.includes("?") ? "&" : "?";
  const first = ghJson(`${endpoint}${separator}per_page=100&page=1`);
  const items = [...(first[property] || [])];
  const total = Number(first.total_count || items.length);
  for (let page = 2; items.length < total; page += 1) {
    const next = ghJson(`${endpoint}${separator}per_page=100&page=${page}`);
    const nextItems = next[property] || [];
    if (!nextItems.length) break;
    items.push(...nextItems);
  }
  return items;
}

function capture(label, fn) {
  try {
    return { available: true, value: fn() };
  } catch (error) {
    const status = Number(error?.status || 0);
    return { available: false, error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "unavailable" };
  }
}

const repository = ghJson(`repos/${repo}`);
const workflows = capture("workflows", () => listFromEnvelope(`repos/${repo}/actions/workflows`, "workflows"));
const secrets = capture("secrets", () => listFromEnvelope(`repos/${repo}/actions/secrets`, "secrets"));
const variables = capture("variables", () => listFromEnvelope(`repos/${repo}/actions/variables`, "variables"));
const environments = capture("environments", () => listFromEnvelope(`repos/${repo}/environments`, "environments"));
const rulesets = capture("rulesets", () => ghJson(`repos/${repo}/rulesets?per_page=100`));
const hooks = capture("hooks", () => ghJson(`repos/${repo}/hooks?per_page=100`));
const collaborators = capture("collaborators", () => ghJson(`repos/${repo}/collaborators?per_page=100`));

const inventory = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  repository: {
    nameWithOwner: repository.full_name,
    visibility: repository.visibility,
    private: repository.private,
    defaultBranch: repository.default_branch,
    archiveUrl: repository.html_url,
  },
  actions: workflows.available
    ? { workflowCount: workflows.value.length, workflows: workflows.value.map(({ name, path: workflowPath, state }) => ({ name, path: workflowPath, state })) }
    : workflows,
  secrets: secrets.available
    ? { repositorySecretCount: secrets.value.length, repositorySecretNames: secrets.value.map(({ name }) => name).sort() }
    : secrets,
  variables: variables.available
    ? { repositoryVariableCount: variables.value.length, repositoryVariableNames: variables.value.map(({ name }) => name).sort() }
    : variables,
  environments: environments.available
    ? { count: environments.value.length, names: environments.value.map(({ name }) => name).sort() }
    : environments,
  rulesets: rulesets.available
    ? rulesets.value.map(({ name, target, enforcement }) => ({ name, target, enforcement }))
    : rulesets,
  webhooks: hooks.available
    ? { count: hooks.value.length, hooks: hooks.value.map(({ name, active, events }) => ({ name, active, events })).sort((a, b) => a.name.localeCompare(b.name)) }
    : hooks,
  permissions: collaborators.available
    ? { directCollaboratorCount: collaborators.value.length, adminCount: collaborators.value.filter(({ permissions }) => permissions?.admin).length }
    : collaborators,
  handling: {
    secretValues: "never exported",
    webhookUrls: "never exported",
    outputPolicy: "Use --output only with a private path outside the Git worktree."
  }
};

const summary = {
  repository: inventory.repository,
  actions: workflows.available ? { workflowCount: inventory.actions.workflowCount } : inventory.actions,
  secrets: secrets.available ? { repositorySecretCount: inventory.secrets.repositorySecretCount } : inventory.secrets,
  variables: variables.available ? { repositoryVariableCount: inventory.variables.repositoryVariableCount } : inventory.variables,
  environments: inventory.environments,
  rulesets: rulesets.available ? { count: inventory.rulesets.length } : inventory.rulesets,
  webhooks: hooks.available ? { count: inventory.webhooks.count } : inventory.webhooks,
  permissions: inventory.permissions,
  outputWritten: false,
};

if (output) {
  // Do not ask Git for the worktree root here. A Windows-created worktree can
  // contain a Windows gitdir path that a WSL Git process cannot resolve.
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const destination = path.resolve(output);
  const relative = path.relative(repositoryRoot, destination);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Inventory output must be outside the Git worktree.");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
  summary.outputWritten = true;
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
