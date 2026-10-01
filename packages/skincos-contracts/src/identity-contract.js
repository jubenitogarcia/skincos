export const IDENTITY_ACTOR_CONTRACT_VERSION = 'identity-actor/v1';

// Unit scopes are closed: persisted and RBAC-facing values are only these slugs.
export const CANONICAL_UNIT_SCOPES = Object.freeze(['novo-hamburgo', 'barra-shopping-sul']);
const CANONICAL_UNIT_SCOPE_SET = new Set(CANONICAL_UNIT_SCOPES);

function scopeItems(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Legacy delimited rows remain readable until their explicit repair.
  }
  return raw.split(/[,;|]/g).map((item) => item.trim()).filter(Boolean);
}

export function normalizeUnitScope(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  if (key === 'novohamburgo' || key === 'nh') return 'novo-hamburgo';
  if (key === 'barrashoppingsul' || key === 'bss') return 'barra-shopping-sul';
  return '';
}

export function normalizeAllowedUnits(value) {
  const units = [];
  for (const item of scopeItems(value)) {
    const canonical = normalizeUnitScope(item);
    if (canonical && !units.includes(canonical)) units.push(canonical);
  }
  return units;
}

export function unknownUnitScopes(value) {
  return scopeItems(value).filter((item) => !normalizeUnitScope(item));
}

export function isCanonicalUnitScope(value) {
  return CANONICAL_UNIT_SCOPE_SET.has(String(value || '').trim());
}

export function hasUnitScopeAccess({ role, allowedUnits }, requestedUnit) {
  const unit = normalizeUnitScope(requestedUnit);
  if (!unit) return false;
  if (String(role || '').trim().toUpperCase() === 'ADMIN') return true;
  return normalizeAllowedUnits(allowedUnits).includes(unit);
}

const asList = (value) => Array.isArray(value)
  ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
  : [];

/**
 * The only identity shape a product receives. Legacy aliases remain while
 * callers move to scopes.units/scopes.modules without invalidating sessions.
 */
export function toAuthenticatedActor(user) {
  if (!user?.username) return null;
  const units = normalizeAllowedUnits(user.allowedUnits);
  const modules = asList(user.allowedModules);
  const permissions = asList(user.permissions);
  return Object.freeze({
    contractVersion: IDENTITY_ACTOR_CONTRACT_VERSION,
    subject: String(user.username),
    username: String(user.username),
    displayName: String(user.displayName || user.name || user.username),
    email: String(user.email || ''),
    role: String(user.role || 'CONSULTOR').toUpperCase(),
    scopes: Object.freeze({ units, modules, permissions }),
    // Compatibility aliases. New consumers must use scopes.*.
    allowedUnits: units,
    allowedModules: modules,
    permissions,
  });
}

export function csrfErrorFor(request, csrf) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return null;
  const received = String(request.headers.get('x-csrf-token') || '').trim();
  return csrf && received === csrf
    ? null
    : new Response(JSON.stringify({ ok: false, error: 'CSRF_INVALID' }), { status: 403, headers: { 'content-type': 'application/json' } });
}
