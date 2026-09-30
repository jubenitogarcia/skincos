import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  activeVersion,
  activateCandidate,
  candidateSecrets,
  cloudflareCliEnvironment,
  compensateWorker,
  parseCandidateUpload,
  uploadCandidate,
  verifyCandidateBindings,
} from "../token-vault-native-worker.mjs";

const incumbent = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const candidate = "ffffffff-1111-2222-3333-444444444444";
const currentConfig = { configBindingPresent: true, nextConfigBindingPresent: false, configBearerMode: "current" };
const candidateBindings = (versionId, { overlap = false, staging = false } = {}) => ({
  id: versionId,
  resources: { bindings: [
    ...["TOKEN_VAULT_API_TOKEN", "TOKEN_VAULT_ENCRYPTION_KEY", "TOKEN_VAULT_N8N_API_TOKEN",
      "TOKEN_VAULT_ANALYTICS_API_TOKEN", "TOKEN_VAULT_META_ADS_CONFIG_TOKEN",
      ...(overlap ? ["TOKEN_VAULT_META_ADS_CONFIG_TOKEN_NEXT"] : []),
      ...(staging ? ["TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN"] : []),
    ].map((name) => ({ name, type: "secret_text" })),
    { name: "TOKEN_VAULT_DB", type: "d1" },
  ] },
});

test("candidate upload binds exact version to trusted preview hostname", () => {
  const output = `Worker Version ID: ${candidate}\nVersion Preview URL: https://ffffffff-skincos-token-vault-staging.skincos.workers.dev\n`;
  assert.deepEqual(parseCandidateUpload(output, "staging"), {
    versionId: candidate,
    previewUrl: "https://ffffffff-skincos-token-vault-staging.skincos.workers.dev",
  });
  assert.throws(() => parseCandidateUpload(output.replace("ffffffff-skincos", "eeeeeeee-skincos"), "staging"), /preview URL differs/);
});

test("Wrangler child environment excludes Meta and Token Vault bearer material", () => {
  const selected = cloudflareCliEnvironment({ PATH: "/usr/bin", HOME: "/home/admin",
    META_ADS_ACCESS_TOKEN: "external", TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "internal",
    TOKEN_VAULT_N8N_API_TOKEN: "operational", CLOUDFLARE_ACCOUNT_ID: "account" });
  assert.deepEqual(selected, { PATH: "/usr/bin", HOME: "/home/admin", CLOUDFLARE_ACCOUNT_ID: "account" });
});

