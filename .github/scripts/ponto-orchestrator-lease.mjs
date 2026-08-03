import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const repositoryId = String(process.env.GITHUB_REPOSITORY_ID || "").trim();
const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();
const capabilityPublicKeysJson = String(
  process.env.PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON || "",
);
const UUIDISH_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const GOVERNED_STAGES = ["staging", "pilot", "canary", "production", "rollback"];
const DOMAIN = "skincos/ponto/orchestrator-capability/v6";
const CLAIM_FIELDS = [
  "schemaVersion", "domain", "repositoryId", "repository",
  "parentWorkflowId", "parentWorkflowPath", "parentRunId", "parentRunAttempt",
  "issuerWorkflowId", "issuerWorkflowPath", "issuerRunId", "issuerRunAttempt",
  "childWorkflowId", "childWorkflowPath", "childRunId", "childRunAttempt",
  "leaseKey", "stage", "target", "releaseSha", "dispatchNonce", "intentDigest",
  "keyId", "issuedAt", "expiresAt",
  "singleUse",
];
const DISPATCH_NONCE = /^[0-9a-f]{32}$/;
const INTENT_DIGEST = /^[0-9a-f]{64}$/;

const stringField = (defaultValue = "") => ({ type: "string", defaultValue });
const booleanField = (defaultValue = false) => ({ type: "boolean", defaultValue });
const integerField = (defaultValue) => ({ type: "integer", defaultValue });
const chainFields = {
  orchestrator_run_id: stringField(),
  orchestrator_stage: stringField(),
  orchestrator_issuer_run_id: stringField(),
  orchestrator_nonce: stringField(),
};
const GOVERNED_INTENT_SCHEMAS = {
  ".github/workflows/deploy-timekeeping.yml": {
    target: stringField("staging"),
    release_sha: stringField(),
    preview_run_id: stringField(),
    staging_run_id: stringField(),
    release_scope: stringField("ponto"),
    predecessor_run_id: stringField(),
    baseline_run_id: stringField(),
    root_custody_run_id: stringField(),
    rollback_from_stage: stringField("production"),
    ...chainFields,
  },
  ".github/workflows/deploy-core-workers.yml": {
    target: stringField("staging"),
    unit: stringField("all"),
    bootstrap_finance_context: booleanField(false),
    release_sha: stringField(),
    preview_run_id: stringField(),
    staging_run_id: stringField(),
    release_scope: stringField("general"),
    predecessor_run_id: stringField(),
    baseline_run_id: stringField(),
    rollback_from_stage: stringField("production"),
    timekeeping_candidate_version_id: stringField(),
    timekeeping_version_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/deploy-crm-pages.yml": {
    target: stringField("staging"),
    release_sha: stringField(),
    preview_run_id: stringField(),
    staging_run_id: stringField(),
    release_scope: stringField("general"),
    predecessor_run_id: stringField(),
    baseline_run_id: stringField(),
    rollback_from_stage: stringField("production"),
    core_candidate_version_id: stringField(),
    identity_candidate_version_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml": {
    target: stringField("staging"),
    release_sha: stringField(),
    staging_run_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/cloudflare-pages-sync-ponto.yml": {
    target: stringField("staging"),
    release_sha: stringField(),
    staging_run_id: stringField(),
    root_custody_run_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/module-availability.yml": {
    module: stringField(),
    target: stringField(),
    state: stringField(),
    message: stringField(),
    release_sha: stringField(),
    timekeeping_candidate_version_id: stringField(),
    timekeeping_incumbent_version_id: stringField(),
    core_candidate_version_id: stringField(),
    core_incumbent_version_id: stringField(),
    identity_candidate_version_id: stringField(),
    identity_incumbent_version_id: stringField(),
    rollout_stage: stringField("pilot"),
    worker_percentage: integerField(0),
    cohort_percentage: integerField(100),
    expires_at: stringField(),
    synthetic_only: booleanField(false),
    orchestrator_release_sha: stringField(),
    orchestrator_lease_key: stringField("module-open"),
    ...chainFields,
  },
  ".github/workflows/ponto-production-baseline.yml": {
    release_sha: stringField(),
    staging_run_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/ponto-production-slo.yml": {
    stage: stringField(),
    release_sha: stringField(),
    core_version_id: stringField(),
    timekeeping_version_id: stringField(),
    identity_version_id: stringField(),
    pages_deployment_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/timekeeping-staging-journey.yml": {
    release_sha: stringField(),
    timekeeping_staging_run_id: stringField(),
    core_api_staging_run_id: stringField(),
    identity_staging_run_id: stringField(),
    crm_pages_staging_run_id: stringField(),
    pages_url: stringField(),
    timekeeping_version_id: stringField(),
    identity_version_id: stringField(),
    ...chainFields,
  },
  ".github/workflows/ponto-staging-rollback-drill.yml": {
    release_sha: stringField(),
    staging_journey_run_id: stringField(),
    timekeeping_candidate_version_id: stringField(),
    timekeeping_incumbent_version_id: stringField(),
    core_candidate_version_id: stringField(),
    core_incumbent_version_id: stringField(),
    identity_candidate_version_id: stringField(),
    identity_incumbent_version_id: stringField(),
    pages_candidate_deployment_id: stringField(),
    pages_incumbent_deployment_id: stringField(),
    ...chainFields,
  },
};

