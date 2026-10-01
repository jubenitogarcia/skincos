export const OBSERVABILITY_CONTRACT_VERSION = 'skincos-observability/v1';

export function dependencyState(available, { required = true, reason = '' } = {}) {
  return { state: available ? 'healthy' : required ? 'unavailable' : 'degraded', required, ...(reason ? { reason } : {}) };
}

export function operationalStatus({ unit, version, environment, ready, dependencies, requestId }) {
  return {
    ok: Boolean(ready), contractVersion: OBSERVABILITY_CONTRACT_VERSION, unit,
    version: String(version || 'unknown'), environment: String(environment || 'unknown'), ready: Boolean(ready),
    dependencies: dependencies || {}, request_id: String(requestId || ''),
  };
}

/** Metadata only: callers must never include actors, query strings, payloads or secrets. */
export function operationalLog({ domain, version, environment, requestId, durationMs, status, route }) {
  return JSON.stringify({ domain, version: String(version || 'unknown'), environment: String(environment || 'unknown'), request_id: String(requestId || ''), duration_ms: Math.max(0, Number(durationMs || 0)), status: Number(status || 0), route: String(route || '/').split('?')[0] });
}
