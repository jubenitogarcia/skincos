#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const SHA = /^[0-9a-f]{40}$/i;

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitExists(value) {
  if (!SHA.test(value)) return false;
  try {
    git("cat-file", "-e", `${value}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function fetchCommit(value, label) {
  if (!SHA.test(value)) throw new Error(`${label} is not a full immutable commit SHA`);
  if (commitExists(value)) return;
  try {
    git("fetch", "--no-tags", "--depth=2", "origin", value);
  } catch {
    throw new Error(`unable to fetch immutable ${label} ${value}`);
  }
  if (!commitExists(value)) throw new Error(`fetched ${label} is not available as a commit`);
}

function fallbackBase() {
  try {
    const value = git("rev-parse", "HEAD^");
    return SHA.test(value) ? value : "";
  } catch {
    return "";
  }
}

const requestedBase = argument("--base");
const head = argument("--head", process.env.GITHUB_SHA ?? "");
let base = "";
let usedFallback = false;

if (SHA.test(requestedBase)) {
  try {
    fetchCommit(requestedBase, "base");
    base = requestedBase;
  } catch {
    usedFallback = true;
  }
} else {
  usedFallback = true;
}
if (!base) {
  base = fallbackBase();
}
if (!base) throw new Error("no valid immutable base SHA and no local parent fallback is available");

if (usedFallback) fetchCommit(base, "fallback base");
fetchCommit(head, "head");
try {
  git("diff", "--check", base, head);
} catch {
  throw new Error(`bounded diff check failed for ${base}..${head}`);
}

const output = argument("--output", process.env.GITHUB_OUTPUT ?? "");
const filesOutput = argument("--files-output");
const changedFiles = git("diff", "--name-only", "--diff-filter=ACMR", base, head)
  .split(/\r?\n/).filter(Boolean);
if (filesOutput) fs.writeFileSync(filesOutput, changedFiles.length ? `${changedFiles.join("\n")}\n` : "");
const lines = [`base=${base}`, `head=${head}`, `used_fallback=${usedFallback}`];
if (filesOutput) lines.push(`files_file=${filesOutput}`);
if (output) fs.appendFileSync(output, `${lines.join("\n")}\n`);
else process.stdout.write(`${lines.join("\n")}\n`);

if (usedFallback) process.stderr.write(`::warning::bounded diff used local parent ${base} because the requested base was missing or invalid\n`);
