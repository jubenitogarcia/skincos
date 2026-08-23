import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/codex-bounded-diff.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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
  execFileSync("git", ["clone", "-q", "--depth=2", "--branch", "main", `file://${remote}`, clone]);
  return { cwd: clone, base: source.base, head: source.head, source: source.cwd };
}

function run(fixtureData, ...args) {
  return execFileSync(process.execPath, [script, ...args], { cwd: fixtureData.cwd, encoding: "utf8" });
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

test("prevents routine workflows from regressing to full-history checkout", () => {
  const workflows = [
    ".github/workflows/ci-smoke.yml",
    ".github/workflows/lint-format-static.yml",
    ".github/workflows/test-coverage-quality.yml",
    ".github/workflows/codex-autonomy-gate.yml",
  ];
  for (const workflow of workflows) {
    const source = fs.readFileSync(path.join(root, workflow), "utf8");
    assert.doesNotMatch(source, /fetch-depth:\s*0/);
    assert.match(source, /scripts\/codex-bounded-diff\.mjs/);
  }
});
