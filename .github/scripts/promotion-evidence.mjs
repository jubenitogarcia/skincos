import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalJson, sha256 } from "../../scripts/codex-autonomy-lib.mjs";

const [mode, file] = process.argv.slice(2);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const optional = (name) => process.env[name] || null;
const SHA256 = /^[0-9a-f]{64}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/;

const releaseSurfacesByUnit = {
  "timekeeping": ["timekeeping"],
  "crm-pages": ["timekeeping"],
  "core-api": ["timekeeping"],
  "core-inventory": ["timekeeping"],
  "finance": ["runtime"],
  "token-vault": ["runtime", "github-governance"],
  "finance-ui": ["website"],
  "escala-api": ["runtime"],
  // The adapter has an isolated Worker/Durable Object artifact.  Its source
  // is neither a generic runtime nor the core Schedule release surface; bind
  // its own inputs plus the canonical promotion and coordination guards.
  "schedule-public-read-adapter": ["schedule-public-read-adapter", "global-coordination", "github-governance"],
  "meta-ads-report": ["runtime"],
  "public-website-release": ["website"],
  "beauty-movement-production-activation": ["website"],
  "beauty-movement-campaign-copy-update": ["website"],
  // Atendimento is promoted as an isolated native CRM runtime.  Its release
  // identity spans the CRM/API source, native runtime custody and the
  // main-custodied workflow validators; keeping all three inputs in the
  // digest prevents a predecessor evidence record from being reused after a
  // contract or runtime change.
  "atendimento": ["timekeeping", "runtime", "github-governance"],
  "atendimento-availability": ["timekeeping", "runtime", "github-governance"],
};

function releaseInputDigest(unit, sourceSha) {
  const surfaces = releaseSurfacesByUnit[unit];
  if (!surfaces) return null;
  const args = ["scripts/codex-release-manifest.mjs", "--source", sourceSha, ...surfaces.flatMap((surface) => ["--surface", surface])];
  const output = execFileSync("node", args, { encoding: "utf8" });
  return JSON.parse(output).releaseInputDigest;
}

function releaseIdentity({ unit, sourceSha, sourceTree, releaseInputDigest: closureDigest, artifacts = [] }) {
  const identity = {
    schemaVersion: 1,
    module: unit,
    sourceCommit: sourceSha,
    sourceTree,
    dependencyClosureDigest: closureDigest,
    artifacts,
  };
  return {
    ...identity,
    releaseIdentityDigest: sha256(canonicalJson(identity)),
  };
}

function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(String(value || ""))) throw new Error(`${label} must be a full SHA`);
  return String(value).toLowerCase();
}

function requiredSha256(value, label) {
  if (!SHA256.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}

function requiredRepository(value, label) {
  const normalized = String(value || "").trim();
  if (!REPOSITORY.test(normalized)) throw new Error(`${label} must be an owner/repository identifier`);
  return normalized.toLowerCase();
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 512 || !SAFE_TEXT.test(normalized)) throw new Error(`${label} must be a non-empty safe string`);
  return normalized;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function normalizeIntegrity(value, label) {
  const normalized = requiredText(value, label);
  if (SHA256.test(normalized)) return normalized.toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/i.test(normalized)) return `sha256:${normalized.slice("sha256:".length).toLowerCase()}`;
  if (/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return normalized;
  throw new Error(`${label} must be a SHA-256 digest or SRI integrity value`);
}

function normalizeContractVersions(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const normalized = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label}[${index}] must be an object`);
    return {
      name: requiredText(entry.name, `${label}[${index}].name`),
      version: requiredText(entry.version, `${label}[${index}].version`),
      integrity: normalizeIntegrity(entry.integrity, `${label}[${index}].integrity`),
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].name === normalized[index].name) throw new Error(`${label} contains duplicate package ${normalized[index].name}`);
  }
  return normalized;
}

function normalizeArtifacts(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const normalized = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label}[${index}] must be an object`);
    return {
      id: requiredText(entry.id, `${label}[${index}].id`),
      digest: normalizeIntegrity(entry.digest, `${label}[${index}].digest`),
      fileDigest: normalizeIntegrity(entry.fileDigest, `${label}[${index}].fileDigest`),
    };
  }).sort((left, right) => left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) throw new Error(`${label} contains duplicate artifact ${normalized[index].id}`);
  }
  return normalized;
}

