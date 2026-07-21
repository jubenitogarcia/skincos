const PONTO_MANAGEMENT_ROLES = new Set(['GESTOR', 'GERENTE', 'SUPERVISOR', 'ADMIN'])

/** UI policy only. The Ponto API must authorize every operation independently. */
export function canManagePonto(role: unknown): boolean {
  return PONTO_MANAGEMENT_ROLES.has(String(role || '').trim().toUpperCase())
}
