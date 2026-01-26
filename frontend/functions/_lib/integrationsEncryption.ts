export function getIntegrationsEncryptionSecret(context: any): string | undefined {
  return String(context?.env?.INTEGRATIONS_ENCRYPTION_SECRET || '').trim() || undefined
}

export function integrationsEncryptionSecretRequired(context: any): boolean {
  const raw = String(context?.env?.REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET || '')
    .trim()
    .toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function isMissingIntegrationsEncryptionSecretError(e: any): boolean {
  const msg = String(e?.message || '')
  return msg.includes('INTEGRATIONS_ENCRYPTION_SECRET not configured')
}

