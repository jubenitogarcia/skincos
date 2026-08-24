import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isProductionWebsiteConfig,
  parseActiveBeautyMovementCampaignCount,
  writeBeautyMovementEnabledConfig,
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
