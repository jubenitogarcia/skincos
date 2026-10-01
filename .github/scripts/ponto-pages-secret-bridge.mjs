import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  attestationKeyCommitment,
  rootFingerprint,
  validateRootCustody,
} from "./ponto-root-custody.mjs";

export const CONTRACT_ID = "skincos/ponto-pages-environment-secret-bridge/v1";
export const ROOT_CUSTODY_WORKFLOW = ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml";
export const ROOT_CUSTODY_WORKFLOW_NAME = "Attest Ponto Worker secret custody";

const FULL_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID = /^[1-9][0-9]*$/;
const ARTIFACT_DIGEST = /^sha256:[0-9a-f]{64}$/;
const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

const PREEXISTING_PAGES_SECRET_NAMES = Object.freeze([
  "PONTO_PAGES_AUTH_API_TARGET",
  "PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID",
  "PONTO_PAGES_INSUMOS_API_TARGET",
  "PONTO_PAGES_PONTO_API_TARGET",
]);

const DERIVATION_DOMAINS = Object.freeze({
  PONTO_PAGES_ACTOR_HMAC_KEY: "skincos/ponto/actor/v1",
  PONTO_PAGES_NETWORK_CONTEXT_KEY: "skincos/ponto/network-context/v1",
  PONTO_PAGES_RELEASE_PROBE_HMAC_KEY: "skincos/ponto/release-probe/v1",
});

const copiedSecretSources = Object.freeze({
  PONTO_PAGES_CLOUDFLARE_API_TOKEN: "CLOUDFLARE_API_TOKEN",
  PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET: "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET",
});

function bridgePlan() {
  return Object.freeze([
    Object.freeze({
      target: "PONTO_PAGES_CLOUDFLARE_API_TOKEN",
      source: copiedSecretSources.PONTO_PAGES_CLOUDFLARE_API_TOKEN,
      kind: "copy",
    }),
    ...Object.entries(DERIVATION_DOMAINS).map(([target, domain]) => Object.freeze({
      target,
      source: "PONTO_IDEMPOTENCY_KEY",
      kind: "hmac-sha256",
      domain,
    })),
    Object.freeze({
      target: "PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET",
      source: copiedSecretSources.PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET,
      kind: "copy",
    }),
  ]);
}

export const TARGETS = Object.freeze({
  staging: Object.freeze({
    sourceEnvironment: "staging",
    targetEnvironment: "ponto-pages-staging",
    project: "skincos-ponto-staging",
    preexistingSecretNames: PREEXISTING_PAGES_SECRET_NAMES,
    plan: bridgePlan(),
  }),
  production: Object.freeze({
    sourceEnvironment: "production",
    targetEnvironment: "ponto-pages-production",
    project: "skincos-ponto",
    preexistingSecretNames: PREEXISTING_PAGES_SECRET_NAMES,
    plan: bridgePlan(),
  }),
});

function fail(message) {
  throw new Error(`PONTO_PAGES_SECRET_BRIDGE_${message}`);
}

function sameText(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireText(value, name) {
  const text = String(value || "");
  if (!text || /[\r\n\0]/.test(text)) fail(`${name}_IS_INVALID`);
  return text;
}

function requireRoot(value) {
  const text = requireText(value, "PONTO_IDEMPOTENCY_KEY");
  if (Buffer.byteLength(text, "utf8") < 32 || text !== text.trim()) {
    fail("PONTO_IDEMPOTENCY_KEY_IS_INVALID");
  }
  return text;
}

function requireRepository(value) {
  const repository = String(value || "").trim();
  if (!REPOSITORY.test(repository)) fail("REPOSITORY_IS_INVALID");
  return repository;
}

function requireSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(sha)) fail("RELEASE_SHA_IS_INVALID");
  return sha;
}

function requireRunId(value) {
  const runId = String(value || "").trim();
  if (!RUN_ID.test(runId)) fail("ROOT_CUSTODY_RUN_ID_IS_INVALID");
  return runId;
}

