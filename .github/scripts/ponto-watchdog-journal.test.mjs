import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconstructWatchdogJournal } from "./ponto-watchdog-journal.mjs";
import {
  createCapabilityCheck,
  transitionCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

const repository = "owner/repo";
const repositoryId = "42";
const sha = "a".repeat(40);
const stagingPair = crypto.generateKeyPairSync("ed25519");
const productionPair = crypto.generateKeyPairSync("ed25519");
const stagingPrivateKey = stagingPair.privateKey.export({ type: "pkcs8", format: "pem" });
const capabilityPublicKeysJson = JSON.stringify({
  staging: {
    keyId: "staging-watchdog-test",
    publicKeyPem: stagingPair.publicKey.export({ type: "spki", format: "pem" }),
  },
  production: {
    keyId: "production-watchdog-test",
    publicKeyPem: productionPair.publicKey.export({ type: "spki", format: "pem" }),
  },
});
const run = (id, pathName, title) => ({
  id,
  workflow_id: pathName === "deploy-timekeeping.yml"
    ? 501
    : pathName === "deploy-crm-pages.yml"
      ? 503
      : 502,
  path: `.github/workflows/${pathName}`,
  display_title: title,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  html_url: `https://github.test/runs/${id}`,
  created_at: "2026-07-30T00:01:00Z",
  updated_at: "2026-07-30T00:02:00Z",
});
const workflowIds = {
  "deploy-timekeeping.yml": 501,
  "deploy-core-workers.yml": 502,
  "deploy-crm-pages.yml": 503,
  "cloudflare-pages-sync-ponto.yml": 504,
  "ponto-staging-rollback-drill.yml": 505,
};
const coordinator = {
  id: 99,
  workflow_id: 900,
  path: ".github/workflows/ponto-progressive-release.yml",
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: sha,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:05:00Z",
};
const scopedRequest = (rows, extra = async () => undefined) => async (pathname) => {
  if (pathname.endsWith("/actions/runs/99")) return coordinator;
  if (pathname.endsWith("/actions/workflows/ponto-progressive-release.yml")) {
    return {
      id: 900,
      path: ".github/workflows/ponto-progressive-release.yml",
      state: "active",
    };
  }
  const workflowFile = decodeURIComponent(pathname.split("?")[0].split("/").at(-1));
  if (Object.hasOwn(workflowIds, workflowFile)) {
    return {
      id: workflowIds[workflowFile],
      path: `.github/workflows/${workflowFile}`,
      state: "active",
    };
  }
  const workflowRuns = pathname.match(/\/actions\/workflows\/([0-9]+)\/runs\?/);
  if (workflowRuns) {
    const id = Number(workflowRuns[1]);
    assert.match(pathname, /created=/);
    return { workflow_runs: rows.filter(item => item.workflow_id === id) };
  }
  const runDetail = pathname.match(/\/actions\/runs\/([0-9]+)$/);
  if (runDetail) return rows.find(item => String(item.id) === runDetail[1]);
  const result = await extra(pathname);
  if (result !== undefined) return result;
  throw new Error(`unexpected request ${pathname}`);
};

const anchor = (root, file, workflow, workflowId, runId) => {
  const directory = path.join(root, "runs");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, file), JSON.stringify({
    schemaVersion: 1,
    workflow,
    workflowId,
    workflowPath: `.github/workflows/${workflow}`,
    runId: String(runId),
    status: "completed",
  }));
};

test("watchdog reconstructs exact surface run files and a bounded artifact manifest", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-watchdog-journal-"));
  const rows = [
    run(10, "deploy-timekeeping.yml", `Timekeeping staging ${sha} orchestrator=99 nonce=${"1".repeat(32)}`),
    run(11, "deploy-core-workers.yml", `Core inventory staging ${sha} orchestrator=99 nonce=${"2".repeat(32)}`),
    run(12, "deploy-core-workers.yml", `Core api staging ${sha} orchestrator=99 nonce=${"3".repeat(32)}`),
    run(13, "deploy-crm-pages.yml", `CRM Pages staging ${sha} orchestrator=99 nonce=${"4".repeat(32)}`),
  ];
  anchor(root, "timekeeping.json", "deploy-timekeeping.yml", 501, 10);
  anchor(root, "identity.json", "deploy-core-workers.yml", 502, 11);
  anchor(root, "core.json", "deploy-core-workers.yml", 502, 12);
  anchor(root, "pages.json", "deploy-crm-pages.yml", 503, 13);
  const report = await reconstructWatchdogJournal({
    repository,
    coordinatorRunId: "99",
    releaseSha: sha,
    stage: "staging",
    artifactRoot: root,
    request: scopedRequest(rows),
  });
  assert.equal(report.passed, true);
  assert.equal(report.downloads.length, 8);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "runs/core.json"), "utf8")).runId, "12");
});

