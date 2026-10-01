export class DependencyUnavailableError extends Error {
  constructor(dependency, reason) { super(`${dependency} is unavailable: ${reason}`); this.name = 'DependencyUnavailableError'; this.dependency = dependency; }
}

export function createDependencyState() { return new Map(); }

function stateFor(state, dependency) {
  if (!state.has(dependency)) state.set(dependency, { failures: 0, openUntil: 0 });
  return state.get(dependency);
}

function withTimeout(invoke, timeoutMs) {
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DependencyUnavailableError('upstream', `timeout after ${timeoutMs}ms`)); }, timeoutMs); });
  return Promise.race([Promise.resolve().then(() => invoke(controller.signal)), timeout]).finally(() => clearTimeout(timer));
}

/** Isolates optional domain calls with a short timeout, circuit breaker and explicit degraded result. */
export async function callOptionalDependency({ dependency, invoke, fallback, timeoutMs = 800, failureThreshold = 2, cooldownMs = 15_000, cache, cacheKey, cacheTtlMs = 0, state = createDependencyState(), now = Date.now }) {
  const clock = now(); const circuit = stateFor(state, dependency); const cached = cacheKey && cache?.get(cacheKey);
  const usableCache = cached && cached.expiresAt > clock;
  const degrade = (mode, error) => ({ mode, pendingSynchronization: true, value: usableCache ? cached.value : fallback({ dependency, mode, error }), error });
  if (circuit.openUntil > clock) return degrade('circuit-open', new DependencyUnavailableError(dependency, 'circuit open'));
  try {
    const value = await withTimeout(invoke, timeoutMs); circuit.failures = 0; circuit.openUntil = 0;
    if (cacheKey && cache && cacheTtlMs > 0) cache.set(cacheKey, { value, expiresAt: clock + cacheTtlMs });
    return { mode: 'live', pendingSynchronization: false, value, error: null };
  } catch (error) {
    circuit.failures += 1; if (circuit.failures >= failureThreshold) circuit.openUntil = clock + cooldownMs;
    return degrade('degraded', error instanceof DependencyUnavailableError ? error : new DependencyUnavailableError(dependency, error?.message || 'request failed'));
  }
}
