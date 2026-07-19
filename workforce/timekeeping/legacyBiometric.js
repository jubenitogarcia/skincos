import { createDecipheriv } from 'node:crypto'

export const LEGACY_GCM_TAG_BYTES = 16

export function validLegacyBiometricTemplate(template) {
  return Array.isArray(template) && template.length >= 64 && template.length <= 1024 && template.every((value) => Number.isFinite(value))
}

export function decryptLegacyBiometricTemplate(payload, secret) {
  if (Array.isArray(payload)) return validLegacyBiometricTemplate(payload) ? payload : null
  if (!secret || payload?.alg !== 'A256GCM') return null
  const keyRaw = String(secret).trim(); let key
  try { key = Buffer.from(keyRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64') } catch { key = Buffer.alloc(0) }
  if (key.length !== 32) { try { key = Buffer.from(keyRaw, 'hex') } catch { key = Buffer.alloc(0) } }
  if (key.length !== 32) return null
  try {
    const tag = Buffer.from(payload.tag, 'base64')
    if (tag.length !== LEGACY_GCM_TAG_BYTES) return null
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'), { authTagLength: LEGACY_GCM_TAG_BYTES })
    decipher.setAuthTag(tag)
    const template = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ct, 'base64')), decipher.final()]).toString('utf8'))
    return validLegacyBiometricTemplate(template) ? template : null
  } catch { return null }
}
