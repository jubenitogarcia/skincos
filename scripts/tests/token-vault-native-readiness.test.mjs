import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../codex-autonomy-lib.mjs";
import { readRemoteFacts, validateEnvironment, verifyIncumbentConfigBearer, verifyReadinessEvidence } from "../token-vault-native-readiness.mjs";

const staging = {
  TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer",
  TOKEN_VAULT_STAGING_BASE_URL: "https://api-staging.skincos.com.br",
  ENABLE_TOKEN_VAULT_DEPLOY_STAGING: "true",
  CONFIRM_STAGING_TRACKING_FIXTURE: "true",
  META_ADS_NOVOHAMBURGO_PAGE_ID: "12345",
  META_ADS_BARRASHOPPPINGSUL_PAGE_ID: "67890",
  META_ADS_API_VERSION: "v25.0",
  META_ADS_ACCESS_TOKEN: "meta-source-opaque",
  META_PIXEL_ID: "123456",
  META_ADS_ACCOUNT_ID: "act_987654",
  TOKEN_VAULT_N8N_API_TOKEN: "x".repeat(32),
};

test("native staging readiness rejects missing or reused protected inputs", () => {
  assert.equal(validateEnvironment("staging", staging).target, "staging");
  assert.throws(() => validateEnvironment("staging", { ...staging, META_ADS_BARRASHOPPPINGSUL_PAGE_ID: "12345" }), /distinct/);
  assert.throws(() => validateEnvironment("staging", { ...staging, TOKEN_VAULT_N8N_API_TOKEN: "config-bearer" }), /short or reused/);
  assert.throws(() => validateEnvironment("staging", { ...staging, TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "\ufeffbad" }), /printable ASCII/);
  assert.throws(() => validateEnvironment("staging", { ...staging, CONFIRM_STAGING_TRACKING_FIXTURE: "false" }), /confirmed/);
});

test("native production readiness retains its own environment flag", () => {
  const production = {
    TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer",
    TOKEN_VAULT_PRODUCTION_BASE_URL: "https://api.skincos.com.br",
    ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY: "true",
  };
  assert.equal(validateEnvironment("production", production).target, "production");
  assert.throws(() => validateEnvironment("production", { ...production, ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY: "false" }), /must be true/);
});

test("read-only remote facts require exact incumbent, inherited secrets and D1 bookmark", () => {
  const version = "a".repeat(8) + "-" + "b".repeat(4) + "-" + "c".repeat(4) + "-" + "d".repeat(4) + "-" + "e".repeat(12);
  const rows = [
    [{ name: "skincos-token-vault-staging" }],
    [{ name: "TOKEN_VAULT_API_TOKEN" }, { name: "TOKEN_VAULT_ENCRYPTION_KEY" }],
    { versions: [{ version_id: version, percentage: 100 }] },
    { version: "beta" },
    { bookmark: "abcde12345abcde12345" },
  ];
  const calls = [];
  const run = (args) => { calls.push(args); return rows.shift(); };
  assert.deepEqual(readRemoteFacts("staging", "/repo", run), {
    database: "skincos-token-vault-staging",
    incumbentVersionId: version,
    d1TimeTravelBookmark: "abcde12345abcde12345",
    analyticsBindingPresent: false,
    configBindingPresent: false,
  });
  assert.equal(calls.length, 5);
  assert.equal(rows.length, 0);
});

test("incumbent config bearer authenticates against the live read-only authority", async () => {
  let request;
  const result = await verifyIncumbentConfigBearer({ target: "staging", baseUrl: staging.TOKEN_VAULT_STAGING_BASE_URL,
    bearer: staging.TOKEN_VAULT_META_ADS_CONFIG_TOKEN,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ready: false, config_authority_mode: "legacy_bootstrap",
        config_authority_revision: `legacy:${"a".repeat(64)}` }), { status: 409 });
    } });
  assert.equal(result.mode, "legacy_bootstrap");
  assert.equal(request.url.endsWith("/internal/token-vault/v1/meta-ads-publish/config"), true);
  assert.equal(request.options.headers.Authorization, `Bearer ${staging.TOKEN_VAULT_META_ADS_CONFIG_TOKEN}`);
  await assert.rejects(() => verifyIncumbentConfigBearer({ target: "production", baseUrl: "https://api.skincos.com.br",
    bearer: "test-bearer", fetchImpl: async () => new Response(JSON.stringify({ ready: false,
      config_authority_mode: "legacy_bootstrap", config_authority_revision: `legacy:${"a".repeat(64)}` }), { status: 409 }) }),
  /rejected/);
});

test("production refuses a missing inherited operational bearer", () => {
  const rows = [
    [{ name: "skincos-token-vault" }],
    [{ name: "TOKEN_VAULT_API_TOKEN" }, { name: "TOKEN_VAULT_ENCRYPTION_KEY" }],
  ];
  assert.throws(() => readRemoteFacts("production", "/repo", () => rows.shift()), /TOKEN_VAULT_N8N_API_TOKEN/);
});

test("readiness record cannot be reused for another target or modified after capture", () => {
  const body = {
    schemaVersion: 1,
    kind: "skincos-token-vault-native-readiness",
    producer: "codex-ubuntu-24.04",
    target: "staging",
    sourceSha: "a".repeat(40),
    sourceTree: "b".repeat(40),
    releaseInputDigest: "c".repeat(64),
    previewEvidenceDigest: "d".repeat(64),
    database: "skincos-token-vault-staging",
    incumbentVersionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    d1TimeTravelBookmark: "abcde12345abcde12345",
    analyticsBindingPresent: false,
    configBindingPresent: false,
    incumbentConfigAuthorityMode: "binding_absent",
    readOnly: true,
    mutationAuthorized: false,
    createdAt: "2026-09-30T12:00:00.000Z",
  };
  const evidence = { ...body, evidenceDigest: createHash("sha256").update(canonicalJson(body)).digest("hex") };
  assert.equal(verifyReadinessEvidence(evidence, body), evidence);
  assert.throws(() => verifyReadinessEvidence(evidence, { ...body, target: "production" }), /target differs/);
  assert.throws(() => verifyReadinessEvidence({ ...evidence, incumbentVersionId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }, body), /digest does not match/);
  const authenticated = { ...body, configBindingPresent: true, incumbentConfigAuthorityMode: "tracking_ready" };
  const authenticatedEvidence = { ...authenticated,
    evidenceDigest: createHash("sha256").update(canonicalJson(authenticated)).digest("hex") };
  assert.equal(verifyReadinessEvidence(authenticatedEvidence, authenticated), authenticatedEvidence);
  assert.throws(() => verifyReadinessEvidence({ ...authenticatedEvidence,
    incumbentConfigAuthorityMode: "binding_absent" }, authenticated), /invalid gate result/);
});
