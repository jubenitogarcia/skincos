import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  createPromotionEvidenceV4,
  createReleaseIdentityV4WithDigest,
  verifyPromotionEvidenceV4,
  verifyReleaseIdentityV4,
} from '../src/index.js';

const sha1 = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const sha256 = (character) => character.repeat(64);

function releaseInput() {
  return {
    module: 'meta-ads-report',
    sourceRepository: 'JubenitoGarcia/Skincos-Meta-Ads-Reporting',
    sourceCommit: sha1,
    sourceTree: tree,
    sourceRef: 'refs/heads/main',
    deliveryContractVersion: '1.0.0',
    contractManifestDigest: sha256('c'),
    dependencyClosureDigest: sha256('d'),
    contractVersions: [
      { name: '@jubenitogarcia/skincos-edge-adapters', version: '1.0.0', integrity: 'sha256:' + sha256('e') },
      { name: '@jubenitogarcia/skincos-contracts', version: '1.0.0', integrity: 'sha512-ZmFrZS1wYWNrYWdlLWludGVncml0eQ==' },
    ],
    artifacts: [
      { id: 'worker.tgz', digest: sha256('f'), fileDigest: sha256('1') },
    ],
  };
}

test('canonical JSON preserves values while sorting object keys', () => {
  assert.equal(
    canonicalJson({ z: [{ b: 2, a: 1 }], a: true }),
    '{"a":true,"z":[{"a":1,"b":2}]}',
  );
});

test('release identity v4 is repository-aware and excludes later evidence artifacts', async () => {
  const identity = await createReleaseIdentityV4WithDigest(releaseInput());
  assert.equal(identity.schemaVersion, 2);
  assert.equal(identity.sourceRepository, 'jubenitogarcia/skincos-meta-ads-reporting');
  assert.equal(identity.artifacts[0].fileDigest, sha256('1'));
  assert.equal(Object.hasOwn(identity, 'evidenceArtifact'), false);
  assert.match(identity.releaseIdentityDigest, /^[0-9a-f]{64}$/);
  assert.equal((await verifyReleaseIdentityV4(identity)).valid, true);

  const tampered = { ...identity, sourceRepository: 'jubenitogarcia/other-repository' };
  assert.equal((await verifyReleaseIdentityV4(tampered)).valid, false);
});

test('promotion evidence v4 keeps evidence and predecessor provenance outside the identity', async () => {
  const evidence = await createPromotionEvidenceV4({
    target: 'staging',
    createdAt: '2026-08-28T14:23:04.000Z',
    evidenceRepository: 'JubenitoGarcia/Skincos-Release-Evidence',
    evidenceRunId: '33179818924',
    evidenceArtifact: 'promotion-evidence.json',
    predecessorRepository: 'JubenitoGarcia/Skincos-Release-Evidence',
    predecessorRunId: '33179681322',
    predecessorArtifact: 'predecessor-evidence.json',
    releaseIdentity: releaseInput(),
  });
  assert.equal(evidence.schemaVersion, 4);
  assert.equal(evidence.evidenceRepository, 'jubenitogarcia/skincos-release-evidence');
  assert.equal(evidence.predecessorRunId, '33179681322');
  assert.equal(Object.hasOwn(evidence.releaseIdentity, 'evidenceArtifact'), false);
  const verified = await verifyPromotionEvidenceV4(evidence, {
    target: 'staging',
    sourceRepository: 'jubenitogarcia/skincos-meta-ads-reporting',
    sourceCommit: sha1,
    releaseIdentityDigest: evidence.releaseIdentityDigest,
  });
  assert.equal(verified.identity.module, 'meta-ads-report');
});
