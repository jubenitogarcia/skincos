export const COORDINATION_OBSERVABILITY_EVENTS = Object.freeze([
  "coordination.readiness",
  "coordination.request_processed",
  "coordination.request_rejected",
  "coordination.request_failed",
]);

export const COORDINATION_OBSERVABILITY_FIELDS = Object.freeze([
  "route",
  "action",
  "status",
  "result",
  "reason",
  "coordinationPlane",
  "authorityEpoch",
  "keyId",
  "resourceClass",
  "durationMs",
]);
