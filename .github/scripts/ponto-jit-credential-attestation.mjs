import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attestClinicRunner } from "./ponto-clinic-runner-attestation.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const SECRET_ENVIRONMENT_NAMES = [
  "PONTO_PILOT_LOGIN",
  "PONTO_PILOT_PASSWORD",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM",
  "PONTO_IDEMPOTENCY_KEY",
  "PONTO_RELEASE_PROBE_HMAC_KEY",
  "PONTO_ROOT_ATTESTATION_KEY_SHARED",
  "PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY",
  "CLOUDFLARE_API_TOKEN",
];
export const JIT_CLAIM_FIELDS = [
  "schemaVersion",
  "domain",
  "repositoryId",
  "repository",
  "workflowPath",
  "workflowRef",
  "workflowJob",
  "ref",
  "environment",
  "releaseSha",
  "stage",
  "coordinatorRunId",
  "coordinatorIssuerRunId",
  "coordinatorDispatchNonce",
  "workflowRunId",
  "runAttempt",
  "coreVersionId",
  "timekeepingVersionId",
  "identityVersionId",
  "pagesDeploymentId",
  "preflightArtifactId",
  "preflightArtifactSha256",
  "runnerId",
  "runnerName",
  "runnerOs",
  "runnerArch",
  "runnerIsolationRef",
  "networkContextCustodyRef",
  "runnerEncryptionPublicKeySha256",
  "credentialBundleSha256",
  "decryptKeySha256",
  "supervisorCustodyRef",
  "cleanupHookCustodyRef",
  "attestationNonce",
  "issuedAt",
  "expiresAt",
  "singleUse",
];

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const normalizeArtifactDigest = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/^sha256:/, "");

export const canonicalJitClaims = (claims) => JSON.stringify(
  Object.fromEntries(JIT_CLAIM_FIELDS.map((field) => [field, claims?.[field]])),
);

const equalClaimFields = (claims) => (
  Object.keys(claims || {}).sort().join(",") === [...JIT_CLAIM_FIELDS].sort().join(",")
);

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assertRunnerSecretEnvironmentIsEmpty(env) {
  const present = SECRET_ENVIRONMENT_NAMES.filter((name) => String(env[name] || "") !== "");
  if (present.length) {
    throw new Error(
      "runner secret environment is forbidden; JIT bundle and decrypt-key files are required",
    );
  }
}

function loadPolicy(policyOverride = null) {
  return policyOverride || JSON.parse(fs.readFileSync(
    path.resolve(".github/governance/progressive-release-policy.json"),
    "utf8",
  ));
}

function loadJitPolicy(policyDocument, target) {
  const expected = policyDocument?.pilotRunner?.[target];
  const files = {
    credentialBundle: String(expected?.jitCredentialBundleFilePath || ""),
    decryptKey: String(expected?.jitDecryptKeyFilePath || ""),
    attestation: String(expected?.jitAttestationFilePath || ""),
  };
  const absolutePaths = Object.values(files);
  if (
    !POSITIVE_ID.test(String(expected?.runnerId || ""))
    || typeof expected?.runnerName !== "string"
    || !expected.runnerName.trim()
    || typeof expected?.runnerIsolationRef !== "string"
    || !expected.runnerIsolationRef.trim()
    || !Array.isArray(expected?.requiredLabels)
    || expected.requiredLabels.length < 4
    || new Set(expected.requiredLabels).size !== expected.requiredLabels.length
    || !["self-hosted", "Linux", "X64"].every((label) => expected.requiredLabels.includes(label))
    || typeof expected?.networkContextCustodyRef !== "string"
    || !expected.networkContextCustodyRef.trim()
    || !HEX_32.test(String(expected?.encryptionPublicKeySha256 || ""))
    || expected?.jitMode !== "ephemeral-pre-job-hook-ed25519-v1"
    || typeof expected?.jitAttestationKeyId !== "string"
    || !/^[a-z][a-z0-9-]{1,63}$/.test(expected.jitAttestationKeyId)
    || typeof expected?.jitAttestationPublicKeyPem !== "string"
    || !expected.jitAttestationPublicKeyPem.includes("BEGIN PUBLIC KEY")
    || absolutePaths.some((file) => !path.isAbsolute(file))
    || new Set(absolutePaths).size !== absolutePaths.length
    || new Set(absolutePaths.map((file) => path.dirname(path.resolve(file)))).size !== 1
    || typeof expected?.jitSupervisorCustodyRef !== "string"
    || !expected.jitSupervisorCustodyRef.trim()
    || typeof expected?.jitCleanupHookCustodyRef !== "string"
    || !expected.jitCleanupHookCustodyRef.trim()
  ) throw new Error("JIT clinic credential policy remains fail-closed");
  return { expected, files };
}