function targetConfig(target) {
  const normalized = String(target || "").trim();
  if (!Object.hasOwn(TARGETS, normalized)) fail("TARGET_IS_INVALID");
  return { target: normalized, ...TARGETS[normalized] };
}

function valuesForPlan(idempotencyKey, pipelineSecrets) {
  const root = requireRoot(idempotencyKey);
  const cloudflareApiToken = requireText(
    pipelineSecrets?.cloudflareApiToken,
    "CLOUDFLARE_API_TOKEN",
  );
  const coordinationSecret = requireText(
    pipelineSecrets?.globalCoordinationSharedSecret,
    "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET",
  );
  const derive = (domain) => crypto.createHmac("sha256", root).update(domain).digest("base64url");
  return Object.freeze({
    PONTO_PAGES_CLOUDFLARE_API_TOKEN: cloudflareApiToken,
    PONTO_PAGES_ACTOR_HMAC_KEY: derive(DERIVATION_DOMAINS.PONTO_PAGES_ACTOR_HMAC_KEY),
    PONTO_PAGES_NETWORK_CONTEXT_KEY: derive(DERIVATION_DOMAINS.PONTO_PAGES_NETWORK_CONTEXT_KEY),
    PONTO_PAGES_RELEASE_PROBE_HMAC_KEY: derive(DERIVATION_DOMAINS.PONTO_PAGES_RELEASE_PROBE_HMAC_KEY),
    PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET: coordinationSecret,
  });
}

function pagesFromMetadata(metadata, field) {
  const pages = Array.isArray(metadata) ? metadata : [metadata];
  if (!pages.length || pages.some((page) => !page || typeof page !== "object" || Array.isArray(page) || !Array.isArray(page[field]))) {
    fail(`${field.toUpperCase()}_METADATA_IS_INVALID`);
  }
  return pages.flatMap((page) => page[field]);
}

function namesFromMetadata(metadata, field) {
  const names = new Set();
  for (const item of pagesFromMetadata(metadata, field)) {
    const name = String(item?.name || "").trim();
    if (!ENVIRONMENT_NAME.test(name) || names.has(name)) fail(`${field.toUpperCase()}_METADATA_IS_INVALID`);
    names.add(name);
  }
  return names;
}

function variablesFromMetadata(metadata) {
  const variables = new Map();
  for (const item of pagesFromMetadata(metadata, "variables")) {
    const name = String(item?.name || "").trim();
    if (!ENVIRONMENT_NAME.test(name) || variables.has(name) || typeof item?.value !== "string") {
      fail("VARIABLES_METADATA_IS_INVALID");
    }
    variables.set(name, item.value);
  }
  return variables;
}

function sameNames(actual, expected) {
  return actual.size === expected.size && [...actual].every((name) => expected.has(name));
}

export function expectedTargetSecretNames(target, phase = "after") {
  const config = targetConfig(target);
  if (!new Set(["before", "after"]).has(phase)) fail("TARGET_PHASE_IS_INVALID");
  const names = phase === "before"
    ? config.preexistingSecretNames
    : [...config.preexistingSecretNames, ...config.plan.map((entry) => entry.target)];
  return [...names].sort();
}

export function validateTargetMetadata({ target, phase, secretMetadata, variableMetadata }) {
  const config = targetConfig(target);
  if (!new Set(["before", "after"]).has(phase)) fail("TARGET_PHASE_IS_INVALID");
  const observedSecretNames = namesFromMetadata(secretMetadata, "secrets");
  const expectedSecretNames = new Set(expectedTargetSecretNames(config.target, phase));
  if (!sameNames(observedSecretNames, expectedSecretNames)) fail(`TARGET_SECRET_NAMES_${phase.toUpperCase()}_MISMATCH`);
  const variables = variablesFromMetadata(variableMetadata);
  if (variables.get("PONTO_PAGES_PROJECT") !== config.project) fail("TARGET_PROJECT_IS_INVALID");
  if (variables.get("PONTO_PAGES_PUBLISH_ENABLED") !== "false") fail("TARGET_PUBLISH_MUST_REMAIN_DISABLED");
  return Object.freeze({
    target: config.target,
    sourceEnvironment: config.sourceEnvironment,
    targetEnvironment: config.targetEnvironment,
    project: config.project,
    phase,
    targetSecretNames: [...observedSecretNames].sort(),
    publishingEnabled: false,
    valuesIncluded: false,
  });
}

