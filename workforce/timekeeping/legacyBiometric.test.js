import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import test from 'node:test'
import { decryptLegacyBiometricTemplate, LEGACY_GCM_TAG_BYTES } from './legacyBiometric.js'

function legacyEnvelope(template, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: LEGACY_GCM_TAG_BYTES })
  const ct = Buffer.concat([cipher.update(JSON.stringify(template), 'utf8'), cipher.final()])
  return { alg: 'A256GCM', iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

test('legacy biometric migration accepts only an authenticated 128-bit GCM tag', () => {
  const key = randomBytes(32)
  const template = Array.from({ length: 64 }, (_, index) => index / 100)
  const payload = legacyEnvelope(template, key)
  assert.deepEqual(decryptLegacyBiometricTemplate(payload, key.toString('base64url')), template)
  const shortenedTag = Buffer.from(payload.tag, 'base64').subarray(0, LEGACY_GCM_TAG_BYTES - 1).toString('base64')
  assert.equal(decryptLegacyBiometricTemplate({ ...payload, tag: shortenedTag }, key.toString('base64url')), null)
})
