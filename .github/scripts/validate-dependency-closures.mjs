#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const POLICY_PATH = "ops/governance/global-concurrency-policy.json";
const SOURCE_EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml"];

function read(relativePath, root = ROOT) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function globRegex(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const matchCache = new Map();
function matches(file, patterns) {
  const normalized = normalize(file);
  return (patterns || []).some((pattern) => {
    const normalizedPattern = normalize(pattern);
    const key = `${normalizedPattern}\0${normalized}`;
    if (!matchCache.has(key)) matchCache.set(key, globRegex(normalizedPattern).test(normalized));
    return matchCache.get(key);
  });
}

function trackedFiles(root = ROOT) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map(normalize)
    .filter((file) => !file.split("/").includes("node_modules"));
}

function resolveLocal(source, request, files) {
  const normalizedRequest = normalize(request);
  if (!normalizedRequest.startsWith(".")) return null;
  const normalizedSource = normalize(source);
  const repoRelativeWorkflowImport = /^(?:\.\/)?(?:\.github|scripts|ops|platform|shared|api|booking|crm|finance|inventory|workforce|website|orb|integration)\//.test(normalizedRequest);
  const base = repoRelativeWorkflowImport || normalizedSource.endsWith(".yml") || normalizedSource.endsWith(".yaml")
    ? path.posix.normalize(normalizedRequest.replace(/^\.\//, ""))
    : path.posix.normalize(path.posix.join(path.posix.dirname(normalizedSource), normalizedRequest));
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = normalize(`${base}${extension}`);
    if (candidate.includes("/node_modules/")) continue;
    if (files.has(candidate)) return candidate;
  }
  for (const extension of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = normalize(path.posix.join(base, `index${extension}`));
    if (candidate.includes("/node_modules/")) continue;
    if (files.has(candidate)) return candidate;
  }
  return base;
}

function referencesFrom(sourcePath, source, files) {
  const references = new Set();
  const add = (request) => {
    const resolved = resolveLocal(sourcePath, request, files);
    if (resolved && !resolved.includes("/node_modules/")) references.add(resolved);
  };
  for (const pattern of [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) add(match[1]);
  }
  for (const match of source.matchAll(/\buses:\s*(\.[^\s@#]+)/g)) {
    const candidate = normalize(match[1]).replace(/^\.\//, "");
    if (!candidate.includes("/node_modules/") && files.has(candidate)) references.add(candidate);
  }
  for (const match of source.matchAll(/\b(?:node|bash|sh|python3?)\s+((?:\.github|scripts|ops|platform|shared|api|booking|crm|finance|inventory|workforce|website|orb|integration)\/[A-Za-z0-9_./-]+)/g)) {
    const candidate = normalize(match[1]).replace(/^\.\//, "");
    if (!candidate.includes("/node_modules/") && files.has(candidate)) references.add(candidate);
  }
  for (const match of source.matchAll(/(?:--config|--wrangler-config|CONFIG_FILE=)\s*["']?([^\s"']+wrangler\.toml)/g)) {
    const candidate = normalize(match[1]).replace(/^\.\//, "");
    if (!candidate.includes("/node_modules/") && files.has(candidate)) references.add(candidate);
  }
  return [...references].sort();
}

function closureFor(policy, module) {
  const closure = policy.releaseClosures?.[module];
  if (!closure || closure.requiresExplicitClosure) throw new Error(`dependency closure is not declared for ${module}`);
  if (!Array.isArray(closure.patterns) || closure.patterns.length === 0) throw new Error(`dependency closure for ${module} is empty`);
  const shared = closure.sharedInputs ? policy.sharedInputs || [] : [];
  return { patterns: closure.patterns, shared };
}

function exceptionMatches(policy, module, source, dependency) {
  return (policy.closureExceptions || []).some((entry) => entry.module === module
    && matches(source, [entry.sourcePattern])
    && matches(dependency, [entry.dependencyPattern]));
}

function digestPaths(paths, readFile) {
  const hash = crypto.createHash("sha256");
  for (const file of paths) {
    const content = readFile(file);
    hash.update(file);
    hash.update("\0");
    hash.update(crypto.createHash("sha256").update(content).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function validateDependencyClosures({
  policy = JSON.parse(read(POLICY_PATH)),
  files = trackedFiles(),
  modules,
  root = ROOT,
  readFile = (relativePath) => read(relativePath, root),
} = {}) {
  const fileSet = new Set(files.map(normalize));
  const errors = [];
  const reports = [];
  const localSourceCache = new Map();
  const localReferenceCache = new Map();
  const moduleNames = modules || Object.keys(policy.releaseClosures || {}).filter((name) => name !== "default" && name !== "merge");
  for (const module of moduleNames) {
    let closure;
    try { closure = closureFor(policy, module); } catch (error) { errors.push(error.message); continue; }
    const selected = new Set([...fileSet].filter((file) => matches(file, closure.patterns) || matches(file, closure.shared)));
    if (selected.size === 0) {
      errors.push(`${module}: dependency closure selected no tracked files`);
      continue;
    }
    const pending = [...selected];
    const visited = new Set();
    const edges = [];
    while (pending.length) {
      const source = pending.pop();
      if (visited.has(source) || !fileSet.has(source)) continue;
      visited.add(source);
      if (source === "package.json" || source.endsWith("/package.json")) continue;
      let sourceText = localSourceCache.get(source);
      try {
        if (sourceText === undefined) {
          sourceText = readFile(source);
          localSourceCache.set(source, sourceText);
        }
      } catch { errors.push(`${module}: cannot read ${source}`); continue; }
      const references = localReferenceCache.get(source) || referencesFrom(source, sourceText, fileSet);
      localReferenceCache.set(source, references);
      for (const dependency of references) {
        edges.push({ source, dependency });
        if (matches(dependency, closure.patterns) || matches(dependency, closure.shared) || exceptionMatches(policy, module, source, dependency)) {
          if (!visited.has(dependency)) pending.push(dependency);
          continue;
        }
        errors.push(`${module}: observable dependency ${source} -> ${dependency} is outside the declared closure`);
      }
    }
    const digestInputPaths = [...visited].sort();
    reports.push({
      module,
      selectedFileCount: selected.size,
      reachableFileCount: visited.size,
      edgeCount: edges.length,
      dependencyClosureDigest: digestPaths(digestInputPaths, readFile),
    });
  }
  return { errors: [...new Set(errors)].sort(), reports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateDependencyClosures();
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
    if (result.errors.length) {
      for (const error of result.errors) process.stderr.write(`dependency closure validation failed: ${error}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`dependency closure validation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
