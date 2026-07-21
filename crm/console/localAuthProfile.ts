/** The local launcher uses true by default so its normal test account is Gestor. */
export function isLocalTestUserAdmin(value: unknown): boolean {
  return String(value ?? 'true').trim().toLowerCase() !== 'false'
}
