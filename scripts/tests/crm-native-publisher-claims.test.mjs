import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  CrmNativePublisherContractError,
  CRM_NATIVE_PUBLISHER_DOMAIN,
  CRM_NATIVE_PUBLISHER_SERVICE,
  CRM_NATIVE_PUBLISHER_TARGET,
  CRM_NATIVE_PUBLISHER_WORKFLOW,
  canonicalJson,
  publisherPolicySha256,
  sha256Hex,
  signPublisherAuthorization,
  verifyPublisherAuthorization,
} from "../runtime/crm-native-publisher-claims.mjs";

const SOURCE_SHA = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const SOURCE_ARCHIVE_SHA256 = "c".repeat(64);
const STAGING_PROOF_SHA256 = "d".repeat(64);
const DEPENDENCY_ARCHIVE_SHA256 = "e".repeat(64);
const DEPENDENCY_MANIFEST_SHA256 = "6".repeat(64);
const INCUMBENT_STATE_SHA256 = "f".repeat(64);
const NOW = new Date("2026-09-10T12:00:00.000Z");

const keyPair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" });

function policy() {
  return {
    schemaVersion: 1,
    kind: "skincos-crm-native-publisher-policy",
    repositoryId: "998877",
    repository: "jubenitogarcia/skincos",
    runnerUser: "skincos-actions",
    source: {
      sourceSha: SOURCE_SHA,
      sourceTree: SOURCE_TREE,
      sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
      sourceArchiveBytes: 1024 * 1024,
      artifactName: `release-source-${SOURCE_SHA}`,
      artifactRunId: "34498321656",
    },
    stagingProof: {
      sourceSha: SOURCE_SHA,
      sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
      receiptSha256: STAGING_PROOF_SHA256,
    },
    runtimeAttestation: {
      receiptSha256: "7".repeat(64),
      mediaRouteMode: "disabled",
    },
    coordination: {
      resource: "release:crm-native",
      module: "crm-native",
    },
    signing: { keyId: "crm-native-2026-09", publicKeyPem },
    target: {
      name: "production",
      service: "crm.service",
      releaseBase: "/opt/skincos/releases",
      currentLink: "/opt/skincos/current/crm-service",
      previousLink: "/opt/skincos/current/crm-service.previous",
      unitFile: "/etc/systemd/system/crm.service",
      stateRoot: "/var/lib/skincos-runtime",
      configRoot: "/etc/skincos",
      logRoot: "/var/log/skincos",
      legacyRuntimeMode: "disabled",
    },
    maximumArchiveBytes: 32 * 1024 * 1024,
    maximumSourceExtractedBytes: 64 * 1024 * 1024,
    maximumSourceEntries: 100_000,
    maximumDependencyArchiveBytes: 512 * 1024 * 1024,
    maximumDependencyExtractedBytes: 512 * 1024 * 1024,
    maximumDependencyEntries: 50_000,
  };
}

function claims(binding = policy()) {
  return {
    schemaVersion: 1,
    domain: CRM_NATIVE_PUBLISHER_DOMAIN,
    operation: "publish",
    authorizationId: "b1f3c5d7-1111-4111-8111-123456789abc",
    policySha256: publisherPolicySha256(binding),
    repositoryId: binding.repositoryId,
    repository: binding.repository,
    workflowPath: CRM_NATIVE_PUBLISHER_WORKFLOW,
    workflowJob: "publish",
    githubRef: "refs/heads/main",
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    sourceArchiveBytes: binding.source.sourceArchiveBytes,
    dependencyArchiveSha256: DEPENDENCY_ARCHIVE_SHA256,
    dependencyArchiveBytes: 256 * 1024 * 1024,
    dependencyManifestSha256: DEPENDENCY_MANIFEST_SHA256,
    dependencyManifestBytes: 2048,
    artifactName: binding.source.artifactName,
    sourceArtifactRunId: binding.source.artifactRunId,
    workflowRunId: "34498400000",
    runAttempt: "1",
    target: CRM_NATIVE_PUBLISHER_TARGET,
    service: CRM_NATIVE_PUBLISHER_SERVICE,
    incumbentStateSha256: INCUMBENT_STATE_SHA256,
    stagingProofSha256: STAGING_PROOF_SHA256,
    runtimeAttestationSha256: binding.runtimeAttestation.receiptSha256,
    coordinationProofSha256: "8".repeat(64),
    coordinationResource: binding.coordination.resource,
    coordinationModule: binding.coordination.module,
    coordinationLeaseId: "c1f3c5d7-1111-4111-8111-123456789abc",
    coordinationFencingToken: 1,
    coordinationIntentDigest: "9".repeat(64),
    issuedAt: "2026-09-10T11:59:00.000Z",
    expiresAt: "2026-09-10T12:04:00.000Z",
    singleUse: true,
  };
}

