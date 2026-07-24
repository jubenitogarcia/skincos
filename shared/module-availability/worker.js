const CONTROL_KEY_PREFIX = 'module-control:';
const VALID_STATES = new Set(['active', 'canary', 'maintenance', 'disabled']);
const MAX_CANARY_ACTORS = 100;
const MAX_CANARY_UNITS = 20;

const list = (value, max) => Array.isArray(value)
  ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max)
  : [];
const percentage = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.floor(Number(value)))) : 0;

function normalize(value) {
  const state = String(value?.state || 'active').trim().toLowerCase();
  return {
    state: VALID_STATES.has(state) ? state : 'active',
    message: String(value?.message || '').trim().slice(0, 240),
    changedAt: String(value?.changedAt || '').trim(),
    // A canary is conjunctive: named actor, named unit, deterministic bucket
    // and promoted source identity must all agree. Missing fields fail closed.
    pilotActors: list(value?.pilotActors, MAX_CANARY_ACTORS),
    pilotUnits: list(value?.pilotUnits, MAX_CANARY_UNITS),
    percentage: percentage(value?.percentage),
    releaseSha: String(value?.releaseSha || '').trim().toLowerCase(),
    syntheticOnly: value?.syntheticOnly === true,
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

export function canaryBucket(actorId) {
  // FNV-1a is stable across Worker isolates. It is a cohort selector, not a
  // security primitive; authorization remains the explicit allow-list.
  let hash = 0x811c9dc5;
  for (const char of String(actorId || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0) % 10_000;
}

export function canUseCanary(availability, actor) {
  if (availability.state !== 'canary') return true;
  const username = String(actor?.username || '').trim();
  const units = Array.isArray(actor?.allowedUnits) ? actor.allowedUnits.map(String).map((unit) => unit.trim()) : [];
  if (!username || !availability.pilotActors.includes(username)) return false;
  if (!availability.pilotUnits.length || !availability.pilotUnits.some((unit) => units.includes(unit))) return false;
  if (!availability.percentage) return false;
  return canaryBucket(username) < availability.percentage * 100;
}

export function moduleHealthResponse(moduleId, availability, requestId) {
  return new Response(JSON.stringify({ ok: true, module: moduleId, availability }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-module-state': availability.state, 'x-request-id': requestId },
  });
}
