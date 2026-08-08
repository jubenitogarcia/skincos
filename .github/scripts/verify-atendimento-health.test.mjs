import assert from "node:assert/strict";
import test from "node:test";

import { verifyAtendimentoPublicHealth } from "./verify-atendimento-health.mjs";

function publicHealth({ state, ready }) {
  return {
    ok: true,
    service: "crm-atendimento-runtime",
    readOnlyRuntime: true,
    control: {
      state,
      ready,
      readOnly: true,
      syntheticOnly: true,
    },
  };
}

test("public health remains a successful liveness probe during maintenance", async () => {
  const report = await verifyAtendimentoPublicHealth({
    url: "http://127.0.0.1:8111/health",
    expectedState: "maintenance",
    fetchImpl: async () => ({ status: 200, json: async () => publicHealth({ state: "maintenance", ready: false }) }),
  });
  assert.equal(report.status, 200);
  assert.equal(report.state, "maintenance");
  assert.equal(report.ready, false);
  assert.equal(report.readOnly, true);
});

test("public health rejects a generic or non-isolated response", async () => {
  await assert.rejects(
    verifyAtendimentoPublicHealth({
      url: "https://crm-atendimento.skincos.com.br/health",
      expectedState: "active",
      fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, control: { state: "active", ready: true, readOnly: true, syntheticOnly: true } }) }),
    }),
    /isolated Atendimento runtime/,
  );
});
