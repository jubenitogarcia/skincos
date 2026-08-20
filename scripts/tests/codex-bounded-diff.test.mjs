import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/codex-bounded-diff.mjs");
const isolatedGitEnvironment = { ...process.env };
delete isolatedGitEnvironment.GIT_DIR;
delete isolatedGitEnvironment.GIT_WORK_TREE;
delete isolatedGitEnvironment.GIT_INDEX_FILE;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: isolatedGitEnvironment, encoding: "utf8" }).trim();
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-diff-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "user.name", "bounded-diff-test");
  fs.writeFileSync(path.join(cwd, "file.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  const base = git(cwd, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(cwd, "file.txt"), "head\n");
  git(cwd, "commit", "-qam", "head");
  const head = git(cwd, "rev-parse", "HEAD");
  return { cwd, base, head };
}

function shallowRemoteFixture() {
  const source = fixture();
  git(source.cwd, "branch", "-M", "main");
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-origin-"));
  git(source.cwd, "init", "--bare", remote);
  git(source.cwd, "remote", "add", "origin", remote);
  git(source.cwd, "push", "-q", "origin", "main");
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-clone-"));
  execFileSync("git", ["clone", "-q", "--depth=2", "--branch", "main", `file://${remote}`, clone], {
    env: isolatedGitEnvironment,
  });
  return { cwd: clone, base: source.base, head: source.head, source: source.cwd };
}

function shallowPullRequestMergeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-pr-merge-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "bounded-diff-test");
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "branch", "-M", "main");
  fs.writeFileSync(path.join(repo, "main.txt"), "main\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "main");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "feature");
  git(repo, "switch", "feature");
  fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "feature");
  const head = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "main");
  git(repo, "merge", "--no-ff", "feature", "-m", "merge pull request");

  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-pr-origin-"));
  git(repo, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-bounded-pr-clone-"));
  execFileSync("git", ["clone", "-q", "--depth=2", "--branch", "main", `file://${remote}`, clone], {
    env: isolatedGitEnvironment,
  });
  return { cwd: clone, base, head };
}

function run(fixtureData, ...args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: fixtureData.cwd,
    env: isolatedGitEnvironment,
    encoding: "utf8",
  });
}

test("resolves explicit immutable base and head", () => {
  const data = fixture();
  const output = run(data, "--base", data.base, "--head", data.head);
  assert.match(output, new RegExp(`base=${data.base}`));
  assert.match(output, new RegExp(`head=${data.head}`));
  assert.match(output, /used_fallback=false/);
});

test("fetches a missing base from origin in a shallow checkout", () => {
  const data = shallowRemoteFixture();
  const output = run(data, "--base", data.base, "--head", data.head);
  assert.match(output, new RegExp(`base=${data.base}`));
  assert.match(output, /used_fallback=false/);
});

test("deepens a shallow PR merge checkout until base and head have a merge base", () => {
  const data = shallowPullRequestMergeFixture();
  const output = run(data, "--base", data.base, "--head", data.head);
  assert.match(output, new RegExp(`base=${data.base}`));
  assert.match(output, new RegExp(`head=${data.head}`));
  assert.match(output, new RegExp(`merge_base=${data.base}`));
});

test("accepts a synchronized force-pushed head by immutable SHA", () => {
  const data = shallowRemoteFixture();
  fs.writeFileSync(path.join(data.source, "file.txt"), "force-pushed-head\n");
  git(data.source, "commit", "-qam", "force-pushed head");
  git(data.source, "push", "-q", "origin", "main", "--force");
  const forcePushedHead = git(data.source, "rev-parse", "HEAD");
  const output = run(data, "--base", data.base, "--head", forcePushedHead);
  assert.match(output, new RegExp(`head=${forcePushedHead}`));
});

test("falls back to the checked-out parent for missing or invalid base", () => {
  const data = fixture();
  const output = run(data, "--base", "not-a-sha", "--head", data.head);
  assert.match(output, new RegExp(`base=${data.base}`));
  assert.match(output, /used_fallback=true/);
});

test("rejects an invalid head instead of widening history", () => {
  const data = fixture();
  assert.throws(() => run(data, "--base", data.base, "--head", "bad-head"), /head is not a full immutable commit SHA/);
});

test("includes deleted and both sides of a rename in the bounded file list", () => {
  const data = fixture();
  fs.rmSync(path.join(data.cwd, "file.txt"));
  fs.writeFileSync(path.join(data.cwd, "renamed.txt"), "head\n");
  git(data.cwd, "add", "-A");
  git(data.cwd, "commit", "-qm", "rename and delete");
  const head = git(data.cwd, "rev-parse", "HEAD");
  const filesPath = path.join(data.cwd, "files.txt");
  run(data, "--base", data.base, "--head", head, "--files-output", filesPath);
  const files = fs.readFileSync(filesPath, "utf8").trim().split(/\r?\n/);
  assert.ok(files.includes("file.txt"));
  assert.ok(files.includes("renamed.txt"));
});

test("prevents routine workflows from regressing to full-history checkout", () => {
  const routineWorkflows = [
    ".github/workflows/ci-smoke.yml",
    ".github/workflows/lint-format-static.yml",
    ".github/workflows/test-coverage-quality.yml",
  ];
  for (const workflow of routineWorkflows) {
    const source = fs.readFileSync(path.join(root, workflow), "utf8");
    assert.doesNotMatch(source, /fetch-depth:\s*0/);
    assert.match(source, /scripts\/codex-bounded-diff\.mjs/);
  }
  const autonomy = fs.readFileSync(path.join(root, ".github/workflows/codex-autonomy-gate.yml"), "utf8");
  assert.doesNotMatch(autonomy, /fetch-depth:\s*0/);
  assert.match(autonomy, /resolve-codex-autonomy-base\.mjs/);
});
