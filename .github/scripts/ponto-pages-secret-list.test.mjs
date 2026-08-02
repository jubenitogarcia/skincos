import assert from "node:assert/strict";
import test from "node:test";
import { parsePagesSecretListOutput } from "./ponto-pages-secret-list.mjs";

test("accepts the JSON array after the Wrangler banner", () => {
  const output = [
    "⛅️ wrangler 4.112.0",
    "───────────────────",
    JSON.stringify([{ name: "PONTO_API_TARGET" }, { name: "PONTO_ACTOR_HMAC_KEY" }]),
    "",
  ].join("\n");
  assert.deepEqual(parsePagesSecretListOutput(output), [
    { name: "PONTO_API_TARGET" },
    { name: "PONTO_ACTOR_HMAC_KEY" },
  ]);
});

test("does not mistake a bracket inside the banner for the list", () => {
  const output = `wrangler [pages secret list]\n${JSON.stringify([{ name: "PONTO_NETWORK_CONTEXT_KEY" }])}`;
  assert.deepEqual(parsePagesSecretListOutput(output), [
    { name: "PONTO_NETWORK_CONTEXT_KEY" },
  ]);
});

test("rejects output without a JSON array", () => {
  assert.throws(
    () => parsePagesSecretListOutput("⛅️ wrangler 4.112.0\nAuthentication failed"),
    /did not contain a JSON array/,
  );
});
