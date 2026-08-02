import test from "node:test";
import assert from "node:assert/strict";
import { validatePontoPagesEnvironment } from "./ponto-pages-environment-attestation.mjs";

const secret = () => ({ type: "secret_text" });

function project(envVars) {
  return { success: true, result: { deployment_configs: { production: { env_vars: envVars } } } };
}

test("staging accepts the three Ponto secret bindings without requiring an API target secret", () => {
  const result = validatePontoPagesEnvironment(project({
    PONTO_ACTOR_HMAC_KEY: secret(),
    PONTO_NETWORK_CONTEXT_KEY: secret(),
    PONTO_RELEASE_PROBE_HMAC_KEY: secret(),
    PONTO_API_TARGET: { type: "plain_text", value: "https://api-staging.skincos.com.br" },
  }), "staging");

  assert.deepEqual(result.requiredSecretNames, [
    "PONTO_ACTOR_HMAC_KEY",
    "PONTO_NETWORK_CONTEXT_KEY",
    "PONTO_RELEASE_PROBE_HMAC_KEY",
  ]);
  assert.equal(result.valuesIncluded, false);
  assert.equal(result.credentialsIncluded, false);
  assert.equal(result.piiIncluded, false);
});

test("production requires the API target as a secret binding", () => {
  const result = validatePontoPagesEnvironment(project({
    PONTO_ACTOR_HMAC_KEY: secret(),
    PONTO_NETWORK_CONTEXT_KEY: secret(),
    PONTO_RELEASE_PROBE_HMAC_KEY: secret(),
    PONTO_API_TARGET: secret(),
  }), "production");

  assert.ok(result.requiredSecretNames.includes("PONTO_API_TARGET"));
});

test("missing bindings fail closed", () => {
  assert.throws(
    () => validatePontoPagesEnvironment(project({ PONTO_ACTOR_HMAC_KEY: secret() }), "staging"),
    /remote Pages value is absent: PONTO_NETWORK_CONTEXT_KEY/,
  );
});

test("required bindings cannot be plain text", () => {
  assert.throws(
    () => validatePontoPagesEnvironment(project({
      PONTO_ACTOR_HMAC_KEY: { type: "plain_text", value: "not-a-secret" },
      PONTO_NETWORK_CONTEXT_KEY: secret(),
      PONTO_RELEASE_PROBE_HMAC_KEY: secret(),
    }), "staging"),
    /remote Pages value must be secret_text: PONTO_ACTOR_HMAC_KEY/,
  );
});

test("malformed project responses fail closed", () => {
  assert.throws(
    () => validatePontoPagesEnvironment({ success: true, result: {} }, "staging"),
    /structured production env_vars/,
  );
});
