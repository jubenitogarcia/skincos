#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const POLICY_PATH = ".github/governance/cloudflare-single-writer-policy.json";
const SOURCE_EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".yml", ".yaml", ".sh", ".py"];
const REPO_ROOT_PREFIX = /^(?:\.\/)?(?:\.github|scripts|ops|platform|shared|api|booking|crm|finance|inventory|workforce|website|orb|integration|identity)\//;

const MUTATION_PATTERNS = [
  /\bwrangler(?:@[A-Za-z0-9._-]+)?\b[^\r\n]*(?:\bpages\b[^\r\n]*\bdeploy\b|\bversions\b[^\r\n]*(?:\bupload\b|\bdeploy\b)|\bdeploy\b|\brollback\b|\bsecret\b[^\r\n]*(?:\bput\b|\bbulk\b|\bdelete\b)|\bkv\b[^\r\n]*\bkey\b[^\r\n]*(?:\bput\b|\bdelete\b)|\bd1\b[^\r\n]*(?:\bexecute\b|\bmigrations\b[^\r\n]*\bapply\b)|\br2\b[^\r\n]*\bobject\b[^\r\n]*(?:\bput\b|\bdelete\b))/i,
  /\b(?:terraform|tofu)\b[^\r\n]*(?:\bapply\b|\bdestroy\b|\bimport\b|\bstate\s+(?:mv|rm|push)\b)/i,
  /\bpulumi\b[^\r\n]*(?:\bup\b|\bdestroy\b|\bimport\b|\bstate\s+(?:rename|delete|repair)\b)/i,
  /\bpages\s+deploy\b/i,
  /\b(?:POST|PUT|PATCH|DELETE)\b[^\r\n]*(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)/i,
  /(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)[^\r\n]*(?:method\s*[:=]\s*["']?(?:POST|PUT|PATCH|DELETE)\b|\bcurl\b[^\r\n]*\s-X\s*(?:POST|PUT|PATCH|DELETE)\b)/i,
];

function read(relativePath, root = ROOT) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

let trackedFileCache;
const sourceTextCache = new Map();
function trackedFiles(root = ROOT) {
  if (root === ROOT && trackedFileCache) return trackedFileCache;
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map(normalize)
    .filter((file) => !file.split("/").includes("node_modules"));
  if (root === ROOT) trackedFileCache = files;
  return files;
}

function resolveLocal(sourcePath, request, files) {
  const normalizedRequest = normalize(request);
  if (!normalizedRequest.startsWith(".")) return null;
  const source = normalize(sourcePath);
  const rootRelative = source.endsWith(".yml") || source.endsWith(".yaml") || REPO_ROOT_PREFIX.test(normalizedRequest);
  const base = rootRelative
    ? path.posix.normalize(normalizedRequest.replace(/^\.\//, ""))
    : path.posix.normalize(path.posix.join(path.posix.dirname(source), normalizedRequest));
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = normalize(`${base}${extension}`);
    if (!candidate.includes("/node_modules/") && files.has(candidate)) return candidate;
  }
  for (const extension of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = normalize(path.posix.join(base, `index${extension}`));
    if (!candidate.includes("/node_modules/") && files.has(candidate)) return candidate;
  }
  return null;
}

function resolveRepoPath(request, files) {
  const normalized = normalize(request);
  if (!normalized || normalized.startsWith("$") || normalized.includes("RUNNER_TEMP")) return null;
  const candidates = [normalized, `${normalized}/action.yml`, `${normalized}/action.yaml`];
  return candidates.find((candidate) => files.has(candidate) && !candidate.includes("/node_modules/")) || null;
}

function referencesFrom(sourcePath, source, files) {
  const references = new Set();
  const addRelative = (request) => {
    const resolved = resolveLocal(sourcePath, request, files);
    if (resolved) references.add(resolved);
  };
  for (const pattern of [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) addRelative(match[1]);
  }
  for (const match of source.matchAll(/\buses:\s*['"]?(\.\/(?:\.github|scripts|ops|platform|shared|api|booking|crm|finance|inventory|workforce|website|orb|integration)[^\s'"@#]*)/g)) {
    const resolved = resolveRepoPath(match[1], files);
    if (resolved) references.add(resolved);
  }
  for (const match of source.matchAll(/\b(?:node|bash|sh|python3?)\s+(?:--[^\s]+\s+)*((?:\.\/)?(?:\.github|scripts|ops|platform|shared|api|booking|crm|finance|inventory|workforce|website|orb|integration)\/[A-Za-z0-9_./-]+)/g)) {
    const resolved = resolveRepoPath(match[1], files);
    if (resolved) references.add(resolved);
  }
  for (const match of source.matchAll(/(?:--config|--wrangler-config|CONFIG_FILE=)\s*["']?([^\s"']+wrangler\.toml)/g)) {
    const resolved = resolveRepoPath(match[1], files);
    if (resolved) references.add(resolved);
  }
  return [...references].sort();
}

export function traceMutationGraph({ sourcePath, files, root = ROOT, readFile } = {}) {
  const fileList = files || trackedFiles(root);
  const load = readFile || ((relativePath) => read(relativePath, root));
  const fileSet = new Set(fileList.map(normalize));
  const pending = [normalize(sourcePath)];
  const visited = new Set();
  const texts = new Map();
  const missing = [];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current) || !fileSet.has(current)) continue;
    visited.add(current);
    let source;
    try {
      if (!readFile && root === ROOT && sourceTextCache.has(current)) source = sourceTextCache.get(current);
      else source = load(current);
      if (!readFile && root === ROOT) sourceTextCache.set(current, source);
    } catch {
      missing.push(current);
      continue;
    }
    texts.set(current, source);
    for (const dependency of referencesFrom(current, source, fileSet)) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return { files: [...visited].sort(), texts, missing };
}

function lineIsMutation(line) {
  if (/(?:dry[-_]run|--local)\b/i.test(line)) return false;
  if (/(?:pattern|regex|regexp)\s*=|new\s+RegExp|\.test\s*\(/i.test(line)) return false;
  return MUTATION_PATTERNS.some((pattern) => pattern.test(line));
}

function callBlocks(source, pattern) {
  const blocks = [];
  for (const match of source.matchAll(pattern)) {
    const opening = match.index + match[0].lastIndexOf("(");
    let depth = 0;
    let quote = "";
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = opening; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }
      if (character === "/" && next === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(match.index, index + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

function cloudflareApiMutationEvidence(source) {
  const endpointPattern = /(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)/i;
  const methodPattern = /\bmethod\s*:\s*["']?(?:POST|PUT|PATCH|DELETE)\b/i;
  const aliases = new Set();
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]https:\/\/(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)/gi)) {
    aliases.add(match[1]);
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*["'`]https:\/\/(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)/gi)) {
    aliases.add(match[1]);
  }
  const endpointIn = (block) => endpointPattern.test(block)
    // A literal containment check is intentionally conservative for this
    // source scanner and avoids compiling input-derived regular expressions.
    || [...aliases].some((alias) => block.includes(alias));
  const fetchBlocks = callBlocks(source, /\b(?:fetch|fetchImpl)\s*\(/g);
  if (fetchBlocks.some((block) => endpointIn(block) && methodPattern.test(block))) return true;

  const wrapperNames = new Set();
  const definitionPatterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
  ];
  for (const pattern of definitionPatterns) {
    for (const match of source.matchAll(pattern)) {
      const body = source.slice(match.index, match.index + 6000);
      if (endpointIn(body) && /\bfetch(?:Impl)?\s*\(/.test(body) && /\.\.\.\s*init\b/.test(body)) wrapperNames.add(match[1]);
    }
  }
  for (const wrapper of wrapperNames) {
    const wrapperCalls = callBlocks(source, /\b[A-Za-z_$][\w$]*\s*\(/g)
      .filter((block) => {
        const trimmed = block.trimStart();
        return trimmed.startsWith(`${wrapper}(`) || trimmed.startsWith(`${wrapper} (`);
      });
    if (wrapperCalls.some((block) => methodPattern.test(block))) return true;
  }

  const curlMutation = /\bcurl\b[\s\S]{0,900}(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)[\s\S]{0,900}(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|\bcurl\b[\s\S]{0,900}(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b[\s\S]{0,900}(?:api\.cloudflare\.com|cloudflare\.com\/client\/v4)/i;
  return curlMutation.test(source);
}

export function mutationEvidence(graph) {
  const evidence = [];
  for (const [file, source] of graph.texts) {
    for (const line of source.split(/\r?\n/)) if (lineIsMutation(line)) evidence.push({ file, line: line.trim().slice(0, 240) });
    if (cloudflareApiMutationEvidence(source) && !evidence.some((item) => item.file === file && item.line.includes("Cloudflare API"))) {
      evidence.push({ file, line: "transitive Cloudflare API mutation detected across source lines" });
    }
  }
  return evidence;
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
  const nonPublishing = new Map();
  for (const entry of policy.nonPublishingWorkflows || []) {
    if (!entry?.workflow || nonPublishing.has(entry.workflow)) {
      errors.push("non-publishing workflow exceptions require unique workflow paths");
      continue;
    }
    const absolute = path.join(ROOT, entry.workflow);
    if (!fs.existsSync(absolute)) {
      errors.push(`non-publishing exception references missing workflow ${entry.workflow}`);
      continue;
    }
    if (!Array.isArray(entry.requiredMarkers) || entry.requiredMarkers.length === 0) {
      errors.push(`non-publishing exception ${entry.workflow} requires static safety markers`);
      continue;
    }
    const graph = traceMutationGraph({ sourcePath: entry.workflow });
    const text = [...graph.texts.values()].join("\n");
    for (const marker of entry.requiredMarkers) {
      if (!text.includes(marker)) errors.push(`${entry.workflow} is missing non-publishing safety marker ${marker}`);
    }
    if (graph.missing.length) errors.push(`${entry.workflow} references missing local files: ${graph.missing.join(", ")}`);
    nonPublishing.set(entry.workflow, entry);
  }
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
    const exceptional = new Set(surface.exceptionalMutationWorkflows || []);
    if (!workflows.has(surface.canonicalDeployWorkflow)) errors.push(`${surface.id} canonical deploy workflow is not in mutationWorkflows`);
    for (const workflow of workflows) {
      const absolute = path.join(ROOT, workflow);
      if (!fs.existsSync(absolute)) {
        errors.push(`${surface.id} references missing workflow ${workflow}`);
        continue;
      }
      const graph = traceMutationGraph({ sourcePath: workflow });
      const text = [...graph.texts.values()].join("\n");
      if (!exceptional.has(workflow) && !resourcePresent(text, group.resource)) errors.push(`${workflow} does not declare coordination resource ${group.resource}`);
      if (exceptional.has(workflow)
        ? !text.includes("global-coordinator-recovery-guard.mjs")
        : !coordinationGuardPresent(text)) {
        errors.push(`${workflow} has no global coordination guard for ${surface.id}`);
      }
      if (graph.missing.length) errors.push(`${workflow} references missing local files: ${graph.missing.join(", ")}`);
      covered.add(workflow);
    }
  }

  const retired = new Set(policy.retiredWorkflows || []);
  for (const entry of fs.readdirSync(path.join(ROOT, ".github/workflows"))) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const workflow = `.github/workflows/${entry}`;
    const graph = traceMutationGraph({ sourcePath: workflow });
    const evidence = mutationEvidence(graph);
    if (evidence.length && !covered.has(workflow) && !retired.has(workflow) && !nonPublishing.has(workflow)) {
      errors.push(`${workflow} contains a transitive Cloudflare mutation but is not classified in the single-writer policy: ${evidence.slice(0, 2).map((item) => `${item.file}:${item.line}`).join(" | ")}`);
    }
  }

  if (policy.authority?.coordinationPlane !== "global") errors.push("Cloudflare single-writer authority must use the global coordination plane");
  if (policy.authority?.mode !== "fail-closed") errors.push("Cloudflare single-writer authority must be fail-closed");
  if (policy.authority?.automaticPagesDeployments !== "disabled") errors.push("automatic Pages deployments must be disabled");
  if (policy.pagesGitIntegration?.unknownOrUnavailable !== "fail-closed") errors.push("unknown Pages Git integration state must fail closed");
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