function v4ReleaseIdentity({
  unit,
  sourceRepository,
  sourceCommit,
  sourceTree,
  sourceRef,
  deliveryContractVersion,
  contractManifestDigest,
  dependencyClosureDigest,
  contractVersions,
  artifacts,
}) {
  const identity = {
    schemaVersion: 2,
    module: unit,
    sourceRepository,
    sourceCommit,
    sourceTree,
    sourceRef,
    deliveryContractVersion,
    contractManifestDigest,
    dependencyClosureDigest,
    contractVersions,
    artifacts,
  };
  return {
    ...identity,
    releaseIdentityDigest: sha256(canonicalJson(identity)),
  };
}

function buildIdentityFromEnv({ artifacts = [] } = {}) {
  const unit = required("PROMOTION_UNIT");
  const sourceSha = requiredSha(required("PROMOTION_SOURCE_SHA"), "promotion source SHA");
  const sourceTree = requiredSha(required("PROMOTION_SOURCE_TREE"), "promotion source tree");
  const closureDigest = process.env.PROMOTION_DEPENDENCY_CLOSURE_DIGEST
    || process.env.PROMOTION_RELEASE_INPUT_DIGEST
    || releaseInputDigest(unit, sourceSha);
  if (!/^[0-9a-f]{64}$/i.test(String(closureDigest || ""))) throw new Error("promotion dependency closure digest is invalid");
  return releaseIdentity({
    unit,
    sourceSha,
    sourceTree,
    releaseInputDigest: String(closureDigest).toLowerCase(),
    artifacts,
  });
}

function requestedEvidenceSchemaVersion() {
  const value = optional("PROMOTION_EVIDENCE_SCHEMA_VERSION") || "3";
  if (value !== "3" && value !== "4") throw new Error("PROMOTION_EVIDENCE_SCHEMA_VERSION must be 3 or 4");
  return Number(value);
}

function sourceCommitFromEnv() {
  const sourceCommit = optional("PROMOTION_SOURCE_COMMIT");
  const sourceSha = optional("PROMOTION_SOURCE_SHA");
  if (!sourceCommit && !sourceSha) throw new Error("missing PROMOTION_SOURCE_SHA");
  const normalized = requiredSha(sourceCommit || sourceSha, "promotion source SHA");
  if (sourceCommit && sourceSha && normalized !== requiredSha(sourceSha, "promotion source SHA")) {
    throw new Error("PROMOTION_SOURCE_COMMIT and PROMOTION_SOURCE_SHA disagree");
  }
  return normalized;
}

function buildV4IdentityFromEnv() {
  const unit = required("PROMOTION_UNIT");
  const sourceRepository = requiredRepository(required("PROMOTION_SOURCE_REPOSITORY"), "promotion source repository");
  const sourceCommit = sourceCommitFromEnv();
  const sourceTree = requiredSha(required("PROMOTION_SOURCE_TREE"), "promotion source tree");
  const sourceRef = requiredText(required("PROMOTION_SOURCE_REF"), "promotion source ref");
  const deliveryContractVersion = requiredText(required("PROMOTION_DELIVERY_CONTRACT_VERSION"), "promotion delivery contract version");
  const contractManifestDigest = requiredSha256(required("PROMOTION_CONTRACT_MANIFEST_DIGEST"), "promotion contract manifest digest");
  const releaseInputDigest = requiredSha256(required("PROMOTION_RELEASE_INPUT_DIGEST"), "promotion release-input digest");
  const dependencyClosureDigest = requiredSha256(
    process.env.PROMOTION_DEPENDENCY_CLOSURE_DIGEST || process.env.PROMOTION_RELEASE_INPUT_DIGEST,
    "promotion dependency closure digest",
  );
  if (releaseInputDigest !== dependencyClosureDigest) throw new Error("promotion dependency-closure digest differs from release-input digest");
  const contractVersions = normalizeContractVersions(
    parseJson(required("PROMOTION_CONTRACT_VERSIONS_JSON"), "PROMOTION_CONTRACT_VERSIONS_JSON"),
    "promotion contract versions",
  );
  const artifacts = normalizeArtifacts(
    parseJson(required("PROMOTION_ARTIFACT_IDENTITIES_JSON"), "PROMOTION_ARTIFACT_IDENTITIES_JSON"),
    "promotion artifact identities",
  );
  if (!artifacts.length) throw new Error("schema v4 evidence requires at least one immutable artifact identity");
  return {
    unit,
    sourceRepository,
    sourceCommit,
    sourceTree,
    sourceRef,
    deliveryContractVersion,
    contractManifestDigest,
    releaseInputDigest,
    dependencyClosureDigest,
    contractVersions,
    artifacts,
    identity: v4ReleaseIdentity({
      unit,
      sourceRepository,
      sourceCommit,
      sourceTree,
      sourceRef,
      deliveryContractVersion,
      contractManifestDigest,
      dependencyClosureDigest,
      contractVersions,
      artifacts,
    }),
  };
}

