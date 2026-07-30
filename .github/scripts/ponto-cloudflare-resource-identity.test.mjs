import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { attestPontoCloudflareResources } from "./ponto-cloudflare-resource-identity.mjs";

const accountId = "a".repeat(32);
const stagingD1Id = "0f79d918-c11b-432a-9d0b-70f74f3347c7";
const productionD1Id = "a642ee56-1d14-40f0-8237-044a12258ba9";
const stagingKvId = "e69fe06b6abc46eca4f4c00198d078f2";
const productionKvId = "918e9a82ee9d4d9c9effd81f04e093f5";
const baseEnv = {
  CLOUDFLARE_API_TOKEN: "opaque-token",
  CLOUDFLARE_ACCOUNT_ID: accountId,
  PONTO_RESOURCE_TARGET: "staging",
  PONTO_TIMEKEEPING_D1_ID: stagingD1Id,
  PONTO_OPPOSITE_TIMEKEEPING_D1_ID: productionD1Id,
  PONTO_MODULE_CONTROL_KV_ID: stagingKvId,
  PONTO_OPPOSITE_MODULE_CONTROL_KV_ID: productionKvId,
};

const response = (result, { ok = true, status = 200, success = true } = {}) => ({
  ok,
  status,
  json: async () => ({ success, result, errors: success ? [] : [{ code: 10000 }] }),
});

const correctFetch = async (url, init) => {
  assert.equal(init.method, "GET");
  assert.equal(init.headers.authorization, "Bearer opaque-token");
  if (url === `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${stagingD1Id}?fields=uuid,name`) {
    return response({ uuid: stagingD1Id, name: "skincos-timekeeping-staging" });
  }
  if (url === `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${stagingKvId}`) {
    return response({ id: stagingKvId, title: "SKINCOS_WORKFORCE_STAGING_FLAGS" });
  }
  throw new Error(`unexpected URL ${url}`);
};

test("attests exact account-scoped D1 UUID/name and KV ID/title using GET only", async () => {
  const report = await attestPontoCloudflareResources({
    env: baseEnv,
    fetchImpl: correctFetch,
  });
  assert.equal(report.passed, true);
  assert.equal(report.target, "staging");
  assert.match(report.accountIdSha256, /^[0-9a-f]{64}$/);
  assert.match(report.d1.idSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.d1.name, "skincos-timekeeping-staging");
  assert.match(report.moduleControlKv.idSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.moduleControlKv.title, "SKINCOS_WORKFORCE_STAGING_FLAGS");
  assert.deepEqual(report.requestMethods, ["GET"]);
  assert.equal(JSON.stringify(report).includes(accountId), false);
  assert.equal(JSON.stringify(report).includes(stagingD1Id), false);
  assert.equal(JSON.stringify(report).includes(stagingKvId), false);
  assert.equal(JSON.stringify(report).includes(baseEnv.CLOUDFLARE_API_TOKEN), false);
});

test("supports a KV-only attestation for module-control and recovery paths", async () => {
  const env = { ...baseEnv };
  delete env.PONTO_TIMEKEEPING_D1_ID;
  delete env.PONTO_OPPOSITE_TIMEKEEPING_D1_ID;
  const report = await attestPontoCloudflareResources({
    env,
    fetchImpl: correctFetch,
  });
  assert.equal(report.d1, null);
  assert.equal(report.moduleControlKv.passed, true);
});

test("supports a D1-only attestation for migration-only paths", async () => {
  const env = { ...baseEnv };
  delete env.PONTO_MODULE_CONTROL_KV_ID;
  delete env.PONTO_OPPOSITE_MODULE_CONTROL_KV_ID;
  const report = await attestPontoCloudflareResources({
    env,
    fetchImpl: correctFetch,
  });
  assert.equal(report.d1.passed, true);
  assert.equal(report.moduleControlKv, null);
});