function signed({ binding = policy(), requestedClaims = claims(binding), signingKey = privateKeyPem } = {}) {
  const coordinationProof = {
    resource: requestedClaims.coordinationResource,
    leaseId: requestedClaims.coordinationLeaseId,
    fencingToken: requestedClaims.coordinationFencingToken,
    intentDigest: requestedClaims.coordinationIntentDigest,
  };
  requestedClaims.coordinationProofSha256 = sha256Hex(canonicalJson(coordinationProof));
  return signPublisherAuthorization({
    claims: requestedClaims,
    privateKeyPem: signingKey,
    keyId: binding.signing.keyId,
    coordinationProof,
  });
}

test("a custody-bound CRM authorization verifies only for the pinned candidate", () => {
  const binding = policy();
  const document = signed({ binding });
  assert.deepEqual(verifyPublisherAuthorization(document, { policy: binding, now: NOW }), document.claims);
});

test("claims cannot substitute a different source or incumbent service state", () => {
  const binding = policy();
  const requestedClaims = claims(binding);
  requestedClaims.sourceSha = "9".repeat(40);
  assert.throws(
    () => verifyPublisherAuthorization(signed({ binding, requestedClaims }), { policy: binding, now: NOW }),
    CrmNativePublisherContractError,
  );

  const stateChanged = claims(binding);
  stateChanged.incumbentStateSha256 = "8".repeat(64);
  const document = signed({ binding, requestedClaims: stateChanged });
  assert.deepEqual(verifyPublisherAuthorization(document, { policy: binding, now: NOW }), stateChanged);
  // The signed state is intentionally accepted by the pure contract; the
  // root publisher must compare it to its own fresh preflight before acting.
});

test("an altered signed document, stale claim, or wrong signer fails closed", () => {
  const binding = policy();
  const document = signed({ binding });
  document.claims.dependencyArchiveSha256 = "0".repeat(64);
  assert.throws(
    () => verifyPublisherAuthorization(document, { policy: binding, now: NOW }),
    CrmNativePublisherContractError,
  );

  const malformedManifest = claims(binding);
  malformedManifest.dependencyManifestBytes = 1;
  assert.throws(
    () => verifyPublisherAuthorization(signed({ binding, requestedClaims: malformedManifest }), { policy: binding, now: NOW }),
    CrmNativePublisherContractError,
  );

  const stale = claims(binding);
  stale.issuedAt = "2026-09-10T11:50:00.000Z";
  stale.expiresAt = "2026-09-10T11:55:00.000Z";
  assert.throws(
    () => verifyPublisherAuthorization(signed({ binding, requestedClaims: stale }), { policy: binding, now: NOW }),
    CrmNativePublisherContractError,
  );

  const alternate = crypto.generateKeyPairSync("ed25519");
  const wrongKey = alternate.privateKey.export({ type: "pkcs8", format: "pem" });
  const wrongSignature = signed({ binding, signingKey: wrongKey });
  assert.throws(
    () => verifyPublisherAuthorization(wrongSignature, { policy: binding, now: NOW }),
    CrmNativePublisherContractError,
  );
});

test("policy rejects an archive whose signed source bytes exceed its own limit", () => {
  const binding = policy();
  binding.maximumArchiveBytes = binding.source.sourceArchiveBytes - 1;
  assert.throws(
    () => publisherPolicySha256(binding),
    CrmNativePublisherContractError,
  );
});