function requiredRunId(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[0-9]+$/.test(normalized)) throw new Error(`${label} must be a numeric GitHub Actions run id`);
  return normalized;
}

function provenanceFromEnv() {
  const evidenceRepository = requiredRepository(
    process.env.PROMOTION_EVIDENCE_REPOSITORY || required("GITHUB_REPOSITORY"),
    "promotion evidence repository",
  );
  const evidenceRunId = requiredRunId(
    process.env.PROMOTION_EVIDENCE_RUN_ID || required("GITHUB_RUN_ID"),
    "promotion evidence run id",
  );
  const evidenceArtifact = requiredText(required("PROMOTION_EVIDENCE_ARTIFACT"), "promotion evidence artifact");
  const predecessorRepository = optional("PROMOTION_PREDECESSOR_REPOSITORY");
  const predecessorRunId = optional("PROMOTION_PREDECESSOR_RUN_ID");
  const predecessorArtifact = optional("PROMOTION_PREDECESSOR_ARTIFACT");
  if (!predecessorRepository && !predecessorRunId && !predecessorArtifact) {
    return { evidenceRepository, evidenceRunId, evidenceArtifact };
  }
  if (!predecessorRepository || !predecessorRunId || !predecessorArtifact) {
    throw new Error("predecessor repository, run id, and artifact must be supplied together");
  }
  return {
    evidenceRepository,
    evidenceRunId,
    evidenceArtifact,
    predecessorRepository: requiredRepository(predecessorRepository, "promotion predecessor repository"),
    predecessorRunId: requiredRunId(predecessorRunId, "promotion predecessor run id"),
    predecessorArtifact: requiredText(predecessorArtifact, "promotion predecessor artifact"),
  };
}

function expectedSourceCommitFromEnv() {
  const sourceCommit = optional("PROMOTION_EXPECTED_SOURCE_COMMIT");
  const sourceSha = optional("PROMOTION_EXPECTED_SHA");
  if (!sourceCommit && !sourceSha) return null;
  const normalized = requiredSha(sourceCommit || sourceSha, "expected promotion source SHA");
  if (sourceCommit && sourceSha && normalized !== requiredSha(sourceSha, "expected promotion source SHA")) {
    throw new Error("PROMOTION_EXPECTED_SOURCE_COMMIT and PROMOTION_EXPECTED_SHA disagree");
  }
  return normalized;
}

function expectedPredecessorFromEnv() {
  const repository = optional("PROMOTION_EXPECTED_PREDECESSOR_REPOSITORY");
  const runId = optional("PROMOTION_EXPECTED_PREDECESSOR_RUN_ID");
  const artifact = optional("PROMOTION_EXPECTED_PREDECESSOR_ARTIFACT");
  if (!repository && !runId && !artifact) return null;
  if (!repository || !runId || !artifact) {
    throw new Error("expected predecessor repository, run id, and artifact must be supplied together");
  }
  return {
    predecessorRepository: requiredRepository(repository, "expected promotion predecessor repository"),
    predecessorRunId: requiredRunId(runId, "expected promotion predecessor run id"),
    predecessorArtifact: requiredText(artifact, "expected promotion predecessor artifact"),
  };
}

function assertOptionalEqual(actual, expected, label) {
  if (expected !== null && actual !== expected) throw new Error(`promotion evidence ${label} differs from the requested candidate`);
}

