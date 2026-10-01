import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeAdmissionRuleset, rulesetFingerprint } from "../codex-native-pr-admission-ruleset.mjs";

const previous = () => ({ id: 19631459, name: "main-enterprise-baseline", target: "branch", enforcement: "active", bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } }, rules: [{ type: "deletion" }, { type: "non_fast_forward" },
    { type: "pull_request", parameters: { allowed_merge_methods: ["squash"], required_review_thread_resolution: true } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [] } }] });
const readiness = { appId: 123, timerReady: true, nativeMergerReady: true, actionsStatusTriggersRetired: true,
  statusReadbacks: ["global-merge-authority", "skincos-integration-gate"] };

test("ruleset preserves protections and binds both required contexts to the actual App", () => {
  const snapshot = previous();
  const output = buildNativeAdmissionRuleset(snapshot, { appId: 123, expectedFingerprint: rulesetFingerprint(snapshot), readiness });
  assert.deepEqual(output.conditions, snapshot.conditions);
  assert.deepEqual(output.bypass_actors, []);
  assert.deepEqual(output.rules.slice(0, 3), snapshot.rules.slice(0, 3));
  assert.deepEqual(output.rules[3].parameters.required_status_checks, [
    { context: "global-merge-authority", integration_id: 123 }, { context: "skincos-integration-gate", integration_id: 123 }]);
  assert.deepEqual(snapshot.rules[3].parameters.required_status_checks, []);
});

test("changed checkpoint, bypass, unrelated checks or missing real readiness refuse mutation", () => {
  for (const mutate of [(value) => { value.bypass_actors = [{ actor_id: 1 }]; },
    (value) => { value.rules[3].parameters.required_status_checks = [{ context: "legacy-Actions" }]; },
    (value) => { value.enforcement = "disabled"; }]) {
    const snapshot = previous(); mutate(snapshot);
    assert.throws(() => buildNativeAdmissionRuleset(snapshot, { appId: 123, expectedFingerprint: rulesetFingerprint(snapshot), readiness }));
  }
  const snapshot = previous();
  assert.throws(() => buildNativeAdmissionRuleset(snapshot, { appId: 123, expectedFingerprint: "changed", readiness }), /checkpoint/);
  for (const field of ["timerReady", "nativeMergerReady", "actionsStatusTriggersRetired"])
    assert.throws(() => buildNativeAdmissionRuleset(snapshot, { appId: 123, expectedFingerprint: rulesetFingerprint(snapshot), readiness: { ...readiness, [field]: false } }), /must be ready/);
});