test("rejects a D1 UUID that resolves to the wrong environment name", async () => {
  await assert.rejects(
    attestPontoCloudflareResources({
      env: baseEnv,
      fetchImpl: async (url, init) => {
        const result = await correctFetch(url, init);
        if (url.includes("/d1/database/")) {
          return response({ uuid: stagingD1Id, name: "skincos-timekeeping" });
        }
        return result;
      },
    }),
    /D1 exact UUID\/name identity is invalid/,
  );
});

test("rejects a KV ID that resolves to the wrong environment title", async () => {
  await assert.rejects(
    attestPontoCloudflareResources({
      env: baseEnv,
      fetchImpl: async (url, init) => {
        const result = await correctFetch(url, init);
        if (url.includes("/storage/kv/namespaces/")) {
          return response({ id: stagingKvId, title: "skincos-module-control-production" });
        }
        return result;
      },
    }),
    /KV exact ID\/title identity is invalid/,
  );
});

test("rejects malformed custody before any API call", async () => {
  let calls = 0;
  await assert.rejects(
    attestPontoCloudflareResources({
      env: { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: "wrong" },
      fetchImpl: async () => {
        calls += 1;
        return response({});
      },
    }),
    /account or target identity is malformed/,
  );
  assert.equal(calls, 0);
});

test("rejects a selected or opposite ID that differs from the immutable inventory", async () => {
  let calls = 0;
  for (const env of [
    { ...baseEnv, PONTO_TIMEKEEPING_D1_ID: "11111111-1111-4111-8111-111111111111" },
    { ...baseEnv, PONTO_OPPOSITE_MODULE_CONTROL_KV_ID: "b".repeat(32) },
  ]) {
    await assert.rejects(
      attestPontoCloudflareResources({
        env,
        fetchImpl: async () => {
          calls += 1;
          return response({});
        },
      }),
      /selected\/opposite immutable resource IDs are invalid/,
    );
  }
  assert.equal(calls, 0);
});

test("rejects Cloudflare API failures without exposing the token", async () => {
  let message = "";
  try {
    await attestPontoCloudflareResources({
      env: baseEnv,
      fetchImpl: async () => response(null, { ok: false, status: 403, success: false }),
    });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /HTTP 403, Cloudflare 10000/);
  assert.doesNotMatch(message, /opaque-token/);
});

test("all Ponto D1/KV mutation entrypoints attest exact resource identity first", () => {
  const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const ordered = (content, guard, mutation) => {
    const guardIndex = content.indexOf(guard);
    const mutationIndex = content.indexOf(mutation);
    assert.notEqual(guardIndex, -1, `${guard} is absent`);
    assert.notEqual(mutationIndex, -1, `${mutation} is absent`);
    assert.ok(guardIndex < mutationIndex, `${guard} must precede ${mutation}`);
  };

  ordered(
    source("../workflows/deploy-timekeeping.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    "Fetch the exact staging root custody predecessor",
  );
  ordered(
    source("../workflows/cloudflare-workers-sync-ponto-secrets.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    "Attest remote secret names without creating or deploying a Worker version",
  );
  ordered(
    source("../workflows/module-availability.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    "Set isolated runtime state",
  );
  ordered(
    source("../workflows/ponto-progressive-release.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    'kv key get "module-control:timekeeping:emergency-latch"',
  );
  ordered(
    source("../workflows/ponto-emergency-latch-reset.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    'kv key put "module-control:timekeeping"',
  );
  ordered(
    source("../workflows/ponto-staging-rollback-drill.yml"),
    "ponto-cloudflare-resource-identity.mjs",
    "Exercise exact incumbents and restore every exact staging candidate",
  );
  const rollback = source("./ponto-automatic-rollback.mjs");
  assert.match(rollback, /await attestPontoCloudflareResources\(/);
  assert.ok(
    rollback.indexOf("await attestPontoCloudflareResources(")
      < rollback.indexOf("const surfaceSpecs"),
    "automatic rollback must attest module-control identity before planning mutations",
  );
});
