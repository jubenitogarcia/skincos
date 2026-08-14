import assert from "node:assert/strict";
import test from "node:test";
import { assessPagesEnvironmentPrerequisite } from "./ponto-pages-environment-prerequisite.mjs";

const attestedJournal = Object.freeze({
  mutationCompleted: true,
  remoteAttestationCompleted: true,
  mutationSafety: {
    maintenanceRequired: true,
    deterministicRerun: true,
    retainedOnCodeRollback: true,
  },
});

test("retains an attested Pages prerequisite after its child lease cleanup is cancelled", () => {
  const result = assessPagesEnvironmentPrerequisite({
    conclusion: "cancelled",
    journal: attestedJournal,
  });

  assert.deepEqual(result, {
    passed: true,
    attestedProvision: true,
    cancelledAfterAttestedProvision: true,
    disposition: "retained-environment-prerequisite-under-maintenance",
  });
});

test("does not retain a failed, timed-out, or incompletely attested Pages provision", () => {
  for (const conclusion of ["failure", "timed_out", "action_required"]) {
    assert.equal(
      assessPagesEnvironmentPrerequisite({ conclusion, journal: attestedJournal }).passed,
      false,
      conclusion,
    );
  }

  assert.equal(
    assessPagesEnvironmentPrerequisite({
      conclusion: "cancelled",
      journal: { ...attestedJournal, remoteAttestationCompleted: false },
    }).passed,
    false,
  );
});
