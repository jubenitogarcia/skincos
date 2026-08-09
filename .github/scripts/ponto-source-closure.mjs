import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  assertDependencyClosureUnchanged,
  dependencyClosureForSource,
} from "../../scripts/codex-global-coordinator.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FULL_SHA = /^[0-9a-f]{40}$/i;

function normalizeSource(value, name) {
  const source = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(source)) throw new Error(`${name} must be a full commit SHA`);
  return source;
}

function ensureCommitAvailable(source) {
  try {
    execFileSync("git", ["cat-file", "-e", `${source}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return;
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "origin", source], { cwd: ROOT, stdio: "ignore" });
  }
  execFileSync("git", ["cat-file", "-e", `${source}^{commit}`], { cwd: ROOT, stdio: "ignore" });
}

export function pontoDependencyClosureDigest(source) {
  const normalized = normalizeSource(source, "Ponto source");
  ensureCommitAvailable(normalized);
  return dependencyClosureForSource({ module: "ponto", sourceCommit: normalized }).digest;
}

export function assertPontoSourceClosureUnchanged(releaseSource, observedSource) {
  const release = normalizeSource(releaseSource, "Ponto release source");
  const observed = normalizeSource(observedSource, "observed Ponto source");
  if (release === observed) return { release, observed, digest: null };
  ensureCommitAvailable(release);
  ensureCommitAvailable(observed);
  const releaseDigest = dependencyClosureForSource({ module: "ponto", sourceCommit: release }).digest;
  const observedDigest = dependencyClosureForSource({ module: "ponto", sourceCommit: observed }).digest;
  assertDependencyClosureUnchanged(releaseDigest, observedDigest);
  return { release, observed, digest: releaseDigest };
}

export function pontoSourceClosureMatches(releaseSource, observedSource) {
  try {
    assertPontoSourceClosureUnchanged(releaseSource, observedSource);
    return true;
  } catch {
    return false;
  }
}
