const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INVITABLE_ROLES = ['CONSULTOR', 'SUPERVISOR', 'GERENTE'];

export function normalizeInviteEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

export function normalizeInviteScope(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;|]/g)
      : [];
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function hasRequiredInviteScope({ allowedUnits, allowedModules }) {
  return normalizeInviteScope(allowedUnits).length > 0 && normalizeInviteScope(allowedModules).length > 0;
}

export function validateInviteDelegation({ actorRole, targetRole, actorAllowedUnits, actorAllowedModules, allowedUnits, allowedModules }) {
  if (String(actorRole || '').trim().toUpperCase() !== 'GESTOR') return 'RBAC_DENIED';
  if (!INVITABLE_ROLES.includes(String(targetRole || '').trim().toUpperCase())) return 'ROLE_DENIED';

  const actorUnits = normalizeInviteScope(actorAllowedUnits);
  const actorModules = normalizeInviteScope(actorAllowedModules);
  const nextUnits = normalizeInviteScope(allowedUnits);
  const nextModules = normalizeInviteScope(allowedModules);

  if (!nextUnits.length) return 'INVITE_UNITS_REQUIRED';
  if (!nextModules.length) return 'INVITE_MODULES_REQUIRED';
  if (!actorUnits.length || !actorModules.length) return 'INVITER_SCOPE_REQUIRED';
  if (nextUnits.some((unit) => !actorUnits.includes(unit))) return 'INVITE_UNITS_DENIED';
  if (nextModules.some((moduleKey) => !actorModules.includes(moduleKey))) return 'INVITE_MODULES_DENIED';
  return null;
}
