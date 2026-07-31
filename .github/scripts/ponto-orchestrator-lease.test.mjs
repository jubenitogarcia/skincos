import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalizeGovernedIntent,
  createCapabilityCheck,
  expectedGovernedRunName,
  transitionCapabilityDocument,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

const script = fileURLToPath(new URL("./ponto-orchestrator-lease.mjs", import.meta.url));
const repositoryRoot = path.resolve(path.dirname(script), "../..");
const repository = "skincos/example";
const releaseSha = "a".repeat(40);
const orchestratorRunId = "12345";
const stage = "staging";
const target = "staging";
const stagingPair = crypto.generateKeyPairSync("ed25519");
const productionPair = crypto.generateKeyPairSync("ed25519");
const stagingPrivateKey = stagingPair.privateKey.export({ type: "pkcs8", format: "pem" });
const stagingPublicKey = stagingPair.publicKey.export({ type: "spki", format: "pem" });
const publicKeysJson = JSON.stringify({
  staging: { keyId: "staging-2026-07", publicKeyPem: stagingPublicKey },
  production: {
    keyId: "production-2026-07",
    publicKeyPem: productionPair.publicKey.export({ type: "spki", format: "pem" }),
  },
});
const repositoryId = "42";
const childRunId = "67890";
const dispatchNonce = "b".repeat(32);

const execute = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: releaseSha,
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_REPOSITORY_ID: repositoryId,
      GITHUB_TOKEN: "test-token",
      PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON: publicKeysJson,
      ...env,
    },
  }, (error, stdout, stderr) => {
    resolve({ code: error?.code ?? 0, stdout, stderr });
  });
});

const canonicalRun = (overrides = {}) => ({
  id: Number(orchestratorRunId),
  workflow_id: 77,
  path: ".github/workflows/ponto-progressive-release.yml",
  run_attempt: 1,
  status: "in_progress",
  conclusion: null,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: releaseSha,
  name: `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`,
  repository: { id: Number(repositoryId), full_name: repository },
  head_repository: { id: Number(repositoryId), full_name: repository },
  display_title: `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`,
  ...overrides,
});

