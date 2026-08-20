#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildClassificationFallback,
  classifyFiles,
  parseGitNameStatus,
} from "./codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readRepeated(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1];
      values.push(value?.startsWith("--") ? undefined : value);
    }
  }
  return values;
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function changedFiles() {
  const explicit = readRepeated("--file");
  if (explicit.length) return explicit;
  const base = readArgument("--base");
  const head = readArgument("--head", "HEAD");
  if (!base) throw new Error("use --file <path> or --base <commit-ish>");
  const range = `${base}...${head}`;
  const output = git("diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", range);
  return parseGitNameStatus(output);
}

function writeOutput(report) {
  const output = readArgument("--output");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(root, output), serialized);
  else process.stdout.write(serialized);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `risk=${report.risk}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `surfaces=${report.surfaces.join(",")}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `languages=${report.languages.join(",")}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `dependencies_changed=${report.dependencies_changed}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `shared_contracts_changed=${report.shared_contracts_changed}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `production_sensitive=${report.production_sensitive}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `security_sensitive=${report.security_sensitive}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${report.status}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `classification_status=${report.classification_status}\n`);
  }
}

let policy = null;
let report;
let exitCode = 0;
try {
  const policyPath = readArgument("--policy", "ops/codex/risk-policy.json");
  if (!policyPath) throw new Error("policy path is missing");
  policy = JSON.parse(fs.readFileSync(path.resolve(root, policyPath), "utf8"));
  report = classifyFiles(policy, changedFiles());
} catch (error) {
  report = buildClassificationFallback({
    policy,
    reason: error instanceof Error ? error.message : String(error),
  });
  exitCode = 2;
  process.stderr.write(`Codex risk classification failed closed: ${report.fallback.reason}\n`);
}
writeOutput(report);
process.exitCode = exitCode;
