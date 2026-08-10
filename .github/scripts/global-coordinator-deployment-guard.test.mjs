import test from "node:test";
import assert from "node:assert/strict";
import { validateDeploymentIntent } from "./global-coordinator-deployment-guard.mjs";

const BASE = {
  target: "production",
  ref: "refs/heads/main",
  sha: "a".repeat(40),
  runAttempt: "1",
};

test("allows only the explicit first production bootstrap without a Worker or endpoint", () => {
  const result = validateDeploymentIntent({
    ...BASE,
    workerExists: false,
    allowBootstrap: true,
  });
  assert.equal(result.bootstrap, true);
  assert.equal(result.remoteLeaseRequired, false);
});

test("requires the remote lease for an existing production coordinator", () => {
  const result = validateDeploymentIntent({
    ...BASE,
    coordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev",
    expectedCoordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev",
    workerExists: true,
  });
  assert.equal(result.bootstrap, false);
  assert.equal(result.remoteLeaseRequired, true);
});

test("fails closed on an ambiguous or replayed bootstrap", () => {
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    workerExists: true,
    allowBootstrap: true,
  }), /already exists/);
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    workerExists: false,
    allowBootstrap: true,
    runAttempt: "2",
  }), /rerun/);
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    workerExists: false,
    allowBootstrap: false,
  }), /explicit bootstrap intent/);
});

test("requires main, an exact SHA, and an existing staging endpoint", () => {
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    target: "staging",
    workerExists: false,
    coordinatorUrl: "https://skincos-global-coordinator-staging.skincos.workers.dev",
  }), /existing Worker/);
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    coordinatorUrl: "https://unexpected.example",
    expectedCoordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev",
    workerExists: true,
  }), /canonical target/);
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    coordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev",
    expectedCoordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev",
    workerExists: false,
  }), /existing Worker/);
  assert.throws(() => validateDeploymentIntent({
    ...BASE,
    ref: "refs/heads/codex/test",
    workerExists: true,
    coordinatorUrl: "https://example.workers.dev",
  }), /from main/);
});