export function validateCustodyMetadata({
  target,
  sourceSecretMetadata,
  repositorySecretMetadata,
  sourceVariableMetadata,
  repositoryVariableMetadata,
}) {
  const config = targetConfig(target);
  const sourceSecrets = namesFromMetadata(sourceSecretMetadata, "secrets");
  const repositorySecrets = namesFromMetadata(repositorySecretMetadata, "secrets");
  const sourceVariables = variablesFromMetadata(sourceVariableMetadata);
  const repositoryVariables = variablesFromMetadata(repositoryVariableMetadata);
  // Match the canonical Worker-custody scope check. The bridge derives only
  // from the idempotency root, but accepts it only as part of the complete
  // source-root custody envelope rather than a weaker, standalone secret.
  for (const name of [
    "PONTO_PROFILE_DATA_KEY",
    "PONTO_IDEMPOTENCY_KEY",
    "PONTO_ROOT_ATTESTATION_KEY_SHARED",
  ]) {
    if (!sourceSecrets.has(name) || repositorySecrets.has(name)) fail(`SOURCE_ROOT_CUSTODY_${name}_MISMATCH`);
  }
  for (const name of ["GH_TOKEN", "CLOUDFLARE_API_TOKEN", "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET"]) {
    if (!repositorySecrets.has(name) || sourceSecrets.has(name)) fail(`REPOSITORY_PIPELINE_CUSTODY_${name}_MISMATCH`);
  }
  for (const name of expectedTargetSecretNames(config.target, "after")) {
    if (repositorySecrets.has(name)) fail(`REPOSITORY_TARGET_CUSTODY_${name}_MISMATCH`);
  }
  for (const name of ["PONTO_PROFILE_DATA_KEY_CUSTODY_REF", "PONTO_IDEMPOTENCY_KEY_CUSTODY_REF"]) {
    if (!sourceVariables.has(name)) fail(`SOURCE_ROOT_CUSTODY_REFERENCE_${name}_IS_ABSENT`);
  }
  if (!repositoryVariables.has("PONTO_ROOT_ATTESTATION_KEY_ID") || sourceVariables.has("PONTO_ROOT_ATTESTATION_KEY_ID")) {
    fail("ROOT_ATTESTATION_KEY_ID_CUSTODY_MISMATCH");
  }
  return Object.freeze({
    target: config.target,
    sourceEnvironment: config.sourceEnvironment,
    targetEnvironment: config.targetEnvironment,
    rootSource: "PONTO_IDEMPOTENCY_KEY",
    repositoryPipelineSources: [
      "GH_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET",
    ],
    valuesIncluded: false,
  });
}

export function verifyAttestedRoot({
  target,
  releaseSha,
  rootCustody,
  idempotencyKey,
  attestationKey,
  idempotencyCustodyRef,
  attestationKeyId,
}) {
  const config = targetConfig(target);
  const sha = requireSha(releaseSha);
  const attested = validateRootCustody(rootCustody, {
    target: config.sourceEnvironment,
    releaseSha: sha,
  });
  const actualFingerprint = rootFingerprint(requireRoot(idempotencyKey), attestationKey);
  const actualKeyCommitment = attestationKeyCommitment(attestationKey);
  if (
    !sameText(actualFingerprint, attested.idempotencyDigest)
    || String(idempotencyCustodyRef || "") !== attested.idempotencyCustodyRef
    || String(attestationKeyId || "") !== attested.attestationKeyId
    || !sameText(actualKeyCommitment, attested.attestationKeyCommitment)
  ) {
    fail("ROOT_CUSTODY_COMMITMENT_MISMATCH");
  }
  return Object.freeze({
    target: config.target,
    sourceEnvironment: config.sourceEnvironment,
    releaseSha: sha,
    rootCustodyVerified: true,
    valuesIncluded: false,
  });
}

