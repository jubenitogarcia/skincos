import {
  CLIENTES_READONLY_CONTRACT_VERSION,
  normalizeClientesReadonlyActor,
} from './contract.js'

export const CLIENTES_READONLY_ACTOR_AUDIENCE = 'clientes-readonly'
export const CLIENTES_READONLY_ACTOR_SIGNATURE_VERSION = 'v1'
export const CLIENTES_READONLY_ACTOR_MAX_AGE_MS = 60_000
export const CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS = 5_000
export const CLIENTES_READONLY_ACTOR_MIN_SECRET_BYTES = 32
export const CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS = 4_096
export const CLIENTES_READONLY_ACTOR_CONTEXT_HEADER = 'x-skincos-clientes-actor-context'
export const CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER = 'x-skincos-clientes-actor-signature'
export const CLIENTES_READONLY_ACTOR_VERSION_HEADER = 'x-skincos-clientes-actor-version'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/
const SHA_256 = { name: 'SHA-256' }

function text(value, maxLength = 4096) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : ''
}

function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value) {
  const normalized = text(value, 4096).replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || !/^[A-Za-z0-9+/]+$/.test(normalized)) return null
  try {
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
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

function requestPath(request) {
  const url = new URL(request.url)
  return `${url.pathname}${url.search}`
}

function normalizedMethod(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizedSecret(value) {
  const candidate = text(value, 4096)
  return encoder.encode(candidate).byteLength >= CLIENTES_READONLY_ACTOR_MIN_SECRET_BYTES
    ? candidate
    : ''
}

function validSignedContext(value, request, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.version !== 1 || value.audience !== CLIENTES_READONLY_ACTOR_AUDIENCE) return false
  if (!Number.isSafeInteger(value.issuedAt)) return false
  const ageMs = now - value.issuedAt
  if (ageMs > CLIENTES_READONLY_ACTOR_MAX_AGE_MS || ageMs < -CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS) return false
  if (!NONCE_PATTERN.test(String(value.nonce || ''))) return false
  if (!['GET', 'HEAD'].includes(value.method) || value.method !== normalizedMethod(request.method)) return false
  if (typeof value.path !== 'string' || value.path !== requestPath(request)) return false
  return true
}

async function sign(secret, context) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: SHA_256 }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(context))
  return base64UrlEncode(signature)
}

function replayExpiry(issuedAt) {
  // A permitted future clock skew does not shorten the one-time nonce claim.
  // The replay ledger must retain the claim through the envelope's own
  // absolute expiry, not merely through the observer's maximum-age window.
  return issuedAt + CLIENTES_READONLY_ACTOR_MAX_AGE_MS
}

async function replayKey({ audience, nonce } = {}) {
  const canonicalNonce = audience === CLIENTES_READONLY_ACTOR_AUDIENCE && NONCE_PATTERN.test(String(nonce || ''))
    ? JSON.stringify({ audience, nonce: String(nonce) })
    : ''
  if (!canonicalNonce) throw new TypeError('A valid readonly audience and nonce are required')
  const digest = await crypto.subtle.digest(SHA_256, encoder.encode(canonicalNonce))
  return `${CLIENTES_READONLY_CONTRACT_VERSION}:actor:${base64UrlEncode(digest)}`
}

function configuredReplayStore(replayStore) {
  return Boolean(replayStore
    && typeof replayStore.claimNonce === 'function'
    && typeof replayStore.isReady === 'function')
}

/**
 * Creates headers only for synthetic or upstream gateway tests. Deployable
 * secrets remain outside this source tree and are never generated here.
 */
