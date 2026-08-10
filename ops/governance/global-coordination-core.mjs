const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const OWNER_PROVIDER = new Set(["codex", "github", "cloudflare", "mini-pc", "system"]);
const ACTIVE_STATES = new Set(["held"]);
const TERMINAL_STATES = new Set(["released", "revoked", "expired"]);

export const CONTRACT_ID = "skincos/global-coordination/v1";
export const SCHEMA_VERSION = 1;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number is not canonical");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("undefined is not canonical");
  return serialized;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const requireId = (value, label) => {
  const normalized = text(value);
  if (!SAFE_ID.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
};

export function resourceClass(resource) {
  const normalized = lower(resource);
  if (!normalized || normalized.includes(" ") || normalized.includes("\\")) throw new Error("resource key is invalid");
  const separator = normalized.indexOf(":");
  const kind = separator > 0 ? normalized.slice(0, separator) : "";
  if (!["merge", "release", "deploy", "cloudflare", "promotion", "global"].includes(kind)) {
    throw new Error("resource class is unsupported");
  }
  const parts = normalized.split(":");
  if (kind === "merge" || kind === "release" || kind === "global") {
    if (parts.length !== 2 || !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(parts[1])) throw new Error("resource key is invalid");
    return kind;
  }
  if (parts.length !== 3 || !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(parts[1])) throw new Error("resource key is invalid");
  if (!["preview", "staging", "pilot", "canary", "production", "rollback", "local"].includes(parts[2])) throw new Error("resource environment is invalid");
  return kind;
}

export function normalizeResourceKey(resource) {
  const normalized = lower(resource);
  resourceClass(normalized);
  return normalized;
}

export function lockScopeFor(resource) {
  const normalized = normalizeResourceKey(resource);
  const [kind, name, environment] = normalized.split(":");
  if (kind === "merge") return `repository:${name}`;
  if (kind === "release") return `release:${name}`;
  if (kind === "global") return `global:${name}`;
  if (kind === "deploy" || kind === "cloudflare") return `surface:${name}:${environment}`;
  return `promotion:${name}:${environment}`;
}

export function normalizeOwner(owner) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) throw new Error("lease owner is required");
  const provider = lower(owner.provider);
  if (!OWNER_PROVIDER.has(provider)) throw new Error("lease owner provider is invalid");
  const normalized = {
    provider,
    missionId: requireId(owner.missionId, "lease owner missionId"),
    threadId: requireId(owner.threadId, "lease owner threadId"),
    actor: requireId(owner.actor, "lease owner actor"),
  };
  if (owner.runId !== undefined && owner.runId !== null && text(owner.runId)) normalized.runId = requireId(owner.runId, "lease owner runId");
  return normalized;
}

export function normalizeArtifacts(artifacts = []) {
  if (!Array.isArray(artifacts)) throw new Error("artifact identity must be an array");
  const normalized = artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("artifact identity is invalid");
    const result = {
      name: requireId(artifact.name, "artifact name"),
      id: requireId(artifact.id, "artifact id"),
      digest: lower(artifact.digest),
    };
    if (!DIGEST.test(result.digest)) throw new Error("artifact digest is invalid");
    if (artifact.versionId !== undefined && artifact.versionId !== null && text(artifact.versionId)) result.versionId = requireId(artifact.versionId, "artifact versionId");
    return result;
  }).sort((left, right) => left.name.localeCompare(right.name));
  const names = new Set();
  for (const artifact of normalized) {
    if (names.has(artifact.name)) throw new Error("artifact names must be unique");
    names.add(artifact.name);
  }
  return normalized;
}

export function normalizeReleaseIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("release identity is required");
  const sourceCommit = lower(identity.sourceCommit);
  const sourceTree = lower(identity.sourceTree);
  const dependencyClosureDigest = lower(identity.dependencyClosureDigest);
  if (!FULL_SHA.test(sourceCommit) || !FULL_SHA.test(sourceTree) || !DIGEST.test(dependencyClosureDigest)) throw new Error("release identity is invalid");
  const module = requireId(identity.module, "release identity module").toLowerCase();
  const artifacts = normalizeArtifacts(identity.artifacts);
  return {
    schemaVersion: SCHEMA_VERSION,
    module,
    sourceCommit,
    sourceTree,
    dependencyClosureDigest,
    artifacts,
    ...(identity.predecessor ? { predecessor: clone(identity.predecessor) } : {}),
  };
}