function v4FieldsFromEvidence(evidence) {
  const sourceRepository = requiredRepository(evidence.sourceRepository, "promotion evidence source repository");
  const sourceCommit = requiredSha(evidence.sourceSha, "promotion evidence source SHA");
  const sourceTree = requiredSha(evidence.sourceTree, "promotion evidence source tree");
  const sourceRef = requiredText(evidence.sourceRef, "promotion evidence source ref");
  const deliveryContractVersion = requiredText(evidence.deliveryContractVersion, "promotion evidence delivery contract version");
  const contractManifestDigest = requiredSha256(evidence.contractManifestDigest, "promotion evidence contract manifest digest");
  const releaseInputDigest = requiredSha256(evidence.releaseInputDigest, "promotion evidence release-input digest");
  const dependencyClosureDigest = requiredSha256(evidence.dependencyClosureDigest, "promotion evidence dependency closure digest");
  if (releaseInputDigest !== dependencyClosureDigest) throw new Error("promotion evidence dependency-closure digest differs from release-input digest");
  const contractVersions = normalizeContractVersions(evidence.contractVersions, "promotion evidence contract versions");
  const artifacts = normalizeArtifacts(evidence.artifacts, "promotion evidence artifact identities");
  if (!artifacts.length) throw new Error("schema v4 evidence requires at least one immutable artifact identity");
  const evidenceRepository = requiredRepository(evidence.evidenceRepository, "promotion evidence repository");
  const evidenceRunId = requiredRunId(evidence.evidenceRunId, "promotion evidence run id");
  const evidenceArtifact = requiredText(evidence.evidenceArtifact, "promotion evidence artifact");
  if (evidence.repository !== undefined && requiredRepository(evidence.repository, "promotion evidence repository") !== evidenceRepository) {
    throw new Error("promotion evidence repository alias does not match its v4 envelope");
  }
  if (evidence.runId !== undefined && requiredRunId(evidence.runId, "promotion evidence run id") !== evidenceRunId) {
    throw new Error("promotion evidence run id alias does not match its v4 envelope");
  }
  const predecessor = {
    predecessorRepository: evidence.predecessorRepository,
    predecessorRunId: evidence.predecessorRunId,
    predecessorArtifact: evidence.predecessorArtifact,
  };
  const predecessorValues = Object.values(predecessor).filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (predecessorValues.length && predecessorValues.length !== 3) {
    throw new Error("promotion evidence predecessor provenance is incomplete");
  }
  const normalizedPredecessor = predecessorValues.length
    ? {
      predecessorRepository: requiredRepository(predecessor.predecessorRepository, "promotion evidence predecessor repository"),
      predecessorRunId: requiredRunId(predecessor.predecessorRunId, "promotion evidence predecessor run id"),
      predecessorArtifact: requiredText(predecessor.predecessorArtifact, "promotion evidence predecessor artifact"),
    }
    : null;
  if (evidence.target !== "preview" && !normalizedPredecessor) {
    throw new Error("schema v4 evidence after preview requires predecessor provenance");
  }
  const identity = v4ReleaseIdentity({
    unit: evidence.unit,
    sourceRepository,
    sourceCommit,
    sourceTree,
    sourceRef,
    deliveryContractVersion,
    contractManifestDigest,
    dependencyClosureDigest,
    contractVersions,
    artifacts,
  });
  if (evidence.releaseIdentityDigest !== identity.releaseIdentityDigest || canonicalJson(evidence.releaseIdentity) !== canonicalJson(identity)) {
    throw new Error("promotion evidence release identity digest is invalid");
  }
  return {
    sourceRepository,
    sourceCommit,
    sourceTree,
    sourceRef,
    deliveryContractVersion,
    contractManifestDigest,
    releaseInputDigest,
    dependencyClosureDigest,
    contractVersions,
    artifacts,
    evidenceRepository,
    evidenceRunId,
    evidenceArtifact,
    predecessor: normalizedPredecessor,
  };
}

