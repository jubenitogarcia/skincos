import assert from "node:assert/strict";
import test from "node:test";

import { validatePontoCoreBootstrapLive } from "./ponto-core-bootstrap-precondition.mjs";

const catalogDeployment = "d88aa85e-a90b-4fd0-b03b-14bf4c6fc248";
const regeneratedDeployment = "e71a4483-da7a-4fee-9189-1543b03795a9";
const bootstrapVersion = "0ee7a2fe-deff-4f37-bcda-c35ad54b68f3";

const live = (deploymentId = catalogDeployment, versionId = bootstrapVersion) => ({
  exists: true,
  attestation: {
    target: "staging",
    activeDeploymentId: deploymentId,
    activeVersionId: versionId,
    activeVersions: [{ versionId, percentage: 100 }],
  },
});

test("accepts the cataloged bootstrap deployment and version", () => {
  assert.deepEqual(
    validatePontoCoreBootstrapLive({
      live: live(),
      expectedDeployment: catalogDeployment,
      expectedVersion: bootstrapVersion,
      target: "staging",
    }),
    {
      deploymentId: catalogDeployment,
      catalogDeploymentId: catalogDeployment,
      deploymentDrifted: false,
      versionId: bootstrapVersion,
    },
  );
});

test("accepts a recovery-regenerated deployment when the immutable bootstrap version remains exact", () => {
  const result = validatePontoCoreBootstrapLive({
    live: live(regeneratedDeployment),
    expectedDeployment: catalogDeployment,
    expectedVersion: bootstrapVersion,
    target: "staging",
  });
  assert.equal(result.deploymentId, regeneratedDeployment);
  assert.equal(result.catalogDeploymentId, catalogDeployment);
  assert.equal(result.deploymentDrifted, true);
});

test("rejects a different live bootstrap version even when its deployment is valid", () => {
  assert.throws(
    () => validatePontoCoreBootstrapLive({
      live: live(regeneratedDeployment, "11111111-1111-4111-8111-111111111111"),
      expectedDeployment: catalogDeployment,
      expectedVersion: bootstrapVersion,
      target: "staging",
    }),
    /version differs from the cataloged bootstrap/,
  );
});

test("rejects a split or partial active version set", () => {
  const current = live(regeneratedDeployment);
  current.attestation.activeVersions = [
    { versionId: bootstrapVersion, percentage: 99 },
    { versionId: "11111111-1111-4111-8111-111111111111", percentage: 1 },
  ];
  assert.throws(
    () => validatePontoCoreBootstrapLive({
      live: current,
      expectedDeployment: catalogDeployment,
      expectedVersion: bootstrapVersion,
      target: "staging",
    }),
    /only the cataloged bootstrap version at 100%/,
  );
});