test("watchdog fails closed on an exact-title child that lacks journal or signed capability", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-watchdog-spoof-"));
  const title = `Timekeeping production ${sha} orchestrator=99 nonce=${"1".repeat(32)}`;
  anchor(root, "timekeeping.json", "deploy-timekeeping.yml", 501, 10);
  const report = await reconstructWatchdogJournal({
    repository,
    coordinatorRunId: "99",
    releaseSha: sha,
    stage: "production",
    artifactRoot: root,
    request: scopedRequest([
      run(10, "deploy-timekeeping.yml", title),
      run(11, "deploy-timekeeping.yml", title),
    ]),
  });
  assert.equal(report.passed, false);
  assert.equal(report.discoveredChildren, 1);
  assert.deepEqual(report.unresolved, [{
    surface: "timekeeping",
    runId: "11",
    reason: "canonical-correlated-child-untrusted",
  }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "runs/timekeeping.json"), "utf8")).runId, "10");
});

test("watchdog fails closed when the durable coordinator journal is unavailable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-watchdog-unanchored-"));
  let requested = false;
  const report = await reconstructWatchdogJournal({
    repository,
    coordinatorRunId: "99",
    releaseSha: sha,
    stage: "production",
    artifactRoot: root,
    request: async (pathname) => {
      requested = true;
      return scopedRequest([])(pathname);
    },
  });
  assert.equal(requested, true);
  assert.equal(report.passed, false);
  assert.deepEqual(report.unresolved, [{
    reason: "durable-journal-and-capability-custody-missing",
  }]);
});

const consumedCapability = ({
  childRunId,
  childWorkflowId,
  childWorkflowPath,
  leaseKey,
  nonce,
}) => {
  const issued = createCapabilityCheck({
    privateKey: stagingPrivateKey,
    keyId: "staging-watchdog-test",
    repositoryId,
    repository,
    parentWorkflowId: 900,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: "99",
    issuerWorkflowId: 900,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: "99",
    childWorkflowId,
    childWorkflowPath,
    childRunId: String(childRunId),
    leaseKey,
    stage: "staging",
    target: "staging",
    releaseSha: sha,
    dispatchNonce: nonce,
    intentDigest: "b".repeat(64),
    issuedAt: new Date("2026-07-30T00:00:00Z"),
  });
  const document = transitionCapabilityDocument(
    JSON.parse(issued.output.summary),
    {
      state: "consumed",
      transitionedAt: new Date("2026-07-30T00:01:00Z"),
    },
  );
  return {
    id: 700,
    ...issued,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions", id: 7 },
    output: {
      title: "Ponto single-use child capability consumed",
      summary: JSON.stringify(document),
    },
  };
};

test("watchdog reconstructs a lost journal from an exact consumed Ed25519 capability", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-watchdog-capability-"));
  const nonce = "1".repeat(32);
  const child = run(
    10,
    "deploy-timekeeping.yml",
    `Timekeeping staging ${sha} orchestrator=99 nonce=${nonce}`,
  );
  const check = consumedCapability({
    childRunId: 10,
    childWorkflowId: 501,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    leaseKey: "timekeeping",
    nonce,
  });
  const request = scopedRequest([child], async (pathname) => {
    if (pathname.includes(`/commits/${sha}/check-runs?`)) {
      return { check_runs: [check] };
    }
    if (pathname.endsWith(`/check-runs/${check.id}`)) return check;
  });
  const report = await reconstructWatchdogJournal({
    repository,
    repositoryId,
    capabilityPublicKeysJson,
    coordinatorRunId: "99",
    releaseSha: sha,
    stage: "staging",
    artifactRoot: root,
    request,
  });
  assert.equal(report.passed, true);
  assert.equal(report.downloads.length, 2);
  const recovered = JSON.parse(
    fs.readFileSync(path.join(root, "runs/timekeeping.json"), "utf8"),
  );
  assert.equal(recovered.reconstructedFromCapability, true);
  assert.equal(recovered.capabilityState, "consumed");
  assert.equal(recovered.runId, "10");
});

test("watchdog refuses rollback for a terminal exact-title child with no signed capability", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-watchdog-no-capability-"));
  const child = run(
    10,
    "deploy-timekeeping.yml",
    `Timekeeping staging ${sha} orchestrator=99 nonce=${"1".repeat(32)}`,
  );
  const request = scopedRequest([child], async (pathname) => {
    if (pathname.includes(`/commits/${sha}/check-runs?`)) {
      return { check_runs: [] };
    }
  });
  const report = await reconstructWatchdogJournal({
    repository,
    repositoryId,
    capabilityPublicKeysJson,
    coordinatorRunId: "99",
    releaseSha: sha,
    stage: "staging",
    artifactRoot: root,
    request,
  });
  assert.equal(report.passed, false);
  assert.equal(report.downloads.length, 0);
  assert.deepEqual(report.ignoredUnprovenChildren, [{
    surface: "timekeeping",
    runId: "10",
    reason: "capability-absent",
  }]);
  assert.deepEqual(report.unresolved, [{
    surface: "timekeeping",
    runId: "10",
    reason: "canonical-correlated-child-untrusted",
  }]);
  assert.equal(fs.existsSync(path.join(root, "runs/timekeeping.json")), false);
});
