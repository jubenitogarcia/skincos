#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildReleaseManifest, matchesAny } from "./codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const repeated = (name) => process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function parsePair(value, name) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`${name} must be name=digest`);
  return { name: value.slice(0, separator), digest: value.slice(separator + 1) };
}

function selectedSurfaces(policy, sourceCommit) {
  const explicit = repeated("--surface");
  if (explicit.length) return explicit;
  const base = argument("--base");
  if (!base) throw new Error("use at least one --surface or provide --base to derive affected surfaces");
  const changed = git("diff", "--name-only", "--diff-filter=ACMR", `${base}...${sourceCommit}`).split(/\r?\n/).filter(Boolean);
  const derived = policy.surfaces.filter((surface) => surface.releaseInput && changed.some((file) => matchesAny(file, surface.patterns))).map((surface) => surface.id);
  if (!derived.length && process.argv.includes("--allow-empty")) return [];
  if (!derived.length) throw new Error("no release-input surface changed; documentation and ledger changes do not produce a runtime candidate");
  return derived;
}

function trackedInputs(policy, sourceCommit, surfaceIds) {
  const selected = policy.surfaces.filter((surface) => surfaceIds.includes(surface.id));
  if (selected.length !== surfaceIds.length) throw new Error("unknown release surface");
  if (!selected.length) return { inputs: [], policyPaths: [] };
  // Read the tree and blob ids in one Git call.  Calling `git rev-parse
  // <commit>:<path>` once per input is prohibitively slow on the Windows
  // mounted worktree and can make promotion evidence time out for a broad
  // surface such as timekeeping.
  const treeEntries = git("ls-tree", "-r", sourceCommit).split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("\t");
    if (separator < 0) throw new Error(`unexpected git tree entry: ${line}`);
    const header = line.slice(0, separator).split(/\s+/);
    return { path: line.slice(separator + 1), blob: header[2] };
  });
  const blobs = new Map(treeEntries.map((entry) => [entry.path, entry.blob]));
  const fileNames = treeEntries.map((entry) => entry.path);
  const surfacePatterns = selected.flatMap((surface) => surface.patterns);
  const policyPaths = [...new Set(["ops/codex/risk-policy.json", ...policy.releaseSharedInputs])].filter((file) => fileNames.includes(file));
  const inputPaths = [...new Set(fileNames.filter((file) => matchesAny(file, surfacePatterns) || policyPaths.includes(file)))].sort();
  return {
    inputs: inputPaths.map((file) => ({ path: file, blob: blobs.get(file) })),
    policyPaths
  };
}

const sourceCommit = argument("--source", "HEAD");
const sourceTree = git("rev-parse", `${sourceCommit}^{tree}`);
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));
const surfaces = selectedSurfaces(policy, sourceCommit);
const { inputs, policyPaths } = trackedInputs(policy, sourceCommit, surfaces);
const artifacts = repeated("--artifact").map((value) => parsePair(value, "--artifact"));
const evidence = repeated("--evidence").map((value) => parsePair(value, "--evidence"));
const migrations = inputs.filter(({ path: file }) => /(?:^|\/)migrations?\//i.test(file) || /(?:^|\/)\d+[_-].*\.sql$/i.test(file)).map(({ path: file }) => file);
const predecessorSourceCommit = argument("--predecessor-source");
const predecessorDigest = argument("--predecessor-digest");
const predecessor = predecessorSourceCommit || predecessorDigest ? {
  sourceCommit: predecessorSourceCommit ?? "unknown",
  releaseInputDigest: predecessorDigest ?? "unknown",
  artifactDigests: repeated("--predecessor-artifact")
} : null;
const manifest = buildReleaseManifest({ sourceCommit: git("rev-parse", sourceCommit), sourceTree, surfaces, inputs, policyPaths, artifacts, migrations, evidence, predecessor });
manifest.candidate = surfaces.length > 0;
if (!manifest.candidate) manifest.reason = "No release-input surface changed; documentation and ledger changes reuse the prior eligible candidate.";
const output = argument("--output");
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (output) fs.writeFileSync(path.resolve(root, output), serialized);
else process.stdout.write(serialized);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_input_digest=${manifest.releaseInputDigest}\n`);
