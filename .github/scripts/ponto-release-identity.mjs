#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  dependencyClosureForSource,
  sha256,
} from "../../scripts/codex-global-coordinator.mjs";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const FULL_SHA = /^[0-9a-f]{40}$/i;
export const DIGEST = /^[0-9a-f]{64}$/i;
export const RELEASE_TAG_PREFIX = "skincos/release";

const safeId = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/;
const safeIssuerId = /^[A-Za-z0-9][A-Za-z0-9._:/@ -]{0,511}$/;

function text(value) {
  return String(value ?? "").trim();
}

function normalizedSha(value, name) {
  const result = text(value).toLowerCase();
  if (!FULL_SHA.test(result)) throw new Error(`${name} must be a full commit SHA`);
  return result;
}

function normalizedDigest(value, name) {
  const result = text(value).toLowerCase();
  if (!DIGEST.test(result)) throw new Error(`${name} must be a SHA-256 digest`);
  return result;
}

function normalizedModule(value) {
  const result = text(value).toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(result)) throw new Error("release module is invalid");
  return result;
}

function normalizedSafeId(value, name) {
  const result = text(value);
  if (!result || !safeId.test(result)) throw new Error(`${name} is invalid`);
  return result;
}

function normalizedIssuerId(value, name) {
  const result = text(value);
  if (!result || !safeIssuerId.test(result)) throw new Error(`${name} is invalid`);
  return result;
}

export function releaseTagFor(module, sourceCommit) {
  return `${RELEASE_TAG_PREFIX}/${normalizedModule(module)}/${normalizedSha(sourceCommit, "release source")}`;
}

export function releaseRefFor(module, sourceCommit) {
  return `refs/tags/${releaseTagFor(module, sourceCommit)}`;
}

export function identityDigestFor(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("release identity is required");
  }
  const { releaseIdentityDigest: _ignored, ...unsigned } = identity;
  return sha256(canonicalJson(unsigned));
}

