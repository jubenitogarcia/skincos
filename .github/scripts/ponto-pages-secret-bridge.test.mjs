import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONTRACT_ID,
  ROOT_CUSTODY_WORKFLOW,
  TARGETS,
  expectedTargetSecretNames,
  ghChildEnvironment,
  provisionEnvironmentSecrets,
  validateCustodyMetadata,
  validateTargetMetadata,
  verifyAttestedRoot,
  writeSanitizedReceipt,
} from "./ponto-pages-secret-bridge.mjs";
import { createRootCustody } from "./ponto-root-custody.mjs";

const releaseSha = "a".repeat(40);
const root = "i".repeat(48);
const attestationKey = "k".repeat(48);
const profileRoot = "p".repeat(48);
const cloudflareToken = "c".repeat(48);
const coordinationSecret = "g".repeat(48);
const repository = "jubenitogarcia/skincos";
const vaultRef = (character) => `vault:v1:${character.repeat(43)}`;

const metadata = (field, names) => ({ [field]: names.map((name) => ({ name })) });
const variables = (entries) => ({ variables: Object.entries(entries).map(([name, value]) => ({ name, value })) });

function sourceMetadata() {
  return {
    sourceSecretMetadata: metadata("secrets", [
      "PONTO_PROFILE_DATA_KEY",
      "PONTO_IDEMPOTENCY_KEY",
      "PONTO_ROOT_ATTESTATION_KEY_SHARED",
    ]),
    repositorySecretMetadata: metadata("secrets", ["GH_TOKEN", "CLOUDFLARE_API_TOKEN", "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET"]),
    sourceVariableMetadata: variables({
      PONTO_PROFILE_DATA_KEY_CUSTODY_REF: vaultRef("p"),
      PONTO_IDEMPOTENCY_KEY_CUSTODY_REF: vaultRef("i"),
    }),
    repositoryVariableMetadata: variables({ PONTO_ROOT_ATTESTATION_KEY_ID: vaultRef("k") }),
  };
}

function targetVariables(target) {
  return variables({
    PONTO_PAGES_PROJECT: TARGETS[target].project,
    PONTO_PAGES_PUBLISH_ENABLED: "false",
  });
}

test("hardcodes only the two source-root to dedicated Pages-target mappings", () => {
  assert.deepEqual(Object.keys(TARGETS), ["staging", "production"]);
  assert.deepEqual(TARGETS.staging, {
    sourceEnvironment: "staging",
    targetEnvironment: "ponto-pages-staging",
    project: "skincos-ponto-staging",
    preexistingSecretNames: [
      "PONTO_PAGES_AUTH_API_TARGET",
      "PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID",
      "PONTO_PAGES_INSUMOS_API_TARGET",
      "PONTO_PAGES_PONTO_API_TARGET",
    ],
    plan: TARGETS.staging.plan,
  });
  assert.equal(TARGETS.production.sourceEnvironment, "production");
  assert.equal(TARGETS.production.targetEnvironment, "ponto-pages-production");
  assert.equal(TARGETS.production.project, "skincos-ponto");
  for (const target of Object.keys(TARGETS)) {
    assert.deepEqual(TARGETS[target].plan.map((entry) => entry.target).sort(), [
      "PONTO_PAGES_ACTOR_HMAC_KEY",
      "PONTO_PAGES_CLOUDFLARE_API_TOKEN",
      "PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET",
      "PONTO_PAGES_NETWORK_CONTEXT_KEY",
      "PONTO_PAGES_RELEASE_PROBE_HMAC_KEY",
    ]);
    assert.deepEqual(expectedTargetSecretNames(target, "before"), [
      "PONTO_PAGES_AUTH_API_TARGET",
      "PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID",
      "PONTO_PAGES_INSUMOS_API_TARGET",
      "PONTO_PAGES_PONTO_API_TARGET",
    ]);
  }
});