function assertSecureDirectory(directory, env) {
  if (process.platform === "win32" || typeof process.getuid !== "function") {
    throw new Error("JIT clinic credential files require a Linux owner-isolated runner");
  }
  const currentUid = process.getuid();
  const workspace = path.resolve(required(env, "GITHUB_WORKSPACE"));
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync(resolved);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || real !== resolved
    || metadata.uid !== currentUid
    || (metadata.mode & 0o777) !== 0o700
    || real === workspace
    || real.startsWith(`${workspace}${path.sep}`)
    || real === runnerTemp
    || real.startsWith(`${runnerTemp}${path.sep}`)
    || real.includes(`${path.sep}_work${path.sep}`)
  ) throw new Error("JIT credential directory ownership, path, or mode is invalid");
  return { currentUid, workspace, runnerTemp, directory: real };
}

function assertSecureFile(file, context) {
  const resolved = path.resolve(file);
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync(resolved);
  if (
    path.dirname(resolved) !== context.directory
    || !metadata.isFile()
    || metadata.isSymbolicLink()
    || real !== resolved
    || metadata.uid !== context.currentUid
    || (metadata.mode & 0o777) !== 0o600
    || real === context.workspace
    || real.startsWith(`${context.workspace}${path.sep}`)
    || real === context.runnerTemp
    || real.startsWith(`${context.runnerTemp}${path.sep}`)
    || real.includes(`${path.sep}_work${path.sep}`)
  ) throw new Error("JIT credential artifact ownership, path, or mode is invalid");
}

