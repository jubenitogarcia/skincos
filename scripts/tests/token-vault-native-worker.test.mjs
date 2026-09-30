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
} from "../token-vault-native-worker.mjs";

const incumbent = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const candidate = "ffffffff-1111-2222-3333-444444444444";

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
    transactionDirectory, analyticsBindingPresent: true,
    env: { TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer" },
    authorize: async () => { order.push("lease"); },
    markAttempt: async () => { order.push("journal"); },
    run: () => { order.push("wrangler"); return output; } });
  assert.deepEqual(order, ["lease", "journal", "wrangler"]);
  assert.equal(result.versionId, candidate);
  assert.equal(fs.existsSync(path.join(transactionDirectory, "candidate-secrets.json")), false);
});

test("candidate secrets preserve staging isolation and do not duplicate inherited bindings", () => {
  const env = {
    TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "config-bearer",
    TOKEN_VAULT_N8N_API_TOKEN: "n".repeat(32),
  };
  const secrets = candidateSecrets("staging", env, { analyticsBindingPresent: true, seedBearer: "s".repeat(64) });
  assert.equal(secrets.TOKEN_VAULT_ANALYTICS_API_TOKEN, undefined);
  assert.equal(secrets.TOKEN_VAULT_N8N_API_TOKEN, "n".repeat(32));
  assert.throws(() => candidateSecrets("staging", { ...env, TOKEN_VAULT_N8N_API_TOKEN: "config-bearer" }, { analyticsBindingPresent: true, seedBearer: "s".repeat(64) }), /invalid or reused/);
  const production = candidateSecrets("production", env, { analyticsBindingPresent: true });
  assert.equal(production.TOKEN_VAULT_N8N_API_TOKEN, undefined);
  assert.equal(production.TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN, undefined);
  assert.throws(() => candidateSecrets("production", env, { analyticsBindingPresent: false }), /canonical custody/);
  const recovered = candidateSecrets("production", { ...env, TOKEN_VAULT_ANALYTICS_API_TOKEN: "a".repeat(40) },
    { analyticsBindingPresent: false });
  assert.equal(recovered.TOKEN_VAULT_ANALYTICS_API_TOKEN, "a".repeat(40));
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