function verifyV4Evidence(evidence) {
  const fields = v4FieldsFromEvidence(evidence);
  assertOptionalEqual(fields.sourceRepository, optional("PROMOTION_EXPECTED_SOURCE_REPOSITORY") === null ? null : requiredRepository(optional("PROMOTION_EXPECTED_SOURCE_REPOSITORY"), "expected promotion source repository"), "source repository");
  assertOptionalEqual(fields.sourceCommit, expectedSourceCommitFromEnv(), "SHA");
  assertOptionalEqual(fields.sourceTree, optional("PROMOTION_EXPECTED_SOURCE_TREE") === null ? null : requiredSha(optional("PROMOTION_EXPECTED_SOURCE_TREE"), "expected promotion source tree"), "source tree");
  assertOptionalEqual(fields.sourceRef, optional("PROMOTION_EXPECTED_SOURCE_REF") === null ? null : requiredText(optional("PROMOTION_EXPECTED_SOURCE_REF"), "expected promotion source ref"), "source ref");
  assertOptionalEqual(fields.releaseInputDigest, optional("PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST") === null ? null : requiredSha256(optional("PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST"), "expected promotion release-input digest"), "release-input digest");
  assertOptionalEqual(fields.deliveryContractVersion, optional("PROMOTION_EXPECTED_DELIVERY_CONTRACT_VERSION") === null ? null : requiredText(optional("PROMOTION_EXPECTED_DELIVERY_CONTRACT_VERSION"), "expected promotion delivery contract version"), "delivery contract version");
  assertOptionalEqual(fields.contractManifestDigest, optional("PROMOTION_EXPECTED_CONTRACT_MANIFEST_DIGEST") === null ? null : requiredSha256(optional("PROMOTION_EXPECTED_CONTRACT_MANIFEST_DIGEST"), "expected promotion contract manifest digest"), "contract manifest digest");
  const expectedVersions = optional("PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON") === null
    ? null
    : normalizeContractVersions(parseJson(optional("PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON"), "PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON"), "expected promotion contract versions");
  if (expectedVersions && canonicalJson(fields.contractVersions) !== canonicalJson(expectedVersions)) {
    throw new Error("promotion evidence contract versions differ from the requested candidate");
  }
  const expectedArtifacts = optional("PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON") === null
    ? null
    : normalizeArtifacts(parseJson(optional("PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON"), "PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON"), "expected promotion artifact identities");
  if (expectedArtifacts && canonicalJson(fields.artifacts) !== canonicalJson(expectedArtifacts)) {
    throw new Error("promotion evidence artifact identities differ from the requested candidate");
  }
  assertOptionalEqual(fields.evidenceRepository, optional("PROMOTION_EXPECTED_EVIDENCE_REPOSITORY") === null ? null : requiredRepository(optional("PROMOTION_EXPECTED_EVIDENCE_REPOSITORY"), "expected promotion evidence repository"), "evidence repository");
  assertOptionalEqual(fields.evidenceRunId, optional("PROMOTION_EXPECTED_EVIDENCE_RUN_ID") === null ? null : requiredRunId(optional("PROMOTION_EXPECTED_EVIDENCE_RUN_ID"), "expected promotion evidence run id"), "evidence run id");
  assertOptionalEqual(fields.evidenceArtifact, optional("PROMOTION_EXPECTED_EVIDENCE_ARTIFACT") === null ? null : requiredText(optional("PROMOTION_EXPECTED_EVIDENCE_ARTIFACT"), "expected promotion evidence artifact"), "evidence artifact");
  const expectedPredecessor = expectedPredecessorFromEnv();
  if (expectedPredecessor && canonicalJson(fields.predecessor) !== canonicalJson(expectedPredecessor)) {
    throw new Error("promotion evidence predecessor provenance differs from the requested candidate");
  }
  assertOptionalEqual(evidence.releaseIdentityDigest, optional("PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST") === null ? null : requiredSha256(optional("PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST"), "expected promotion release identity digest"), "release identity");
  return fields;
}

