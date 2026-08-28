import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createPromotionEvidenceV4,
  verifyPromotionEvidenceV4,
} from '../../packages/skincos-delivery-contract/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha1 = (character) => character.repeat(40);
const sha256 = (character) => character.repeat(64);

function runPromotion(args, env) {
  return execFileSync(process.execPath, ['.github/scripts/promotion-evidence.mjs', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function v4Environment() {
  return {
    PROMOTION_EVIDENCE_SCHEMA_VERSION: '4',
    PROMOTION_UNIT: 'synthetic-unit',
    PROMOTION_TARGET: 'preview',
    PROMOTION_SOURCE_REPOSITORY: 'jubenitogarcia/skincos-meta-ads-reporting',
    PROMOTION_SOURCE_COMMIT: sha1('a'),
    PROMOTION_SOURCE_TREE: sha1('b'),
    PROMOTION_SOURCE_REF: 'refs/heads/main',
    PROMOTION_DELIVERY_CONTRACT_VERSION: '1.0.0',
    PROMOTION_CONTRACT_MANIFEST_DIGEST: sha256('c'),
    PROMOTION_RELEASE_INPUT_DIGEST: sha256('d'),
    PROMOTION_DEPENDENCY_CLOSURE_DIGEST: sha256('d'),
    PROMOTION_CONTRACT_VERSIONS_JSON: JSON.stringify([
      { name: '@jubenitogarcia/skincos-contracts', version: '1.0.0', integrity: sha256('e') },
    ]),
    PROMOTION_ARTIFACT_IDENTITIES_JSON: JSON.stringify([
      { id: 'worker.tgz', digest: sha256('f'), fileDigest: sha256('1') },
    ]),
    GITHUB_REPOSITORY: 'jubenitogarcia/skincos-release-evidence',
    GITHUB_RUN_ID: '33179818924',
    PROMOTION_EVIDENCE_REPOSITORY: 'jubenitogarcia/skincos-release-evidence',
    PROMOTION_EVIDENCE_ARTIFACT: 'promotion-evidence-synthetic-unit',
  };
}

function verificationEnvironment(evidence) {
  return {
    ...v4Environment(),
    GITHUB_REPOSITORY: 'jubenitogarcia/skincos-release-controller',
    PROMOTION_EXPECTED_TARGET: 'preview',
    PROMOTION_EXPECTED_SOURCE_REPOSITORY: evidence.sourceRepository,
    PROMOTION_EXPECTED_SOURCE_COMMIT: evidence.sourceSha,
    PROMOTION_EXPECTED_SOURCE_TREE: evidence.sourceTree,
    PROMOTION_EXPECTED_SOURCE_REF: evidence.sourceRef,
    PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST: evidence.releaseInputDigest,
    PROMOTION_EXPECTED_DELIVERY_CONTRACT_VERSION: evidence.deliveryContractVersion,
    PROMOTION_EXPECTED_CONTRACT_MANIFEST_DIGEST: evidence.contractManifestDigest,
    PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON: JSON.stringify(evidence.contractVersions),
    PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON: JSON.stringify(evidence.artifacts),
    PROMOTION_EXPECTED_EVIDENCE_REPOSITORY: evidence.evidenceRepository,
    PROMOTION_EXPECTED_EVIDENCE_RUN_ID: evidence.evidenceRunId,
    PROMOTION_EXPECTED_EVIDENCE_ARTIFACT: evidence.evidenceArtifact,
    PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST: evidence.releaseIdentityDigest,
  };
}

test('promotion evidence gate and delivery-contract package interoperate in both directions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-promotion-contract-interop-'));
  const gateEvidencePath = path.join(directory, 'gate-evidence.json');
  const packageEvidencePath = path.join(directory, 'package-evidence.json');
  const environment = v4Environment();

  runPromotion(['write', gateEvidencePath], environment);
  const gateEvidence = JSON.parse(fs.readFileSync(gateEvidencePath, 'utf8'));
  const packageVerification = await verifyPromotionEvidenceV4(gateEvidence, {
    target: 'preview',
    sourceRepository: gateEvidence.sourceRepository,
    sourceCommit: gateEvidence.sourceSha,
    releaseIdentityDigest: gateEvidence.releaseIdentityDigest,
  });
  assert.equal(packageVerification.evidence.releaseIdentityDigest, gateEvidence.releaseIdentityDigest);

  const packageEvidence = await createPromotionEvidenceV4({
    target: 'preview',
    createdAt: '2026-08-28T14:23:04.000Z',
    evidenceRepository: gateEvidence.evidenceRepository,
    evidenceRunId: gateEvidence.evidenceRunId,
    evidenceArtifact: gateEvidence.evidenceArtifact,
    releaseIdentity: gateEvidence.releaseIdentity,
  });
  fs.writeFileSync(packageEvidencePath, `${JSON.stringify(packageEvidence)}\n`);
  runPromotion(['verify', packageEvidencePath], verificationEnvironment(packageEvidence));
});
