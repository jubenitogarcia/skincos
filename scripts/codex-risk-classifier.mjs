#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classifyFiles } from "./codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readRepeated(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function changedFiles() {
  const explicit = readRepeated("--file");
  if (explicit.length) return explicit;
  const base = readArgument("--base");
  const head = readArgument("--head", "HEAD");
  if (!base) throw new Error("use --file <path> or --base <commit-ish>");
  const range = `${base}...${head}`;
  const output = git("diff", "--name-only", "--diff-filter=ACMR", range);
  return output ? output.split(/\r?\n/) : [];
}

function writeOutput(report) {
  const output = readArgument("--output");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(root, output), serialized);
  else process.stdout.write(serialized);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `risk=${report.risk}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `surfaces=${report.affectedSurfaces.join(",")}\n`);
  }
}

const policyPath = readArgument("--policy", "ops/codex/risk-policy.json");
const policy = JSON.parse(fs.readFileSync(path.resolve(root, policyPath), "utf8"));
const report = classifyFiles(policy, changedFiles());
writeOutput(report);