test("requires source roots in staging or production while generic bridge authorities remain repository-scoped", () => {
  const accepted = validateCustodyMetadata({ target: "staging", ...sourceMetadata() });
  assert.equal(accepted.sourceEnvironment, "staging");
  assert.equal(accepted.targetEnvironment, "ponto-pages-staging");
  assert.equal(accepted.valuesIncluded, false);
  const rootAtRepository = sourceMetadata();
  rootAtRepository.repositorySecretMetadata = metadata("secrets", [
    "GH_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET",
    "PONTO_IDEMPOTENCY_KEY",
  ]);
  assert.throws(
    () => validateCustodyMetadata({ target: "staging", ...rootAtRepository }),
    /SOURCE_ROOT_CUSTODY_PONTO_IDEMPOTENCY_KEY_MISMATCH/,
  );
  const genericOverride = sourceMetadata();
  genericOverride.sourceSecretMetadata = metadata("secrets", [
    "PONTO_PROFILE_DATA_KEY",
    "PONTO_IDEMPOTENCY_KEY",
    "PONTO_ROOT_ATTESTATION_KEY_SHARED",
    "CLOUDFLARE_API_TOKEN",
  ]);
  assert.throws(
    () => validateCustodyMetadata({ target: "staging", ...genericOverride }),
    /REPOSITORY_PIPELINE_CUSTODY_CLOUDFLARE_API_TOKEN_MISMATCH/,
  );
  const repositoryTargetOverride = sourceMetadata();
  repositoryTargetOverride.repositorySecretMetadata = metadata("secrets", [
    "GH_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET",
    "PONTO_PAGES_ACTOR_HMAC_KEY",
  ]);
  assert.throws(
    () => validateCustodyMetadata({ target: "staging", ...repositoryTargetOverride }),
    /REPOSITORY_TARGET_CUSTODY_PONTO_PAGES_ACTOR_HMAC_KEY_MISMATCH/,
  );
  const incompleteRootEnvelope = sourceMetadata();
  incompleteRootEnvelope.sourceSecretMetadata = metadata("secrets", [
    "PONTO_IDEMPOTENCY_KEY",
    "PONTO_ROOT_ATTESTATION_KEY_SHARED",
  ]);
  assert.throws(
    () => validateCustodyMetadata({ target: "staging", ...incompleteRootEnvelope }),
    /SOURCE_ROOT_CUSTODY_PONTO_PROFILE_DATA_KEY_MISMATCH/,
  );
  const attestationOverride = sourceMetadata();
  attestationOverride.sourceVariableMetadata = variables({
    PONTO_PROFILE_DATA_KEY_CUSTODY_REF: vaultRef("p"),
    PONTO_IDEMPOTENCY_KEY_CUSTODY_REF: vaultRef("i"),
    PONTO_ROOT_ATTESTATION_KEY_ID: vaultRef("k"),
  });
  assert.throws(
    () => validateCustodyMetadata({ target: "staging", ...attestationOverride }),
    /ROOT_ATTESTATION_KEY_ID_CUSTODY_MISMATCH/,
  );
});

test("requires the exact pre-seeded target baseline, complete post-state, and disabled publishing", () => {
  const before = validateTargetMetadata({
    target: "staging",
    phase: "before",
    secretMetadata: metadata("secrets", expectedTargetSecretNames("staging", "before")),
    variableMetadata: targetVariables("staging"),
  });
  assert.equal(before.publishingEnabled, false);
  const after = validateTargetMetadata({
    target: "production",
    phase: "after",
    secretMetadata: metadata("secrets", expectedTargetSecretNames("production", "after")),
    variableMetadata: targetVariables("production"),
  });
  assert.equal(after.targetEnvironment, "ponto-pages-production");
  assert.throws(() => validateTargetMetadata({
    target: "staging",
    phase: "before",
    secretMetadata: metadata("secrets", [...expectedTargetSecretNames("staging", "before"), "PONTO_PAGES_ACTOR_HMAC_KEY"]),
    variableMetadata: targetVariables("staging"),
  }), /TARGET_SECRET_NAMES_BEFORE_MISMATCH/);
  assert.throws(() => validateTargetMetadata({
    target: "staging",
    phase: "after",
    secretMetadata: metadata("secrets", expectedTargetSecretNames("staging", "after")),
    variableMetadata: variables({ PONTO_PAGES_PROJECT: "skincos-ponto-staging", PONTO_PAGES_PUBLISH_ENABLED: "true" }),
  }), /TARGET_PUBLISH_MUST_REMAIN_DISABLED/);
});

