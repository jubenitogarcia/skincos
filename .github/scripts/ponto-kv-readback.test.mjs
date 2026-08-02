import assert from "node:assert/strict";
import test from "node:test";
import { readCloudflareKvJson } from "./ponto-kv-readback.mjs";

const accountId = "a".repeat(32);
const namespaceId = "b".repeat(32);

test("reads an account-scoped JSON KV record without exposing its value", async () => {
  const calls = [];
  const result = await readCloudflareKvJson({
    accountId,
    namespaceId,
    key: "module-control:timekeeping",
    apiToken: "opaque-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ schemaVersion: 2, state: "maintenance" }),
      };
    },
  });

  assert.deepEqual(result, { schemaVersion: 2, state: "maintenance" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/accounts\/a{32}\/storage\/kv\/namespaces\/b{32}\/values\/module-control%3Atimekeeping$/);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer opaque-token");
});

test("fails closed without including Cloudflare response content", async () => {
  const secretLikeBody = "sensitive-value-must-not-appear";
  await assert.rejects(
    () => readCloudflareKvJson({
      accountId,
      namespaceId,
      key: "module-control:timekeeping:emergency-latch",
      apiToken: "opaque-token",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        text: async () => secretLikeBody,
      }),
    }),
    (error) => error.message === "Cloudflare KV readback failed (HTTP 403)"
      && error.code === "cloudflare-kv-readback-http-403"
      && !error.message.includes(secretLikeBody),
  );
});

test("rejects a non-JSON KV value", async () => {
  await assert.rejects(
    () => readCloudflareKvJson({
      accountId,
      namespaceId,
      key: "module-control:timekeeping",
      apiToken: "opaque-token",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "not-json",
      }),
    }),
    /Cloudflare KV readback is not valid JSON/,
  );
});
