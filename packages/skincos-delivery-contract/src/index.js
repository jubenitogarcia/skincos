export const PROMOTION_EVIDENCE_SCHEMA_VERSION = 4;
export const RELEASE_IDENTITY_SCHEMA_VERSION = 2;

const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SHA256_INTEGRITY = /^sha256:([0-9a-f]{64})$/i;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MODULE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value, label, { pattern = null, max = 240 } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > max || CONTROL.test(normalized)) {
    throw new TypeError(label + ' must be a non-empty safe string');
  }
  if (pattern && !pattern.test(normalized)) {
    throw new TypeError(label + ' has an invalid format');
  }
  return normalized;
}

function normalizeRepository(value, label) {
  return requiredText(value, label, { pattern: REPOSITORY, max: 256 }).toLowerCase();
}

function normalizeSha(value, label, pattern) {
  return requiredText(value, label, { pattern, max: pattern === SHA1 ? 40 : 64 }).toLowerCase();
}

function normalizeTimestamp(value, label) {
  const normalized = requiredText(value, label, { max: 64 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(label + ' must be an ISO timestamp');
  return normalized;
}

function normalizeArtifactDigest(value, label) {
  const normalized = requiredText(value, label, { max: 1024 });
  if (SHA256.test(normalized)) return normalized.toLowerCase();
  const integrity = normalized.match(SHA256_INTEGRITY);
  if (integrity) return 'sha256:' + integrity[1].toLowerCase();
  if (SRI.test(normalized)) return normalized;
  throw new TypeError(label + ' must be a SHA-256 digest or SRI integrity value');
}

function normalizePackageIntegrity(value, label) {
  const normalized = requiredText(value, label, { max: 1024 });
  const integrity = normalized.match(SHA256_INTEGRITY);
  if (integrity) return 'sha256:' + integrity[1].toLowerCase();
  if (SRI.test(normalized)) return normalized;
  throw new TypeError(label + ' must be sha256:<hex> or an SRI integrity value');
}

function freezeArray(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value)) throw new TypeError('artifacts must be an array');
  const artifacts = value.map((item, index) => {
    if (!isPlainObject(item)) throw new TypeError('artifacts[' + index + '] must be an object');
    return {
      id: requiredText(item.id, 'artifacts[' + index + '].id'),
      digest: normalizeArtifactDigest(item.digest, 'artifacts[' + index + '].digest'),
      fileDigest: normalizeArtifactDigest(item.fileDigest, 'artifacts[' + index + '].fileDigest'),
    };
  });
  artifacts.sort((left, right) => left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest));
  for (let index = 1; index < artifacts.length; index += 1) {
    if (artifacts[index - 1].id === artifacts[index].id) {
      throw new TypeError('artifacts must not contain duplicate ids');
    }
  }
  return freezeArray(artifacts);
}

function normalizeContractVersions(value) {
  if (!Array.isArray(value)) throw new TypeError('contractVersions must be an array');
  const packages = value.map((item, index) => {
    if (!isPlainObject(item)) throw new TypeError('contractVersions[' + index + '] must be an object');
    return {
      name: requiredText(item.name, 'contractVersions[' + index + '].name'),
      version: requiredText(item.version, 'contractVersions[' + index + '].version'),
      integrity: normalizePackageIntegrity(item.integrity, 'contractVersions[' + index + '].integrity'),
    };
  });
  packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  for (let index = 1; index < packages.length; index += 1) {
    if (packages[index - 1].name === packages[index].name) {
      throw new TypeError('contractVersions must not contain duplicate names');
    }
  }
  return freezeArray(packages);
}

function normalizeEvidenceProvenance(value) {
  if (!isPlainObject(value)) throw new TypeError('promotion evidence input must be an object');
  return Object.freeze({
    evidenceRepository: normalizeRepository(value.evidenceRepository, 'evidenceRepository'),
    evidenceRunId: requiredText(value.evidenceRunId, 'evidenceRunId', { max: 128 }),
    evidenceArtifact: requiredText(value.evidenceArtifact, 'evidenceArtifact'),
  });
}