const withApi = async ({ run = canonicalRun(), artifact }, callback) => {
  let deleted = false;
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    response.setHeader("content-type", "application/json");
    if (request.url === `/repos/${repository}/actions/workflows/ponto-progressive-release.yml`) {
      response.end(JSON.stringify({
        id: 77,
        state: "active",
        path: ".github/workflows/ponto-progressive-release.yml",
      }));
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/${orchestratorRunId}`) {
      response.end(JSON.stringify(run));
      return;
    }
    if (request.url?.startsWith(`/repos/${repository}/actions/runs/${orchestratorRunId}/artifacts?`)) {
      response.end(JSON.stringify({ artifacts: deleted || !artifact ? [] : [artifact] }));
      return;
    }
    if (request.url === `/repos/${repository}/actions/artifacts/${artifact?.id}` && request.method === "DELETE") {
      deleted = true;
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await callback({
      apiUrl: `http://127.0.0.1:${address.port}`,
      getRequestCount: () => requestCount,
      wasDeleted: () => deleted,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

const workflow = name => fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", name), "utf8");
const job = (source, name) => {
  const marker = `  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `job ${name} is absent`);
  const remaining = source.slice(start + marker.length);
  const next = /\n  [a-zA-Z0-9_-]+:\n/.exec(remaining);
  return source.slice(start, next ? start + marker.length + next.index : source.length);
};

test("assert-active accepts only the exact live first-attempt coordinator", async () => {
  await withApi({}, async ({ apiUrl }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /active first-attempt Ponto coordinator/);
  });
});

test("assert-active rejects a rerun of the privileged child before any API access", async () => {
  await withApi({}, async ({ apiUrl, getRequestCount }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl, GITHUB_RUN_ATTEMPT: "2" },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refuse workflow reruns/);
    assert.equal(getRequestCount(), 0);
  });
});

test("assert-active rejects a full rerun of the coordinator", async () => {
  await withApi({ run: canonicalRun({ run_attempt: 2 }) }, async ({ apiUrl }) => {
    const result = await execute(
      ["assert-active", stage, releaseSha, orchestratorRunId],
      { GITHUB_API_URL: apiUrl },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /exact active first-attempt issuer/);
  });
});

const timekeepingIntent = (overrides = {}) => ({
  target: "staging",
  release_sha: releaseSha,
  release_scope: "ponto",
  orchestrator_run_id: orchestratorRunId,
  orchestrator_stage: stage,
  orchestrator_issuer_run_id: orchestratorRunId,
  orchestrator_nonce: dispatchNonce,
  ...overrides,
});

const issuedCapability = () => {
  const canonical = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent(),
  );
  const check = createCapabilityCheck({
    privateKey: stagingPrivateKey,
    keyId: "staging-2026-07",
    repositoryId,
    repository,
    parentWorkflowId: 77,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: orchestratorRunId,
    issuerWorkflowId: 77,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: orchestratorRunId,
    childWorkflowId: 88,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId,
    leaseKey: "timekeeping",
    stage,
    target,
    releaseSha,
    dispatchNonce,
    intentDigest: canonical.digest,
  });
  return { canonical, check, document: JSON.parse(check.output.summary) };
};

test("typed intent binds every dispatch input and derives the exact nonce run name", () => {
  const base = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent(),
  );
  const changed = canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    timekeepingIntent({ predecessor_run_id: "9001" }),
  );
  assert.notEqual(base.digest, changed.digest);
  assert.equal(
    expectedGovernedRunName(".github/workflows/deploy-timekeeping.yml", base.normalizedInputs),
    `Timekeeping staging ${releaseSha} orchestrator=${orchestratorRunId} nonce=${dispatchNonce}`,
  );
  assert.throws(() => canonicalizeGovernedIntent(
    ".github/workflows/deploy-timekeeping.yml",
    { ...timekeepingIntent(), unexpected: "confused-deputy" },
  ), /unknown inputs/);
});

test("issued capability is Ed25519-bound to target, root, issuer, child, nonce, and typed intent", () => {
  const { canonical, check, document } = issuedCapability();
  assert.equal(check.status, "in_progress");
  assert.equal(check.conclusion, undefined);
  assert.match(check.name, new RegExp(`/${childRunId}/${dispatchNonce}$`));
  const expected = {
    publicKey: stagingPublicKey,
    keyId: "staging-2026-07",
    repositoryId,
    repository,
    parentWorkflowId: 77,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: orchestratorRunId,
    issuerWorkflowId: 77,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: orchestratorRunId,
    childWorkflowId: 88,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId,
    leaseKey: "timekeeping",
    stage,
    target,
    releaseSha,
    dispatchNonce,
    intentDigest: canonical.digest,
  };
  assert.equal(verifyCapabilityDocument(document, expected).target, target);
  assert.equal(document.transition.state, "issued");
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, intentDigest: "c".repeat(64) }),
    /claims or Ed25519 signature differ/,
  );
  const consumed = transitionCapabilityDocument(document, {
    state: "consumed",
  });
  assert.equal(consumed.signature.valueBase64url, document.signature.valueBase64url);
  assert.deepEqual(consumed.claims, document.claims);
  assert.equal(verifyCapabilityDocument(consumed, { ...expected, state: "consumed" }).target, target);
  assert.equal(consumed.transition.state, "consumed");
  const wrong = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, publicKey: wrong }),
    /Ed25519 signature differ/,
  );
  assert.throws(
    () => verifyCapabilityDocument(document, { ...expected, target: "production" }),
    /Ed25519 signature differ/,
  );
});

test("consume-check rejects a child rerun before any API access", async () => {
  await withApi({}, async ({ apiUrl, getRequestCount }) => {
    const result = await execute(
      ["consume-check", "timekeeping", stage, target, releaseSha, orchestratorRunId],
      {
        GITHUB_API_URL: apiUrl,
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: childRunId,
        GITHUB_EVENT_PATH: "unused",
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refuse workflow reruns/);
    assert.equal(getRequestCount(), 0);
  });
});

test("every orchestrated secret or mutation job revalidates the coordinator after checkout and before secrets", () => {
  const guardedJobs = [
    ["deploy-timekeeping.yml", "release"],
    ["deploy-core-workers.yml", "ponto-identity-staging"],
    ["deploy-core-workers.yml", "deploy"],
    ["deploy-core-workers.yml", "ponto-progressive-release"],
    ["deploy-core-workers.yml", "ponto-identity-progressive-release"],
    ["deploy-crm-pages.yml", "deploy"],
    ["deploy-crm-pages.yml", "ponto-progressive-release"],
    ["cloudflare-workers-sync-ponto-secrets.yml", "provision"],
    ["cloudflare-pages-sync-ponto.yml", "provision"],
    ["module-availability.yml", "set-state"],
    ["ponto-production-baseline.yml", "capture"],
    ["ponto-production-slo.yml", "consultor-journey"],
    ["ponto-production-slo.yml", "rollback-observation"],
    ["timekeeping-staging-journey.yml", "journey"],
    ["ponto-staging-rollback-drill.yml", "drill"],
  ];
  for (const [file, jobName] of guardedJobs) {
    const source = job(workflow(file), jobName);
    const checkout = source.indexOf("actions/checkout@");
    const assertion = source.indexOf("ponto-orchestrator-lease.mjs assert-active");
    const firstEnvironmentSecret = source.indexOf("${{ secrets.");
    assert.ok(checkout >= 0, `${file}:${jobName} must checkout trusted code`);
    assert.ok(assertion > checkout, `${file}:${jobName} must assert after checkout`);
    assert.ok(firstEnvironmentSecret < 0 || assertion < firstEnvironmentSecret, `${file}:${jobName} must assert before environment secrets`);
  }
});

test("every privileged Ponto mutation job refuses workflow reruns without blocking preview or general paths", () => {
  const firstAttemptJobs = [
    ["ponto-progressive-release.yml", "orchestrate"],
    ["deploy-timekeeping.yml", "release"],
    ["deploy-core-workers.yml", "ponto-identity-staging"],
    ["deploy-core-workers.yml", "deploy"],
    ["deploy-core-workers.yml", "ponto-progressive-release"],
    ["deploy-core-workers.yml", "ponto-identity-progressive-release"],
    ["deploy-crm-pages.yml", "deploy"],
    ["deploy-crm-pages.yml", "ponto-progressive-release"],
    ["cloudflare-workers-sync-ponto-secrets.yml", "provision"],
    ["cloudflare-pages-sync-ponto.yml", "provision"],
    ["module-availability.yml", "set-state"],
    ["module-availability.yml", "emergency-reconciliation"],
    ["ponto-emergency-latch-reset.yml", "reset-mutate"],
    ["ponto-emergency-close.yml", "close"],
    ["ponto-production-baseline.yml", "capture"],
    ["ponto-production-slo.yml", "consultor-journey"],
    ["ponto-production-slo.yml", "rollback-observation"],
    ["timekeeping-staging-journey.yml", "journey"],
    ["ponto-staging-rollback-drill.yml", "drill"],
    ["ponto-core-baseline-publisher.yml", "staging"],
    ["ponto-core-baseline-publisher.yml", "production"],
  ];
  for (const [file, jobName] of firstAttemptJobs) {
    assert.match(job(workflow(file), jobName), /github\.run_attempt == 1/, `${file}:${jobName} lacks an attempt-one job guard`);
  }

  assert.doesNotMatch(job(workflow("deploy-timekeeping.yml"), "preview"), /github\.run_attempt == 1/);
  assert.match(
    job(workflow("deploy-core-workers.yml"), "deploy"),
    /inputs\.release_scope != 'ponto' \|\| github\.run_attempt == 1/,
  );
  assert.match(
    job(workflow("deploy-crm-pages.yml"), "deploy"),
    /inputs\.release_scope != 'ponto' \|\| github\.run_attempt == 1/,
  );
  assert.match(workflow("ponto-orchestrator-gate.yml"), /Governed Ponto capabilities cannot be consumed from a workflow rerun/);
  assert.match(workflow("module-availability.yml"), /Historical emergency-stop reruns are forbidden/);
  assert.match(workflow("ponto-emergency-latch-reset.yml"), /Historical latch-reset reruns are forbidden/);
});

test("latch reset accepts only a fresh manual close reattestation title", () => {
  const reset = workflow("ponto-emergency-latch-reset.yml");
  assert.match(reset, /\.github\/workflows\/ponto-emergency-close\.yml/);
  assert.match(reset, /run\?\.display_title !== `Ponto emergency close \$\{process\.env\.TARGET\}`/);
  assert.match(reset, /ponto-emergency-close-\$TARGET-\$EMERGENCY_RUN_ID/);
  assert.match(reset, /maintenance\?\.passed !== true/);
  assert.match(reset, /String\(run\?\.id \|\| ""\) !== process\.env\.EMERGENCY_RUN_ID/);
  assert.match(reset, /run\?\.run_attempt !== 1/);
  assert.match(reset, /Automatic watchdog\/ordinary latches are intentionally not reset/);
});
