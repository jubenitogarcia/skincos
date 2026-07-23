import { callOptionalDependency, createDependencyState } from '../resilience/dependency.js';

const serviceDependencyState = createDependencyState();
const safeResponseCache = new Map();

function degradedResponse(bindingName, mode) {
  return new Response(JSON.stringify({ ok: false, error: 'domain_service_degraded', dependency: bindingName, mode, pendingSynchronization: true }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-dependency-status': mode, 'x-skincos-sync-state': 'pending' },
  });
}

function dependencyResponse(response, { mode, pendingSynchronization }) {
  const headers = new Headers(response.headers);
  headers.set('x-skincos-dependency-status', mode);
  headers.set('x-skincos-sync-state', pendingSynchronization ? 'pending' : 'current');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Neutral adapter for a domain reached through a Cloudflare Worker service
 * binding. The caller owns mount selection; the target owns its data. A
 * failing optional binding is bounded and returns a clear degraded response.
 */
export async function fetchBoundService(request, env, bindingName, { timeoutMs = 800, failureThreshold = 2, cooldownMs = 15_000, cacheTtlMs = 0 } = {}) {
  const binding = env?.[bindingName];
  if (!binding || typeof binding.fetch !== 'function') {
    return degradedResponse(bindingName, 'unavailable');
  }
  const cacheKey = request.method === 'GET' && cacheTtlMs > 0 ? `${bindingName}:${request.url}` : null;
  const result = await callOptionalDependency({
    dependency: bindingName,
    state: serviceDependencyState,
    cache: safeResponseCache,
    cacheKey,
    cacheTtlMs,
    timeoutMs,
    failureThreshold,
    cooldownMs,
    invoke: async (signal) => {
      const response = await binding.fetch(new Request(request, { signal }));
      if (response.status >= 500) throw new Error(`upstream status ${response.status}`);
      return cacheKey ? response.clone() : response;
    },
    fallback: ({ mode }) => degradedResponse(bindingName, mode),
  });
  const response = result.mode === 'live' ? result.value : result.value.clone ? result.value.clone() : result.value;
  return dependencyResponse(response, result);
}

export function resetBoundServiceResilienceForTest() {
  serviceDependencyState.clear();
  safeResponseCache.clear();
}
