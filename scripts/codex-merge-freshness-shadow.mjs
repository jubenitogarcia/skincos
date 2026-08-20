#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildClassificationFallback,
  classifyFiles,
  parseGitNameStatus,
} from "./codex-autonomy-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FULL_SHA = /^[0-9a-f]{40}$/i;
const DEPTH_STEPS = [32, 128, 512];
const SENSITIVE_SURFACES = new Set(["unclassified", "codex-baseline", "github-governance"]);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitExists(value) {
  if (!FULL_SHA.test(value)) return false;
  try {
    git("cat-file", "-e", `${value}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function fetchCommit(value, label) {
  if (!FULL_SHA.test(value)) throw new Error(`${label} must be a full immutable commit SHA`);
  if (commitExists(value)) return;
  try {
    git("fetch", "--no-tags", "--depth=2", "origin", value);
  } catch {
    throw new Error(`unable to fetch immutable ${label} ${value}`);
  }
  if (!commitExists(value)) throw new Error(`fetched ${label} is not available as a commit`);
}

function mergeBase(base, head) {
  try {
    return git("merge-base", base, head);
  } catch {
    return "";
  }
}

function ensureBoundedRange(base, head) {
  fetchCommit(base, "base");
  fetchCommit(head, "head");
  let resolved = mergeBase(base, head);
  if (resolved) return resolved;

  for (const depth of DEPTH_STEPS) {
    for (const endpoint of [base, head]) {
      try {
        git("fetch", "--no-tags", `--depth=${depth}`, "origin", endpoint);
      } catch {
        // Keep trying bounded endpoint/depth combinations; exhaustion fails closed.
      }
    }
    resolved = mergeBase(base, head);
    if (resolved) return resolved;
  }
  throw new Error(`unable to resolve merge base for bounded range ${base}...${head}`);
}

function closureMaterial(report) {
  return {
    risk: report.risk,
    surfaces: [...new Set(report.surfaces || [])].sort(),
    languages: [...new Set(report.languages || [])].sort(),
    dependencies_changed: report.dependencies_changed === true,
    shared_contracts_changed: report.shared_contracts_changed === true,
    production_sensitive: report.production_sensitive === true,
    security_sensitive: report.security_sensitive === true,
  };
}

export function dependencyClosureDigest(report) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(closureMaterial(report)))
    .digest("hex");
}

function hasSensitiveClosure(report) {
  const surfaces = new Set(report.surfaces || []);
  return report.risk === "high"
    || report.risk === "critical"
    || report.dependencies_changed === true
    || report.shared_contracts_changed === true
    || report.production_sensitive === true
    || report.security_sensitive === true
    || [...SENSITIVE_SURFACES].some((surface) => surfaces.has(surface));
}

export function buildShadowDecision({
  previousMainSha,
  currentMainSha,
  pr,
  mainReport,
  prReport,
}) {
  const reasons = [];
  const previous = String(previousMainSha || "").trim().toLowerCase();
  const current = String(currentMainSha || "").trim().toLowerCase();
  const base = String(pr?.baseSha || "").trim().toLowerCase();
  const head = String(pr?.headSha || "").trim().toLowerCase();
  const mainSurfaces = new Set(mainReport.surfaces || []);
  const prSurfaces = new Set(prReport.surfaces || []);
  const overlap = [...mainSurfaces].some((surface) => prSurfaces.has(surface));
  let reusable = true;

  if (!FULL_SHA.test(previous) || !FULL_SHA.test(current) || !FULL_SHA.test(head)) {
    reusable = false;
    reasons.push("immutable SHA input is missing or invalid");
  }
  if (current === previous) reasons.push("main did not advance");
  if (base && base !== previous) {
    reusable = false;
    reasons.push("PR base is not the previously validated main SHA");
  }
  if (current !== previous && hasSensitiveClosure(mainReport)) {
    reusable = false;
    reasons.push("main advance has an elevated or shared dependency closure");
  }
  if (current !== previous && overlap) {
    reusable = false;
    reasons.push("main advance and PR share an affected surface");
  }
  if (hasSensitiveClosure(prReport)) {
    reusable = false;
    reasons.push("PR itself is elevated or shared; full revalidation remains required");
  }
  if (mainReport.classification_status !== "ok" || prReport.classification_status !== "ok") {
    reusable = false;
    reasons.push("classification is not sealed; fail closed");
  }
  if (!reasons.length) reasons.push("closures are disjoint and both classifications are sealed");

  return {
    pr_number: pr?.number ?? null,
    head_sha: head || null,
    previous_main_sha: previous || null,
    current_main_sha: current || null,
    base_sha: base || null,
    admission: reusable ? "shadow-reuse-candidate" : "revalidate-required",
    reusable_candidate: reusable,
    strict_up_to_date_still_required: true,
    mutates_repository: false,
    main_closure_digest: dependencyClosureDigest(mainReport),
    pr_closure_digest: dependencyClosureDigest(prReport),
    reasons,
  };
}

function classifyRange(policy, base, head) {
  try {
    ensureBoundedRange(base, head);
    const entries = parseGitNameStatus(git("diff", "--name-status", "-z", `${base}...${head}`));
    return classifyFiles(policy, entries);
  } catch (error) {
    return buildClassificationFallback({
      policy,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function readPrs(file) {
  const value = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8"));
  if (!Array.isArray(value)) throw new Error("PR input must be an array");
  return value;
}

function main() {
  const previousMainSha = argument("--previous-main");
  const currentMainSha = argument("--current-main");
  const prsFile = argument("--prs-file");
  const outputPath = argument("--output");
  if (!FULL_SHA.test(String(previousMainSha)) || !FULL_SHA.test(String(currentMainSha))) {
    throw new Error("previous and current main SHAs must be full immutable commits");
  }
  if (!prsFile) throw new Error("--prs-file is required");

  const policyPath = argument("--policy", "ops/codex/risk-policy.json");
  const policy = JSON.parse(fs.readFileSync(path.resolve(ROOT, policyPath), "utf8"));
  const mainReport = classifyRange(policy, previousMainSha, currentMainSha);
  const results = [];
  for (const pr of readPrs(prsFile)) {
    const headSha = String(pr.headSha || "").trim().toLowerCase();
    const baseSha = FULL_SHA.test(String(pr.baseSha || "")) ? String(pr.baseSha).trim().toLowerCase() : previousMainSha;
    const prReport = classifyRange(policy, baseSha, headSha);
    results.push({
      ...buildShadowDecision({ previousMainSha, currentMainSha, pr, mainReport, prReport }),
      main_report: closureMaterial(mainReport),
      pr_report: closureMaterial(prReport),
    });
  }

  const result = {
    schemaVersion: 1,
    mode: "shadow-only",
    generated_at: new Date().toISOString(),
    previous_main_sha: previousMainSha,
    current_main_sha: currentMainSha,
    main_report: closureMaterial(mainReport),
    main_classification_status: mainReport.classification_status,
    strict_up_to_date_policy: "unchanged",
    required_checks_policy: "unchanged",
    mutation_policy: "read-only; no branch, merge, ruleset, or required-check mutation",
    results,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(path.resolve(ROOT, outputPath), serialized);
  else process.stdout.write(serialized);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
