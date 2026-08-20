import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShadowDecision,
  dependencyClosureDigest,
} from "../codex-merge-freshness-shadow.mjs";

const sha = (letter) => letter.repeat(40);

function report(overrides = {}) {
  return {
    risk: "low",
    surfaces: ["crm"],
    languages: ["javascript"],
    dependencies_changed: false,
    shared_contracts_changed: false,
    production_sensitive: false,
    security_sensitive: false,
    classification_status: "ok",
    ...overrides,
  };
}

test("closure digest is canonical across field ordering", () => {
  const left = report({ surfaces: ["crm", "website"], languages: ["typescript", "javascript"] });
  const right = report({ surfaces: ["website", "crm"], languages: ["javascript", "typescript"] });
  assert.equal(dependencyClosureDigest(left), dependencyClosureDigest(right));
});

test("disjoint low-risk closures produce a read-only reuse candidate", () => {
  const decision = buildShadowDecision({
    previousMainSha: sha("a"),
    currentMainSha: sha("b"),
    pr: { number: 42, baseSha: sha("a"), headSha: sha("c") },
    mainReport: report({ surfaces: ["website"] }),
    prReport: report({ surfaces: ["crm"] }),
  });
  assert.equal(decision.admission, "shadow-reuse-candidate");
  assert.equal(decision.reusable_candidate, true);
  assert.equal(decision.strict_up_to_date_still_required, true);
  assert.equal(decision.mutates_repository, false);
});

test("shared, elevated, or overlapping closures require revalidation", () => {
  for (const mainReport of [
    report({ surfaces: ["crm"] }),
    report({ risk: "high", surfaces: ["website"] }),
    report({ shared_contracts_changed: true, surfaces: ["website"] }),
  ]) {
    const decision = buildShadowDecision({
      previousMainSha: sha("a"),
      currentMainSha: sha("b"),
      pr: { number: 42, baseSha: sha("a"), headSha: sha("c") },
      mainReport,
      prReport: report({ surfaces: ["crm"] }),
    });
    assert.equal(decision.admission, "revalidate-required");
    assert.equal(decision.reusable_candidate, false);
  }
});

test("base drift and unsealed fallback remain fail-closed", () => {
  const decision = buildShadowDecision({
    previousMainSha: sha("a"),
    currentMainSha: sha("b"),
    pr: { number: 42, baseSha: sha("d"), headSha: sha("c") },
    mainReport: report({ surfaces: ["website"] }),
    prReport: report({ classification_status: "failed", surfaces: ["unclassified"] }),
  });
  assert.equal(decision.admission, "revalidate-required");
  assert.match(decision.reasons.join("; "), /base|classification|elevated|shared/i);
});
