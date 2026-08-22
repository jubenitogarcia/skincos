const requiredHealthy = (entries) => entries.every(([, dependency]) =>
  dependency?.required !== true || dependency?.state === "healthy");

const maintenanceWithLegacyGatewayBridge = (health, dependencies) => {
  const requiredFailures = dependencies.filter(([, dependency]) =>
    dependency?.required === true && dependency?.state !== "healthy");
  return health?.availability?.source === "control"
    && health?.dependencies?.module_control?.state === "unavailable"
    && health?.dependencies?.module_control?.reason === "MODULE_MAINTENANCE"
    && requiredFailures.length === 2
    && requiredFailures.some(([name]) => name === "module_control")
    && requiredFailures.some(([name, dependency]) =>
      name === "gateway_affinity"
      && dependency?.reason === "RELEASE_AFFINITY_MISMATCH");
};

const maintenanceControlSafe = (health, dependencies) =>
  health?.dependencies?.module_control?.state === "unavailable"
  && health?.dependencies?.module_control?.reason === "MODULE_MAINTENANCE"
  && dependencies.every(([name, dependency]) =>
    name === "module_control" || dependency?.required !== true || dependency?.state === "healthy");

export function evaluateProductionHealth(status, health) {
  const dependencies = health?.dependencies && typeof health.dependencies === "object"
    ? Object.entries(health.dependencies)
    : [];
  const hasDependencyContract = dependencies.length > 0;
  const activeReady = status === 200
    && health?.availability?.state === "active"
    && health?.ok === true
    && health?.ready === true
    && hasDependencyContract
    && health?.dependencies?.module_control?.state === "healthy"
    && requiredHealthy(dependencies);
  if (activeReady) return { passed: true, state: "active", ready: true, gatewayAffinityBridge: false };

  const maintenanceOnly = status === 200
    && health?.availability?.state === "maintenance"
    && health?.ok === false
    && health?.ready === false
    && (
      !hasDependencyContract
      || maintenanceControlSafe(health, dependencies)
      || maintenanceWithLegacyGatewayBridge(health, dependencies)
    );
  if (!maintenanceOnly) return { passed: false, state: "", ready: false, gatewayAffinityBridge: false };
  return {
    passed: true,
    state: "maintenance",
    ready: false,
    gatewayAffinityBridge: maintenanceWithLegacyGatewayBridge(health, dependencies),
  };
}