export function ghChildEnvironment(environment = process.env) {
  const ghToken = requireText(environment.GH_TOKEN, "GH_TOKEN");
  const safe = { GH_TOKEN: ghToken };
  for (const name of [
    "PATH",
    "HOME",
    "GH_HOST",
    "GITHUB_API_URL",
    "GITHUB_SERVER_URL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    if (environment[name]) safe[name] = environment[name];
  }
  return safe;
}

export function provisionEnvironmentSecrets({
  target,
  repository,
  idempotencyKey,
  pipelineSecrets,
  spawn = spawnSync,
  childEnvironment = ghChildEnvironment(),
}) {
  const config = targetConfig(target);
  const repositoryName = requireRepository(repository);
  const values = valuesForPlan(idempotencyKey, pipelineSecrets);
  for (const entry of config.plan) {
    const value = values[entry.target];
    const result = spawn(
      "gh",
      ["secret", "set", entry.target, "--repo", repositoryName, "--env", config.targetEnvironment],
      {
        input: Buffer.from(value, "utf8"),
        encoding: "utf8",
        stdio: ["pipe", "ignore", "pipe"],
        env: childEnvironment,
      },
    );
    if (result?.error || result?.status !== 0) fail(`SECRET_WRITE_FAILED_${entry.target}`);
  }
  return Object.freeze({
    target: config.target,
    targetEnvironment: config.targetEnvironment,
    project: config.project,
    targetSecretNames: config.plan.map((entry) => entry.target).sort(),
    valuesIncluded: false,
  });
}

export function writeSanitizedReceipt({
  target,
  repository,
  releaseSha,
  rootCustodyRunId,
  rootCustodyArtifactId,
  rootCustodyArtifactDigest,
  targetState,
  outputFile,
  now = new Date(),
}) {
  const config = targetConfig(target);
  const sha = requireSha(releaseSha);
  const runId = requireRunId(rootCustodyRunId);
  const artifactId = String(rootCustodyArtifactId || "").trim();
  const artifactDigest = String(rootCustodyArtifactDigest || "").trim().toLowerCase();
  if (!RUN_ID.test(artifactId) || !ARTIFACT_DIGEST.test(artifactDigest)) fail("ROOT_CUSTODY_ARTIFACT_IS_INVALID");
  if (!targetState || targetState.phase !== "after" || targetState.target !== config.target || targetState.publishingEnabled !== false) {
    fail("TARGET_STATE_IS_INVALID");
  }
  const names = targetState.targetSecretNames;
  if (!Array.isArray(names) || JSON.stringify([...names].sort()) !== JSON.stringify(expectedTargetSecretNames(config.target, "after"))) {
    fail("TARGET_STATE_SECRET_NAMES_ARE_INVALID");
  }
  const destination = String(outputFile || "").trim();
  if (!destination) fail("RECEIPT_OUTPUT_IS_INVALID");
  const receipt = {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    generatedAt: new Date(now).toISOString(),
    source: {
      repository: requireRepository(repository),
      releaseSha: sha,
      sourceEnvironment: config.sourceEnvironment,
      rootSecret: "PONTO_IDEMPOTENCY_KEY",
      rootCustody: {
        workflowPath: ROOT_CUSTODY_WORKFLOW,
        workflowName: ROOT_CUSTODY_WORKFLOW_NAME,
        workflowRunId: runId,
        artifactId,
        artifactDigest,
        artifactName: `ponto-root-custody-${config.sourceEnvironment}-${sha}`,
      },
      valuesIncluded: false,
    },
    target: {
      githubEnvironment: config.targetEnvironment,
      project: config.project,
      publishingEnabled: false,
      secretNames: expectedTargetSecretNames(config.target, "after"),
    },
    bridge: {
      writtenSecretNames: config.plan.map((entry) => entry.target).sort(),
      copiedSecretSources: copiedSecretSources,
      derivations: Object.fromEntries(Object.entries(DERIVATION_DOMAINS).map(([name, domain]) => [
        name,
        `hmac-sha256:PONTO_IDEMPOTENCY_KEY:${domain}`,
      ])),
      transport: "gh-environment-secret-api-stdin-only",
      cloudflareMutated: false,
      pagesDeployed: false,
      valuesIncluded: false,
      credentialsIncluded: false,
      piiIncluded: false,
    },
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return receipt;
}

function parseMetadata(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function commandLine() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "validate-custody": {
      const [target, sourceSecrets, repositorySecrets, sourceVariables, repositoryVariables] = args;
      validateCustodyMetadata({
        target,
        sourceSecretMetadata: parseMetadata(sourceSecrets),
        repositorySecretMetadata: parseMetadata(repositorySecrets),
        sourceVariableMetadata: parseMetadata(sourceVariables),
        repositoryVariableMetadata: parseMetadata(repositoryVariables),
      });
      process.stdout.write("PONTO_PAGES_SECRET_BRIDGE_CUSTODY_METADATA_OK values_emitted=false\n");
      return;
    }
    case "validate-target": {
      const [target, phase, secrets, variables] = args;
      validateTargetMetadata({
        target,
        phase,
        secretMetadata: parseMetadata(secrets),
        variableMetadata: parseMetadata(variables),
      });
      process.stdout.write(`PONTO_PAGES_SECRET_BRIDGE_TARGET_${String(phase).toUpperCase()}_OK values_emitted=false\n`);
      return;
    }
    case "verify-root": {
      const [target, releaseSha, custodyFile] = args;
      verifyAttestedRoot({
        target,
        releaseSha,
        rootCustody: parseMetadata(custodyFile),
        idempotencyKey: process.env.PONTO_IDEMPOTENCY_KEY,
        attestationKey: process.env.PONTO_ROOT_ATTESTATION_KEY_SHARED,
        idempotencyCustodyRef: process.env.PONTO_IDEMPOTENCY_KEY_CUSTODY_REF,
        attestationKeyId: process.env.PONTO_ROOT_ATTESTATION_KEY_ID,
      });
      process.stdout.write("PONTO_PAGES_SECRET_BRIDGE_ROOT_CUSTODY_OK values_emitted=false\n");
      return;
    }
    case "provision": {
      const [target, repository] = args;
      provisionEnvironmentSecrets({
        target,
        repository,
        idempotencyKey: process.env.PONTO_IDEMPOTENCY_KEY,
        pipelineSecrets: {
          cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
          globalCoordinationSharedSecret: process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET,
        },
      });
      process.stdout.write("PONTO_PAGES_SECRET_BRIDGE_WRITTEN values_emitted=false\n");
      return;
    }
    case "write-receipt": {
      const [target, repository, releaseSha, runId, artifactId, artifactDigest, targetSecrets, targetVariables, outputFile] = args;
      const targetState = validateTargetMetadata({
        target,
        phase: "after",
        secretMetadata: parseMetadata(targetSecrets),
        variableMetadata: parseMetadata(targetVariables),
      });
      writeSanitizedReceipt({
        target,
        repository,
        releaseSha,
        rootCustodyRunId: runId,
        rootCustodyArtifactId: artifactId,
        rootCustodyArtifactDigest: artifactDigest,
        targetState,
        outputFile,
      });
      process.stdout.write("PONTO_PAGES_SECRET_BRIDGE_RECEIPT_WRITTEN values_emitted=false\n");
      return;
    }
    default:
      fail("USAGE_VALIDATE_CUSTODY_VALIDATE_TARGET_VERIFY_ROOT_PROVISION_OR_WRITE_RECEIPT");
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    commandLine();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "PONTO_PAGES_SECRET_BRIDGE_FAILED"}\n`);
    process.exitCode = 1;
  }
}