function assertLegacyEvidenceIsIntraRepository(evidence) {
  const expectedPredecessor = expectedPredecessorFromEnv();
  const repositories = [
    optional("GITHUB_REPOSITORY") && requiredRepository(optional("GITHUB_REPOSITORY"), "GitHub repository"),
    optional("PROMOTION_EXPECTED_SOURCE_REPOSITORY") && requiredRepository(optional("PROMOTION_EXPECTED_SOURCE_REPOSITORY"), "expected promotion source repository"),
    optional("PROMOTION_EXPECTED_EVIDENCE_REPOSITORY") && requiredRepository(optional("PROMOTION_EXPECTED_EVIDENCE_REPOSITORY"), "expected promotion evidence repository"),
    expectedPredecessor?.predecessorRepository,
    evidence.repository && requiredRepository(evidence.repository, "promotion evidence repository"),
  ].filter(Boolean);
  if (repositories.some((repository) => repository !== repositories[0])) {
    throw new Error("legacy promotion evidence can only be used intra-repository; schema v4 is required for cross-repository promotion");
  }
}

if (mode === "write") {
  const schemaVersion = requestedEvidenceSchemaVersion();
  const target = required("PROMOTION_TARGET");
  let evidence;
  if (schemaVersion === 4) {
    const prepared = buildV4IdentityFromEnv();
    const provenance = provenanceFromEnv();
    if (target !== "preview" && !provenance.predecessorRepository) {
      throw new Error("schema v4 evidence after preview requires predecessor provenance");
    }
    evidence = {
      schemaVersion: 4,
      unit: prepared.unit,
      target,
      sourceRepository: prepared.sourceRepository,
      sourceSha: prepared.sourceCommit,
      sourceTree: prepared.sourceTree,
      sourceRef: prepared.sourceRef,
      deliveryContractVersion: prepared.deliveryContractVersion,
      contractManifestDigest: prepared.contractManifestDigest,
      releaseInputDigest: prepared.releaseInputDigest,
      dependencyClosureDigest: prepared.dependencyClosureDigest,
      contractVersions: prepared.contractVersions,
      artifacts: prepared.artifacts,
      releaseIdentity: prepared.identity,
      releaseIdentityDigest: prepared.identity.releaseIdentityDigest,
      promotionStrategy: "exact-artifacts",
      ...provenance,
      // Aliases preserve the v1-v3 envelope readers during the transition.
      runId: provenance.evidenceRunId,
      repository: provenance.evidenceRepository,
      createdAt: new Date().toISOString(),
    };
  } else {
    const unit = required("PROMOTION_UNIT");
    const sourceSha = required("PROMOTION_SOURCE_SHA");
    const artifacts = process.env.PROMOTION_ARTIFACT_DIGESTS_JSON ? JSON.parse(process.env.PROMOTION_ARTIFACT_DIGESTS_JSON) : [];
    if (!Array.isArray(artifacts)) throw new Error("PROMOTION_ARTIFACT_DIGESTS_JSON must be an array");
    const identity = buildIdentityFromEnv({ artifacts });
    const repository = requiredRepository(required("GITHUB_REPOSITORY"), "promotion evidence repository");
    const explicitSourceRepository = optional("PROMOTION_SOURCE_REPOSITORY");
    const explicitEvidenceRepository = optional("PROMOTION_EVIDENCE_REPOSITORY");
    const explicitPredecessorRepository = optional("PROMOTION_PREDECESSOR_REPOSITORY");
    if (
      (explicitSourceRepository && requiredRepository(explicitSourceRepository, "promotion source repository") !== repository)
      || (explicitEvidenceRepository && requiredRepository(explicitEvidenceRepository, "promotion evidence repository") !== repository)
      || (explicitPredecessorRepository && requiredRepository(explicitPredecessorRepository, "promotion predecessor repository") !== repository)
    ) {
      throw new Error("cross-repository promotion evidence requires schema v4");
    }
    evidence = {
      schemaVersion: 3,
      unit,
      target,
      sourceSha: identity.sourceCommit,
      sourceTree: identity.sourceTree,
      releaseInputDigest: process.env.PROMOTION_RELEASE_INPUT_DIGEST || releaseInputDigest(unit, sourceSha),
      dependencyClosureDigest: identity.dependencyClosureDigest,
      artifacts,
      releaseIdentity: identity,
      releaseIdentityDigest: identity.releaseIdentityDigest,
      promotionStrategy: artifacts.length ? "exact-artifacts" : "immutable-source-identity",
      runId: required("GITHUB_RUN_ID"),
      repository,
      createdAt: new Date().toISOString(),
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} else if (mode === "verify") {
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  const expectedUnit = required("PROMOTION_UNIT");
  const expectedTarget = required("PROMOTION_EXPECTED_TARGET");
  const expectedSha = process.env.PROMOTION_EXPECTED_SHA;
  const expectedReleaseInputDigest = process.env.PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST;
  const expectedReleaseIdentityDigest = process.env.PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST;
  if (![1, 2, 3, 4].includes(evidence.schemaVersion) || evidence.unit !== expectedUnit || evidence.target !== expectedTarget || !/^[0-9a-f]{40}$/i.test(evidence.sourceSha) || !/^[0-9a-f]{40}$/i.test(evidence.sourceTree)) {
    throw new Error("promotion evidence has an invalid identity or stage");
  }
  let v4Fields = null;
  if (evidence.schemaVersion === 4) {
    v4Fields = verifyV4Evidence(evidence);
  } else {
    assertLegacyEvidenceIsIntraRepository(evidence);
    if (expectedSha && evidence.sourceSha !== expectedSha) throw new Error("promotion evidence SHA differs from requested release SHA");
    if (expectedReleaseInputDigest && evidence.releaseInputDigest !== expectedReleaseInputDigest) throw new Error("promotion evidence release-input digest differs from the requested candidate");
    if (evidence.dependencyClosureDigest && evidence.dependencyClosureDigest !== evidence.releaseInputDigest) throw new Error("promotion evidence dependency-closure digest differs from release-input digest");
    if (evidence.schemaVersion >= 3) {
      const identity = releaseIdentity({
        unit: evidence.unit,
        sourceSha: evidence.sourceSha,
        sourceTree: evidence.sourceTree,
        releaseInputDigest: evidence.dependencyClosureDigest || evidence.releaseInputDigest,
        artifacts: evidence.artifacts || [],
      });
      if (evidence.releaseIdentityDigest !== identity.releaseIdentityDigest || canonicalJson(evidence.releaseIdentity) !== canonicalJson(identity)) {
        throw new Error("promotion evidence release identity digest is invalid");
      }
      if (expectedReleaseIdentityDigest && evidence.releaseIdentityDigest !== expectedReleaseIdentityDigest) throw new Error("promotion evidence release identity differs from requested candidate");
    } else if (expectedReleaseIdentityDigest) {
      throw new Error("legacy promotion evidence has no immutable release identity");
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    const sourceRepository = v4Fields?.sourceRepository || evidence.repository || "";
    const sourceRef = v4Fields?.sourceRef || "";
    const evidenceRepository = v4Fields?.evidenceRepository || evidence.repository || "";
    const evidenceRunId = v4Fields?.evidenceRunId || evidence.runId || "";
    const evidenceArtifact = v4Fields?.evidenceArtifact || "";
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_repository=${sourceRepository}\nsource_sha=${evidence.sourceSha}\nsource_tree=${evidence.sourceTree}\nsource_ref=${sourceRef}\nrelease_input_digest=${evidence.releaseInputDigest || ""}\ndependency_closure_digest=${evidence.dependencyClosureDigest || evidence.releaseInputDigest || ""}\nrelease_identity_digest=${evidence.releaseIdentityDigest || ""}\nevidence_repository=${evidenceRepository}\nevidence_run_id=${evidenceRunId}\nevidence_artifact=${evidenceArtifact}\n`);
  }
  process.stdout.write(`Promotion evidence verified for ${evidence.unit} ${evidence.sourceSha} from ${evidence.target}.\n`);
} else if (mode === "digest") {
  const unit = required("PROMOTION_UNIT");
  const sourceSha = required("PROMOTION_SOURCE_SHA");
  const digest = process.env.PROMOTION_RELEASE_INPUT_DIGEST || releaseInputDigest(unit, sourceSha);
  if (!digest) throw new Error(`no release surface mapping exists for ${unit}; provide PROMOTION_RELEASE_INPUT_DIGEST explicitly`);
  process.stdout.write(`${digest}\n`);
} else if (mode === "identity") {
  const schemaVersion = requestedEvidenceSchemaVersion();
  const identity = schemaVersion === 4 ? buildV4IdentityFromEnv().identity : buildIdentityFromEnv();
  process.stdout.write(`${JSON.stringify(identity)}\n`);
} else {
  throw new Error("usage: promotion-evidence.mjs write|verify <file> | digest | identity");
}
