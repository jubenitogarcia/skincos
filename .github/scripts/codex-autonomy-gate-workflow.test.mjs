import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodexAutonomyBase } from "./resolve-codex-autonomy-base.mjs";

const cleanGitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const source = fs.readFileSync(
  new URL("../workflows/codex-autonomy-gate.yml", import.meta.url),
  "utf8",
);
const resolverSource = fs.readFileSync(
  new URL("./resolve-codex-autonomy-base.mjs", import.meta.url),
  "utf8",
);

test("ready-for-review transitions create the required PR check", () => {
  assert.match(
    source,
    /pull_request:\n\s+types:\s+\[opened, synchronize, reopened, ready_for_review\]/,
  );
  assert.match(source, /push:\n\s+branches:\s+\[main\]/);
  assert.doesNotMatch(source, /branches:\s+\[main, 'codex\/\*\*'\]/);
});

test("manual autonomy recovery requires an exact ancestor base", () => {
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+base_sha:/);
  assert.match(source, /MANUAL_BASE_SHA: \$\{\{ inputs\.base_sha \}\}/);
  assert.match(source, /node \.github\/scripts\/resolve-codex-autonomy-base\.mjs/);
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: cleanGitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function commitFile(cwd, name, content, message) {
  fs.writeFileSync(path.join(cwd, name), content);
  git(cwd, "add", name);
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function createRepositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-autonomy-base-"));
  const origin = path.join(root, "origin.git");
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(checkout);
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(checkout, "init", "--initial-branch=main");
  git(checkout, "config", "user.email", "codex@example.invalid");
  git(checkout, "config", "user.name", "Codex test");
  git(checkout, "remote", "add", "origin", origin);

  const initial = commitFile(checkout, "state.txt", "initial\n", "initial");
  git(checkout, "push", "-u", "origin", "main");

  const mainOne = commitFile(checkout, "main.txt", "one\n", "main one");
  git(checkout, "push", "origin", "main");
  git(checkout, "checkout", "-b", "topic", mainOne);
  const head = commitFile(checkout, "topic.txt", "topic\n", "topic");

  git(checkout, "checkout", "main");
  const mainTwo = commitFile(checkout, "main.txt", "two\n", "main two");
  git(checkout, "push", "origin", "main");
  git(checkout, "checkout", "topic");
  git(checkout, "update-ref", "refs/remotes/origin/main", initial);

  return { root, checkout, head, initial, mainOne, mainTwo };
}

test("force-push and missing event bases fall back to the freshly fetched origin/main merge base", (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  assert.equal(
    resolveCodexAutonomyBase({
      eventName: "push",
      headSha: fixture.head,
      beforeSha: fixture.mainTwo,
      cwd: fixture.checkout,
      environment: cleanGitEnvironment,
    }),
    fixture.mainOne,
  );

  assert.equal(
    resolveCodexAutonomyBase({
      eventName: "pull_request",
      headSha: fixture.head,
      prBaseSha: "f".repeat(40),
      cwd: fixture.checkout,
      environment: cleanGitEnvironment,
    }),
    fixture.mainOne,
  );
});

test("manual recovery never falls back from its explicit base", (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  assert.throws(
    () => resolveCodexAutonomyBase({
      eventName: "workflow_dispatch",
      headSha: fixture.head,
      manualBaseSha: "not-a-sha",
      cwd: fixture.checkout,
      environment: cleanGitEnvironment,
    }),
    /Manual governance base_sha must be a full commit SHA/,
  );

  assert.throws(
    () => resolveCodexAutonomyBase({
      eventName: "workflow_dispatch",
      headSha: fixture.head,
      manualBaseSha: fixture.mainTwo,
      cwd: fixture.checkout,
      environment: cleanGitEnvironment,
    }),
    /Manual governance base_sha must be an ancestor of the checked-out head/,
  );
});

test("push recovery classifies rebased branches from their mainline", () => {
  assert.match(source, /node \.github\/scripts\/resolve-codex-autonomy-base\.mjs/);
  assert.match(resolverSource, /\+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(resolverSource, /\["merge-base", "origin\/main", headSha\]/);
});
