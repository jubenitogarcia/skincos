#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const POLICY_PATH = ".github/governance/cloudflare-single-writer-policy.json";

const MUTATION_PATTERNS = [
  /\bwrangler\b[^\r\n]*(?:pages\s+deploy|versions\s+(?:upload|deploy)|\bdeploy\b|secret\s+(?:put|bulk|delete)|d1\s+(?:execute|migrations)|r2\s+(?:object\s+(?:put|delete)|bucket\s+create))/i,
  /\bpages\s+deploy\b/i,
  /\bversions\s+(?:upload|deploy)\b/i,
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function isMutationWorkflow(text) {
  return text.split(/\r?\n/).some((line) => {
    if (/\b(?:dry-run|local)\b/i.test(line)) return false;
    return MUTATION_PATTERNS.some((pattern) => pattern.test(line));
  });
}

function resourcePresent(text, resource) {
  if (resource.includes("<environment>")) {
    const prefix = resource.replace("<environment>", "");
    return text.includes(prefix);
  }
  return text.includes(resource);
}

function coordinationGuardPresent(text) {
  return text.includes("global-coordination-acquire")
    || text.includes("global-coordination-check")
    || text.includes("global-coordinator-deployment-guard.mjs")
    || text.includes("ponto-orchestrator-gate.yml");
}

export function loadPolicy() {
  return JSON.parse(read(POLICY_PATH));
}

export function validatePolicy(policy = loadPolicy()) {
  const errors = [];
  const groups = new Map();
  for (const group of policy.coordinationGroups || []) {
    if (!group?.id || !group.resource) {
      errors.push("every coordination group requires id and resource");
      continue;
    }
    if (groups.has(group.id)) errors.push(`duplicate coordination group: ${group.id}`);
    groups.set(group.id, group);
  }

  const covered = new Set();
  for (const surface of policy.surfaces || []) {
    if (!surface?.id || !surface.canonicalDeployWorkflow || !surface.coordinationGroup) {
      errors.push("every Cloudflare surface requires id, canonicalDeployWorkflow and coordinationGroup");
      continue;
    }
    const group = groups.get(surface.coordinationGroup);
    if (!group) {
      errors.push(`${surface.id} references unknown coordination group ${surface.coordinationGroup}`);
      continue;
    }
    const workflows = new Set(surface.mutationWorkflows || []);
    if (!workflows.has(surface.canonicalDeployWorkflow)) {
      errors.push(`${surface.id} canonical deploy workflow is not in mutationWorkflows`);
    }
    for (const workflow of workflows) {
      const absolute = path.join(ROOT, workflow);
      if (!fs.existsSync(absolute)) {
        errors.push(`${surface.id} references missing workflow ${workflow}`);
        continue;
      }
      const text = fs.readFileSync(absolute, "utf8");
      if (!resourcePresent(text, group.resource)) {
        errors.push(`${workflow} does not declare coordination resource ${group.resource}`);
      }
      if (!coordinationGuardPresent(text)) {
        errors.push(`${workflow} has no global coordination guard for ${surface.id}`);
      }
      covered.add(workflow);
    }
  }

  const retired = new Set(policy.retiredWorkflows || []);
  for (const entry of fs.readdirSync(path.join(ROOT, ".github/workflows"))) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const workflow = `.github/workflows/${entry}`;
    const text = read(workflow);
    if (isMutationWorkflow(text) && !covered.has(workflow) && !retired.has(workflow)) {
      errors.push(`${workflow} contains a Cloudflare mutation but is not classified in the single-writer policy`);
    }
  }

  if (policy.authority?.coordinationPlane !== "global") {
    errors.push("Cloudflare single-writer authority must use the global coordination plane");
  }
  if (policy.authority?.mode !== "fail-closed") {
    errors.push("Cloudflare single-writer authority must be fail-closed");
  }
  if (policy.authority?.automaticPagesDeployments !== "disabled") {
    errors.push("automatic Pages deployments must be disabled");
  }
  if (policy.pagesGitIntegration?.unknownOrUnavailable !== "fail-closed") {
    errors.push("unknown Pages Git integration state must fail closed");
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validatePolicy();
  if (errors.length) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Cloudflare single-writer governance OK.\n");
  }
}
