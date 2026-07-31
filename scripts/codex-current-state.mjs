#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const repeated = (name) => process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function loadOptionalJson(file, source) {
  if (!file) return { status: "not-collected" };
  const raw = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  return { status: "collected", source, fingerprint: crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex"), data: raw };
}

function onlineIssues() {
  if (!process.argv.includes("--online")) return { status: "not-collected" };
  const repository = argument("--repository", process.env.GITHUB_REPOSITORY ?? "jubenitogarcia/skincos");
  const issues = repeated("--issue").map((number) => {
    const raw = execFileSync("gh", ["issue", "view", number, "--repo", repository, "--json", "number,state,title,updatedAt,url"], { cwd: root, encoding: "utf8" });
    return JSON.parse(raw);
  });
  return { status: "collected", source: "GitHub API via gh", issues };
}

const state = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: argument("--repository", process.env.GITHUB_REPOSITORY ?? null),
  git: {
    sourceCommit: git("rev-parse", "HEAD"),
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    branch: git("branch", "--show-current") || null,
    dirty: Boolean(git("status", "--porcelain"))
  },
  sources: {
    github: onlineIssues(),
    cloudflare: loadOptionalJson(argument("--cloudflare"), "Cloudflare API export"),
    runtime: loadOptionalJson(argument("--runtime"), "private runtime export")
  }
};
const output = argument("--output", "ops/codex/current-state.json");
fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
fs.writeFileSync(path.resolve(root, output), `${JSON.stringify(state, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, sourceCommit: state.git.sourceCommit, sources: Object.fromEntries(Object.entries(state.sources).map(([key, value]) => [key, value.status])) })}\n`);