export function normalizeIntent(intent, { operation = "mutation" } = {}) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) throw new Error("lease intent is required");
  const normalized = clone(intent);
  if (operation === "release" || operation === "promotion") {
    normalized.releaseIdentity = normalizeReleaseIdentity(intent.releaseIdentity);
  }
  if (normalized.dependencyClosureDigest !== undefined) {
    normalized.dependencyClosureDigest = lower(normalized.dependencyClosureDigest);
    if (!DIGEST.test(normalized.dependencyClosureDigest)) throw new Error("intent dependency closure digest is invalid");
  }
  return normalized;
}

export function buildIntent({ operation, resource, owner, intent, idempotencyKey }) {
  const normalizedOperation = lower(operation);
  if (!["mutation", "release", "promotion", "revalidate", "revoke"].includes(normalizedOperation)) throw new Error("lease operation is invalid");
  const normalizedResource = normalizeResourceKey(resource);
  const normalizedOwner = normalizeOwner(owner);
  const normalizedIntent = normalizeIntent(intent, { operation: normalizedOperation });
  const key = requireId(idempotencyKey, "lease idempotencyKey");
  return {
    schemaVersion: SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    operation: normalizedOperation,
    resource: normalizedResource,
    lockScope: lockScopeFor(normalizedResource),
    owner: normalizedOwner,
    idempotencyKey: key,
    intent: normalizedIntent,
  };
}

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    fencingCounters: {},
    leases: {},
    nonces: {},
  };
}

function stateOrEmpty(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("coordinator state is invalid");
  if (state.schemaVersion !== SCHEMA_VERSION || state.contractId !== CONTRACT_ID) throw new Error("coordinator state contract is invalid");
  return clone(state);
}

function assertTime(now) {
  if (!Number.isInteger(now) || now < 0) throw new Error("coordinator time is invalid");
}

function assertTtl(ttlMs) {
  if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 900_000) throw new Error("lease TTL is outside the fail-closed bounds");
}

function nextFencingToken(state, scope) {
  const token = Number(state.fencingCounters[scope] || 0) + 1;
  if (!Number.isSafeInteger(token) || token <= 0) throw new Error("fencing token exhausted");
  state.fencingCounters[scope] = token;
  return token;
}

function expireCurrent(state, scope, now) {
  const current = state.leases[scope];
  if (current && current.state === "held" && current.expiresAt <= now) {
    current.state = "expired";
    current.expiredAt = now;
  }
  return current;
}

export function consumeNonce(state, { nonce, digest, now, ttlMs = 900_000 }) {
  const next = stateOrEmpty(state);
  assertTime(now);
  assertTtl(ttlMs);
  const key = requireId(nonce, "request nonce");
  const requestDigest = lower(digest);
  if (!DIGEST.test(requestDigest)) throw new Error("request digest is invalid");
  for (const [storedNonce, record] of Object.entries(next.nonces)) {
    if (!record || record.expiresAt <= now) delete next.nonces[storedNonce];
  }
  if (next.nonces[key]) return { accepted: false, reason: "request-nonce-replayed", state: next };
  next.nonces[key] = { digest: requestDigest, acceptedAt: now, expiresAt: now + ttlMs };
  return { accepted: true, state: next };
}

