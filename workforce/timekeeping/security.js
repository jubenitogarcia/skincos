const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const normalized = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function signHmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return bytesToBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(String(value))))
}

export function constantTimeEqual(leftValue, rightValue) {
  const left = encoder.encode(String(leftValue || ''))
  const right = encoder.encode(String(rightValue || ''))
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

export async function hashPin(pin, iterations = 100000) {
  const value = String(pin || '')
  if (!/^\d{4,12}$/.test(value)) throw new Error('PIN_INVALID')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256)
  return { algorithm: 'PBKDF2-SHA256', iterations, saltB64: bytesToBase64Url(salt), hashB64: bytesToBase64Url(derived) }
}

export async function verifyPin(pin, credential) {
  if (!credential || credential.algorithm !== 'PBKDF2-SHA256') return false
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(String(pin || '')), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(credential.saltB64), iterations: Number(credential.iterations) }, baseKey, 256)
  return constantTimeEqual(bytesToBase64Url(derived), credential.hashB64)
}

export function isValidBiometricTemplate(template) {
  return Array.isArray(template)
    && template.length >= 64
    && template.length <= 1024
    && template.every((value) => Number.isFinite(value))
}

async function templateKey(secret) {
  if (!secret) throw new Error('BIOMETRIC_KEY_MISSING')
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(String(secret)))
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptTemplate(template, secret) {
  if (!isValidBiometricTemplate(template)) throw new Error('BIOMETRIC_TEMPLATE_INVALID')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await templateKey(secret), encoder.encode(JSON.stringify(template)))
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(encrypted) })
}

export async function decryptTemplate(payload, secret) {
  const parsed = JSON.parse(String(payload || ''))
  if (parsed?.alg !== 'A256GCM') throw new Error('BIOMETRIC_TEMPLATE_INVALID')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(parsed.iv) }, await templateKey(secret), base64UrlToBytes(parsed.ciphertext))
  const template = JSON.parse(decoder.decode(plaintext))
  if (!isValidBiometricTemplate(template)) throw new Error('BIOMETRIC_TEMPLATE_INVALID')
  return template
}

export function biometricDistance(left, right) {
  if (!isValidBiometricTemplate(left) || !isValidBiometricTemplate(right) || left.length !== right.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let index = 0; index < left.length; index += 1) sum += (Number(left[index]) - Number(right[index])) ** 2
  return Math.sqrt(sum)
}