function normalizeOptionalPredecessor(value) {
  if (!isPlainObject(value)) throw new TypeError('promotion evidence input must be an object');
  const supplied = [value.predecessorRepository, value.predecessorRunId, value.predecessorArtifact]
    .filter((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '');
  if (!supplied.length) return null;
  if (supplied.length !== 3) throw new TypeError('predecessor provenance must include repository, run id and artifact together');
  return Object.freeze({
    predecessorRepository: normalizeRepository(value.predecessorRepository, 'predecessorRepository'),
    predecessorRunId: requiredText(value.predecessorRunId, 'predecessorRunId', { max: 128 }),
    predecessorArtifact: requiredText(value.predecessorArtifact, 'predecessorArtifact'),
  });
}

function normalizeTarget(value) {
  return requiredText(value, 'target', { max: 128 });
}

function normalizeExpected(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new TypeError('expected identity must be an object');
  return value;
}

function requireWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SubtleCrypto is required to calculate release identity digests');
  }
  return globalThis.crypto.subtle;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not support non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) throw new TypeError('canonical JSON supports only plain JSON values');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  return hex(await requireWebCrypto().digest('SHA-256', bytes));
}

/**
 * Builds the identity carried by promotion-evidence schema v4. Its own schema
 * is versioned separately because a release identity is reusable outside one
 * concrete workflow implementation.
 *
 * Evidence-artifact and predecessor provenance deliberately remain outside the
 * identity. Their identifiers are only available after an evidence artifact is
 * written or downloaded, so placing them in the digest would be circular.
 */
export function createReleaseIdentityV4(value) {
  if (!isPlainObject(value)) throw new TypeError('release identity must be an object');
  return Object.freeze({
    schemaVersion: RELEASE_IDENTITY_SCHEMA_VERSION,
    module: requiredText(value.module, 'module', { pattern: MODULE, max: 128 }),
    sourceRepository: normalizeRepository(value.sourceRepository, 'sourceRepository'),
    sourceCommit: normalizeSha(value.sourceCommit, 'sourceCommit', SHA1),
    sourceTree: normalizeSha(value.sourceTree, 'sourceTree', SHA1),
    sourceRef: requiredText(value.sourceRef, 'sourceRef', { max: 512 }),
    deliveryContractVersion: requiredText(value.deliveryContractVersion, 'deliveryContractVersion', { max: 128 }),
    contractManifestDigest: normalizeSha(value.contractManifestDigest, 'contractManifestDigest', SHA256),
    dependencyClosureDigest: normalizeSha(value.dependencyClosureDigest, 'dependencyClosureDigest', SHA256),
    contractVersions: normalizeContractVersions(value.contractVersions ?? []),
    artifacts: normalizeArtifacts(value.artifacts ?? []),
  });
}

export async function releaseIdentityDigestV4(value) {
  return sha256Hex(canonicalJson(createReleaseIdentityV4(value)));
}

export async function createReleaseIdentityV4WithDigest(value) {
  const identity = createReleaseIdentityV4(value);
  return Object.freeze({
    ...identity,
    releaseIdentityDigest: await releaseIdentityDigestV4(identity),
  });
}

export async function verifyReleaseIdentityV4(value) {
  if (!isPlainObject(value) || value.schemaVersion !== RELEASE_IDENTITY_SCHEMA_VERSION) {
    throw new TypeError('release identity must use schema version ' + RELEASE_IDENTITY_SCHEMA_VERSION);
  }
  const identity = createReleaseIdentityV4(value);
  const providedDigest = normalizeSha(value.releaseIdentityDigest, 'releaseIdentityDigest', SHA256);
  const calculatedDigest = await releaseIdentityDigestV4(identity);
  return Object.freeze({
    identity,
    providedDigest,
    calculatedDigest,
    valid: providedDigest === calculatedDigest,
  });
}

export async function assertReleaseIdentityV4(value) {
  const verification = await verifyReleaseIdentityV4(value);
  if (!verification.valid) throw new Error('release identity digest is invalid');
  return verification.identity;
}