export function acquireLease(state, request, { now, leaseId }) {
  const next = stateOrEmpty(state);
  assertTime(now);
  const ttlMs = request?.ttlMs;
  assertTtl(ttlMs);
  const intent = buildIntent(request);
  const intentDigest = lower(request.intentDigest);
  if (!DIGEST.test(intentDigest)) throw new Error("intent digest is invalid");
  const scope = intent.lockScope;
  const current = expireCurrent(next, scope, now);
  if (current?.state === "held") {
    if (
      current.idempotencyKey === intent.idempotencyKey
      && canonicalJson(current.owner) === canonicalJson(intent.owner)
      && current.intentDigest === intentDigest
    ) return { accepted: true, idempotent: true, lease: clone(current), state: next };
    return {
      accepted: false,
      reason: "resource-lease-held",
      resource: intent.resource,
      lockScope: scope,
      holder: { provider: current.owner.provider, missionId: current.owner.missionId, threadId: current.owner.threadId },
      state: next,
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(String(leaseId || ""))) throw new Error("leaseId is invalid");
  const fencingToken = nextFencingToken(next, scope);
  const lease = {
    schemaVersion: SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    resource: intent.resource,
    lockScope: scope,
    leaseId,
    fencingToken,
    owner: intent.owner,
    operation: intent.operation,
    idempotencyKey: intent.idempotencyKey,
    intentDigest,
    intent: intent.intent,
    state: "held",
    acquiredAt: now,
    expiresAt: now + ttlMs,
  };
  next.leases[scope] = lease;
  return { accepted: true, idempotent: false, lease: clone(lease), state: next };
}

function matchingLease(state, proof, now) {
  const next = stateOrEmpty(state);
  assertTime(now);
  const scope = lockScopeFor(proof?.resource || "");
  const current = expireCurrent(next, scope, now);
  if (!current || !ACTIVE_STATES.has(current.state)) return { valid: false, reason: current?.state === "expired" ? "lease-expired" : "lease-not-held", state: next };
  if (
    current.leaseId !== proof.leaseId
    || current.fencingToken !== proof.fencingToken
    || current.intentDigest !== lower(proof.intentDigest)
    || canonicalJson(current.owner) !== canonicalJson(normalizeOwner(proof.owner))
  ) return { valid: false, reason: "lease-fence-mismatch", state: next };
  return { valid: true, lease: clone(current), state: next };
}

export function checkLease(state, proof, { now }) {
  return matchingLease(state, proof, now);
}

export function renewLease(state, proof, { now, ttlMs }) {
  const result = matchingLease(state, proof, now);
  if (!result.valid) return result;
  assertTtl(ttlMs);
  result.lease.expiresAt = now + ttlMs;
  result.lease.renewedAt = now;
  result.state.leases[result.lease.lockScope] = result.lease;
  return { ...result, renewed: true };
}

export function releaseLease(state, proof, { now }) {
  const result = matchingLease(state, proof, now);
  if (!result.valid) return result;
  const released = { ...result.lease, state: "released", releasedAt: now };
  result.state.leases[released.lockScope] = released;
  return { valid: true, released: true, lease: clone(released), state: result.state };
}

export function revokeLease(state, proof, { now, reason }) {
  const result = matchingLease(state, proof, now);
  if (!result.valid) return result;
  const revokeReason = requireId(reason, "lease revocation reason");
  const revoked = { ...result.lease, state: "revoked", revokedAt: now, revocationReason: revokeReason };
  result.state.leases[revoked.lockScope] = revoked;
  return { valid: true, revoked: true, lease: clone(revoked), state: result.state };
}

export function compareDependencyClosure(expectedDigest, observedDigest) {
  const expected = lower(expectedDigest);
  const observed = lower(observedDigest);
  if (!DIGEST.test(expected) || !DIGEST.test(observed)) return { valid: false, failClosed: true, reason: "dependency-closure-unavailable" };
  if (expected !== observed) return { valid: false, failClosed: true, reason: "dependency-closure-changed" };
  return { valid: true, failClosed: false, reason: "dependency-closure-unchanged" };
}

export function authorizeMutation(state, proof, { now, expectedResource, expectedIntentDigest, observedDependencyClosureDigest, expectedArtifacts = null } = {}) {
  const checked = checkLease(state, proof, { now });
  if (!checked.valid) return checked;
  if (expectedResource && normalizeResourceKey(expectedResource) !== checked.lease.resource) return { valid: false, failClosed: true, reason: "resource-mismatch", state: checked.state };
  if (expectedIntentDigest && lower(expectedIntentDigest) !== checked.lease.intentDigest) return { valid: false, failClosed: true, reason: "intent-digest-mismatch", state: checked.state };
  if (observedDependencyClosureDigest !== undefined && observedDependencyClosureDigest !== null) {
    const expectedIntentClosure = checked.lease.intent?.dependencyClosureDigest
      || checked.lease.intent?.releaseIdentity?.dependencyClosureDigest;
    const closure = compareDependencyClosure(expectedIntentClosure, observedDependencyClosureDigest);
    if (!closure.valid) return { ...closure, reason: closure.reason === "dependency-closure-unavailable" ? "dependency-closure-intent-missing" : closure.reason, state: checked.state };
  }
  const identity = checked.lease.intent?.releaseIdentity;
  if (checked.lease.operation === "release" || checked.lease.operation === "promotion") {
    if (!identity) return { valid: false, failClosed: true, reason: "release-identity-missing", state: checked.state };
    const closure = compareDependencyClosure(identity.dependencyClosureDigest, observedDependencyClosureDigest);
    if (!closure.valid) return { ...closure, state: checked.state };
    if (!identity.artifacts.length) return { valid: false, failClosed: true, reason: "artifact-identity-missing", state: checked.state };
    if (expectedArtifacts !== null && canonicalJson(normalizeArtifacts(expectedArtifacts)) !== canonicalJson(identity.artifacts)) {
      return { valid: false, failClosed: true, reason: "artifact-identity-mismatch", state: checked.state };
    }
  }
  return { valid: true, failClosed: false, reason: "mutation-authorized", lease: checked.lease, state: checked.state };
}

export function terminalState(state) {
  return Object.fromEntries(Object.entries(stateOrEmpty(state).leases).map(([scope, lease]) => [scope, TERMINAL_STATES.has(lease.state) ? lease.state : lease.state]));
}
