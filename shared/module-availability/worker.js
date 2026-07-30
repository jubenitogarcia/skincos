const CONTROL_KEY_PREFIX = 'module-control:';
const VALID_STATES = new Set(['active', 'canary', 'maintenance', 'disabled']);
const MAX_CANARY_ACTORS = 100;
const MAX_CANARY_UNITS = 20;
const MAX_CANARY_EMPLOYEES = 100;
const MAX_CANARY_IDENTITIES = 100;
const MAX_CANARY_NETWORK_CONTEXTS = 20;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const list = (value, max) => Array.isArray(value)
  ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean))).slice(0, max)
  : [];
const percentage = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.floor(Number(value)))) : 0;
const stateOr = (value, fallback) => VALID_STATES.has(String(value || '').trim().toLowerCase())
  ? String(value).trim().toLowerCase()
  : fallback;
const versionId = (value) => VERSION_ID.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : '';

function normalize(value) {
  const state = stateOr(value?.state, 'active');
  return {
    state,
    message: String(value?.message || '').trim().slice(0, 240),
    changedAt: String(value?.changedAt || '').trim(),
    schemaVersion: Number.isSafeInteger(Number(value?.schemaVersion)) ? Number(value.schemaVersion) : 1,
    rolloutStage: String(value?.rolloutStage || '').trim().toLowerCase(),
    // Canary authorization is conjunctive. Older modules keep actor names;
    // Timekeeping uses opaque employee and network references instead.
    pilotActors: list(value?.pilotActors, MAX_CANARY_ACTORS),
    pilotUnits: list(value?.pilotUnits, MAX_CANARY_UNITS),
    pilotEmployeeRefs: list(value?.pilotEmployeeRefs, MAX_CANARY_EMPLOYEES),
    pilotIdentityRefs: list(value?.pilotIdentityRefs, MAX_CANARY_IDENTITIES),
    pilotIdentityLoginRefs: list(value?.pilotIdentityLoginRefs, MAX_CANARY_IDENTITIES),
    pilotNetworkContexts: list(value?.pilotNetworkContexts, MAX_CANARY_NETWORK_CONTEXTS),
    percentage: percentage(value?.percentage),
    releaseSha: String(value?.releaseSha || '').trim().toLowerCase(),
    versions: {
      timekeeping: {
        candidate: versionId(value?.versions?.timekeeping?.candidate),
        incumbent: versionId(value?.versions?.timekeeping?.incumbent),
      },
      coreApi: {
        candidate: versionId(value?.versions?.coreApi?.candidate),
        incumbent: versionId(value?.versions?.coreApi?.incumbent),
      },
      identityWorkforce: {
        candidate: versionId(value?.versions?.identityWorkforce?.candidate),
        incumbent: versionId(value?.versions?.identityWorkforce?.incumbent),
      },
    },
    expiresAt: String(value?.expiresAt || '').trim(),
    syntheticOnly: value?.syntheticOnly === true,
  };
}

function fallbackAvailability(state, source, message) {
  return {
    ...normalize({
      state,
      message: state === 'active' ? '' : message,
    }),
    source,
  };
}

/**
 * Runtime control is deliberately external to an artifact. A control change
 * can put one module in maintenance or disable it without redeploying its
 * Worker or the CRM shell. Modules that have not migrated to an explicit
 * control preserve the historical active default. Sensitive modules opt into
 * a fail-closed missing/malformed state through the options below.
 */
export async function readModuleAvailability(env, moduleId, {
  missingState = 'active',
  malformedState = 'active',
} = {}) {
  const safeMissingState = stateOr(missingState, 'active');
  const safeMalformedState = stateOr(malformedState, 'maintenance');
  const store = env?.MODULE_CONTROL;
  if (!store || typeof store.get !== 'function') {
    return fallbackAvailability(safeMissingState, 'binding-missing', 'Controle operacional não configurado.');
  }
  try {
    const raw = await store.get(`${CONTROL_KEY_PREFIX}${moduleId}`, 'json');
    if (raw === null || raw === undefined) {
      return fallbackAvailability(safeMissingState, 'key-missing', 'Controle operacional não configurado.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !VALID_STATES.has(String(raw.state || '').trim().toLowerCase())) {
      return fallbackAvailability(safeMalformedState, 'malformed', 'Controle operacional inválido.');
    }
    return { ...normalize(raw), source: 'control' };
  } catch {
    return fallbackAvailability('maintenance', 'unavailable', 'Controle operacional temporariamente indisponível.');
  }
}

export function publicModuleAvailability(availability) {
  return {
    state: stateOr(availability?.state, 'maintenance'),
    message: String(availability?.message || '').trim().slice(0, 240),
    changedAt: String(availability?.changedAt || '').trim(),
    source: String(availability?.source || '').trim(),
    schemaVersion: Number.isSafeInteger(Number(availability?.schemaVersion)) ? Number(availability.schemaVersion) : 1,
    rolloutStage: String(availability?.rolloutStage || '').trim().toLowerCase(),
    releaseSha: String(availability?.releaseSha || '').trim().toLowerCase(),
    expiresAt: String(availability?.expiresAt || '').trim(),
    syntheticOnly: availability?.syntheticOnly === true,
  };
}

export function moduleUnavailableResponse(moduleId, availability, requestId, { publicOnly = false } = {}) {
  const error = availability.state === 'disabled' ? 'MODULE_DISABLED' : 'MODULE_MAINTENANCE';
  const visibleAvailability = publicOnly ? publicModuleAvailability(availability) : availability;
  return new Response(JSON.stringify({ ok: false, error, module: moduleId, availability: visibleAvailability }), {
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