export async function createClientesReadonlyActorHeaders({
  secret,
  url,
  method = 'GET',
  actor,
  issuedAt = Date.now(),
  nonce = crypto.randomUUID(),
} = {}) {
  const normalized = normalizedSecret(secret)
  const requestUrl = new URL(String(url || 'https://clientes-readonly.invalid/'))
  const normalizedRequestMethod = normalizedMethod(method)
  if (!normalized || !['GET', 'HEAD'].includes(normalizedRequestMethod)) {
    throw new TypeError('A signing secret and a read-only method are required')
  }
  const actorResult = normalizeClientesReadonlyActor(actor)
  if (!actorResult.ok || !NONCE_PATTERN.test(String(nonce || '')) || !Number.isInteger(issuedAt)) {
    throw new TypeError('A valid readonly actor, nonce and timestamp are required')
  }
  const context = base64UrlEncode(encoder.encode(JSON.stringify({
    version: 1,
    audience: CLIENTES_READONLY_ACTOR_AUDIENCE,
    issuedAt,
    nonce: String(nonce),
    method: normalizedRequestMethod,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    actor: actorResult.actor,
  })))
  // Keep the signer and verifier on the same hard envelope boundary. The
  // actor normalizer caps unit scopes, and this final check also protects the
  // full request path from producing a credential the verifier will reject.
  if (context.length > CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS) {
    throw new TypeError('Readonly actor envelope exceeds the supported context limit')
  }
  return {
    [CLIENTES_READONLY_ACTOR_VERSION_HEADER]: CLIENTES_READONLY_ACTOR_SIGNATURE_VERSION,
    [CLIENTES_READONLY_ACTOR_CONTEXT_HEADER]: context,
    [CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER]: await sign(normalized, context),
  }
}

/**
 * Adapter contract for a dedicated authenticated actor source. It accepts no
 * browser identity headers, requires an HMAC envelope bound to the request,
 * and claims every nonce through a dedicated replay-store interface.
 */
export function createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore, now = () => Date.now() } = {}) {
  const signingSecret = normalizedSecret(secret)
  const configured = Boolean(signingSecret && configuredReplayStore(replayStore))

  const resolveActor = async (request) => {
    if (!configured) return { ok: false, code: 'CLIENTES_ACTOR_UNAVAILABLE' }

    const version = text(request?.headers?.get(CLIENTES_READONLY_ACTOR_VERSION_HEADER), 16)
    const context = text(request?.headers?.get(CLIENTES_READONLY_ACTOR_CONTEXT_HEADER), CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS)
    const signature = text(request?.headers?.get(CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER), 256)
    if (!version && !context && !signature) return null
    if (version !== CLIENTES_READONLY_ACTOR_SIGNATURE_VERSION || !context || !signature) {
      return { ok: false, code: 'CLIENTES_ACTOR_FORBIDDEN' }
    }

    let parsed
    try {
      const bytes = base64UrlDecode(context)
      parsed = bytes ? JSON.parse(decoder.decode(bytes)) : null
    } catch {
      parsed = null
    }
    const observedAt = now()
    if (!parsed || !validSignedContext(parsed, request, observedAt)) {
      return { ok: false, code: 'CLIENTES_ACTOR_FORBIDDEN' }
    }

    let expectedSignature
    try {
      expectedSignature = await sign(signingSecret, context)
    } catch {
      return { ok: false, code: 'CLIENTES_ACTOR_UNAVAILABLE' }
    }
    if (!constantTimeEqual(expectedSignature, signature)) {
      return { ok: false, code: 'CLIENTES_ACTOR_FORBIDDEN' }
    }

    const actorResult = normalizeClientesReadonlyActor(parsed.actor)
    if (!actorResult.ok) return { ok: false, code: actorResult.code === 'CLIENTES_ACTOR_REQUIRED' ? 'CLIENTES_ACTOR_FORBIDDEN' : actorResult.code }

    try {
      const claimed = await replayStore.claimNonce({
        key: await replayKey({ audience: parsed.audience, nonce: parsed.nonce }),
        expiresAtMs: replayExpiry(parsed.issuedAt),
      })
      if (claimed?.accepted !== true) {
        return { ok: false, code: claimed?.code === 'CLIENTES_ACTOR_REPLAYED' ? claimed.code : 'CLIENTES_ACTOR_REPLAYED' }
      }
    } catch {
      return { ok: false, code: 'CLIENTES_ACTOR_UNAVAILABLE' }
    }
    return actorResult.actor
  }

  resolveActor.isReady = async () => {
    if (!configured) return false
    try {
      return (await replayStore.isReady()) === true
    } catch {
      return false
    }
  }

  return resolveActor
}

export const __testables = {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  configuredReplayStore,
  replayKey,
  replayExpiry,
  requestPath,
  validSignedContext,
}