test("candidate upload records its remote attempt before invoking Wrangler", async (t) => {
  const transactionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-upload-"));
  t.after(() => fs.rmSync(transactionDirectory, { recursive: true, force: true }));
  const order = [];
  const output = `Worker Version ID: ${candidate}\nVersion Preview URL: https://ffffffff-skincos-token-vault.skincos.workers.dev\n`;
  const result = await uploadCandidate({ target: "production", sourceSha: "a".repeat(40), root: "/repo",
    transactionDirectory, analyticsBindingPresent: true, ...currentConfig,
    env: { TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer" },
    authorize: async () => { order.push("lease"); },
    markAttempt: async () => { order.push("journal"); },
    run: (args) => { order.push(args[1] === "view" ? "readback" : "wrangler");
      return args[1] === "view" ? JSON.stringify(candidateBindings(candidate)) : output; } });
  assert.deepEqual(order, ["lease", "journal", "wrangler", "readback"]);
  assert.equal(result.versionId, candidate);
  assert.equal(fs.existsSync(path.join(transactionDirectory, "candidate-secrets.json")), false);
});

test("candidate secrets preserve staging isolation and do not duplicate inherited bindings", () => {
  const env = {
    TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer",
    TOKEN_VAULT_N8N_API_TOKEN: "n".repeat(32),
  };
  const secrets = candidateSecrets("staging", env, { analyticsBindingPresent: true, seedBearer: "s".repeat(64), ...currentConfig });
  assert.equal(secrets.TOKEN_VAULT_ANALYTICS_API_TOKEN, undefined);
  assert.equal(secrets.TOKEN_VAULT_N8N_API_TOKEN, "n".repeat(32));
  assert.throws(() => candidateSecrets("staging", { ...env, TOKEN_VAULT_N8N_API_TOKEN: "config-bearer" }, { analyticsBindingPresent: true, seedBearer: "s".repeat(64), ...currentConfig }), /invalid or reused/);
  const production = candidateSecrets("production", env, { analyticsBindingPresent: true, ...currentConfig });
  assert.equal(production.TOKEN_VAULT_N8N_API_TOKEN, undefined);
  assert.equal(production.TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN, undefined);
  assert.throws(() => candidateSecrets("production", env, { analyticsBindingPresent: false, ...currentConfig }), /canonical custody/);
  const recovered = candidateSecrets("production", { ...env, TOKEN_VAULT_ANALYTICS_API_TOKEN: "a".repeat(40) },
    { analyticsBindingPresent: false, ...currentConfig });
  assert.equal(recovered.TOKEN_VAULT_ANALYTICS_API_TOKEN, "a".repeat(40));
});

test("staging overlap adds only the next config bearer and preserves the inherited primary", () => {
  const env = { TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "r".repeat(48), TOKEN_VAULT_N8N_API_TOKEN: "n".repeat(48) };
  const overlap = { configBindingPresent: true, nextConfigBindingPresent: false, configBearerMode: "overlap",
    analyticsBindingPresent: true, seedBearer: "s".repeat(64) };
  const secrets = candidateSecrets("staging", env, overlap);
  assert.equal(secrets.TOKEN_VAULT_META_ADS_CONFIG_TOKEN, undefined);
  assert.equal(secrets.TOKEN_VAULT_META_ADS_CONFIG_TOKEN_NEXT, "r".repeat(48));
  assert.throws(() => candidateSecrets("production", env, overlap), /staging-only/);
  assert.throws(() => candidateSecrets("staging", env, { ...overlap, configBindingPresent: false }), /inherited primary/);
  assert.throws(() => candidateSecrets("staging", env, { ...overlap, nextConfigBindingPresent: true }), /reconciled config binding/);
});

test("candidate version readback requires both config bindings in overlap and rejects unexpected next binding", () => {
  assert.equal(verifyCandidateBindings(candidateBindings(candidate, { staging: true, overlap: true }),
    { target: "staging", versionId: candidate, configBearerMode: "overlap" }), true);
  assert.throws(() => verifyCandidateBindings(candidateBindings(candidate, { staging: true }),
    { target: "staging", versionId: candidate, configBearerMode: "overlap" }), /TOKEN_VAULT_META_ADS_CONFIG_TOKEN_NEXT/);
  assert.throws(() => verifyCandidateBindings(candidateBindings(candidate, { staging: true, overlap: true }),
    { target: "staging", versionId: candidate, configBearerMode: "current" }), /unexpectedly carries/);
  assert.throws(() => verifyCandidateBindings({ ...candidateBindings(candidate), id: incumbent },
    { target: "production", versionId: candidate, configBearerMode: "current" }), /invalid identity/);
  assert.throws(() => verifyCandidateBindings({ id: candidate, resources: { bindings: [
    ...candidateBindings(candidate).resources.bindings.filter((item) => item.name !== "TOKEN_VAULT_META_ADS_CONFIG_TOKEN"),
  ] } }, { target: "production", versionId: candidate, configBearerMode: "current" }), /TOKEN_VAULT_META_ADS_CONFIG_TOKEN/);
});

test("Worker activation and compensation require exact ownership and lease callback", async () => {
  let active = incumbent;
  let authorizations = 0;
  const commands = [];
  const run = (args) => {
    commands.push(args);
    if (args[0] === "deployments") return JSON.stringify({ versions: [{ version_id: active, percentage: 100 }] });
    if (args[0] === "versions" && args[1] === "deploy") {
      active = String(args[2]).split("@")[0];
      return "";
    }
    throw new Error("unexpected command");
  };
  const authorize = async () => { authorizations += 1; };
  assert.equal(await activateCandidate({ target: "staging", candidateVersionId: candidate, incumbentVersionId: incumbent, root: "/repo", authorize, run }), candidate);
  assert.equal(activeVersion({ versions: [{ version_id: active, percentage: 100 }] }), candidate);
  assert.equal(await compensateWorker({ target: "staging", candidateVersionId: candidate, incumbentVersionId: incumbent, root: "/repo", authorize, run }), "restored");
  assert.equal(active, incumbent);
  assert.equal(authorizations, 2);
  assert.equal(commands.filter((args) => args[0] === "versions").length, 2);
});

test("Worker compensation refuses to overwrite a newer writer", async () => {
  const run = () => JSON.stringify({ versions: [{ version_id: "99999999-1111-2222-3333-444444444444", percentage: 100 }] });
  await assert.rejects(() => compensateWorker({ target: "production", candidateVersionId: candidate, incumbentVersionId: incumbent, root: "/repo", authorize: async () => {}, run }), /another Worker version owns traffic/);
});
