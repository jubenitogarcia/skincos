import assert from "node:assert/strict";
import test from "node:test";
import { classifyAdmission } from "../codex-native-pr-admission-inventory.mjs";

const mainSha = "a".repeat(40);
const pull = (overrides = {}) => ({
  base: { ref: "main", sha: mainSha },
  head: { repo: { full_name: "jubenitogarcia/skincos" } },
  draft: false,
  ...overrides,
});

test("PR admission requires exact main ancestry and same-repository reviewed head", () => {
  assert.equal(classifyAdmission(pull(), mainSha, { status: "ahead", ahead_by: 1, behind_by: 0 }), "candidate-for-native-gate");
  assert.equal(classifyAdmission(pull({ base: { ref: "main", sha: "b".repeat(40) } }), mainSha, { status: "ahead", ahead_by: 1, behind_by: 0 }), "stale-api-base-anchor");
  assert.equal(classifyAdmission(pull(), mainSha, { status: "diverged", ahead_by: 1, behind_by: 1 }), "stale-head");
  assert.equal(classifyAdmission(pull({ draft: true }), mainSha, null), "draft");
  assert.equal(classifyAdmission(pull({ head: { repo: { full_name: "external/fork" } } }), mainSha, null), "external-head");
  assert.equal(classifyAdmission(pull(), mainSha, null), "compare-unavailable");
});
