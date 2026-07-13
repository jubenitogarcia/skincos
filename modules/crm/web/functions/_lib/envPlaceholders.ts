const PLACEHOLDER_PATTERNS = [
  /^__CONFIGURE_[A-Z0-9_]+__$/,
  /^__REPLACE_[A-Z0-9_]+__$/,
  /^CHANGE_ME$/i,
  /^TODO$/i,
  /^TBD$/i,
]

export function isPlaceholderSecret(value: unknown): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw))
}

export function sanitizeEnvSecret(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw || isPlaceholderSecret(raw)) return ''
  return raw
}
