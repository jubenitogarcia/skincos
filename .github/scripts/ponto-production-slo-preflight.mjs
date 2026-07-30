import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTerminalPagesDeployment } from "./ponto-rollback-ownership.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const PROBE_STAGES = new Set(["pilot", "canary"]);
const OBSERVATION_STAGES = new Set(["pilot", "canary", "production"]);
const PROBE_DERIVATION_DOMAIN = "skincos/ponto/release-probe/v1";
const PROBE_MESSAGE_DOMAIN = "ponto-release-probe/v2";
const PROBE_PATHNAME = "/api/ponto/_release-contract";

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const digestDocument = (document) => crypto
  .createHash("sha256")
  .update(JSON.stringify(document))
  .digest("hex");

const aliasHostname = (alias) => {
  try {
    return new URL(String(alias)).hostname;
  } catch {
    return String(alias).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

export const canonicalReleaseProbeMessageV2 = ({
  timestamp,
  nonce,
  method = "POST",
  pathname = PROBE_PATHNAME,
  bodyDigest,
  releaseSha,
  stage,
  coordinatorRunId,
  workflowRunId,
}) => [
  PROBE_MESSAGE_DOMAIN,
  timestamp,
  nonce,
  method,
  pathname,
  bodyDigest,
  releaseSha,
  stage,
  coordinatorRunId,
  workflowRunId,
].join(".");

export function loadConfiguration(env = process.env, policyOverride = null) {
  const releaseSha = required(env, "PONTO_RELEASE_SHA").toLowerCase();
  const stage = required(env, "PONTO_RELEASE_STAGE").toLowerCase();
  const orchestratorStage = required(env, "PONTO_ORCHESTRATOR_STAGE").toLowerCase();
  const coordinatorRunId = required(env, "PONTO_ORCHESTRATOR_RUN_ID");
  const workflowRunId = required(env, "GITHUB_RUN_ID");
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID").toLowerCase();
  const pagesProject = required(env, "CLOUDFLARE_PAGES_PROJECT");
  const outputDirectory = required(env, "PONTO_SLO_PREFLIGHT_DIR");
  const pagesDeploymentId = required(env, "PONTO_EXPECTED_PAGES_DEPLOYMENT_ID").toLowerCase();
  const ids = {
    core: required(env, "PONTO_EXPECTED_CORE_VERSION_ID").toLowerCase(),
    timekeeping: required(env, "PONTO_EXPECTED_TIMEKEEPING_VERSION_ID").toLowerCase(),
    identity: required(env, "PONTO_EXPECTED_IDENTITY_VERSION_ID").toLowerCase(),
    pages: pagesDeploymentId,
  };
  if (
    !FULL_SHA.test(releaseSha)
    || !OBSERVATION_STAGES.has(stage)
    || orchestratorStage !== stage
    || !POSITIVE_ID.test(coordinatorRunId)
    || !POSITIVE_ID.test(workflowRunId)
    || !/^[0-9a-f]{32}$/.test(accountId)
    || pagesProject !== "skincos"
    || !Object.values(ids).every((value) => UUID.test(value))
  ) throw new Error("Ponto production SLO preflight identity is invalid");

  let probeRoot = "";
  let runnerEncryptionPublicKey = null;
  let runnerEncryptionPublicKeyFingerprint = "";
  let runnerPolicy = null;
  if (PROBE_STAGES.has(stage)) {
    const idempotencyKey = String(env.PONTO_IDEMPOTENCY_KEY || "");
    const publicKeyPem = required(env, "PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM");
    const policy = policyOverride || JSON.parse(fs.readFileSync(
      path.resolve(".github/governance/progressive-release-policy.json"),
      "utf8",
    ));
    runnerPolicy = policy?.pilotRunner?.production;
    const expectedFingerprint = String(runnerPolicy?.encryptionPublicKeySha256 || "").trim().toLowerCase();
    if (
      Buffer.byteLength(idempotencyKey, "utf8") < 32
      || idempotencyKey !== idempotencyKey.trim()
      || /[\r\n\0]/.test(idempotencyKey)
    ) throw new Error("Ponto release-probe signing custody is invalid");
    try {
      runnerEncryptionPublicKey = crypto.createPublicKey(publicKeyPem);
    } catch {
      throw new Error("Ponto pilot runner encryption public key is invalid");
    }
    const publicDer = runnerEncryptionPublicKey.export({ type: "spki", format: "der" });
    runnerEncryptionPublicKeyFingerprint = crypto.createHash("sha256").update(publicDer).digest("hex");
    if (
      runnerEncryptionPublicKey.asymmetricKeyType !== "rsa"
      || Number(runnerEncryptionPublicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
      || !POSITIVE_ID.test(String(runnerPolicy?.runnerId || ""))
      || !/^[0-9a-f]{64}$/.test(expectedFingerprint)
      || typeof runnerPolicy?.runnerName !== "string"
      || !runnerPolicy.runnerName.trim()
      || typeof runnerPolicy?.runnerIsolationRef !== "string"
      || !runnerPolicy.runnerIsolationRef.trim()
      || !Array.isArray(runnerPolicy?.requiredLabels)
      || runnerPolicy.requiredLabels.length < 4
      || runnerPolicy.requiredLabels.some((label) => typeof label !== "string" || !label.trim())
      || typeof runnerPolicy?.networkContextCustodyRef !== "string"
      || !runnerPolicy.networkContextCustodyRef.trim()
      || !constantTimeHexEqual(runnerEncryptionPublicKeyFingerprint, expectedFingerprint)
    ) throw new Error("Ponto pilot runner encryption public key custody is invalid");
    probeRoot = idempotencyKey;
  }

  return {
    releaseSha,
    stage,
    orchestratorStage,
    coordinatorRunId,
    workflowRunId,
    accountId,
    apiToken: required(env, "CLOUDFLARE_API_TOKEN"),
    pagesProject,
    pagesDeploymentId,
    outputDirectory,
    ids,
    probeRoot,
    runnerEncryptionPublicKey,
    runnerEncryptionPublicKeyFingerprint,
    runnerPolicy,
  };
}

function constantTimeHexEqual(left, right) {
  if (!/^[0-9a-f]+$/.test(String(left)) || String(left).length !== String(right).length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function execute({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  randomBytes = crypto.randomBytes,
  policy = null,
} = {}) {
  const configuration = loadConfiguration(env, policy);
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/pages/projects/${configuration.pagesProject}/deployments/${configuration.pagesDeploymentId}`,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.apiToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  const deployment = payload?.result;
  const metadata = deployment?.deployment_trigger?.metadata || {};
  const aliases = new Set((deployment?.aliases || []).map(aliasHostname));
  const commitSha = String(metadata.commit_hash || "").trim().toLowerCase();
  if (
    response.status !== 200
    || payload?.success !== true
    || String(deployment?.id || "").toLowerCase() !== configuration.pagesDeploymentId
    || deployment?.project_name !== configuration.pagesProject
    || deployment?.environment !== "production"
    || metadata.branch !== "main"
    || commitSha !== configuration.releaseSha
    || !isTerminalPagesDeployment(deployment)
    || !aliases.has("crm.skincos.com.br")
  ) throw new Error("public CRM domain is not linked to the exact terminal Pages candidate");

  const observedAt = now.toISOString();
  const controlPlaneSummary = {
    schemaVersion: 1,
    domain: "skincos/ponto/production-slo-control-plane/v1",
    passed: true,
    target: "production",
    stage: configuration.stage,
    sourceSha: configuration.releaseSha,
    coordinatorRunId: configuration.coordinatorRunId,
    workflowRunId: configuration.workflowRunId,
    coreVersionId: configuration.ids.core,
    timekeepingVersionId: configuration.ids.timekeeping,
    identityVersionId: configuration.ids.identity,
    pagesDeploymentId: configuration.ids.pages,
    pagesProject: configuration.pagesProject,
    pagesEnvironment: "production",
    pagesBranch: "main",
    pagesCommitSha: commitSha,
    pagesTerminal: true,
    crmAliasMatched: true,
    ...(configuration.runnerPolicy ? {
      pilotRunnerId: String(configuration.runnerPolicy.runnerId),
      pilotRunnerName: configuration.runnerPolicy.runnerName,
      pilotRunnerIsolationRef: configuration.runnerPolicy.runnerIsolationRef,
      pilotRunnerRequiredLabels: configuration.runnerPolicy.requiredLabels,
      pilotRunnerNetworkContextCustodyRef: configuration.runnerPolicy.networkContextCustodyRef,
      pilotRunnerEncryptionPublicKeySha256: configuration.runnerEncryptionPublicKeyFingerprint,
    } : {}),
    observedAt,
    piiIncluded: false,
    credentialsIncluded: false,
  };
  const controlPlane = {
    ...controlPlaneSummary,
    digest: digestDocument(controlPlaneSummary),
  };

  fs.mkdirSync(configuration.outputDirectory, { recursive: true });
  const controlPlaneFile = path.join(configuration.outputDirectory, "control-plane-attestation.json");
  fs.writeFileSync(controlPlaneFile, `${JSON.stringify(controlPlane, null, 2)}\n`, { mode: 0o600 });

  let probeCapability = null;
  let probeCapabilityFile = "";
  if (configuration.probeRoot) {
    const delegationTimestamp = String(Math.floor(now.getTime() / 1000));
    const delegationExpiresAt = String(Math.floor((now.getTime() + 2 * 60 * 60 * 1000) / 1000));
    const nonce = randomBytes(16).toString("hex");
    const delegatedKey = randomBytes(32).toString("base64url");
    const delegatedKeyCommitment = crypto.createHash("sha256").update(delegatedKey).digest("hex");
    const delegationMessage = [
      "ponto-release-probe-delegation/v1",
      delegationTimestamp,
      delegationExpiresAt,
      nonce,
      "POST",
      PROBE_PATHNAME,
      configuration.releaseSha,
      configuration.stage,
      configuration.coordinatorRunId,
      configuration.workflowRunId,
      delegatedKeyCommitment,
    ].join(".");
    const releaseProbeKey = crypto
      .createHmac("sha256", configuration.probeRoot)
      .update(PROBE_DERIVATION_DOMAIN)
      .digest("base64url");
    const delegationSignature = crypto
      .createHmac("sha256", releaseProbeKey)
      .update(delegationMessage)
      .digest("base64url");
    const encryptedDelegatedKey = crypto.publicEncrypt({
      key: configuration.runnerEncryptionPublicKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(delegatedKey));
    probeCapability = {
      schemaVersion: 2,
      domain: PROBE_MESSAGE_DOMAIN,
      signatureVersion: "2",
      delegationVersion: "1",
      delegationTimestamp,
      delegationExpiresAt,
      nonce,
      delegatedKeyCommitment,
      delegationSignature,
      encryptedDelegatedKey: encryptedDelegatedKey.toString("base64"),
      delegatedKeyEncryption: "rsa-oaep-sha256",
      runnerEncryptionPublicKeyFingerprint: configuration.runnerEncryptionPublicKeyFingerprint,
      method: "POST",
      pathname: PROBE_PATHNAME,
      releaseSha: configuration.releaseSha,
      stage: configuration.stage,
      coordinatorRunId: configuration.coordinatorRunId,
      workflowRunId: configuration.workflowRunId,
      bodyDigestBoundAtUse: true,
      singleUse: true,
      piiIncluded: false,
      credentialsIncluded: false,
      bodyDigestIncluded: false,
      rootKeyIncluded: false,
      delegatedSigningKeyIncluded: false,
      encryptedDelegatedSigningKeyIncluded: true,
    };
    probeCapabilityFile = path.join(configuration.outputDirectory, "release-probe-capability.json");
    fs.writeFileSync(probeCapabilityFile, `${JSON.stringify(probeCapability, null, 2)}\n`, { mode: 0o600 });
  }

  return { configuration, controlPlane, controlPlaneFile, probeCapability, probeCapabilityFile };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  await execute();
  process.stdout.write("Ponto production SLO control-plane preflight and scoped probe delegation passed without emitting roots or credentials.\n");
}
