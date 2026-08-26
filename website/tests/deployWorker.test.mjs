import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertProductionReleaseReconciliationContract,
  isProductionWebsiteConfig,
  parseActiveBeautyMovementCampaignCount,
  parseCurrentWorkerVersionId,
  writeBeautyMovementEnabledConfig,
  writeDeployReleaseManifest,
} from "../scripts/deploy-worker.mjs";

const productionConfig = `name = "espacofacial-site"

[vars]
BEAUTY_MOVEMENT_ENABLED = "false"

[[d1_databases]]
binding = "BEAUTY_MOVEMENT_DB"
database_name = "espacofacial-beauty-movement"

[env.staging.vars]
BEAUTY_MOVEMENT_ENABLED = "false"
`;

test("parses an attested active campaign count without depending on Wrangler log noise", () => {
  const output = `wrangler progress\n${JSON.stringify([{ results: [{ count: 1 }] }])}\n`;
  assert.equal(parseActiveBeautyMovementCampaignCount(output), 1);
  assert.equal(parseActiveBeautyMovementCampaignCount(JSON.stringify([{ results: [{ count: 0 }] }])), 0);
});

test("only the production config is eligible for active-campaign continuity", () => {
  assert.equal(
    isProductionWebsiteConfig({ configPath: "wrangler.toml", wranglerEnvironment: null, content: productionConfig }),
    true,
  );
  assert.equal(
    isProductionWebsiteConfig({ configPath: "wrangler.toml", wranglerEnvironment: "staging", content: productionConfig }),
    false,
  );
  assert.equal(
    isProductionWebsiteConfig({ configPath: "wrangler-skincos.toml", wranglerEnvironment: null, content: productionConfig }),
    false,
  );
});

test("production deploys fail closed without the ownership-attested reconciliation contract", () => {
  assert.doesNotThrow(() => assertProductionReleaseReconciliationContract({
    productionDeployment: true,
    manifestPath: "/private/runtime/candidate.json",
    releaseOwner: "bm-123456789-2",
  }));
  assert.throws(
    () => assertProductionReleaseReconciliationContract({
      productionDeployment: true,
      manifestPath: null,
      releaseOwner: "bm-123456789-2",
    }),
    /deploy_production_reconciliation_contract_missing/,
  );
  assert.throws(
    () => assertProductionReleaseReconciliationContract({
      productionDeployment: true,
      manifestPath: "/private/runtime/candidate.json",
      releaseOwner: null,
    }),
    /deploy_production_reconciliation_contract_missing/,
  );
  assert.doesNotThrow(() => assertProductionReleaseReconciliationContract({
    productionDeployment: false,
    manifestPath: null,
    releaseOwner: null,
  }));
});

test("enabled overlay changes only the production flag and is disposable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beauty-movement-deploy-test-"));
  const configPath = path.join(root, "wrangler.toml");
  try {
    const overlayPath = writeBeautyMovementEnabledConfig(configPath, productionConfig);
    const overlay = fs.readFileSync(overlayPath, "utf8");
    assert.match(overlay, /\[vars\][\s\S]*BEAUTY_MOVEMENT_ENABLED = "true"/);
    assert.match(overlay, /\[env\.staging\.vars\][\s\S]*BEAUTY_MOVEMENT_ENABLED = "false"/);
    fs.rmSync(overlayPath, { force: true });
    assert.equal(fs.existsSync(overlayPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release manifest records a bounded rollback target without campaign data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beauty-movement-release-manifest-"));
  const filePath = path.join(root, "evidence", "deploy.json");
  try {
    writeDeployReleaseManifest({
      filePath,
      runnerTemp: root,
      phase: "candidate",
      releaseSha: "a".repeat(40),
      releaseOwner: "bm-123456789-2",
      previousVersionId: "11111111-1111-4111-8111-111111111111",
      candidateVersionId: "22222222-2222-4222-8222-222222222222",
      activeCampaignCount: 1,
      previousBuildSha: "b".repeat(40),
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {
      version: 1,
      phase: "candidate",
      releaseSha: "a".repeat(40),
      releaseOwner: "bm-123456789-2",
      previousVersionId: "11111111-1111-4111-8111-111111111111",
      candidateVersionId: "22222222-2222-4222-8222-222222222222",
      beautyMovementActiveCampaignCount: 1,
      previousBuildSha: "b".repeat(40),
    });
    assert.throws(
      () => writeDeployReleaseManifest({
        filePath: path.join(root, "..", "escaped.json"),
        runnerTemp: root,
        phase: "prepared",
        releaseSha: "a".repeat(40),
        releaseOwner: "bm-123456789-2",
        previousVersionId: null,
        candidateVersionId: "22222222-2222-4222-8222-222222222222",
        activeCampaignCount: 0,
        previousBuildSha: null,
      }),
      /deploy_release_manifest_path_invalid/,
    );
    writeDeployReleaseManifest({
      filePath,
      runnerTemp: root,
      phase: "prepared",
      releaseSha: "a".repeat(40),
      releaseOwner: "bm-123456789-2",
      previousVersionId: "11111111-1111-4111-8111-111111111111",
      candidateVersionId: null,
      activeCampaignCount: 1,
      previousBuildSha: "b".repeat(40),
    });
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).phase, "prepared");
    assert.throws(
      () => writeDeployReleaseManifest({
        filePath,
        runnerTemp: root,
        phase: "prepared",
        releaseSha: "a".repeat(40),
        releaseOwner: "not-an-owner",
        previousVersionId: "11111111-1111-4111-8111-111111111111",
        candidateVersionId: null,
        activeCampaignCount: 1,
        previousBuildSha: "b".repeat(40),
      }),
      /deploy_release_manifest_owner_invalid/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("current Worker version parser selects the active 100 percent deployment", () => {
  assert.equal(
    parseCurrentWorkerVersionId("Created: today\n(100%) 33333333-3333-4333-8333-333333333333\n"),
    "33333333-3333-4333-8333-333333333333",
  );
  assert.throws(() => parseCurrentWorkerVersionId("no active deployment"), /worker_current_version_unreadable/);
});
