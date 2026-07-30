import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function attestClinicRunner({
  env = process.env,
  policy = null,
  privateKeyPem = "",
  now = new Date(),
} = {}) {
  if (String(env.PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM || "")) {
    throw new Error("clinic runner private key in process environment is forbidden");
  }
  const target = required(env, "PONTO_RESOURCE_TARGET").toLowerCase();
  if (!["staging", "production"].includes(target)) throw new Error("clinic runner target is invalid");
  const policyDocument = policy || JSON.parse(fs.readFileSync(
    path.resolve(".github/governance/progressive-release-policy.json"),
    "utf8",
  ));
  const expected = policyDocument?.pilotRunner?.[target];
  const runnerName = required(env, "RUNNER_NAME");
  const runnerOs = required(env, "RUNNER_OS");
  const runnerArch = required(env, "RUNNER_ARCH");
  const isolationRef = String(expected?.runnerIsolationRef || "");
  const networkContextRef = String(expected?.networkContextCustodyRef || "");
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(String(privateKeyPem || ""));
  } catch {
    throw new Error("clinic runner proof-of-possession key is unavailable");
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const fingerprint = crypto.createHash("sha256").update(publicDer).digest("hex");
  if (
    publicKey.asymmetricKeyType !== "rsa"
    || Number(publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
    || !/^[1-9][0-9]{0,19}$/.test(String(expected?.runnerId || ""))
    || typeof expected?.runnerName !== "string"
    || runnerName !== expected.runnerName
    || runnerOs !== "Linux"
    || runnerArch !== "X64"
    || typeof expected?.runnerIsolationRef !== "string"
    || !isolationRef.trim()
    || !Array.isArray(expected?.requiredLabels)
    || expected.requiredLabels.length < 4
    || new Set(expected.requiredLabels).size !== expected.requiredLabels.length
    || !["self-hosted", "Linux", "X64"].every((label) => expected.requiredLabels.includes(label))
    || typeof expected?.networkContextCustodyRef !== "string"
    || !networkContextRef.trim()
    || !/^[0-9a-f]{64}$/.test(String(expected?.encryptionPublicKeySha256 || ""))
    || fingerprint !== String(expected.encryptionPublicKeySha256).toLowerCase()
  ) throw new Error("clinic runner identity or policy-pinned custody differs");
  const report = {
    schemaVersion: 1,
    domain: "skincos/ponto/clinic-runner-attestation/v1",
    target,
    runnerId: String(expected.runnerId),
    runnerName,
    runnerOs,
    runnerArch,
    runnerIsolationRef: isolationRef,
    requiredLabels: expected.requiredLabels,
    networkContextCustodyRef: networkContextRef,
    encryptionPublicKeySha256: fingerprint,
    observedAt: now.toISOString(),
    passed: true,
    piiIncluded: false,
    credentialsIncluded: false,
  };
  const reportFile = String(env.PONTO_CLINIC_RUNNER_ATTESTATION_REPORT || "").trim();
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  throw new Error(
    "Direct clinic runner attestation is disabled; the JIT consumer must supply the decrypt key in memory.",
  );
}
