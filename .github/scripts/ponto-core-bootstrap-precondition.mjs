const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function validatePontoCoreBootstrapLive({
  live,
  expectedDeployment,
  expectedVersion,
  target,
}) {
  requireValue(live?.exists === true, `live ${target} Ponto Core is absent`);
  requireValue(UUID_PATTERN.test(String(expectedDeployment || "")), "catalog bootstrap deployment id is invalid");
  requireValue(UUID_PATTERN.test(String(expectedVersion || "")), "catalog bootstrap version id is invalid");

  const attestation = live.attestation;
  const activeDeploymentId = String(attestation?.activeDeploymentId || "");
  const activeVersionId = String(attestation?.activeVersionId || "");
  requireValue(attestation?.target === target, `live ${target} Ponto Core target differs`);
  requireValue(UUID_PATTERN.test(activeDeploymentId), `live ${target} Ponto Core deployment id is invalid`);
  requireValue(activeVersionId === expectedVersion, `live ${target} Ponto Core version differs from the cataloged bootstrap`);
  requireValue(
    Array.isArray(attestation?.activeVersions)
      && attestation.activeVersions.length === 1
      && attestation.activeVersions[0]?.versionId === expectedVersion
      && attestation.activeVersions[0]?.percentage === 100,
    `live ${target} Ponto Core must expose only the cataloged bootstrap version at 100%`,
  );

  return {
    deploymentId: activeDeploymentId,
    catalogDeploymentId: expectedDeployment,
    deploymentDrifted: activeDeploymentId !== expectedDeployment,
    versionId: activeVersionId,
  };
}
