import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateCustody } from "../runtime/provision-native-github-app.mjs";

const privateKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const input = { appId: 123, installationId: 456, privateKey };
const permissions = { contents: "read", pull_requests: "read", statuses: "write", security_events: "write", metadata: "read" };
const records = () => [{ id: 123, owner: { login: "jubenitogarcia" }, slug: "native-pr-test", permissions: { ...permissions } },
  { id: 456, app_id: 123, account: { login: "jubenitogarcia" }, repository_selection: "selected", permissions: { ...permissions } }];
const dependencies = (rows, profiles = []) => ({
  fetchImpl: async (url, options) => { assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); return { ok: true, json: async () => rows[url.endsWith("/app") ? 0 : 1] }; },
  issuer: async (options) => { profiles.push(options.profile); return "synthetic-only"; },
});

test("custody validates owned selected installation and both token profiles", async () => {
  const profiles = [];
  const config = await validateCustody(input, dependencies(records(), profiles));
  assert.deepEqual(profiles, ["admission", "security"]);
  assert.equal(config.botLogin, "native-pr-test[bot]");
  assert.equal(config.appId, 123);
  assert.equal(config.coordinatorUrl, "https://skincos-global-coordinator-production.skincos.workers.dev/v1/leases");
  assert.equal(Object.hasOwn(config, "privateKey"), false);
});

test("broader permission union, wrong owner, all-repository or suspended installs fail closed", async () => {
  for (const mutate of [(rows) => { rows[0].permissions.actions = "write"; }, (rows) => { rows[0].owner.login = "other"; },
    (rows) => { rows[1].repository_selection = "all"; }, (rows) => { rows[1].suspended_at = "now"; },
    (rows) => { rows[1].app_id = 321; }, (rows) => { rows[1].permissions.contents = "write"; }]) {
    const rows = records(); mutate(rows);
    await assert.rejects(validateCustody(input, dependencies(rows)), /invalid/);
  }
});

test("custody has no arbitrary endpoint, URL or metadata override", async () => {
  await assert.rejects(validateCustody({ ...input, coordinatorUrl: "https://example.com" }, dependencies(records())), /Unexpected/);
});
