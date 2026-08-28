export const SCHEDULE_PUBLIC_READ_CONTRACT_VERSION = 'schedule-public-read/v1'
export const SCHEDULE_PUBLIC_READ_SIGNATURE_VERSION = 'v1'
export const SCHEDULE_PUBLIC_READ_EDGE_SERVICE = 'website-booking'
export const SCHEDULE_PUBLIC_READ_CORE_SERVICE = 'schedule-public-read-adapter'
export const SCHEDULE_PUBLIC_READ_MAX_SKEW_MS = 5 * 60 * 1000

const encoder = new TextEncoder()
const noncePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/

function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function constantTimeEqual(left, right) {
  const leftValue = String(left || '')
  const rightValue = String(right || '')
  const maxLength = Math.max(leftValue.length, rightValue.length)
  let mismatch = leftValue.length ^ rightValue.length
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

function requestPath(value) {
  const url = new URL(value)
  return `${url.pathname}${url.search}`
}

function normalizedMethod(value) {
  return String(value || '').trim().toUpperCase()
}

export function normalizeSchedulePublicReadSecret(value) {
  return String(value ?? '').trim()
}

function signingPayload({ timestamp, nonce, method, path, service }) {
  return [
    SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
    String(timestamp),
    String(nonce),
    normalizedMethod(method),
    String(path),
    String(service),
  ].join('.')
}

export async function signSchedulePublicReadRequest({ secret, timestamp, nonce, method, path, service = SCHEDULE_PUBLIC_READ_EDGE_SERVICE }) {
  const normalizedSecret = normalizeSchedulePublicReadSecret(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalizedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signingPayload({ timestamp, nonce, method, path, service })),
  )
  return base64UrlEncode(signature)
}

export async function createSchedulePublicReadHeaders({
  secret,
  url,
  method = 'GET',
  service = SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
  timestamp = String(Date.now()),
  nonce = crypto.randomUUID(),
} = {}) {
  const path = requestPath(url)
  const signature = await signSchedulePublicReadRequest({ secret, timestamp, nonce, method, path, service })
  return {
    'x-skincos-schedule-read-version': SCHEDULE_PUBLIC_READ_SIGNATURE_VERSION,
    'x-skincos-schedule-read-service': String(service),
    'x-skincos-schedule-read-ts': String(timestamp),
    'x-skincos-schedule-read-nonce': String(nonce),
    'x-skincos-schedule-read-signature': signature,
  }
}

export async function verifySchedulePublicReadRequest(request, secret, {
  allowedService = SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
  now = Date.now(),
} = {}) {
  if (normalizedMethod(request?.method) !== 'GET') return { ok: false, error: 'METHOD_NOT_ALLOWED' }
  const key = normalizeSchedulePublicReadSecret(secret)
  if (!key) return { ok: false, error: 'KEY_MISSING' }

  const version = String(request.headers.get('x-skincos-schedule-read-version') || '')
  const service = String(request.headers.get('x-skincos-schedule-read-service') || '')
  const timestamp = String(request.headers.get('x-skincos-schedule-read-ts') || '')
  const nonce = String(request.headers.get('x-skincos-schedule-read-nonce') || '')
  const signature = String(request.headers.get('x-skincos-schedule-read-signature') || '')
  const timestampMs = Number(timestamp)

  if (
    version !== SCHEDULE_PUBLIC_READ_SIGNATURE_VERSION
    || service !== allowedService
    || !noncePattern.test(nonce)
    || !Number.isFinite(timestampMs)
    || Math.abs(now - timestampMs) > SCHEDULE_PUBLIC_READ_MAX_SKEW_MS
    || !signature
  ) {
    return { ok: false, error: 'UNAUTHORIZED' }
  }

  const expected = await signSchedulePublicReadRequest({
    secret: key,
    timestamp,
    nonce,
    method: request.method,
    path: requestPath(request.url),
    service,
  })
  if (!constantTimeEqual(expected, signature)) return { ok: false, error: 'UNAUTHORIZED' }
  return { ok: true, service }
}

export const __testables = {
  constantTimeEqual,
  requestPath,
  signingPayload,
}