function normalizeArtifactBindings(bindings = []) {
  if (!Array.isArray(bindings)) throw new Error("artifact bindings must be an array");
  return bindings.map((binding) => {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("artifact binding is invalid");
    const allowed = new Set([
      "name", "digest", "id", "versionId", "deploymentId", "artifactId", "artifactDigest",
      "workflowRunId", "runId", "workerVersionId", "pagesDeploymentId", "schemaIdentity",
      "migrationIdentity", "rollbackIncumbent", "sourceCommit", "sourceTree", "releaseRef", "releaseTag",
    ]);
    for (const key of Object.keys(binding)) {
      if (!allowed.has(key)) throw new Error(`artifact binding field is not allowed: ${key}`);
    }
    const name = normalizedSafeId(binding.name, "artifact binding name");
    const result = { name };
    for (const key of [...allowed].filter((candidate) => candidate !== "name")) {
      if (binding[key] === undefined || binding[key] === null || text(binding[key]) === "") continue;
      result[key] = normalizedSafeId(binding[key], `artifact binding ${key}`);
    }
    if (!result.digest && !result.artifactDigest && !result.versionId && !result.deploymentId && !result.artifactId) {
      throw new Error(`artifact binding ${name} has no immutable identity`);
    }
    return result;
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeIncumbents(value) {
  if (!Array.isArray(value)) throw new Error("rollback incumbents must be an array");
  return value.map((item) => normalizedSafeId(item, "rollback incumbent")).sort();
}

function normalizePredecessor(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("release predecessor is invalid");
  const result = {};
  for (const key of ["module", "sourceCommit", "sourceTree", "releaseRef", "releaseTag", "releaseIdentityDigest", "workflowRunId", "runId"]) {
    if (value[key] === undefined || value[key] === null || text(value[key]) === "") continue;
    result[key] = key === "sourceCommit" || key === "sourceTree"
      ? normalizedSha(value[key], `predecessor ${key}`)
      : key === "releaseIdentityDigest"
        ? normalizedDigest(value[key], `predecessor ${key}`)
        : normalizedSafeId(value[key], `predecessor ${key}`);
  }
  if (!result.sourceCommit || !result.releaseIdentityDigest) throw new Error("release predecessor is incomplete");
  return result;
}

export function buildReleaseIdentity({
  module,
  sourceCommit,
  sourceTree,
  dependencyClosureDigest,
  repository = "",
  workflow = "",
  runId = "",
  predecessor = null,
  artifactBindings = [],
  rollbackIncumbents = [],
}) {
  const normalizedModuleName = normalizedModule(module);
  const commit = normalizedSha(sourceCommit, "release source");
  const tree = normalizedSha(sourceTree, "release source tree");
  const closure = normalizedDigest(dependencyClosureDigest, "dependency closure");
  const releaseTag = releaseTagFor(normalizedModuleName, commit);
  const unsigned = {
    schemaVersion: 1,
    identityType: "skincos-release",
    module: normalizedModuleName,
    sourceCommit: commit,
    sourceTree: tree,
    dependencyClosureDigest: closure,
    releaseTag,
    releaseRef: `refs/tags/${releaseTag}`,
    artifactManifestSchemaVersion: 1,
    artifactBindings: normalizeArtifactBindings(artifactBindings),
    rollbackIncumbents: normalizeIncumbents(rollbackIncumbents),
    ...(normalizePredecessor(predecessor) ? { predecessor: normalizePredecessor(predecessor) } : {}),
    ...(repository || workflow || runId ? {
      issuer: {
        ...(repository ? { repository: normalizedSafeId(repository, "issuer repository") } : {}),
        ...(workflow ? { workflow: normalizedIssuerId(workflow, "issuer workflow") } : {}),
        ...(runId ? { runId: normalizedSafeId(runId, "issuer runId") } : {}),
      },
    } : {}),
  };
  return { ...unsigned, releaseIdentityDigest: identityDigestFor(unsigned) };
}

export function verifyReleaseIdentity(identity, {
  module,
  sourceCommit,
  sourceTree,
  dependencyClosureDigest,
  expectedReleaseTag,
  expectedReleaseRef,
  tagTarget,
} = {}) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("release identity is required");
  const expected = buildReleaseIdentity({
    module: module || identity.module,
    sourceCommit: sourceCommit || identity.sourceCommit,
    sourceTree: sourceTree || identity.sourceTree,
    dependencyClosureDigest: dependencyClosureDigest || identity.dependencyClosureDigest,
    repository: identity.issuer?.repository || "",
    workflow: identity.issuer?.workflow || "",
    runId: identity.issuer?.runId || "",
    predecessor: identity.predecessor || null,
    artifactBindings: identity.artifactBindings || [],
    rollbackIncumbents: identity.rollbackIncumbents || [],
  });
  if (identity.releaseIdentityDigest !== expected.releaseIdentityDigest) throw new Error("release identity digest differs");
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (JSON.stringify(identity[key]) !== JSON.stringify(expectedValue)) throw new Error(`release identity ${key} differs`);
  }
  if (expectedReleaseTag && expected.releaseTag !== expectedReleaseTag) throw new Error("release tag differs from the immutable identity");
  if (expectedReleaseRef && expected.releaseRef !== expectedReleaseRef) throw new Error("release ref differs from the immutable identity");
  if (tagTarget !== undefined && normalizedSha(tagTarget, "release tag target") !== expected.sourceCommit) {
    throw new Error("release tag does not point to the immutable release SHA");
  }
  return expected;
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function assertLocalRef(identity) {
  const target = git("rev-parse", `${identity.releaseRef}^{commit}`).toLowerCase();
  if (target !== identity.sourceCommit) throw new Error("local immutable release ref does not point to the release SHA");
}

export function releaseTagApiPath(repository, tag) {
  const repo = normalizedSafeId(repository, "GitHub repository");
  const normalizedTag = normalizedSafeId(tag, "release tag");
  return `/repos/${repo}/git/ref/tags/${normalizedTag.split("/").map(encodeURIComponent).join("/")}`;
}

function requestPathForTag(tag) {
  return releaseTagApiPath(process.env.GITHUB_REPOSITORY, tag);
}

async function githubRequest(pathname, token, init = {}) {
  const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
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
  return { response, body };
}

async function ensureRemoteTag(tag, sourceCommit, token) {
  if (!token || !String(process.env.GITHUB_REPOSITORY || "").includes("/")) {
    throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required to establish the immutable release ref");
  }
  const refPath = requestPathForTag(tag);
  const existing = await githubRequest(refPath, token);
  if (existing.response.ok) {
    if (existing.body?.object?.type !== "commit" || String(existing.body.object.sha || "").toLowerCase() !== sourceCommit) {
      throw new Error("immutable release tag already exists with a different target");
    }
    return { created: false, target: sourceCommit };
  }
  if (existing.response.status !== 404) throw new Error(`GitHub release ref lookup returned ${existing.response.status}`);
  const created = await githubRequest(`/repos/${process.env.GITHUB_REPOSITORY}/git/refs`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: sourceCommit }),
  });
  if (created.response.ok) return { created: true, target: sourceCommit };
  // A retry or a concurrent coordinator may have created the deterministic
  // ref between the GET and POST. Re-read and accept only the exact target.
  const raced = await githubRequest(refPath, token);
  if (raced.response.ok && raced.body?.object?.type === "commit" && String(raced.body.object.sha || "").toLowerCase() === sourceCommit) {
    return { created: false, target: sourceCommit };
  }
  throw new Error(`GitHub immutable release ref creation returned ${created.response.status}`);
}

