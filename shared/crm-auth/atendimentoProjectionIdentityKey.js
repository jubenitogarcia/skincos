import { createHash } from 'node:crypto'

// A non-secret commitment to the HMAC material that derives opaque
// projection/source references. The material itself never crosses a handoff,
// checkpoint, receipt, or database record.
export function fingerprintAtendimentoProjectionIdentityKey(value, {
  requiredCode = 'ATENDIMENTO_CRM_PROJECTION_IDENTITY_KEY_REQUIRED',
  unsafeCode = 'ATENDIMENTO_CRM_PROJECTION_IDENTITY_KEY_UNSAFE',
} = {}) {
  const key = String(value ?? '').trim()
  if (!key) throw new Error(requiredCode)
  if (Buffer.byteLength(key, 'utf8') < 32) throw new Error(unsafeCode)
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`
}