test("matches the exact canonical root-custody commitment before derivation", () => {
  const custody = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot,
    idempotencyRoot: root,
    attestationKey,
    profileCustodyRef: vaultRef("p"),
    idempotencyCustodyRef: vaultRef("i"),
    attestationKeyId: vaultRef("k"),
  });
  const accepted = verifyAttestedRoot({
    target: "staging",
    releaseSha,
    rootCustody: custody,
    idempotencyKey: root,
    attestationKey,
    idempotencyCustodyRef: vaultRef("i"),
    attestationKeyId: vaultRef("k"),
  });
  assert.equal(accepted.rootCustodyVerified, true);
  assert.throws(() => verifyAttestedRoot({
    target: "staging",
    releaseSha,
    rootCustody: custody,
    idempotencyKey: `${root.slice(0, -1)}x`,
    attestationKey,
    idempotencyCustodyRef: vaultRef("i"),
    attestationKeyId: vaultRef("k"),
  }), /ROOT_CUSTODY_COMMITMENT_MISMATCH/);
});

test("writes only target names through gh stdin and derives the legacy domain-separated HMAC keys", () => {
  const calls = [];
  const childEnvironment = ghChildEnvironment({ PATH: "/usr/bin", HOME: "/tmp", GH_TOKEN: "gh-token" });
  const result = provisionEnvironmentSecrets({
    target: "staging",
    repository,
    idempotencyKey: root,
    pipelineSecrets: {
      cloudflareApiToken: cloudflareToken,
      globalCoordinationSharedSecret: coordinationSecret,
    },
    childEnvironment,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.deepEqual(result.targetSecretNames, TARGETS.staging.plan.map((entry) => entry.target).sort());
  assert.equal(calls.length, 5);
  const expectedValues = {
    PONTO_PAGES_CLOUDFLARE_API_TOKEN: cloudflareToken,
    PONTO_PAGES_ACTOR_HMAC_KEY: crypto.createHmac("sha256", root).update("skincos/ponto/actor/v1").digest("base64url"),
    PONTO_PAGES_NETWORK_CONTEXT_KEY: crypto.createHmac("sha256", root).update("skincos/ponto/network-context/v1").digest("base64url"),
    PONTO_PAGES_RELEASE_PROBE_HMAC_KEY: crypto.createHmac("sha256", root).update("skincos/ponto/release-probe/v1").digest("base64url"),
    PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET: coordinationSecret,
  };
  for (const call of calls) {
    const targetName = call.args[2];
    assert.equal(call.command, "gh");
    assert.deepEqual(call.args, ["secret", "set", targetName, "--repo", repository, "--env", "ponto-pages-staging"]);
    assert.equal(call.args.includes("--body"), false);
    assert.equal(call.args.join(" ").includes(root), false);
    assert.equal(call.args.join(" ").includes(cloudflareToken), false);
    assert.equal(call.args.join(" ").includes(coordinationSecret), false);
    assert.equal(call.options.input.toString("utf8"), expectedValues[targetName]);
    assert.deepEqual(call.options.stdio, ["pipe", "ignore", "pipe"]);
    assert.deepEqual(call.options.env, childEnvironment);
    assert.equal(Object.hasOwn(call.options.env, "PONTO_IDEMPOTENCY_KEY"), false);
  }
});

test("writes a receipt that has no root or copied secret values", () => {
  const targetState = validateTargetMetadata({
    target: "staging",
    phase: "after",
    secretMetadata: metadata("secrets", expectedTargetSecretNames("staging", "after")),
    variableMetadata: targetVariables("staging"),
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-pages-secret-bridge-"));
  const output = path.join(directory, "receipt.json");
  const receipt = writeSanitizedReceipt({
    target: "staging",
    repository,
    releaseSha,
    rootCustodyRunId: "123",
    rootCustodyArtifactId: "456",
    rootCustodyArtifactDigest: `sha256:${"d".repeat(64)}`,
    targetState,
    outputFile: output,
    now: new Date("2026-09-10T00:00:00.000Z"),
  });
  const raw = fs.readFileSync(output, "utf8");
  assert.equal(receipt.contractId, CONTRACT_ID);
  assert.equal(receipt.source.rootCustody.workflowPath, ROOT_CUSTODY_WORKFLOW);
  assert.equal(receipt.target.publishingEnabled, false);
  assert.equal(receipt.bridge.cloudflareMutated, false);
  assert.equal(receipt.bridge.pagesDeployed, false);
  for (const value of [root, attestationKey, cloudflareToken, coordinationSecret]) assert.equal(raw.includes(value), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("workflow is manual, guards source provenance before secret hydration, and has no Cloudflare publisher", () => {
  const rootDirectory = path.resolve(import.meta.dirname, "../..");
  const workflow = fs.readFileSync(path.join(rootDirectory, ".github/workflows/ponto-pages-secret-bridge.yml"), "utf8");
  const bridge = fs.readFileSync(path.join(rootDirectory, ".github/scripts/ponto-pages-secret-bridge.mjs"), "utf8");
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule|workflow_run|workflow_call):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /inputs\.apply == true/);
  assert.match(workflow, /environment: \$\{\{ inputs\.target \}\}/);
  assert.match(workflow, /staging\) TARGET_ENVIRONMENT='ponto-pages-staging'/);
  assert.match(workflow, /production\) TARGET_ENVIRONMENT='ponto-pages-production'/);
  assert.match(workflow, /cloudflare-workers-sync-ponto-secrets\.yml/);
  assert.ok(workflow.includes("`${expectedPath}@refs/heads/main`"));
  assert.ok(workflow.includes('run?.head_branch !== "main"'));
  assert.ok(workflow.includes("Attest Ponto Workers ${sourceEnvironment} ${releaseSha} mode=read-only-bridge-attestation"));
  assert.match(workflow, /PONTO_ARTIFACT_METADATA_FILE="\$artifact_metadata_file"/);
  assert.match(workflow, /read -r artifact_id artifact_digest/);
  assert.match(workflow, /actions\/artifacts\/\$artifact_id\/zip/);
  assert.match(workflow, /PONTO_PAGES_BRIDGE_ROOT_CUSTODY_ARTIFACT_ID=\$artifact_id/);
  assert.doesNotMatch(workflow, /actions\/artifacts\/\$PONTO_PAGES_BRIDGE_ROOT_CUSTODY_ARTIFACT_ID\/zip/);
  assert.ok(
    workflow.indexOf("read -r artifact_id artifact_digest")
      < workflow.indexOf("actions/artifacts/$artifact_id/zip"),
  );
  assert.match(workflow, /sha256sum "\$artifact_archive"/);
  assert.match(workflow, /unzip -q "\$artifact_archive"/);
  assert.doesNotMatch(workflow, /gh run download/);
  assert.match(workflow, /PONTO_IDEMPOTENCY_KEY: \$\{\{ secrets\.PONTO_IDEMPOTENCY_KEY \}\}/);
  assert.match(workflow, /PONTO_ROOT_ATTESTATION_KEY_SHARED: \$\{\{ secrets\.PONTO_ROOT_ATTESTATION_KEY_SHARED \}\}/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET \}\}/);
  assert.doesNotMatch(workflow, /secrets\.PONTO_ACTOR_HMAC_KEY/);
  assert.doesNotMatch(workflow, /secrets\.PONTO_NETWORK_CONTEXT_KEY/);
  assert.doesNotMatch(workflow, /secrets\.PONTO_RELEASE_PROBE_HMAC_KEY/);
  assert.doesNotMatch(workflow, /(?:wrangler|api\.cloudflare\.com|pages\s+deploy)/i);
  assert.ok(
    workflow.indexOf("Verify source custody and the empty dedicated target baseline by name only")
      < workflow.indexOf("PONTO_IDEMPOTENCY_KEY: ${{ secrets.PONTO_IDEMPOTENCY_KEY }}"),
  );
  assert.match(bridge, /\["secret", "set", entry\.target, "--repo", repositoryName, "--env", config\.targetEnvironment\]/);
  assert.match(bridge, /input: Buffer\.from\(value, "utf8"\)/);
  assert.match(bridge, /stdio: \["pipe", "ignore", "pipe"\]/);
  assert.doesNotMatch(bridge, /--body/);
  assert.doesNotMatch(bridge, /PONTO_DERIVED_SECRET_FILE/);
});
