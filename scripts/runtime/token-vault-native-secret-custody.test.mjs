import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { parseNativeCredentials } from "./token-vault-native-secret-custody.mjs";

const staging = [
  "TOKEN_VAULT_META_ADS_CONFIG_TOKEN=config-bearer",
  "TOKEN_VAULT_STAGING_BASE_URL=https://staging.example.invalid",
  "ENABLE_TOKEN_VAULT_DEPLOY_STAGING=true",
  "CONFIRM_STAGING_TRACKING_FIXTURE=true",
  "TOKEN_VAULT_N8N_API_TOKEN=operational-bearer",
  "META_ADS_ACCESS_TOKEN=externally-issued",
  "META_ADS_ACCOUNT_ID=act_123456",
  "META_PIXEL_ID=456789",
  "META_ADS_API_VERSION=v25.0",
  "META_ADS_NOVOHAMBURGO_PAGE_ID=111111",
  "META_ADS_BARRASHOPPPINGSUL_PAGE_ID=222222",
].join("\n");

test("native staging custody accepts only its bounded key set", () => {
  const result = parseNativeCredentials(staging, "staging");
  assert.equal(Object.keys(result).length, 11);
  assert.equal(result.META_ADS_ACCESS_TOKEN, "externally-issued");
  assert.throws(() => parseNativeCredentials(`${staging}\nTOKEN_VAULT_PRODUCTION_BASE_URL=https://production.example.invalid`, "staging"), /unsafe record/);
  assert.throws(() => parseNativeCredentials(`${staging}\nMETA_ADS_ACCESS_TOKEN=again`, "staging"), /unsafe record/);
  assert.throws(() => parseNativeCredentials(`${staging}\nUNKNOWN_SECRET=x`, "staging"), /unsafe record/);
  assert.throws(() => parseNativeCredentials(staging.replace("externally-issued", "bad\rvalue"), "staging"), /unsafe record/);
});

test("credential loader refuses a checkout or non-root invocation before reading custody", () => {
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "token-vault-native-secret-custody.mjs"),
    "readiness", "--source-sha", "a".repeat(40), "--target", "staging",
    "--preview-evidence", "/private/preview", "--observation-file", "/private/observation"],
  { encoding: "utf8", env: { PATH: process.env.PATH, WSL_DISTRO_NAME: "Ubuntu-24.04" } });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /selected root-owned Ubuntu-24.04 release/);
});

test("production custody excludes staging Meta source and requires its own configuration", () => {
  const production = [
    "TOKEN_VAULT_META_ADS_CONFIG_TOKEN=production-config",
    "TOKEN_VAULT_PRODUCTION_BASE_URL=https://production.example.invalid",
    "ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY=true",
    "TOKEN_VAULT_ANALYTICS_API_TOKEN=separate-analytics",
  ].join("\n");
  assert.equal(parseNativeCredentials(production, "production").TOKEN_VAULT_ANALYTICS_API_TOKEN, "separate-analytics");
  assert.throws(() => parseNativeCredentials(`${production}\nMETA_ADS_ACCESS_TOKEN=forbidden`, "production"), /unsafe record/);
  assert.throws(() => parseNativeCredentials(production.replace("ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY=true", ""), "production"), /incomplete/);
});