const KEY_ID = /^[a-z][a-z0-9._-]{2,63}$/;
const TARGETS = ["staging", "production"];
const ED25519_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export function acceptsWorkflowRunPath(workflowPath, observedPath) {
  const canonicalPath = String(workflowPath || "").trim();
  const livePath = String(observedPath || "").trim();
  return [canonicalPath, `${canonicalPath}@refs/heads/main`].includes(livePath);
}

const canonicalClaims = claims => CLAIM_FIELDS.map((field) => {
  const name = Buffer.from(field, "utf8");
  const value = Buffer.from(String(claims?.[field] ?? ""), "utf8");
  return `${name.length}:${field}${value.length}:${value.toString("utf8")}`;
}).join("");

const normalizeIntentValue = (name, definition, rawValue) => {
  const value = rawValue === undefined || rawValue === null
    ? definition.defaultValue
    : rawValue;
  if (definition.type === "string") {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`Ponto intent input ${name} is not a scalar string`);
    }
    const normalized = String(value);
    if (/[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error(`Ponto intent input ${name} contains control characters`);
    }
    return normalized;
  }
  if (definition.type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new Error(`Ponto intent input ${name} is not a canonical boolean`);
  }
  if (definition.type === "integer") {
    const text = String(value);
    if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(Number(text))) {
      throw new Error(`Ponto intent input ${name} is not a canonical non-negative integer`);
    }
    return Number(text);
  }
  throw new Error(`Ponto intent schema for ${name} is invalid`);
};

const canonicalIntentBytes = (workflowPath, typedEntries) => {
  const components = [
    ["schemaVersion", "integer", 1],
    ["workflowPath", "string", workflowPath],
    ...typedEntries.map(({ name, type, value }) => [name, type, value]),
  ];
  return components.map(([name, type, rawValue]) => {
    const value = typeof rawValue === "boolean"
      ? (rawValue ? "true" : "false")
      : String(rawValue);
    return [name, type, value].map((part) => {
      const bytes = Buffer.from(part, "utf8");
      return `${bytes.length}:${part}`;
    }).join("");
  }).join("");
};

export function canonicalizeGovernedIntent(workflowPath, rawInputs) {
  const schema = GOVERNED_INTENT_SCHEMAS[workflowPath];
  if (!schema || !rawInputs || typeof rawInputs !== "object" || Array.isArray(rawInputs)) {
    throw new Error("Ponto governed workflow intent is unsupported");
  }
  const unknown = Object.keys(rawInputs).filter(name => !Object.hasOwn(schema, name));
  if (unknown.length) {
    throw new Error(`Ponto governed workflow intent has unknown inputs: ${unknown.sort().join(",")}`);
  }
  const typedEntries = Object.entries(schema)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, definition]) => ({
      name,
      type: definition.type,
      value: normalizeIntentValue(name, definition, rawInputs[name]),
    }));
  const normalizedInputs = Object.fromEntries(typedEntries.map(({ name, value }) => [name, value]));
  const digest = crypto.createHash("sha256")
    .update(canonicalIntentBytes(workflowPath, typedEntries))
    .digest("hex");
  return { digest, normalizedInputs, typedEntries };
}

