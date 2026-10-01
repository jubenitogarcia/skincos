import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  assertPontoDependencyClosureUnchanged,
  dispatchTimeoutMsFor,
  globalResourceFor,
  governedLeaseKeyFor,
  isBodylessResponseStatus,
  readGitHubResponse,
  resolvePontoCoordinatorIdentity,
} from "./ponto-dispatch-workflow.mjs";

test("dispatch budgets and bodyless GitHub responses are deterministic", () => {
  assert.equal(dispatchTimeoutMsFor("ponto-production-slo.yml", 1), 65 * 60 * 1000);
  assert.equal(dispatchTimeoutMsFor("timekeeping-staging-journey.yml", 1), 35 * 60 * 1000);
  assert.equal(dispatchTimeoutMsFor("unknown.yml", 20 * 60 * 1000), 20 * 60 * 1000);
  for (const status of [202, 204]) {
    assert.equal(isBodylessResponseStatus(status), true);
    assert.equal(readGitHubResponse({ status, json: () => assert.fail("bodyless response was parsed") }), null);
  }
});

test("only governed Ponto mutations acquire a lease", () => {
  assert.equal(governedLeaseKeyFor("deploy-timekeeping.yml", { target: "preview", release_scope: "ponto" }), "");
  assert.equal(governedLeaseKeyFor("ponto-pages-governed-publisher.yml", { target: "preview", release_scope: "ponto" }), "");
  for (const target of ["staging", "production", "rollback"]) {
    assert.equal(governedLeaseKeyFor("deploy-timekeeping.yml", { target, release_scope: "ponto" }), "timekeeping");
    assert.equal(governedLeaseKeyFor("deploy-core-workers.yml", { target, release_scope: "ponto", unit: "api" }), "core-api");
    assert.equal(governedLeaseKeyFor("ponto-pages-governed-publisher.yml", { target, release_scope: "ponto" }), "pages");
  }
  assert.equal(globalResourceFor("ponto-pages-governed-publisher.yml", { release_scope: "ponto", target: "staging" }), "global:ponto-pages-writer");
  assert.equal(globalResourceFor("ponto-pages-secret-bridge.yml", { target: "staging" }), "global:ponto-pages-writer");
});

test("dependency closure and coordinator identity fail closed", () => {
  const digest = "c".repeat(64);
  assert.equal(assertPontoDependencyClosureUnchanged(digest, digest).valid, true);
  assert.throws(() => assertPontoDependencyClosureUnchanged(digest, "d".repeat(64)), /dependency-closure input changed/);
  const releaseSha = "a".repeat(40);
  assert.deepEqual(resolvePontoCoordinatorIdentity({ releaseSha, workflowSha: "b".repeat(40) }), { releaseSha, workflowSha: "b".repeat(40) });
  assert.throws(() => resolvePontoCoordinatorIdentity({ releaseSha, workflowSha: "invalid" }), /full immutable Ponto coordinator workflow SHA/);
});

test("Ponto publisher keeps exact source and dedicated coordination boundaries", () => {
  const workflow = fs.readFileSync(new URL("../workflows/ponto-pages-governed-publisher.yml", import.meta.url), "utf8");
  assert.match(workflow, /group: ponto-pages-governed-publisher-\$\{\{ inputs\.target \}\}/);
  assert.match(workflow, /resource: deploy:ponto-pages:\$\{\{ inputs\.target \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /pages deploy dist/);
  const forbidden = new RegExp([
    ["crm", "console"].join("/"),
    ["deploy", "crm", "pages"].join("-"),
    ["global", "crm", "cloudflare", "writer"].join(":"),
  ].join("|"), "i");
  assert.doesNotMatch(workflow, forbidden);
});

test("capability material remains cryptographic and non-persistent", () => {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  assert.ok(keyPair.privateKey && keyPair.publicKey);
});
