const retainedUnderMaintenance = (journal) => (
  journal?.mutationCompleted === true
  && journal?.remoteAttestationCompleted === true
  && journal?.mutationSafety?.maintenanceRequired === true
  && journal?.mutationSafety?.deterministicRerun === true
  && journal?.mutationSafety?.retainedOnCodeRollback === true
);

/**
 * A Pages custody child can be cancelled only after its provision job has
 * completed and uploaded the durable remote-attestation artifact.  The
 * watchdog owns a new recovery lease at this point, so the cancelled child
 * cannot leave a code rollback blocked solely by its final lease-release job.
 */
export function assessPagesEnvironmentPrerequisite({ conclusion, journal } = {}) {
  const attestedProvision = retainedUnderMaintenance(journal);
  const cancelledAfterAttestedProvision = conclusion === "cancelled" && attestedProvision;
  const passed = attestedProvision && (
    conclusion === "success" || cancelledAfterAttestedProvision
  );

  return {
    passed,
    attestedProvision,
    cancelledAfterAttestedProvision,
    disposition: passed
      ? "retained-environment-prerequisite-under-maintenance"
      : "unresolved-secret-configuration-mutation",
  };
}
