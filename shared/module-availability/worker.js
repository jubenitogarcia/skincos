const CONTROL_KEY_PREFIX = 'module-control:';
const VALID_STATES = new Set(['active', 'canary', 'maintenance', 'disabled']);

function normalize(value) {
  const state = String(value?.state || 'active').trim().toLowerCase();
  return {
    state: VALID_STATES.has(state) ? state : 'active',
    message: String(value?.message || '').trim().slice(0, 240),
    changedAt: String(value?.changedAt || '').trim(),
    // The allow-list is intentionally explicit: Finance launches only for a
    // named pilot, never by random percentage on financial mutations.
    pilotActors: Array.isArray(value?.pilotActors) ? value.pilotActors.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 100) : [],
  };
}

/**
 * Runtime control is deliberately external to an artifact. A control change
 * can put one module in maintenance or disable it without redeploying its
 * Worker or the CRM shell. Missing control is compatible with the initial
 * rollout and means active; malformed values fail closed into maintenance.
 */
export async function readModuleAvailability(env, moduleId) {
  const store = env?.MODULE_CONTROL;
  if (!store || typeof store.get !== 'function') return { state: 'active', message: '', changedAt: '', source: 'default' };
  try {
    const raw = await store.get(`${CONTROL_KEY_PREFIX}${moduleId}`, 'json');
    return { ...normalize(raw), source: 'control' };
  } catch {
    return { state: 'maintenance', message: 'Controle operacional temporariamente indisponível.', changedAt: '', source: 'unavailable' };
  }
}

export function moduleUnavailableResponse(moduleId, availability, requestId) {
  const error = availability.state === 'disabled' ? 'MODULE_DISABLED' : 'MODULE_MAINTENANCE';
  return new Response(JSON.stringify({ ok: false, error, module: moduleId, availability }), {
    status: availability.state === 'disabled' ? 423 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-skincos-module-state': availability.state,
      'x-request-id': requestId,
    },
  });
}

export function canUseCanary(availability, actor) {
  return availability.state !== 'canary' || availability.pilotActors.includes(String(actor?.username || '').trim());
}

export function moduleHealthResponse(moduleId, availability, requestId) {
  return new Response(JSON.stringify({ ok: true, module: moduleId, availability }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-module-state': availability.state, 'x-request-id': requestId },
  });
}
