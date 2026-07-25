export const FORBIDDEN_ROLE_PRIVILEGES = [
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'CREATE', 'ALTER', 'DROP',
  'EXECUTE_DANGEROUS', 'BYPASSRLS', 'SUPERUSER', 'CREATEROLE', 'CREATEDB', 'REPLICATION',
];

export function assertReadOnlyRolePrivileges(role = {}) {
  const violations = FORBIDDEN_ROLE_PRIVILEGES.filter((privilege) => Boolean(role[privilege]));
  if (role.rolinherit !== false) violations.push('INHERIT');
  if (role.rolcanlogin !== true) violations.push('LOGIN_REQUIRED');
  return violations;
}

export function isReadOnlyRole(role = {}) {
  return assertReadOnlyRolePrivileges(role).length === 0;
}
