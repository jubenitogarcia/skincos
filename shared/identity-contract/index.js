export const IDENTITY_ACTOR_CONTRACT_VERSION = 'identity-actor/v1';

const asList = (value) => Array.isArray(value)
  ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
  : [];

/**
 * The only identity shape a product receives. Legacy aliases remain while
 * callers move to scopes.units/scopes.modules without invalidating sessions.
 */
export function toAuthenticatedActor(user) {
  if (!user?.username) return null;
  const units = asList(user.allowedUnits);
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
