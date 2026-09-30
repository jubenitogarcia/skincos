import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBootstrap,
  authorityState,
  exerciseStagingFixture,
  parseProtectedManifest,
  planBootstrap,
  readAuthenticatedHealth,
  waitCandidateAuthority,
} from "../token-vault-native-authority.mjs";

const revision = "a".repeat(64);
const legacy = `legacy:${revision}`;
const previewUrl = "https://ffffffff-skincos-token-vault-staging.skincos.workers.dev";
const baseUrl = "https://staging-token-vault.example.com";
const sourceSha = "b".repeat(40);
const transactionId = "native-release-001";
const env = { TOKEN_VAULT_META_ADS_CONFIG_TOKEN: "test-bearer" };
const ready = { ok: true, ready: true, config_authority_mode: "tracking_ready", config_authority_revision: revision };
const legacyResponse = { ready: false, config_authority_mode: "legacy_bootstrap", config_authority_revision: legacy };

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("candidate authority requires exact authenticated ready or legacy response", async () => {
  assert.deepEqual(authorityState({ response: { status: 200 }, payload: ready }), { mode: "tracking_ready", revision });
  assert.deepEqual(authorityState({ response: { status: 409 }, payload: legacyResponse }), { mode: "legacy_bootstrap", revision: legacy });
  assert.equal(authorityState({ response: { status: 401 }, payload: ready }), null);
  const observed = await waitCandidateAuthority({ previewUrl, env, fetchImpl: async () => response(ready), now: () => 0 });
  assert.equal(observed.mode, "tracking_ready");
});

test("protected manifest has target-specific fixture and rejects unknown fields", () => {
  const entries = [
    { config_token_id: "website-1", destination_type: "website", source_adset_id: "123456", url_tags: "utm_source=meta", staging_synthetic_fixture: true },
    { config_token_id: "whatsapp-1", destination_type: "whatsapp" },
  ];
  assert.equal(parseProtectedManifest(JSON.stringify({ entries }), "staging").entries.length, 2);
  assert.throws(() => parseProtectedManifest(JSON.stringify({ entries }), "production"), /fixture count/);
  assert.throws(() => parseProtectedManifest(JSON.stringify({ entries: [{ ...entries[0], secret: "x" }, entries[1]] }), "staging"), /unsafe entry/);
});

test("legacy bootstrap plan is hash bound and mutation is journaled before request", async () => {
  const order = [];
  const plan = await planBootstrap({ target: "staging", previewUrl, authority: { mode: "legacy_bootstrap", revision: legacy }, env,
    fetchImpl: async () => response({ ok: true, config_authority_revision: legacy, manifest_sha256: "c".repeat(64),
      summary: { destination_count: 2, website_destination_count: 1, whatsapp_destination_count: 1, staging_fixture_count: 1 } }) });
  assert.equal(plan.strategy, "derive");
  let reads = 0;
  const result = await applyBootstrap({ target: "staging", baseUrl, plan, sourceSha, transactionId, env,
    authorize: async () => { order.push("lease"); },
    markAttempt: async () => { order.push("journal"); },
    fetchImpl: async (_url, options) => {
      if (options.method !== "POST") {
        reads += 1;
        return reads === 1 ? response(legacyResponse, 409) : response(ready);
      }
      order.push("fetch");
      assert.equal(JSON.parse(options.body).expected_manifest_sha256, "c".repeat(64));
      return response({ ok: true, config_authority_revision: revision });
    },
  });
  assert.deepEqual(order, ["lease", "journal", "fetch"]);
  assert.equal(result.status, "applied");
});

test("production rejects a legacy bootstrap before any mutation", async () => {
  await assert.rejects(() => planBootstrap({ target: "production", previewUrl,
    authority: { mode: "legacy_bootstrap", revision: legacy }, env,
    fetchImpl: async () => { throw new Error("must not call the bootstrap API"); } }), /staging-only/);
});

test("authenticated health requires secret checks and one staging tracking fixture", async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) return response({ ok: false }, 401);
    if (call === 2) return response({ ok: true, checks: { apiToken: true, n8nApiToken: true, analyticsApiToken: true, encryptionKey: true } });
    return response({ ...ready, capabilities: { tracking: { adset_conversion_reconciliation: true } }, destinations: [{
      tracking_contract: { destination_kind: "website", profile_configured: true, url_tags_configured: true, staging_synthetic_fixture: true },
    }] });
  };
  assert.deepEqual(await readAuthenticatedHealth({ target: "staging", baseUrl, env, fetchImpl }), { ready: true, revision });
});

test("staging exercise requires successful reconciliation and rollback", async () => {
  const order = [];
  const status = await exerciseStagingFixture({ baseUrl, sourceSha, transactionId, env,
    authorize: async () => { order.push("lease"); },
    markAttempt: async () => { order.push("journal"); },
    fetchImpl: async () => {
      order.push("fetch");
      return response({ ok: true, exercise: { status: "reconciled_and_rolled_back", reconciliation: "reconciled", rollback: "restored", fixture_count: 1 } });
    },
  });
  assert.equal(status, "reconciled_and_rolled_back");
  assert.deepEqual(order, ["lease", "journal", "fetch"]);
});
