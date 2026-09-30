import assert from "node:assert/strict";
import test from "node:test";
import { fullNativeArchitecturePlan } from "../codex-native-architecture-governance.mjs";

test("native scheduled architecture plan keeps the full seven-job matrix", () => {
  const plan = fullNativeArchitecturePlan();
  assert.deepEqual(plan.jobs, ["minimum", "global", "ponto", "influencer", "cloudflare", "staging", "finance"]);
  assert.equal(plan.commands.length, 22);
  assert.ok(plan.commands.some(({ command }) => command.includes("validate-promotion-source-ref.test.mjs")));
  assert.ok(plan.commands.some(({ command }) => command.includes("ponto-pages-promotion-environment.test.mjs")));
});