export async function createPromotionEvidenceV4(value) {
  if (!isPlainObject(value)) throw new TypeError('promotion evidence input must be an object');
  const releaseIdentity = await createReleaseIdentityV4WithDigest(value.releaseIdentity);
  const provenance = normalizeEvidenceProvenance(value);
  const predecessor = normalizeOptionalPredecessor(value);
  const target = normalizeTarget(value.target);
  const createdAt = normalizeTimestamp(value.createdAt, 'createdAt');
  return Object.freeze({
    schemaVersion: PROMOTION_EVIDENCE_SCHEMA_VERSION,
    unit: releaseIdentity.module,
    target,
    sourceRepository: releaseIdentity.sourceRepository,
    sourceSha: releaseIdentity.sourceCommit,
    sourceTree: releaseIdentity.sourceTree,
    sourceRef: releaseIdentity.sourceRef,
    deliveryContractVersion: releaseIdentity.deliveryContractVersion,
    releaseInputDigest: releaseIdentity.dependencyClosureDigest,
    dependencyClosureDigest: releaseIdentity.dependencyClosureDigest,
    contractManifestDigest: releaseIdentity.contractManifestDigest,
    contractVersions: releaseIdentity.contractVersions,
    artifacts: releaseIdentity.artifacts,
    ...provenance,
    ...(predecessor || {}),
    releaseIdentity,
    releaseIdentityDigest: releaseIdentity.releaseIdentityDigest,
    promotionStrategy: releaseIdentity.artifacts.length ? 'exact-artifacts' : 'immutable-source-identity',
    createdAt,
  });
}

export async function verifyPromotionEvidenceV4(value, expected = {}) {
  if (!isPlainObject(value) || value.schemaVersion !== PROMOTION_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError('promotion evidence must use schema version ' + PROMOTION_EVIDENCE_SCHEMA_VERSION);
  }
  const normalizedExpected = normalizeExpected(expected);
  const identity = await assertReleaseIdentityV4(value.releaseIdentity);
  const provenance = normalizeEvidenceProvenance(value);
  const predecessor = normalizeOptionalPredecessor(value);
  const valid = value.unit === identity.module
    && value.sourceRepository === identity.sourceRepository
    && value.sourceSha === identity.sourceCommit
    && value.sourceTree === identity.sourceTree
    && value.sourceRef === identity.sourceRef
    && value.deliveryContractVersion === identity.deliveryContractVersion
    && value.releaseInputDigest === identity.dependencyClosureDigest
    && value.dependencyClosureDigest === identity.dependencyClosureDigest
    && value.contractManifestDigest === identity.contractManifestDigest
    && canonicalJson(value.contractVersions) === canonicalJson(identity.contractVersions)
    && canonicalJson(value.artifacts) === canonicalJson(identity.artifacts)
    && value.releaseIdentityDigest === await releaseIdentityDigestV4(identity)
    && value.evidenceRepository === provenance.evidenceRepository
    && value.evidenceRunId === provenance.evidenceRunId
    && value.evidenceArtifact === provenance.evidenceArtifact;
  if (!valid) throw new Error('promotion evidence does not match its release identity');
  if (normalizedExpected.target && value.target !== normalizeTarget(normalizedExpected.target)) {
    throw new Error('promotion evidence target differs from the expected target');
  }
  if (normalizedExpected.sourceRepository && identity.sourceRepository !== normalizeRepository(normalizedExpected.sourceRepository, 'expected.sourceRepository')) {
    throw new Error('promotion evidence source repository differs from the expected repository');
  }
  if (normalizedExpected.sourceCommit && identity.sourceCommit !== normalizeSha(normalizedExpected.sourceCommit, 'expected.sourceCommit', SHA1)) {
    throw new Error('promotion evidence source commit differs from the expected commit');
  }
  if (normalizedExpected.releaseIdentityDigest && value.releaseIdentityDigest !== normalizeSha(normalizedExpected.releaseIdentityDigest, 'expected.releaseIdentityDigest', SHA256)) {
    throw new Error('promotion evidence release identity differs from the expected identity');
  }
  return Object.freeze({ evidence: value, identity, provenance, predecessor });
}
