import test from "node:test";
import assert from "node:assert/strict";
import { parseWranglerJson } from "./parse-wrangler-json.mjs";

test("parses Wrangler banner followed by a JSON array", () => {
  assert.deepEqual(
    parseWranglerJson("⛅️ wrangler 4.112.0\n[{\"name\":\"PONTO_ACTOR_HMAC_KEY\"}]\n"),
    [{ name: "PONTO_ACTOR_HMAC_KEY" }],
  );
});

test("parses JSON followed by a Wrangler warning", () => {
  assert.deepEqual(
    parseWranglerJson("[{\"name\":\"PONTO_NETWORK_CONTEXT_KEY\"}]\nwarning: retrying\n"),
    [{ name: "PONTO_NETWORK_CONTEXT_KEY" }],
  );
});

test("parses a JSON object after leading output", () => {
  assert.deepEqual(
    parseWranglerJson("wrangler notice\n{\"result\":true}\n"),
    { result: true },
  );
});

test("rejects output without JSON", () => {
  assert.throws(
    () => parseWranglerJson("wrangler failed: no response"),
    /did not contain a JSON document/,
  );
});
