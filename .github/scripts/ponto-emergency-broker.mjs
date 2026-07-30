import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EMERGENCY_BROKER_CONTRACT_ID = "skincos/ponto/emergency-close/v1";
const POLICY_FILE = new URL("../governance/progressive-release-policy.json", import.meta.url);
const ALLOWED_OPERATIONS = Object.freeze(["latch-true", "maintenance"]);
const DENIED_OPERATIONS = Object.freeze([
  "active",
  "arbitrary-kv-write",
  "canary",
  "delete",
  "disabled",
  "latch-false",
]);
const RUN_ID = /^[1-9][0-9]*$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_RESPONSE_AGE_MS = 5 * 60_000;

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const exactArray = (actual, expected) =>
  Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const loadBrokerPolicy = (target) => {
  const policy = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
  return policy?.emergencyBrokers?.[target];
};

const exactBrokerUrl = (raw) => {
  const literal = String(raw || "").trim();
  const url = new URL(literal);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname === "/"
    || url.toString() !== literal
  ) throw new Error("emergency close broker URL is invalid");
  return url;
};

const configuration = (env, brokerPolicy) => {
  const credential = required(env, "PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL");
  const target = required(env, "PONTO_EMERGENCY_TARGET").toLowerCase();
  const custodyRef = required(env, "PONTO_EMERGENCY_CLOSE_CUSTODY_REF");
  const url = exactBrokerUrl(required(env, "PONTO_EMERGENCY_CLOSE_BROKER_URL"));
  const identity = brokerPolicy || loadBrokerPolicy(target);
  const pinnedUrl = String(identity?.url || "").trim();
  const pinnedCustodyRef = String(identity?.custodyRef || "").trim();
  const responseKeyId = String(identity?.responseKeyId || "").trim();
  const responsePublicKeyPem = String(identity?.responsePublicKeyPem || "").trim();
  if (
    credential.length < 32
    || !["staging", "production"].includes(target)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,159}$/.test(custodyRef)
    || !pinnedUrl
    || !pinnedCustodyRef
    || !KEY_ID.test(responseKeyId)
    || !responsePublicKeyPem
  ) throw new Error("versioned emergency close broker identity is absent or invalid");
  const expectedUrl = exactBrokerUrl(pinnedUrl);
  if (url.toString() !== expectedUrl.toString() || custodyRef !== pinnedCustodyRef) {
    throw new Error("emergency close broker differs from the reviewed target identity");
  }
  let responsePublicKey;
  try {
    responsePublicKey = createPublicKey(responsePublicKeyPem);
  } catch {
    throw new Error("emergency close broker response public key is invalid");
  }
  if (responsePublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("emergency close broker response key must be Ed25519");
  }
  return {
    credential,
    target,
    custodyRef,
    url,
    responseKeyId,
    responsePublicKey,
  };
};

const validateContract = (contract, { target, custodyRef }) => {
  if (
    contract?.schemaVersion !== 1
    || contract?.id !== EMERGENCY_BROKER_CONTRACT_ID
    || contract?.mode !== "close-only"
    || contract?.target !== target
    || contract?.custodyRef !== custodyRef
    || !exactArray(contract?.allowedOperations, ALLOWED_OPERATIONS)
    || !exactArray(contract?.deniedOperations, DENIED_OPERATIONS)
  ) throw new Error("emergency close broker contract is invalid");
  return contract;
};

const verifyBrokerAttestation = ({
  payload,
  config,
  requestBinding,
  nowMs,
}) => {
  const attestation = payload?.brokerAttestation;
  const signature = String(attestation?.signature || "");
  const issuedAtMs = Date.parse(String(attestation?.issuedAt || ""));
  const requestedAtMs = Date.parse(requestBinding.requestedAt);
  const unsigned = {
    schemaVersion: attestation?.schemaVersion,
    contractId: attestation?.contractId,
    keyId: attestation?.keyId,
    issuedAt: attestation?.issuedAt,
    requestBinding: attestation?.requestBinding,
    responseDigest: attestation?.responseDigest,
  };
  const unsignedPayload = { ...payload };
  delete unsignedPayload.brokerAttestation;
  if (
    attestation?.schemaVersion !== 1
    || attestation?.contractId !== EMERGENCY_BROKER_CONTRACT_ID
    || attestation?.keyId !== config.responseKeyId
    || canonicalJson(attestation?.requestBinding) !== canonicalJson(requestBinding)
    || attestation?.responseDigest !== sha256(canonicalJson(unsignedPayload))
    || !Number.isFinite(issuedAtMs)
    || issuedAtMs < requestedAtMs - MAX_CLOCK_SKEW_MS
    || issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || nowMs - issuedAtMs > MAX_RESPONSE_AGE_MS
    || !BASE64URL.test(signature)
    || !verifySignature(
      null,
      Buffer.from(canonicalJson(unsigned)),
      config.responsePublicKey,
      Buffer.from(signature, "base64url"),
    )
  ) throw new Error("emergency close broker response identity is invalid");
};

