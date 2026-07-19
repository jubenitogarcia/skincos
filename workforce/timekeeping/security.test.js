import assert from 'node:assert/strict'
import test from 'node:test'
import { biometricDistance, decryptTemplate, encryptTemplate, hashPin, verifyPin } from './security.js'

test('PIN is salted, hashed and verified without plaintext persistence', async () => {
  const first = await hashPin('123456')
  const second = await hashPin('123456')
  assert.notEqual(first.hashB64, second.hashB64)
  assert.equal(await verifyPin('123456', first), true)
  assert.equal(await verifyPin('000000', first), false)
  assert.equal(JSON.stringify(first).includes('123456'), false)
})

test('biometric matching rejects empty, undersized and non-finite templates', async () => {
  await assert.rejects(() => encryptTemplate([], 'unit-test-secret'), /BIOMETRIC_TEMPLATE_INVALID/)
  await assert.rejects(() => encryptTemplate(Array(64).fill(Number.NaN), 'unit-test-secret'), /BIOMETRIC_TEMPLATE_INVALID/)
  assert.equal(biometricDistance([], []), Number.POSITIVE_INFINITY)
})

test('biometric templates require encryption and round-trip without raw payload', async () => {
  const template = Array.from({ length: 128 }, (_, index) => index / 1000)
  const encrypted = await encryptTemplate(template, 'unit-test-secret')
  assert.equal(encrypted.includes(String(template[4])), false)
  assert.deepEqual(await decryptTemplate(encrypted, 'unit-test-secret'), template)
  await assert.rejects(() => encryptTemplate(template, ''), /BIOMETRIC_KEY_MISSING/)
})
