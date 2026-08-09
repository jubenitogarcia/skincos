import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "index.js"), "utf8");
const config = fs.readFileSync(path.join(import.meta.dirname, "wrangler.toml"), "utf8");

test("Cloudflare adapter uses one SQLite Durable Object per normalized lock scope", () => {
  assert.match(source, /class GlobalCoordinator extends DurableObject/);
  assert.match(source, /blockConcurrencyWhile/);
  assert.match(source, /storage\.sql\.exec/);
  assert.match(source, /getByName\(scope\)/);
  assert.match(config, /new_sqlite_classes = \["GlobalCoordinator"\]/);
});

test("remote custody is mandatory and the adapter has no local fallback", () => {
  assert.match(source, /COORDINATION_SHARED_SECRET/);
  assert.match(source, /coordination authority custody is unavailable/);
  assert.match(source, /return bad\("coordination authority custody is unavailable", 503\)/);
  assert.match(source, /coordination request rejected/);
  assert.match(source, /coordination request could not be processed/);
  assert.doesNotMatch(source, /in-memory fallback|local fallback|allowWithout/);
  assert.match(source, /authorizeMutation/);
  assert.match(source, /input\.authorization/);
});

test("revocation uses separate administrative custody", () => {
  assert.match(source, /COORDINATION_ADMIN_SECRET/);
  assert.match(source, /body\.action === "revoke"/);
  assert.match(source, /coordination revocation authority is unavailable/);
});
