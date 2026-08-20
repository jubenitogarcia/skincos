import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildVerificationPlan, collectPushLines, parsePushRef } from "../verify-changed.mjs";
import { classifyFiles } from "../codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));

function plan(files, options = {}) {
  const changes = files.map((file) => ({ status: "M", paths: [file] }));
  const report = classifyFiles(policy, changes);
  return buildVerificationPlan({
    changes,
    diffSpecs: options.diffSpecs ?? [{ label: "fixture", args: [] }],
    report,
    full: options.full ?? false,
  });
}

test("low presentation changes select only delta/static validation", () => {
  const result = plan(["crm/console/styles/panel.css"]);
  assert.equal(result.lane, "low");
  assert.equal(result.forcedFull, false);
  assert.deepEqual(result.plan.map((item) => item.type), ["diff-check", "static-parse", "secret-delta"]);
});

test("a UI component in an explicit component path gets focal checks", () => {
  const result = plan(["crm/console/components/LocalCard.tsx"]);
  assert.equal(result.lane, "low");
  assert.match(result.plan.map((item) => item.label).join("\n"), /CRM console focal lint/);
  assert.match(result.plan.map((item) => item.label).join("\n"), /CRM console focal typecheck/);
  assert.equal(result.forcedFull, false);
});

test("auth and dependency paths remain fail-closed in the full lane", () => {
  for (const file of ["crm/console/AuthScreen.tsx", "crm/console/package.json"]) {
    const result = plan([file]);
    assert.equal(result.forcedFull, true, file);
    assert.equal(result.lane, "high", file);
    assert.ok(result.plan.some((item) => item.label === "quality:critical"), file);
    assert.ok(result.plan.some((item) => item.type === "secret-full"), file);
  }
});

test("explicit full verification never downgrades an empty change set", () => {
  const result = plan([], { full: true, diffSpecs: [] });
  assert.equal(result.forcedFull, true);
  assert.equal(result.lane, "full");
  assert.ok(result.plan.some((item) => item.label === "quality:critical"));
});

test("pre-push parsing is strict and supports new branches", () => {
  const ref = parsePushRef("refs/heads/feature abcdefabcdefabcdefabcdefabcdefabcdefabcd refs/heads/main 0000000000000000000000000000000000000000");
  assert.equal(ref.localRef, "refs/heads/feature");
  assert.equal(ref.remoteRef, "refs/heads/main");
  assert.throws(() => parsePushRef("refs/heads/main bad refs/heads/main bad"), /SHAs are invalid/);
  assert.equal(collectPushLines("refs/heads/a abcdefabcdefabcdefabcdefabcdefabcdefabcd refs/heads/main 0000000000000000000000000000000000000000\n").length, 1);
});
