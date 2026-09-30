import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { appJwt, assertScopedToken, issueInstallationToken, TOKEN_PROFILES } from "../codex-native-github-app.mjs";

const now = 1_790_000_000_000;
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const body = (profile) => ({ token: "synthetic-installation-token-for-unit-test", permissions: { ...TOKEN_PROFILES[profile], metadata: "read" },
  repositories: [{ id: 1060913632, full_name: "jubenitogarcia/skincos" }], expires_at: new Date(now + 3_600_000).toISOString() });

test("JWT signature, time bound and App identity are exact", () => {
  const [header, payload, signature] = appJwt({ appId: 123, privateKey: pem, now }).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), { iat: now / 1000 - 60, exp: now / 1000 + 480, iss: 123 });
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  assert.throws(() => appJwt({ appId: "123/other", privateKey: pem, now }), /App ID/);
});

test("all purpose profiles return only narrowly validated token strings", () => {
  for (const profile of Object.keys(TOKEN_PROFILES)) assert.equal(assertScopedToken(body(profile), profile, now), body(profile).token);
  assert.throws(() => assertScopedToken(body("admission"), "operator", now), /profile/);
});

test("broad repository access, wrong IDs and extra write privileges fail closed", () => {
  for (const mutate of [
    (value) => value.repositories.push({ id: 1 }),
    (value) => { value.repositories[0].id = 1; },
    (value) => { value.repositories[0].full_name = "other/repo"; },
    (value) => { value.permissions.actions = "write"; },
    (value) => { value.permissions.contents = "write"; },
    (value) => { value.permissions.metadata = "write"; },
    (value) => { delete value.permissions.statuses; },
  ]) {
    const value = body("admission"); mutate(value);
    assert.throws(() => assertScopedToken(value, "admission", now), /scope/);
  }
});

test("expired, excessively long and malformed lifetimes are rejected", () => {
  for (const expires_at of [new Date(now).toISOString(), new Date(now + 3_720_000).toISOString(), "never"])
    assert.throws(() => assertScopedToken({ ...body("security"), expires_at }, "security", now), /lifetime/);
});

test("issuer requests one repo with the purpose profile and no redirects", async () => {
  let observed;
  const token = await issueInstallationToken({ appId: 123, installationId: 456, privateKey: pem, profile: "security", now,
    fetchImpl: async (url, options) => { observed = { url, options }; return { ok: true, json: async () => body("security") }; } });
  assert.equal(token, body("security").token);
  assert.equal(observed.url, "https://api.github.com/app/installations/456/access_tokens");
  assert.deepEqual(JSON.parse(observed.options.body), { repository_ids: [1060913632], permissions: { contents: "read", security_events: "write" } });
  assert.equal(observed.options.redirect, "error");
  assert.ok(observed.options.signal);
});

test("upstream error text and token material are never emitted in issuance diagnostics", async () => {
  await assert.rejects(issueInstallationToken({ appId: 123, installationId: 456, privateKey: pem, profile: "admission", now,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: "sensitive material" }) }) }), /^Error: GitHub App issuance failed with HTTP 403$/);
});