function writeOutputFile(file, identity) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolved);
  return resolved;
}

function writeGitHubOutputs(file, identity) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
      `release_ref=${identity.releaseRef}`,
      `release_tag=${identity.releaseTag}`,
      `release_identity_digest=${identity.releaseIdentityDigest}`,
      `source_tree=${identity.sourceTree}`,
      `dependency_closure_digest=${identity.dependencyClosureDigest}`,
      `release_identity_file=${file}`,
      "",
    ].join("\n"));
  }
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, [
      `PONTO_RELEASE_REF=${identity.releaseRef}`,
      `PONTO_RELEASE_TAG=${identity.releaseTag}`,
      `PONTO_RELEASE_IDENTITY_DIGEST=${identity.releaseIdentityDigest}`,
      `PONTO_RELEASE_IDENTITY_FILE=${file}`,
      "",
    ].join("\n"));
  }
}

export async function createReleaseIdentity({ module, sourceCommit, outputFile, token }) {
  const commit = normalizedSha(sourceCommit, "release source");
  const resolved = git("rev-parse", `${commit}^{commit}`).toLowerCase();
  if (resolved !== commit) throw new Error("requested release source is not available locally");
  const sourceTree = git("rev-parse", `${commit}^{tree}`).toLowerCase();
  const closure = dependencyClosureForSource({ module, sourceCommit: commit });
  if (closure.sourceCommit !== commit || closure.sourceTree !== sourceTree) throw new Error("release closure source identity differs");
  const identity = buildReleaseIdentity({
    module,
    sourceCommit: commit,
    sourceTree,
    dependencyClosureDigest: closure.digest,
    repository: process.env.GITHUB_REPOSITORY || "",
    workflow: process.env.GITHUB_WORKFLOW || "",
    runId: process.env.GITHUB_RUN_ID || "",
  });
  await ensureRemoteTag(identity.releaseTag, identity.sourceCommit, token);
  // Make the exact remote ref available to all later checks in this runner;
  // the child workflow independently resolves the same remote tag.
  execFileSync("git", ["update-ref", identity.releaseRef, identity.sourceCommit], { cwd: ROOT, stdio: "ignore" });
  const file = writeOutputFile(outputFile, identity);
  writeGitHubOutputs(file, identity);
  return { identity, file };
}

export function readAndVerifyReleaseIdentity(file, options = {}) {
  const identity = JSON.parse(fs.readFileSync(file, "utf8"));
  return verifyReleaseIdentity(identity, options);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    const [command, module, sourceCommit, outputFile] = process.argv.slice(2);
    if (command === "create" && module && sourceCommit && outputFile) {
      const result = await createReleaseIdentity({
        module,
        sourceCommit,
        outputFile,
        token: String(process.env.GH_TOKEN || "").trim(),
      });
      process.stdout.write(`Immutable ${result.identity.module} release identity established at ${result.identity.releaseRef}; digest=${result.identity.releaseIdentityDigest}\n`);
    } else if (command === "verify" && module && sourceCommit && outputFile) {
      const source = normalizedSha(sourceCommit, "release source");
      const identity = readAndVerifyReleaseIdentity(outputFile, {
        module,
        sourceCommit: source,
        sourceTree: git("rev-parse", `${source}^{tree}`),
        dependencyClosureDigest: dependencyClosureForSource({ module, sourceCommit: source }).digest,
        expectedReleaseTag: releaseTagFor(module, source),
        expectedReleaseRef: releaseRefFor(module, source),
        tagTarget: git("rev-parse", `${releaseRefFor(module, source)}^{commit}`),
      });
      assertLocalRef(identity);
      process.stdout.write(`Immutable ${identity.module} release identity verified for ${identity.sourceCommit}; digest=${identity.releaseIdentityDigest}\n`);
    } else {
      throw new Error("usage: ponto-release-identity.mjs create|verify <module> <source-sha> <identity-file>");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