function readSecureFile(file, context) {
  assertSecureFile(file, context);
  const resolved = path.resolve(file);
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const pathMetadata = fs.lstatSync(resolved);
    const descriptorMetadata = fs.fstatSync(descriptor);
    if (
      !descriptorMetadata.isFile()
      || descriptorMetadata.uid !== context.currentUid
      || (descriptorMetadata.mode & 0o777) !== 0o600
      || descriptorMetadata.dev !== pathMetadata.dev
      || descriptorMetadata.ino !== pathMetadata.ino
    ) throw new Error("JIT credential artifact changed during secure open");
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateRuntimeContext(env, expected, claims, now, rawBundle, rawDecryptKey) {
  const expectedWorkflowRef = `${required(env, "GITHUB_REPOSITORY")}/.github/workflows/ponto-production-slo.yml@refs/heads/main`;
  const expectedArtifactDigest = normalizeArtifactDigest(required(
    env,
    "PONTO_SLO_PREFLIGHT_ARTIFACT_DIGEST",
  ));
  const issuedAt = Date.parse(String(claims?.issuedAt || ""));
  const expiresAt = Date.parse(String(claims?.expiresAt || ""));
  return equalClaimFields(claims)
    && claims?.schemaVersion === 1
    && claims?.domain === "skincos/ponto/jit-credential-attestation/v1"
    && claims?.repositoryId === required(env, "GITHUB_REPOSITORY_ID")
    && claims?.repository === env.GITHUB_REPOSITORY
    && claims?.workflowPath === ".github/workflows/ponto-production-slo.yml"
    && claims?.workflowRef === expectedWorkflowRef
    && claims?.workflowRef === required(env, "GITHUB_WORKFLOW_REF")
    && claims?.workflowJob === "consultor-journey"
    && claims?.workflowJob === required(env, "GITHUB_JOB")
    && claims?.ref === "refs/heads/main"
    && claims?.ref === required(env, "GITHUB_REF")
    && claims?.environment === "production"
    && FULL_SHA.test(String(claims?.releaseSha || ""))
    && claims?.releaseSha === required(env, "PONTO_RELEASE_SHA").toLowerCase()
    && claims?.releaseSha === required(env, "GITHUB_SHA").toLowerCase()
    && ["pilot", "canary", "production"].includes(claims?.stage)
    && claims?.stage === required(env, "PONTO_RELEASE_STAGE").toLowerCase()
    && POSITIVE_ID.test(String(claims?.coordinatorRunId || ""))
    && claims?.coordinatorRunId === required(env, "PONTO_ORCHESTRATOR_RUN_ID")
    && POSITIVE_ID.test(String(claims?.coordinatorIssuerRunId || ""))
    && claims?.coordinatorIssuerRunId === required(env, "PONTO_ORCHESTRATOR_ISSUER_RUN_ID")
    && /^[0-9a-f]{32}$/.test(String(claims?.coordinatorDispatchNonce || ""))
    && claims?.coordinatorDispatchNonce === required(env, "PONTO_ORCHESTRATOR_NONCE")
    && POSITIVE_ID.test(String(claims?.workflowRunId || ""))
    && claims?.workflowRunId === required(env, "GITHUB_RUN_ID")
    && claims?.runAttempt === 1
    && String(env.GITHUB_RUN_ATTEMPT || "") === "1"
    && UUID.test(String(claims?.coreVersionId || ""))
    && claims?.coreVersionId.toLowerCase() === required(env, "PONTO_EXPECTED_CORE_VERSION_ID").toLowerCase()
    && UUID.test(String(claims?.timekeepingVersionId || ""))
    && claims?.timekeepingVersionId.toLowerCase() === required(env, "PONTO_EXPECTED_TIMEKEEPING_VERSION_ID").toLowerCase()
    && UUID.test(String(claims?.identityVersionId || ""))
    && claims?.identityVersionId.toLowerCase() === required(env, "PONTO_EXPECTED_IDENTITY_VERSION_ID").toLowerCase()
    && UUID.test(String(claims?.pagesDeploymentId || ""))
    && claims?.pagesDeploymentId.toLowerCase() === required(env, "PONTO_EXPECTED_PAGES_DEPLOYMENT_ID").toLowerCase()
    && POSITIVE_ID.test(String(claims?.preflightArtifactId || ""))
    && claims?.preflightArtifactId === required(env, "PONTO_SLO_PREFLIGHT_ARTIFACT_ID")
    && HEX_32.test(String(claims?.preflightArtifactSha256 || ""))
    && claims?.preflightArtifactSha256 === expectedArtifactDigest
    && String(claims?.runnerId || "") === String(expected.runnerId)
    && claims?.runnerName === required(env, "RUNNER_NAME")
    && claims?.runnerName === expected.runnerName
    && claims?.runnerOs === required(env, "RUNNER_OS")
    && claims?.runnerOs === "Linux"
    && claims?.runnerArch === required(env, "RUNNER_ARCH")
    && claims?.runnerArch === "X64"
    && claims?.runnerIsolationRef === expected.runnerIsolationRef
    && claims?.networkContextCustodyRef === expected.networkContextCustodyRef
    && claims?.runnerEncryptionPublicKeySha256 === String(expected.encryptionPublicKeySha256).toLowerCase()
    && claims?.credentialBundleSha256 === digest(rawBundle)
    && claims?.decryptKeySha256 === digest(rawDecryptKey)
    && claims?.supervisorCustodyRef === expected.jitSupervisorCustodyRef
    && claims?.cleanupHookCustodyRef === expected.jitCleanupHookCustodyRef
    && /^[0-9a-f]{32}$/.test(String(claims?.attestationNonce || ""))
    && Number.isFinite(issuedAt)
    && Number.isFinite(expiresAt)
    && issuedAt <= now.getTime()
    && expiresAt > now.getTime()
    && expiresAt - issuedAt <= 10 * 60 * 1000
    && claims?.singleUse === true;
}

export function cleanupJitFiles({
  env = process.env,
  policy = null,
  target = "production",
} = {}) {
  const { files } = loadJitPolicy(loadPolicy(policy), target);
  const directory = path.dirname(path.resolve(files.credentialBundle));
  const context = assertSecureDirectory(directory, env);
  const failures = [];
  for (const file of Object.values(files)) {
    try {
      const resolved = path.resolve(file);
      let metadata;
      try {
        metadata = fs.lstatSync(resolved);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (
        path.dirname(resolved) !== context.directory
        || (!metadata.isFile() && !metadata.isSymbolicLink())
        || metadata.uid !== context.currentUid
      ) throw new Error("refusing to unlink a non-file or foreign-owner JIT path");
      fs.unlinkSync(resolved);
      try {
        fs.lstatSync(resolved);
        failures.push(`${path.basename(file)} still exists`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } catch (error) {
      failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(`JIT credential cleanup failed: ${failures.join("; ")}`);
  return { filesDeleted: true };
}

export function consumeJitCredentials({
  env = process.env,
  policy = null,
  now = new Date(),
} = {}) {
  const target = "production";
  const policyDocument = loadPolicy(policy);
  const { expected, files } = loadJitPolicy(policyDocument, target);
  const directory = path.dirname(path.resolve(files.credentialBundle));
  let rawBundle = null;
  let rawDecryptKey = null;
  let rawAttestation = "";
  let result = null;
  let primaryError = null;
  let cleanupError = null;
  try {
    assertRunnerSecretEnvironmentIsEmpty(env);
    const context = assertSecureDirectory(directory, env);
    rawBundle = readSecureFile(files.credentialBundle, context);
    rawDecryptKey = readSecureFile(files.decryptKey, context);
    const rawAttestationBuffer = readSecureFile(files.attestation, context);
    rawAttestation = rawAttestationBuffer.toString("utf8");
    rawAttestationBuffer.fill(0);
    const document = JSON.parse(rawAttestation);
    const claims = document?.claims;
    if (
      !validateRuntimeContext(env, expected, claims, now, rawBundle, rawDecryptKey)
      || document?.signature?.algorithm !== "Ed25519"
      || document?.signature?.keyId !== expected.jitAttestationKeyId
      || !/^[A-Za-z0-9_-]{86}$/.test(String(document?.signature?.valueBase64url || ""))
    ) throw new Error("JIT credential attestation claims differ");
    const publicKey = crypto.createPublicKey(expected.jitAttestationPublicKeyPem);
    if (
      publicKey.asymmetricKeyType !== "ed25519"
      || !crypto.verify(
        null,
        Buffer.from(canonicalJitClaims(claims)),
        publicKey,
        Buffer.from(document.signature.valueBase64url, "base64url"),
      )
    ) throw new Error("JIT credential attestation signature differs");

    const credentials = JSON.parse(rawBundle.toString("utf8"));
    if (
      JSON.stringify(Object.keys(credentials).sort()) !== JSON.stringify([
        "cfAccessClientId",
        "cfAccessClientSecret",
        "pilotLogin",
        "pilotPassword",
      ])
      || !String(credentials.pilotLogin || "").includes("@")
      || String(credentials.pilotPassword || "").length < 12
      || Boolean(credentials.cfAccessClientId) !== Boolean(credentials.cfAccessClientSecret)
    ) throw new Error("JIT credential bundle is invalid");

    const runnerPrivateKeyPem = rawDecryptKey.toString("utf8");
    const clinicRunner = attestClinicRunner({
      env: {
        ...env,
        PONTO_RESOURCE_TARGET: target,
      },
      policy: policyDocument,
      privateKeyPem: runnerPrivateKeyPem,
      now,
    });
    result = {
      pilotLogin: String(credentials.pilotLogin),
      pilotPassword: String(credentials.pilotPassword),
      cfAccessClientId: String(credentials.cfAccessClientId || ""),
      cfAccessClientSecret: String(credentials.cfAccessClientSecret || ""),
      runnerEncryptionPrivateKeyPem: runnerPrivateKeyPem,
      attestationDigest: digest(rawAttestation),
      credentialBundleDigest: digest(rawBundle),
      decryptKeyDigest: digest(rawDecryptKey),
      clinicRunnerAttestationDigest: digest(JSON.stringify(clinicRunner)),
      filesDeleted: false,
    };
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  } finally {
    try {
      cleanupJitFiles({ env, policy: policyDocument, target });
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    rawBundle?.fill(0);
    rawDecryptKey?.fill(0);
    rawAttestation = "";
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${primaryError.message}; ${cleanupError.message}`,
      { cause: primaryError },
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return { ...result, filesDeleted: true };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  if (process.argv[2] !== "cleanup") {
    throw new Error("JIT credentials may only be consumed in-process by the authenticated journey");
  }
  cleanupJitFiles();
  process.stdout.write("JIT credential hook files are absent after cleanup.\n");
}