const brokerRequest = async ({
  env,
  fetchImpl,
  method,
  body,
  brokerPolicy,
  now = () => Date.now(),
  nonceFactory = () => randomBytes(32).toString("base64url"),
}) => {
  const config = configuration(env, brokerPolicy);
  const requestNowMs = Number(now());
  const requestNonce = String(nonceFactory() || "");
  if (
    !Number.isFinite(requestNowMs)
    || !BASE64URL.test(requestNonce)
    || requestNonce.length < 32
  ) throw new Error("emergency close broker request freshness is invalid");
  const requestedAt = new Date(requestNowMs).toISOString();
  const requestPayload = body ? { ...body, requestNonce, requestedAt } : null;
  const bodyText = requestPayload ? canonicalJson(requestPayload) : "";
  const requestBinding = {
    schemaVersion: 1,
    contractId: EMERGENCY_BROKER_CONTRACT_ID,
    method,
    url: config.url.toString(),
    target: config.target,
    custodyRef: config.custodyRef,
    responseKeyId: config.responseKeyId,
    requestNonce,
    requestedAt,
    requestDigest: sha256(bodyText),
  };
  const requestSignature = createHmac("sha256", config.credential)
    .update(canonicalJson(requestBinding))
    .digest("base64url");
  const response = await fetchImpl(config.url.toString(), {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.credential}`,
      "content-type": "application/json",
      "x-skincos-emergency-contract": EMERGENCY_BROKER_CONTRACT_ID,
      "x-skincos-emergency-custody-ref": config.custodyRef,
      "x-skincos-emergency-request-digest": requestBinding.requestDigest,
      "x-skincos-emergency-request-nonce": requestNonce,
      "x-skincos-emergency-request-signature": requestSignature,
      "x-skincos-emergency-requested-at": requestedAt,
      "x-skincos-emergency-response-key-id": config.responseKeyId,
      "x-skincos-emergency-target": config.target,
    },
    ...(requestPayload ? { body: bodyText } : {}),
  });
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, "utf8") > 256 * 1024) {
    throw new Error("emergency close broker response exceeds the size limit");
  }
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }
  if (response.status !== 200) {
    throw new Error(`emergency close broker ${method} failed with HTTP ${response.status}`);
  }
  verifyBrokerAttestation({
    payload,
    config,
    requestBinding,
    nowMs: Number(now()),
  });
  if (payload?.passed !== true) {
    throw new Error(`emergency close broker ${method} did not pass`);
  }
  validateContract(payload.contract, config);
  if (payload?.credentialsIncluded !== false || payload?.piiIncluded !== false) {
    throw new Error("emergency close broker privacy attestation is invalid");
  }
  return { config, payload };
};

export async function attestEmergencyBroker({
  env = process.env,
  fetchImpl = fetch,
  brokerPolicy,
  now,
  nonceFactory,
} = {}) {
  const { config, payload } = await brokerRequest({
    env,
    fetchImpl,
    method: "GET",
    brokerPolicy,
    now,
    nonceFactory,
  });
  if (payload.operation != null || payload.latch != null || payload.control != null) {
    throw new Error("emergency close broker contract probe returned mutation state");
  }
  return {
    schemaVersion: 1,
    contractId: EMERGENCY_BROKER_CONTRACT_ID,
    mode: "close-only",
    target: config.target,
    custodyRef: config.custodyRef,
    responseKeyId: config.responseKeyId,
    allowedOperations: [...ALLOWED_OPERATIONS],
    deniedOperations: [...DENIED_OPERATIONS],
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

export async function requestEmergencyClose({
  operation,
  coordinatorRunId,
  emergencyRunId,
  env = process.env,
  fetchImpl = fetch,
  brokerPolicy,
  now,
  nonceFactory,
} = {}) {
  if (
    !ALLOWED_OPERATIONS.includes(operation)
    || !RUN_ID.test(coordinatorRunId)
    || !RUN_ID.test(emergencyRunId)
  ) throw new Error("emergency close broker request is invalid");
  const { config, payload } = await brokerRequest({
    env,
    fetchImpl,
    method: "POST",
    body: {
      schemaVersion: 1,
      operation,
      target: String(env.PONTO_EMERGENCY_TARGET || "").trim().toLowerCase(),
      coordinatorRunId,
      emergencyRunId,
    },
    brokerPolicy,
    now,
    nonceFactory,
  });
  const latch = payload.latch;
  if (
    payload.operation !== operation
    || payload.target !== config.target
    || payload.coordinatorRunId !== coordinatorRunId
    || payload.emergencyRunId !== emergencyRunId
    || latch?.schemaVersion !== 1
    || latch?.module !== "timekeeping"
    || latch?.target !== config.target
    || latch?.latched !== true
    || latch?.stopRunId !== coordinatorRunId
    || latch?.emergencyRunId !== emergencyRunId
    || !Number.isFinite(Date.parse(String(latch?.changedAt || "")))
    || !Array.isArray(payload.observations)
    || payload.observations.length < 3
    || payload.observations.some((item) => item?.passed !== true)
  ) throw new Error("emergency close broker response is not exact and target-bound");
  if (
    operation === "maintenance"
    && (
      payload.control?.schemaVersion !== 2
      || payload.control?.state !== "maintenance"
      || !Number.isFinite(Date.parse(String(payload.control?.changedAt || "")))
      || payload.control?.emergencyLatchRef?.stopRunId !== coordinatorRunId
      || payload.control?.emergencyLatchRef?.emergencyRunId !== emergencyRunId
      || payload.control?.emergencyLatchRef?.latchChangedAt !== latch.changedAt
    )
  ) throw new Error("emergency maintenance broker response differs");
  if (operation === "latch-true" && payload.control != null) {
    throw new Error("latch-only broker response contains an unauthorized control mutation");
  }
  return { config, payload };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const [command, reportFile] = process.argv.slice(2);
  if (command !== "attest" || !reportFile) {
    throw new Error("usage: ponto-emergency-broker.mjs attest <report.json>");
  }
  const report = await attestEmergencyBroker();
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Emergency close-only broker contract attested for ${report.target}.\n`);
}