export function expectedGovernedRunName(workflowPath, inputs) {
  const value = (name) => String(inputs[name] ?? "");
  const suffix = `orchestrator=${value("orchestrator_run_id")} nonce=${value("orchestrator_nonce")}`;
  const names = {
    ".github/workflows/deploy-timekeeping.yml":
      `Timekeeping ${value("target")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/deploy-core-workers.yml":
      `Core ${value("unit")} ${value("target")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/deploy-crm-pages.yml":
      `CRM Pages ${value("target")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml":
      `Attest Ponto Workers ${value("target")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/cloudflare-pages-sync-ponto.yml":
      `Attest CRM Pages ${value("target")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/module-availability.yml":
      `Module ${value("module")} ${value("target")} ${value("state")} ${suffix}`,
    ".github/workflows/ponto-production-baseline.yml":
      `Ponto baseline ${value("release_sha")} staging=${value("staging_run_id")} ${suffix}`,
    ".github/workflows/ponto-production-slo.yml":
      `Ponto SLO ${value("stage")} ${value("release_sha")} ${suffix}`,
    ".github/workflows/timekeeping-staging-journey.yml":
      `Timekeeping staging journey ${value("release_sha")} ${suffix}`,
    ".github/workflows/ponto-staging-rollback-drill.yml":
      `Ponto staging rollback drill ${value("release_sha")} ${suffix}`,
  };
  const result = names[workflowPath];
  if (!result || !DISPATCH_NONCE.test(value("orchestrator_nonce"))) {
    throw new Error("Ponto governed run name cannot be derived");
  }
  return result;
}

const importEd25519PrivateKey = value => {
  try {
    const key = crypto.createPrivateKey(String(value || ""));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Ponto capability Ed25519 private signing custody is invalid");
  }
};

const importEd25519PublicKey = value => {
  try {
    const key = crypto.createPublicKey(String(value || ""));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Ponto capability Ed25519 public verification custody is invalid");
  }
};

const signatureFor = (claims, privateKey) => crypto
  .sign(null, Buffer.from(canonicalClaims(claims), "utf8"), importEd25519PrivateKey(privateKey))
  .toString("base64url");

const verifySignature = (claims, signature, publicKey) => {
  if (!ED25519_SIGNATURE.test(String(signature || ""))) return false;
  return crypto.verify(
    null,
    Buffer.from(canonicalClaims(claims), "utf8"),
    importEd25519PublicKey(publicKey),
    Buffer.from(signature, "base64url"),
  );
};

export function resolveCapabilityVerifier(publicKeysJson, target) {
  let map;
  try {
    map = JSON.parse(String(publicKeysJson || ""));
  } catch {
    throw new Error("Ponto capability public verifier map is malformed");
  }
  if (
    !map
    || typeof map !== "object"
    || Array.isArray(map)
    || Object.keys(map).sort().join(",") !== "production,staging"
    || !TARGETS.includes(String(target))
  ) throw new Error("Ponto capability public verifier map is not target-bound");
  for (const name of TARGETS) {
    const candidate = map[name];
    if (
      !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
      || Object.keys(candidate).sort().join(",") !== "keyId,publicKeyPem"
      || !KEY_ID.test(String(candidate.keyId || ""))
      || !String(candidate.publicKeyPem || "")
    ) throw new Error("Ponto capability target verifier is invalid");
    importEd25519PublicKey(candidate.publicKeyPem);
  }
  if (
    map.staging.keyId === map.production.keyId
    || String(map.staging.publicKeyPem || "") === String(map.production.publicKeyPem || "")
  ) throw new Error("Ponto staging and production capability verifiers are not independent");
  const entry = map[target];
  return {
    keyId: String(entry.keyId),
    publicKey: String(entry.publicKeyPem),
  };
}

export const capabilityCheckName = (leaseKey, childRunId, dispatchNonce) =>
  `ponto-lease/${leaseKey}/${childRunId}/${dispatchNonce}`;

export const capabilityExternalId = (
  parentRunId,
  issuerRunId,
  childRunId,
  leaseKey,
  dispatchNonce,
  intentDigest,
) => `${DOMAIN}/${parentRunId}/${issuerRunId}/${childRunId}/${leaseKey}/${dispatchNonce}/${intentDigest}`;

export function createCapabilityCheck({
  privateKey,
  keyId,
  repositoryId: repositoryNumericId,
  repository: repositoryName,
  parentWorkflowId,
  parentWorkflowPath,
  parentRunId,
  issuerWorkflowId,
  issuerWorkflowPath,
  issuerRunId,
  childWorkflowId,
  childRunId,
  leaseKey,
  stage,
  target,
  releaseSha,
  childWorkflowPath,
  dispatchNonce,
  intentDigest,
  issuedAt = new Date(),
}) {
  const issued = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (
    !/^[1-9][0-9]*$/.test(String(parentRunId))
    || !/^[1-9][0-9]*$/.test(String(repositoryNumericId))
    || !Number.isInteger(Number(parentWorkflowId))
    || !/^\.github\/workflows\/ponto-progressive-release\.yml$/.test(String(parentWorkflowPath))
    || !Number.isInteger(Number(issuerWorkflowId))
    || !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(String(issuerWorkflowPath))
    || !/^[1-9][0-9]*$/.test(String(issuerRunId))
    || !Number.isInteger(Number(childWorkflowId))
    || !/^[1-9][0-9]*$/.test(String(childRunId))
    || !UUIDISH_KEY.test(String(leaseKey))
    || !GOVERNED_STAGES.includes(String(stage))
    || !TARGETS.includes(String(target))
    || !KEY_ID.test(String(keyId))
    || !FULL_SHA.test(String(releaseSha))
    || !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(String(childWorkflowPath))
    || !DISPATCH_NONCE.test(String(dispatchNonce))
    || !INTENT_DIGEST.test(String(intentDigest))
    || !Number.isFinite(issued.getTime())
  ) throw new Error("Ponto child capability claims are invalid");
  const claims = {
    schemaVersion: 6,
    domain: DOMAIN,
    repositoryId: String(repositoryNumericId),
    repository: repositoryName,
    parentWorkflowId: Number(parentWorkflowId),
    parentWorkflowPath: String(parentWorkflowPath),
    parentRunId: String(parentRunId),
    parentRunAttempt: 1,
    issuerWorkflowId: Number(issuerWorkflowId),
    issuerWorkflowPath: String(issuerWorkflowPath),
    issuerRunId: String(issuerRunId),
    issuerRunAttempt: 1,
    childWorkflowId: Number(childWorkflowId),
    childWorkflowPath: String(childWorkflowPath),
    childRunId: String(childRunId),
    childRunAttempt: 1,
    leaseKey: String(leaseKey),
    stage: String(stage),
    target: String(target),
    releaseSha: String(releaseSha),
    dispatchNonce: String(dispatchNonce),
    intentDigest: String(intentDigest),
    keyId: String(keyId),
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    singleUse: true,
  };
  const document = {
    claims,
    signature: {
      algorithm: "Ed25519",
      keyId: String(keyId),
      valueBase64url: signatureFor(claims, privateKey),
    },
    transition: {
      state: "issued",
      transitionedAt: "",
    },
  };
  return {
    name: capabilityCheckName(leaseKey, childRunId, dispatchNonce),
    head_sha: releaseSha,
    status: "in_progress",
    external_id: capabilityExternalId(
      parentRunId,
      issuerRunId,
      childRunId,
      leaseKey,
      dispatchNonce,
      intentDigest,
    ),
    output: {
      title: "Ponto single-use child capability issued",
      summary: JSON.stringify(document),
    },
  };
}

export function verifyCapabilityDocument(document, {
  publicKey,
  keyId,
  repositoryId: repositoryNumericId,
  repository: repositoryName,
  parentWorkflowId,
  parentWorkflowPath,
  parentRunId,
  issuerWorkflowId,
  issuerWorkflowPath,
  issuerRunId,
  childWorkflowId,
  childRunId,
  leaseKey,
  stage,
  target,
  releaseSha,
  childWorkflowPath,
  dispatchNonce,
  intentDigest,
  state = "issued",
  now = new Date(),
  allowExpired = false,
}) {
  const claims = document?.claims;
  const transition = document?.transition;
  const current = now instanceof Date ? now : new Date(now);
  if (
    claims?.schemaVersion !== 6
    || claims.domain !== DOMAIN
    || claims.repositoryId !== String(repositoryNumericId)
    || claims.repository !== repositoryName
    || claims.parentWorkflowId !== Number(parentWorkflowId)
    || claims.parentWorkflowPath !== parentWorkflowPath
    || claims.parentRunId !== String(parentRunId)
    || claims.parentRunAttempt !== 1
    || claims.issuerWorkflowId !== Number(issuerWorkflowId)
    || claims.issuerWorkflowPath !== issuerWorkflowPath
    || claims.issuerRunId !== String(issuerRunId)
    || claims.issuerRunAttempt !== 1
    || claims.childWorkflowId !== Number(childWorkflowId)
    || claims.childRunId !== String(childRunId)
    || claims.childRunAttempt !== 1
    || claims.leaseKey !== leaseKey
    || claims.stage !== stage
    || claims.target !== target
    || claims.releaseSha !== releaseSha
    || claims.childWorkflowPath !== childWorkflowPath
    || claims.dispatchNonce !== dispatchNonce
    || claims.intentDigest !== intentDigest
    || claims.keyId !== keyId
    || document?.signature?.algorithm !== "Ed25519"
    || document?.signature?.keyId !== keyId
    || transition?.state !== state
    || (state === "issued" ? transition.transitionedAt !== "" : !Number.isFinite(Date.parse(String(transition?.transitionedAt || ""))))
    || claims.singleUse !== true
    || !Number.isFinite(Date.parse(String(claims.issuedAt || "")))
    || Date.parse(String(claims.issuedAt || "")) > current.getTime()
    || (
      !allowExpired
      && Date.parse(String(claims.expiresAt || "")) <= current.getTime()
    )
    || !Number.isFinite(Date.parse(String(claims.expiresAt || "")))
    || Date.parse(String(claims.expiresAt || "")) <= Date.parse(String(claims.issuedAt || ""))
    || !verifySignature(claims, document?.signature?.valueBase64url, publicKey)
  ) throw new Error("Ponto child capability claims or Ed25519 signature differ");
  return claims;
}

export function transitionCapabilityDocument(document, {
  state,
  transitionedAt = new Date(),
}) {
  if (!["consumed", "invalidated"].includes(state)) throw new Error("Ponto capability transition is invalid");
  const at = transitionedAt instanceof Date ? transitionedAt : new Date(transitionedAt);
  if (!Number.isFinite(at.getTime())) throw new Error("Ponto capability transition time is invalid");
  return {
    claims: { ...document.claims },
    signature: { ...document.signature },
    transition: {
      state,
      transitionedAt: at.toISOString(),
    },
  };
}

const TRANSIENT_READ_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_READ_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const MAX_TRANSIENT_READ_RETRY_DELAY_MS = 30_000;
const MAX_CANONICAL_SNAPSHOT_REFRESHES = 2;

const parseRetryAfterMs = (value, now = Date.now()) => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.ceil(Number(raw) * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
};

const request = async (pathname, init = {}, { onRetry } = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.headers || {}),
      },
    });
    if (response.ok) {
      if (response.status === 202 || response.status === 204) return null;
      return response.json();
    }
    const retryAfterDelay = response.status === 429 || response.status === 403
      ? parseRetryAfterMs(response.headers.get("retry-after"))
      : undefined;
    const retryableReadStatus = TRANSIENT_READ_STATUSES.has(response.status)
      || (response.status === 403 && retryAfterDelay !== undefined);
    if (canRetry && retryableReadStatus && attempt >= TRANSIENT_READ_RETRY_DELAYS_MS.length) {
      throw new Error(
        `GitHub API ${method} ${pathname} returned ${response.status} after bounded transient read retries`,
      );
    }
    const retryDelay = canRetry && retryableReadStatus
      ? retryAfterDelay ?? TRANSIENT_READ_RETRY_DELAYS_MS[attempt]
      : undefined;
    if (retryDelay === undefined) {
      throw new Error(`GitHub API ${method} ${pathname} returned ${response.status}`);
    }
    if (retryDelay > MAX_TRANSIENT_READ_RETRY_DELAY_MS) {
      throw new Error(
        `GitHub API ${method} ${pathname} returned ${response.status} with Retry-After beyond the bounded retry window`,
      );
    }
    onRetry?.({ method, pathname, status: response.status, retryDelay });
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
};

const assertFirstAttempt = () => {
  if (runAttempt !== "1") {
    throw new Error("governed Ponto capabilities refuse workflow reruns");
  }
};

const canonicalOrchestrator = async ({ orchestratorRunId, releaseSha, stage, currentHeadSha }) => {
  for (let refresh = 0; ; refresh += 1) {
    let snapshotWasRetried = false;
    const markSnapshotRetry = () => {
      snapshotWasRetried = true;
    };
    const [workflow, run] = await Promise.all([
      request(
        `/repos/${repository}/actions/workflows/ponto-progressive-release.yml`,
        {},
        { onRetry: markSnapshotRetry },
      ),
      request(
        `/repos/${repository}/actions/runs/${orchestratorRunId}`,
        {},
        { onRetry: markSnapshotRetry },
      ),
    ]);
    if (snapshotWasRetried) {
      if (refresh >= MAX_CANONICAL_SNAPSHOT_REFRESHES) {
        throw new Error("canonical orchestrator snapshot remained transient after bounded refreshes");
      }
      continue;
    }
    if (
      workflow?.state !== "active"
      || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
      || String(run?.id || "") !== orchestratorRunId
      || run?.workflow_id !== workflow.id
      || !acceptsWorkflowRunPath(workflow.path, run?.path)
      || run?.run_attempt !== 1
      || run?.status !== "in_progress"
      || run?.conclusion != null
      || run?.event !== "workflow_dispatch"
      || run?.head_branch !== "main"
      || run?.head_sha !== currentHeadSha
      || run?.head_sha !== releaseSha
      || run?.name !== `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`
      || run?.repository?.full_name !== repository
      || String(run?.repository?.id || "") !== repositoryId
      || run?.head_repository?.full_name !== repository
      || run?.display_title !== `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`
    ) {
      throw new Error("canonical orchestrator run is not the exact active first-attempt issuer");
    }
    return { workflow, run };
  }
};

const delegatedIssuerSnapshot = async ({ issuerRunId }) => {
  for (let refresh = 0; ; refresh += 1) {
    let snapshotWasRetried = false;
    const markSnapshotRetry = () => {
      snapshotWasRetried = true;
    };
    const issuer = await request(
      `/repos/${repository}/actions/runs/${issuerRunId}`,
      {},
      { onRetry: markSnapshotRetry },
    );
    const issuerWorkflow = await request(
      `/repos/${repository}/actions/workflows/${issuer?.workflow_id}`,
      {},
      { onRetry: markSnapshotRetry },
    );
    if (snapshotWasRetried) {
      if (refresh >= MAX_CANONICAL_SNAPSHOT_REFRESHES) {
        throw new Error("delegated issuer snapshot remained transient after bounded refreshes");
      }
      continue;
    }
    return { issuer, issuerWorkflow };
  }
};

async function consumeCheck([leaseKey, stage, target, releaseShaRaw, orchestratorRunId]) {
  const releaseSha = String(releaseShaRaw || "").trim().toLowerCase();
  const currentHeadSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
  const childRunId = String(process.env.GITHUB_RUN_ID || "").trim();
  const eventPath = String(process.env.GITHUB_EVENT_PATH || "").trim();
  assertFirstAttempt();
  if (
    !UUIDISH_KEY.test(leaseKey || "")
    || !GOVERNED_STAGES.includes(stage || "")
    || !TARGETS.includes(target || "")
    || !FULL_SHA.test(releaseSha)
    || currentHeadSha !== releaseSha
    || !/^[1-9][0-9]*$/.test(orchestratorRunId || "")
    || !/^[1-9][0-9]*$/.test(childRunId)
    || !token
    || !repository.includes("/")
    || !/^[1-9][0-9]*$/.test(repositoryId)
    || !capabilityPublicKeysJson
    || !eventPath
  ) throw new Error("invalid Ponto check capability consume request");
  const verifier = resolveCapabilityVerifier(capabilityPublicKeysJson, target);

  const parent = await canonicalOrchestrator({ orchestratorRunId, releaseSha, stage, currentHeadSha });
  const child = await request(`/repos/${repository}/actions/runs/${childRunId}`);
  const childWorkflowPath = String(child?.path || "").split("@")[0];
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const { digest: intentDigest, normalizedInputs } = canonicalizeGovernedIntent(
    childWorkflowPath,
    event?.inputs,
  );
  const dispatchNonce = String(normalizedInputs.orchestrator_nonce || "");
  const issuerRunId = String(normalizedInputs.orchestrator_issuer_run_id || "");
  const expectedDisplayTitle = expectedGovernedRunName(childWorkflowPath, normalizedInputs);
  const intentReleaseSha = childWorkflowPath === ".github/workflows/module-availability.yml"
    ? String(normalizedInputs.orchestrator_release_sha || normalizedInputs.release_sha)
    : String(normalizedInputs.release_sha);
  if (
    String(child?.id || "") !== childRunId
    || child?.run_attempt !== 1
    || !acceptsWorkflowRunPath(childWorkflowPath, child?.path)
    || child?.status !== "in_progress"
    || child?.conclusion != null
    || child?.event !== "workflow_dispatch"
    || child?.head_branch !== "main"
    || child?.head_sha !== releaseSha
    || child?.repository?.full_name !== repository
    || String(child?.repository?.id || "") !== repositoryId
    || child?.head_repository?.full_name !== repository
    || String(child?.head_repository?.id || "") !== repositoryId
    || child?.display_title !== expectedDisplayTitle
    || normalizedInputs.orchestrator_run_id !== orchestratorRunId
    || normalizedInputs.orchestrator_stage !== stage
    || intentReleaseSha !== releaseSha
    || !DISPATCH_NONCE.test(dispatchNonce)
    || !/^[1-9][0-9]*$/.test(issuerRunId)
    || String(event?.repository?.id || "") !== repositoryId
    || event?.repository?.full_name !== repository
    || !["main", "refs/heads/main"].includes(String(event?.ref || ""))
  ) throw new Error("current child run is not the exact active first-attempt capability subject");

  const issuerSnapshot = issuerRunId === orchestratorRunId
    ? parent
    : await delegatedIssuerSnapshot({ issuerRunId });
  const { issuer, issuerWorkflow } = issuerSnapshot;
  const issuerWorkflowPath = String(issuer?.path || "").split("@")[0];
  const delegatedIssuer = issuerRunId !== orchestratorRunId;
  if (
    String(issuer?.id || "") !== issuerRunId
    || issuer?.workflow_id !== issuerWorkflow?.id
    || issuerWorkflow?.state !== "active"
    || issuerWorkflow?.path !== issuerWorkflowPath
    || !acceptsWorkflowRunPath(issuerWorkflowPath, issuer?.path)
    || issuer?.run_attempt !== 1
    || issuer?.status !== "in_progress"
    || issuer?.conclusion != null
    || issuer?.event !== "workflow_dispatch"
    || issuer?.head_branch !== "main"
    || issuer?.head_sha !== releaseSha
    || issuer?.repository?.full_name !== repository
    || String(issuer?.repository?.id || "") !== repositoryId
    || issuer?.head_repository?.full_name !== repository
    || String(issuer?.head_repository?.id || "") !== repositoryId
    || (delegatedIssuer && (
      issuerWorkflowPath !== ".github/workflows/ponto-staging-rollback-drill.yml"
      || childWorkflowPath !== ".github/workflows/module-availability.yml"
      || !["rollback-incumbent-open", "rollback-candidate-open"].includes(leaseKey)
      || stage !== "staging"
      || !String(issuer?.display_title || "").includes(`orchestrator=${orchestratorRunId} nonce=`)
    ))
    || (!delegatedIssuer && issuerWorkflowPath !== parent.workflow.path)
  ) throw new Error("Ponto capability direct issuer or grandchild chain is invalid");

  const checkName = capabilityCheckName(leaseKey, childRunId, dispatchNonce);
  const externalId = capabilityExternalId(
    orchestratorRunId,
    issuerRunId,
    childRunId,
    leaseKey,
    dispatchNonce,
    intentDigest,
  );
  const waitMs = Number(process.env.PONTO_CAPABILITY_WAIT_MS || "600000");
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 900_000) {
    throw new Error("Ponto capability wait is invalid");
  }
  const deadline = Date.now() + waitMs;
  let check;
  do {
    const checks = await request(`/repos/${repository}/commits/${releaseSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`);
    const candidates = (checks?.check_runs || []).filter((candidate) =>
      candidate?.name === checkName
      && candidate?.head_sha === releaseSha
      && candidate?.app?.slug === "github-actions"
      && candidate?.external_id === externalId
      && candidate?.status === "in_progress"
      && candidate?.conclusion == null
      && Number.isInteger(candidate?.id));
    if (candidates.length > 1) throw new Error("Ponto child capability check is ambiguous");
    check = candidates[0];
    if (check || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  } while (true);
  if (!check) throw new Error("Ponto child capability check is absent");

  const document = JSON.parse(String(check?.output?.summary || ""));
  verifyCapabilityDocument(document, {
    publicKey: verifier.publicKey,
    keyId: verifier.keyId,
    repositoryId,
    repository,
    parentWorkflowId: parent.workflow.id,
    parentWorkflowPath: parent.workflow.path,
    parentRunId: orchestratorRunId,
    issuerWorkflowId: issuerWorkflow.id,
    issuerWorkflowPath,
    issuerRunId,
    childWorkflowId: child.workflow_id,
    childRunId,
    leaseKey,
    stage,
    target,
    releaseSha,
    childWorkflowPath,
    dispatchNonce,
    intentDigest,
  });
  const consumedDocument = transitionCapabilityDocument(document, {
    state: "consumed",
  });
  await request(`/repos/${repository}/check-runs/${check.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "completed",
      conclusion: "success",
      output: {
        title: "Ponto single-use child capability consumed",
        summary: JSON.stringify(consumedDocument),
      },
    }),
  });
  // Check-run PATCH is not compare-and-swap. Confirm the current server state;
  // the coordinator/latch/run-attempt checks remain the surrounding fence.
  const consumed = await request(`/repos/${repository}/check-runs/${check.id}`);
  if (
    consumed?.id !== check.id
    || consumed?.conclusion !== "success"
    || consumed?.status !== "completed"
    || consumed?.external_id !== check.external_id
  ) throw new Error("Ponto child capability consumption was not confirmed");
  const consumedDocumentFromServer = JSON.parse(String(consumed?.output?.summary || ""));
  if (
    consumedDocumentFromServer?.signature?.valueBase64url
      !== document?.signature?.valueBase64url
    || canonicalClaims(consumedDocumentFromServer?.claims) !== canonicalClaims(document?.claims)
  ) throw new Error("Ponto child capability consumption rewrote the signed document");
  verifyCapabilityDocument(consumedDocumentFromServer, {
    publicKey: verifier.publicKey,
    keyId: verifier.keyId,
    repositoryId,
    repository,
    parentWorkflowId: parent.workflow.id,
    parentWorkflowPath: parent.workflow.path,
    parentRunId: orchestratorRunId,
    issuerWorkflowId: issuerWorkflow.id,
    issuerWorkflowPath,
    issuerRunId,
    childWorkflowId: child.workflow_id,
    childRunId,
    leaseKey,
    stage,
    target,
    releaseSha,
    childWorkflowPath,
    dispatchNonce,
    intentDigest,
    state: "consumed",
  });
  process.stdout.write(`Consumed child-bound Ponto capability ${checkName}.\n`);
}

async function assertActive([stage, releaseShaRaw, orchestratorRunId]) {
  const releaseSha = String(releaseShaRaw || "").trim().toLowerCase();
  const currentHeadSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
  assertFirstAttempt();
  if (
    !GOVERNED_STAGES.includes(stage || "")
    || !FULL_SHA.test(releaseSha)
    || currentHeadSha !== releaseSha
    || !/^[1-9][0-9]*$/.test(orchestratorRunId || "")
    || !token
    || !repository.includes("/")
    || !/^[1-9][0-9]*$/.test(repositoryId)
  ) throw new Error("invalid active orchestrator assertion request");
  await canonicalOrchestrator({ orchestratorRunId, releaseSha, stage, currentHeadSha });
  process.stdout.write(`Confirmed active first-attempt Ponto coordinator ${orchestratorRunId}.\n`);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "consume-check") await consumeCheck(args);
  else if (command === "assert-active") await assertActive(args);
  else throw new Error("usage: ponto-orchestrator-lease.mjs consume-check|assert-active ...");
}
