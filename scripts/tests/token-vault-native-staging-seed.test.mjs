import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attestStagingSource,
  rollbackStagingSeed,
  sealStagingSeed,
} from "../token-vault-native-staging-seed.mjs";

const sourceSha = "a".repeat(40);
const transactionId = "native-release-001";
const operationKey = `meta-ads-staging-seed:${sourceSha.slice(0, 12)}:${transactionId}`;
const contract = "meta-ads-tracking-v20/staging-synthetic-seed/v2";
const previewUrl = "https://ffffffff-skincos-token-vault-staging.skincos.workers.dev";
const env = {
  META_ADS_ACCESS_TOKEN: "opaque-meta-source",
  META_ADS_ACCOUNT_ID: "act_123456",
  META_PIXEL_ID: "789012",
  META_ADS_API_VERSION: "v25.0",
  META_ADS_NOVOHAMBURGO_PAGE_ID: "111111",
  META_ADS_BARRASHOPPPINGSUL_PAGE_ID: "222222",
};

function withSeedFile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-seed-test-"));
  const seedFile = path.join(directory, "seed");
  fs.writeFileSync(seedFile, "s".repeat(64), { mode: 0o600 });
  return Promise.resolve().then(() => run(seedFile)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test("staging seed is journaled before the Meta mutation and keeps the same operation key", async () => withSeedFile(async (seedFile) => {
  const order = [];
  const fetchImpl = async (url, options) => {
    order.push("fetch");
    assert.equal(url, `${previewUrl}/internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed`);
    const body = JSON.parse(options.body);
    assert.equal(body.operation_key, operationKey);
    return new Response(JSON.stringify({ ok: true, seed: "sealed", operation_status: "sealed", replayed: false, operation_key: operationKey, contract_version: contract }), { status: 200 });
  };
  const result = await sealStagingSeed({
    previewUrl, seedFile, sourceSha, transactionId, env,
    authorize: async () => { order.push("lease"); },
    markAttempt: async (key) => { assert.equal(key, operationKey); order.push("journal"); },
    fetchImpl,
  });
  assert.deepEqual(order, ["lease", "journal", "fetch"]);
  assert.deepEqual(result, { status: "sealed", operationKey });
}));

test("staging attestation rejects a mismatched candidate response", async () => withSeedFile(async (seedFile) => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, attestation: "match", operation_key: "wrong", contract_version: contract, requestId: "r" }), { status: 200 });
  await assert.rejects(() => attestStagingSource({ previewUrl, seedFile, sourceSha, transactionId, env, fetchImpl }), /attestation failed/);
}));

test("staging rollback accepts only its exact operation and contract", async () => withSeedFile(async (seedFile) => {
  let authorizations = 0;
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, rolled_back: true, operation_status: "rolled_back", replayed: false, operation_key: operationKey, contract_version: contract }), { status: 200 });
  const result = await rollbackStagingSeed({ previewUrl, seedFile, operationKey, env, authorize: async () => { authorizations += 1; }, fetchImpl });
  assert.equal(result, "rolled_back");
  assert.equal(authorizations, 1);
}));
