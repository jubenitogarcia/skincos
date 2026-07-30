import { getInsumosUser } from '../../_lib/insumosAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'

const json = (status: number, body: any, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${Date.now()}_${hex}`
  }
}

function buildUpstreamHeaders(request: Request, requestId: string, forwardAuthorization: boolean): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'pragma',
    'user-agent',
    'idempotency-key',
    'x-idempotency-key',
  ])

  const headers = new Headers()
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (key === 'authorization' && !forwardAuthorization) continue
    if (!allow.has(key) && key !== 'authorization') continue
    headers.set(k, v)
  }

  headers.set('x-request-id', requestId)
  return headers
}

function b64UrlEncodeBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64UrlEncodeString(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return b64UrlEncodeBytes(bytes.buffer)
}

async function signHmacSha256B64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return b64UrlEncodeBytes(sig)
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isIpv4(value: string): boolean {
  const parts = String(value || '').trim().split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function cloudflareClientIpv4(request: Request): string | null {
  // This header is set by Cloudflare and is deliberately not replaced by
  // X-Forwarded-For or browser-provided data.
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim()
  return isIpv4(ip) ? ip : null
}

function cloudflareClientAddress(request: Request): string | null {
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim()
  if (isIpv4(ip)) return ip
  if (ip.includes(':') && /^[0-9a-f:]{2,64}$/i.test(ip)) return ip.toLowerCase()
  return null
}

async function readBodyLimited(request: Request, maxBytes = 1024 * 1024): Promise<ArrayBuffer | undefined> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE')
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel('PAYLOAD_TOO_LARGE').catch(() => {})
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    chunks.push(value)
  }
  if (!total) return undefined
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out.buffer
}

function normalizeUnits(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const unit = String(v ?? '').trim()
    if (unit) out.push(unit)
  }
  return out
}

function normalizeCrmRole(value: unknown): string {
  const role = String(value || '').trim().toUpperCase()
  if (role === 'RH' || role === 'AUDITOR') return 'SUPERVISOR'
  if (role === 'EMPLOYEE') return 'CONSULTOR'
  return role
}

const RELEASE_SHA_RE = /^[0-9a-f]{40}$/
const CLOUDFLARE_VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPAQUE_COHORT_REF_RE = /^v1:[A-Za-z0-9_-]{43}$/
const PONTO_ROLLOUT_STAGES = new Set(['maintenance', 'staging', 'pilot', 'canary', 'production', 'rollback', 'local'])
const PONTO_TARGET_BY_ENVIRONMENT = {
  production: 'https://api.skincos.com.br',
  staging: 'https://api-staging.skincos.com.br',
} as const

type PontoDeploymentEnvironment = keyof typeof PONTO_TARGET_BY_ENVIRONMENT | 'local'

type PontoProxyConfiguration = {
  ok: boolean
  environment: PontoDeploymentEnvironment | ''
  releaseSha: string
  targetOrigin: string
  targetConfigured: boolean
  targetMatchesEnvironment: boolean
  coreVersionId: string
  coreServiceConfigured: boolean
  identityVersionId: string
  identityServiceConfigured: boolean
  releaseProbeKeyConfigured: boolean
  rolloutStage: string
  localDirectTimekeeping: boolean
  issues: string[]
}

function isLoopbackHostname(value: string): boolean {
  const hostname = String(value || '').trim().toLowerCase()
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

function readProxyConfiguration(env: any, request: Request): PontoProxyConfiguration {
  const environmentValue = String(env?.SKINCOS_DEPLOYMENT_ENV || '').trim().toLowerCase()
  const environment = environmentValue === 'production' || environmentValue === 'staging' || environmentValue === 'local'
    ? environmentValue
    : ''
  const releaseSha = String(env?.PONTO_RELEASE_SHA || '').trim().toLowerCase()
  const coreVersionId = String(env?.PONTO_CORE_VERSION_ID || '').trim()
  const identityVersionId = String(env?.PONTO_IDENTITY_VERSION_ID || '').trim()
  const rolloutStage = String(env?.PONTO_ROLLOUT_STAGE || '').trim().toLowerCase()
  const configuredTarget = String(env?.PONTO_API_TARGET || '').trim()
  const localDirectFlag = String(env?.PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING || '').trim().toLowerCase() === 'true'
  const localAuthBypass = String(env?.LOCAL_AUTH_BYPASS || '').trim().toLowerCase() === 'true'
  const coreServiceConfigured = typeof env?.PONTO_CORE?.fetch === 'function'
  const identityServiceConfigured = typeof env?.PONTO_IDENTITY?.fetch === 'function'
  const releaseProbeKeyConfigured = Boolean(String(env?.PONTO_RELEASE_PROBE_HMAC_KEY || '').trim())
  const requestIsLoopback = isLoopbackHostname(new URL(request.url).hostname)
  const issues: string[] = []
  let targetOrigin = ''
  let targetIsLoopback = false

  if (!environment) issues.push('SKINCOS_DEPLOYMENT_ENV_INVALID')
  if (!RELEASE_SHA_RE.test(releaseSha)) issues.push('PONTO_RELEASE_SHA_INVALID')
  if (!PONTO_ROLLOUT_STAGES.has(rolloutStage)) issues.push('PONTO_ROLLOUT_STAGE_INVALID')
  if (environment === 'local' && rolloutStage !== 'local') issues.push('PONTO_LOCAL_ROLLOUT_STAGE_REQUIRED')
  if (environment && environment !== 'local' && rolloutStage === 'local') issues.push('PONTO_LOCAL_ROLLOUT_STAGE_FORBIDDEN')
  if (coreVersionId && !CLOUDFLARE_VERSION_ID_RE.test(coreVersionId)) issues.push('PONTO_CORE_VERSION_ID_INVALID')
  if (identityVersionId && !CLOUDFLARE_VERSION_ID_RE.test(identityVersionId)) issues.push('PONTO_IDENTITY_VERSION_ID_INVALID')
  const exactCoreStage = rolloutStage === 'staging' || rolloutStage === 'pilot' || rolloutStage === 'canary'
  if (exactCoreStage && !CLOUDFLARE_VERSION_ID_RE.test(coreVersionId)) issues.push('PONTO_CORE_VERSION_ID_REQUIRED_FOR_STAGING_PILOT_OR_CANARY')
  if (exactCoreStage && !CLOUDFLARE_VERSION_ID_RE.test(identityVersionId)) issues.push('PONTO_IDENTITY_VERSION_ID_REQUIRED_FOR_STAGING_PILOT_OR_CANARY')
  if (exactCoreStage && !releaseProbeKeyConfigured) issues.push('PONTO_RELEASE_PROBE_HMAC_KEY_REQUIRED_FOR_STAGING_PILOT_OR_CANARY')
  if (rolloutStage && !exactCoreStage && coreVersionId) issues.push('PONTO_CORE_VERSION_ID_FORBIDDEN_OUTSIDE_PILOT_OR_CANARY')
  if (rolloutStage && !exactCoreStage && identityVersionId) issues.push('PONTO_IDENTITY_VERSION_ID_FORBIDDEN_OUTSIDE_PILOT_OR_CANARY')
  if (!configuredTarget) {
    issues.push('PONTO_API_TARGET_MISSING')
  } else {
    try {
      const target = new URL(configuredTarget)
      const canonicalPath = target.pathname === '' || target.pathname === '/'
      targetIsLoopback = isLoopbackHostname(target.hostname)
      const validProductionTarget = environment !== 'local' && target.protocol === 'https:' && !target.port
      const validLocalTarget = environment === 'local' && target.protocol === 'http:' && targetIsLoopback
      if ((!validProductionTarget && !validLocalTarget) || target.username || target.password || !canonicalPath || target.search || target.hash) {
        issues.push('PONTO_API_TARGET_INVALID')
      } else {
        targetOrigin = target.origin
      }
    } catch {
      issues.push('PONTO_API_TARGET_INVALID')
    }
  }

  const localDirectTimekeeping = environment === 'local'
    && localDirectFlag
    && localAuthBypass
    && requestIsLoopback
    && targetIsLoopback
  const expectedTarget = environment === 'production' || environment === 'staging'
    ? PONTO_TARGET_BY_ENVIRONMENT[environment]
    : ''
  const targetMatchesEnvironment = environment === 'local'
    ? localDirectTimekeeping
    : Boolean(targetOrigin && expectedTarget && targetOrigin === expectedTarget)
  if (targetOrigin && environment && !targetMatchesEnvironment) issues.push('PONTO_API_TARGET_ENVIRONMENT_MISMATCH')
  if (environment === 'local' && !localDirectFlag) issues.push('PONTO_LOCAL_DIRECT_FLAG_REQUIRED')
  if (environment === 'local' && !localAuthBypass) issues.push('PONTO_LOCAL_AUTH_BYPASS_REQUIRED')
  if (environment === 'local' && !requestIsLoopback) issues.push('PONTO_LOCAL_REQUEST_HOST_REQUIRED')
  if (environment === 'local' && !targetIsLoopback) issues.push('PONTO_LOCAL_TARGET_REQUIRED')
  if (environment && environment !== 'local' && !coreServiceConfigured) issues.push('PONTO_CORE_SERVICE_BINDING_MISSING')
  if (environment && environment !== 'local' && !identityServiceConfigured) issues.push('PONTO_IDENTITY_SERVICE_BINDING_MISSING')

  return {
    ok: issues.length === 0,
    environment,
    releaseSha,
    targetOrigin,
    targetConfigured: Boolean(configuredTarget),
    targetMatchesEnvironment,
    coreVersionId,
    coreServiceConfigured,
    identityVersionId,
    identityServiceConfigured,
    releaseProbeKeyConfigured,
    rolloutStage,
    localDirectTimekeeping,
    issues,
  }
}

function canaryBucket(identityRef: string): number {
  let hash = 0x811c9dc5
  for (const char of identityRef) {
    hash ^= char.codePointAt(0) || 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 10_000
}

async function readPontoControl(env: any): Promise<any | null> {
  if (!env?.MODULE_CONTROL || typeof env.MODULE_CONTROL.get !== 'function') return null
  const runtimeTarget = String(env?.SKINCOS_DEPLOYMENT_ENV || '').trim().toLowerCase()
  if (!['production', 'staging', 'local'].includes(runtimeTarget)) return null
  try {
    const latch = await env.MODULE_CONTROL.get('module-control:timekeeping:emergency-latch', 'json')
    if (
      !latch
      || typeof latch !== 'object'
      || Array.isArray(latch)
      || Number(latch.schemaVersion) !== 1
      || latch.module !== 'timekeeping'
      || typeof latch.target !== 'string'
      || latch.target.trim().toLowerCase() !== runtimeTarget
      || latch.latched !== false
      || !Number.isFinite(Date.parse(String(latch.changedAt || '')))
      || !String(latch.changedBy || '').trim()
    ) return null
    const control = await env.MODULE_CONTROL.get('module-control:timekeeping', 'json')
    return control && typeof control === 'object' && !Array.isArray(control) ? control : null
  } catch {
    return null
  }
}

function exactLiveControl(control: any, configuration: PontoProxyConfiguration): boolean {
  if (!control) return false
  if (Number(control.schemaVersion) !== 2) return false
  if (String(control.rolloutStage || '').trim().toLowerCase() !== configuration.rolloutStage) return false
  if (String(control.releaseSha || '').trim().toLowerCase() !== configuration.releaseSha) return false
  if (String(control.versions?.coreApi?.candidate || '').trim().toLowerCase() !== configuration.coreVersionId.toLowerCase()) return false
  if (String(control.versions?.identityWorkforce?.candidate || '').trim().toLowerCase() !== configuration.identityVersionId.toLowerCase()) return false
  if (configuration.rolloutStage === 'staging') {
    return String(control.state || '').trim().toLowerCase() === 'active' && control.syntheticOnly === true
  }
  if (String(control.state || '').trim().toLowerCase() !== 'canary') return false
  const expiresAt = Date.parse(String(control.expiresAt || ''))
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

async function canRoutePontoCandidate(
  env: any,
  configuration: PontoProxyConfiguration,
  actor: { id: string, email?: string, allowedUnits: string[] },
  networkContext: string,
): Promise<boolean> {
  if (!['pilot', 'canary'].includes(configuration.rolloutStage)) return false
  if (!CLOUDFLARE_VERSION_ID_RE.test(configuration.coreVersionId)) return false
  if (!actor.id || !OPAQUE_COHORT_REF_RE.test(networkContext)) return false
  const control = await readPontoControl(env)
  if (!exactLiveControl(control, configuration)) return false

  const employeeRefs = Array.isArray(control.pilotEmployeeRefs) ? control.pilotEmployeeRefs.map(String) : []
  const identityRefs = Array.isArray(control.pilotIdentityRefs) ? control.pilotIdentityRefs.map(String) : []
  const loginRefs = Array.isArray(control.pilotIdentityLoginRefs) ? control.pilotIdentityLoginRefs.map(String) : []
  const networkContexts = Array.isArray(control.pilotNetworkContexts) ? control.pilotNetworkContexts.map(String) : []
  const units = Array.isArray(control.pilotUnits) ? control.pilotUnits.map(String) : []
  const percentage = Number(control.percentage)
  if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) return false
  if (!employeeRefs.length || employeeRefs.length !== identityRefs.length || identityRefs.length !== loginRefs.length) return false
  if (employeeRefs.some((value) => !OPAQUE_COHORT_REF_RE.test(value))) return false
  if (identityRefs.some((value) => !OPAQUE_COHORT_REF_RE.test(value))) return false
  if (loginRefs.some((value) => !OPAQUE_COHORT_REF_RE.test(value))) return false
  if (networkContexts.some((value) => !OPAQUE_COHORT_REF_RE.test(value))) return false

  const actorKey = String(env?.PONTO_ACTOR_HMAC_KEY || '').trim()
  if (!actorKey) return false
  const identityRef = `v1:${await signHmacSha256B64Url(
    actorKey,
    `ponto-canary-identity/v1.${configuration.releaseSha}.${actor.id}`,
  )}`
  const login = String(actor.email || '').trim().toLowerCase()
  if (!login) return false
  const identityLoginRef = `v1:${await signHmacSha256B64Url(
    actorKey,
    `ponto-canary-login/v1.${configuration.releaseSha}.${login}`,
  )}`
  const tupleIndex = identityRefs.findIndex((value, index) =>
    value === identityRef
    && loginRefs[index] === identityLoginRef
    && OPAQUE_COHORT_REF_RE.test(employeeRefs[index] || ''),
  )
  if (tupleIndex < 0) return false
  if (!networkContexts.includes(networkContext)) return false
  if (!units.length || !actor.allowedUnits.some((unit) => units.includes(unit))) return false
  return canaryBucket(identityRef) < percentage * 100
}

const RELEASE_PROBE_NONCE_RE = /^[A-Za-z0-9_-]{20,120}$/
const RELEASE_PROBE_RUN_ID_RE = /^[1-9][0-9]{0,19}$/
const RELEASE_PROBE_MAX_AGE_MS = 5 * 60 * 1000
const RELEASE_PROBE_RESERVATION_PATH = '/api/ponto/internal/release-probe-nonce'

function constantTimeTextEqual(leftValue: string, rightValue: string): boolean {
  const left = new TextEncoder().encode(String(leftValue || ''))
  const right = new TextEncoder().encode(String(rightValue || ''))
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index]
  return mismatch === 0
}

async function reserveReleaseProbeNonce(
  env: any,
  configuration: PontoProxyConfiguration,
  nonceDigest: string,
  bodyDigest: string,
  requestId: string,
): Promise<boolean> {
  const actorKey = String(env?.PONTO_ACTOR_HMAC_KEY || '').trim()
  if (
    !actorKey
    || !configuration.coreServiceConfigured
    || !CLOUDFLARE_VERSION_ID_RE.test(configuration.coreVersionId)
    || !/^[0-9a-f]{64}$/.test(nonceDigest)
    || !/^[0-9a-f]{64}$/.test(bodyDigest)
    || !['staging', 'production'].includes(configuration.environment)
  ) return false

  const reservationNonce = [
    'ponto-release-probe',
    configuration.environment,
    configuration.releaseSha,
    nonceDigest,
  ].join(':')
  const reservationBody = JSON.stringify({
    schemaVersion: 1,
    target: configuration.environment,
    releaseSha: configuration.releaseSha,
    nonceDigest,
    bodyDigest,
  })
  const actor = {
    id: `release-probe:${configuration.environment}`,
    email: `release-probe@${configuration.environment}.internal.invalid`,
    role: 'ADMIN',
    allowedUnits: [],
    releaseSha: configuration.releaseSha,
  }
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTimestamp = String(Date.now())
  const reservationBodyBytes = new TextEncoder().encode(reservationBody)
  const reservationBodyHash = await sha256Hex(reservationBodyBytes.buffer)
  const actorSignature = await signHmacSha256B64Url(
    actorKey,
    [
      actorTimestamp,
      actorB64,
      'POST',
      RELEASE_PROBE_RESERVATION_PATH,
      reservationNonce,
      reservationBodyHash,
    ].join('.'),
  )
  const coreService = configuration.environment === 'staging'
    ? 'skincos-ponto-core-staging'
    : 'skincos-ponto-core'

  try {
    const response = await env.PONTO_CORE.fetch(new Request(
      `https://ponto-core.internal${RELEASE_PROBE_RESERVATION_PATH}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'cache-control': 'no-store',
          'x-request-id': requestId,
          'x-request-nonce': reservationNonce,
          'x-skincos-actor': actorB64,
          'x-skincos-actor-ts': actorTimestamp,
          'x-skincos-actor-sig': actorSignature,
          'x-skincos-signature-version': '2',
          'cloudflare-workers-version-overrides': `${coreService}="${configuration.coreVersionId}"`,
          'content-type': 'application/json',
        },
        body: reservationBodyBytes,
        redirect: 'manual',
      },
    ))
    const body = await responseJson(response.clone())
    return response.status === 201
      && body?.ok === true
      && body?.consumed === true
      && String(body?.releaseSha || '').trim().toLowerCase() === configuration.releaseSha
      && String(body?.environment || '').trim().toLowerCase() === configuration.environment
      && String(response.headers.get('x-skincos-gateway-release-sha') || '').trim().toLowerCase() === configuration.releaseSha
      && String(response.headers.get('x-skincos-gateway-version-id') || '').trim().toLowerCase() === configuration.coreVersionId.toLowerCase()
      && String(response.headers.get('x-skincos-timekeeping-release-sha') || '').trim().toLowerCase() === configuration.releaseSha
  } catch {
    return false
  }
}

async function authorizeOneTimeReleaseProbe(
  env: any,
  configuration: PontoProxyConfiguration,
  request: Request,
  rawBody: ArrayBuffer,
  requestId: string,
): Promise<boolean> {
  const secret = String(env?.PONTO_RELEASE_PROBE_HMAC_KEY || '').trim()
  const timestamp = String(request.headers.get('x-skincos-release-probe-ts') || '').trim()
  const nonce = String(request.headers.get('x-skincos-release-probe-nonce') || '').trim()
  const signatureVersion = String(request.headers.get('x-skincos-release-probe-signature-version') || '').trim()
  const signature = String(request.headers.get('x-skincos-release-probe-sig') || '').trim()
  if (!secret || !/^\d{13}$/.test(timestamp) || !RELEASE_PROBE_NONCE_RE.test(nonce)) return false
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false
  const timestampMs = Number(timestamp)
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > RELEASE_PROBE_MAX_AGE_MS) return false

  const method = String(request.method || 'GET').toUpperCase()
  const pathname = new URL(request.url).pathname
  const bodyHash = await sha256Hex(rawBody)
  let message = ''
  if (signatureVersion === '1') {
    // v1 is retained only for the isolated synthetic staging drill. Pilot and
    // canary require workflow-run provenance bound into the signed capability.
    if (configuration.rolloutStage !== 'staging') return false
    message = `ponto-release-probe/v1.${timestamp}.${nonce}.${method}.${pathname}.${bodyHash}.${configuration.releaseSha}`
    const expected = await signHmacSha256B64Url(secret, message)
    if (!constantTimeTextEqual(signature, expected)) return false
  } else if (signatureVersion === '2') {
    const stage = String(request.headers.get('x-skincos-release-probe-stage') || '').trim().toLowerCase()
    const coordinatorRunId = String(request.headers.get('x-skincos-release-probe-coordinator-run-id') || '').trim()
    const workflowRunId = String(request.headers.get('x-skincos-release-probe-workflow-run-id') || '').trim()
    const delegationVersion = String(request.headers.get('x-skincos-release-probe-delegation-version') || '').trim()
    const delegatedKey = String(request.headers.get('x-skincos-release-probe-delegation-key') || '').trim()
    const delegatedKeyCommitment = String(request.headers.get('x-skincos-release-probe-delegation-key-commitment') || '').trim().toLowerCase()
    const delegationTimestamp = String(request.headers.get('x-skincos-release-probe-delegation-ts') || '').trim()
    const delegationExpiresAt = String(request.headers.get('x-skincos-release-probe-delegation-exp') || '').trim()
    const delegationSignature = String(request.headers.get('x-skincos-release-probe-delegation-sig') || '').trim()
    if (
      !['pilot', 'canary'].includes(stage)
      || stage !== configuration.rolloutStage
      || !RELEASE_PROBE_RUN_ID_RE.test(coordinatorRunId)
      || !RELEASE_PROBE_RUN_ID_RE.test(workflowRunId)
      || delegationVersion !== '1'
      || !/^[A-Za-z0-9_-]{43}$/.test(delegatedKey)
      || !/^[0-9a-f]{64}$/.test(delegatedKeyCommitment)
      || !RELEASE_PROBE_RUN_ID_RE.test(delegationTimestamp)
      || !RELEASE_PROBE_RUN_ID_RE.test(delegationExpiresAt)
      || !/^[A-Za-z0-9_-]{43}$/.test(delegationSignature)
    ) return false
    const delegationIssuedSeconds = Number(delegationTimestamp)
    const delegationExpiresSeconds = Number(delegationExpiresAt)
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (
      !Number.isSafeInteger(delegationIssuedSeconds)
      || !Number.isSafeInteger(delegationExpiresSeconds)
      || delegationIssuedSeconds > nowSeconds
      || delegationExpiresSeconds <= nowSeconds
      || delegationExpiresSeconds - delegationIssuedSeconds > 2 * 60 * 60
    ) return false
    const actualKeyCommitment = await sha256Hex(new TextEncoder().encode(delegatedKey).buffer)
    if (!constantTimeTextEqual(actualKeyCommitment, delegatedKeyCommitment)) return false
    const delegationMessage = [
      'ponto-release-probe-delegation/v1',
      delegationTimestamp,
      delegationExpiresAt,
      nonce,
      method,
      pathname,
      configuration.releaseSha,
      stage,
      coordinatorRunId,
      workflowRunId,
      delegatedKeyCommitment,
    ].join('.')
    const expectedDelegationSignature = await signHmacSha256B64Url(secret, delegationMessage)
    if (!constantTimeTextEqual(delegationSignature, expectedDelegationSignature)) return false
    message = [
      'ponto-release-probe/v2',
      timestamp,
      nonce,
      method,
      pathname,
      bodyHash,
      configuration.releaseSha,
      stage,
      coordinatorRunId,
      workflowRunId,
    ].join('.')
    const expected = await signHmacSha256B64Url(delegatedKey, message)
    if (!constantTimeTextEqual(signature, expected)) return false
  } else {
    return false
  }

  const nonceDigest = await sha256Hex(new TextEncoder().encode(nonce).buffer)
  return reserveReleaseProbeNonce(env, configuration, nonceDigest, bodyHash, requestId)
}

function cookiePairs(headers: Headers): string[] {
  const getSetCookie = (headers as any).getSetCookie
  const values = typeof getSetCookie === 'function'
    ? getSetCookie.call(headers)
    : [headers.get('set-cookie')].filter(Boolean)
  return values
    .flatMap((value: string) => String(value).split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/))
    .map((value: string) => value.split(';', 1)[0].trim())
    .filter(Boolean)
}

function updateCookieJar(jar: Map<string, string>, headers: Headers): void {
  for (const pair of cookiePairs(headers)) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (!value || value === 'deleted') jar.delete(name)
    else jar.set(name, value)
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function responseJson(response: Response): Promise<any | null> {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

async function authorizedIdentityReleaseProbe(
  env: any,
  configuration: PontoProxyConfiguration,
  request: Request,
  requestId: string,
): Promise<Response> {
  const releaseHeaders = proxyReleaseHeaders(configuration, requestId)
  if (request.method !== 'POST' || !['staging', 'pilot', 'canary'].includes(configuration.rolloutStage)) {
    return json(404, { ok: false, error: 'NOT_FOUND' }, releaseHeaders)
  }
  if (!configuration.identityServiceConfigured || !CLOUDFLARE_VERSION_ID_RE.test(configuration.identityVersionId)) {
    return json(503, { ok: false, error: 'IDENTITY_RELEASE_BINDING_UNAVAILABLE' }, releaseHeaders)
  }
  const actorKey = String(env?.PONTO_ACTOR_HMAC_KEY || '').trim()
  const networkKey = String(env?.PONTO_NETWORK_CONTEXT_KEY || '').trim()
  const clientAddress = cloudflareClientAddress(request)
  if (!actorKey || !networkKey || !clientAddress) {
    return json(503, { ok: false, error: 'RELEASE_PROBE_CONTEXT_UNAVAILABLE' }, releaseHeaders)
  }

  let rawBody: ArrayBuffer
  let body: any
  try {
    rawBody = (await readBodyLimited(request, 16 * 1024)) || new ArrayBuffer(0)
    if (!(await authorizeOneTimeReleaseProbe(env, configuration, request, rawBody, requestId))) {
      return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
    }
    body = rawBody.byteLength ? JSON.parse(new TextDecoder().decode(rawBody)) : null
  } catch {
    return json(400, { ok: false, error: 'INVALID_RELEASE_PROBE_INPUT' }, releaseHeaders)
  }
  const login = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  if (!login || login.length > 320 || password.length < 12 || password.length > 512) {
    return json(400, { ok: false, error: 'INVALID_RELEASE_PROBE_INPUT' }, releaseHeaders)
  }

  const control = await readPontoControl(env)
  if (!exactLiveControl(control, configuration)) {
    return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
  }
  const stagingSyntheticFixture = configuration.rolloutStage === 'staging'
    && String(control?.state || '').trim().toLowerCase() === 'active'
    && control?.syntheticOnly === true
    && login.endsWith('@staging.invalid')
  const loginRefs = Array.isArray(control.pilotIdentityLoginRefs) ? control.pilotIdentityLoginRefs.map(String) : []
  const networkContexts = Array.isArray(control.pilotNetworkContexts) ? control.pilotNetworkContexts.map(String) : []
  if (!stagingSyntheticFixture && (!loginRefs.length || !networkContexts.length
    || loginRefs.some((value) => !OPAQUE_COHORT_REF_RE.test(value))
    || networkContexts.some((value) => !OPAQUE_COHORT_REF_RE.test(value)))) {
    return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
  }
  const loginRef = `v1:${await signHmacSha256B64Url(
    actorKey,
    `ponto-canary-login/v1.${configuration.releaseSha}.${login}`,
  )}`
  const networkContext = `v1:${await signHmacSha256B64Url(
    networkKey,
    `ponto-network/v1.${configuration.releaseSha}.${clientAddress}`,
  )}`
  if (!stagingSyntheticFixture && (!loginRefs.includes(loginRef) || !networkContexts.includes(networkContext))) {
    return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
  }

  const serviceName = configuration.environment === 'staging' ? 'skincos-insumos-staging' : 'skincos-insumos'
  const baseHeaders = {
    accept: 'application/json',
    'cloudflare-workers-version-overrides': `${serviceName}="${configuration.identityVersionId}"`,
    'x-request-id': requestId,
  }
  const jar = new Map<string, string>()
  let currentSessionId = ''
  let sessionMayExist = false
  let lastSessionCookie = ''
  let sessionTeardownAttempted = false
  let sessionTeardownProven = false
  let sessionTeardownMethod = ''
  let primaryError = ''
  let successReport: Record<string, unknown> | null = null
  const callIdentity = async (pathname: string, init: RequestInit = {}, cookieOverride?: string) => {
    const headers = new Headers({ ...baseHeaders, ...(init.headers || {}) })
    const cookies = cookieOverride === undefined ? cookieHeader(jar) : cookieOverride
    if (cookies) headers.set('cookie', cookies)
    const csrf = jar.get('csrfToken')
    if (csrf) headers.set('x-csrf-token', csrf)
    const response = await env.PONTO_IDENTITY.fetch(new Request(`https://identity.internal${pathname}`, {
      ...init,
      headers,
      redirect: 'manual',
    }))
    updateCookieJar(jar, response.headers)
    if (jar.has('session')) {
      sessionMayExist = true
      lastSessionCookie = cookieHeader(jar)
    }
    return { response, json: await responseJson(response.clone()) }
  }

  try {
    const contract = await callIdentity('/health/workforce-contract', {
      headers: { 'x-skincos-release-probe': 'ponto-v1' },
    })
    const contractMatched = contract.response.status === 200
      && contract.json?.ok === true
      && contract.json?.ready === true
      && String(contract.json?.version || '').toLowerCase() === configuration.releaseSha
      && String(contract.json?.workerVersionId || '').toLowerCase() === configuration.identityVersionId.toLowerCase()
      && contract.json?.data?.contract === 'identity-workforce-hmac-v2'
      && contract.json?.data?.matched === true
    if (!contractMatched) throw new Error('IDENTITY_CONTRACT_MISMATCH')

    const loginResponse = await callIdentity('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: login, password }),
    })
    if (loginResponse.response.status !== 200 || loginResponse.json?.success !== true || !jar.get('session')) {
      throw new Error('IDENTITY_LOGIN_FAILED')
    }

    const me = await callIdentity('/auth/me')
    const role = String(me.json?.user?.role || '').trim().toUpperCase()
    const modules = [...new Set((Array.isArray(me.json?.user?.allowedModules) ? me.json.user.allowedModules : [])
      .map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean))].sort()
    if (me.response.status !== 200 || me.json?.success !== true || !['CONSULTOR', 'EMPLOYEE'].includes(role)) {
      throw new Error('IDENTITY_ROLE_MISMATCH')
    }
    if (JSON.stringify(modules) !== JSON.stringify(['atendimento', 'ponto'])) throw new Error('IDENTITY_GRANTS_MISMATCH')

    const sessions = await callIdentity('/auth/sessions')
    const current = (Array.isArray(sessions.json?.sessions) ? sessions.json.sessions : [])
      .find((session: any) => session?.current === true && typeof session?.id === 'string')
    if (sessions.response.status !== 200 || sessions.json?.success !== true || !current) throw new Error('IDENTITY_SESSION_READ_FAILED')
    currentSessionId = current.id

    successReport = {
      ok: true,
      ready: true,
      releaseSha: configuration.releaseSha,
      identityVersionId: configuration.identityVersionId,
      contract: 'identity-workforce-hmac-v2',
      roleClass: role === 'EMPLOYEE' ? 'CONSULTOR' : role,
      modules,
      sessionRead: true,
      sessionRevoked: true,
      credentialsIncluded: false,
      piiIncluded: false,
    }
  } catch (error) {
    const code = String((error as Error)?.message || '')
    primaryError = new Set([
      'IDENTITY_CONTRACT_MISMATCH',
      'IDENTITY_LOGIN_FAILED',
      'IDENTITY_ROLE_MISMATCH',
      'IDENTITY_GRANTS_MISMATCH',
      'IDENTITY_SESSION_READ_FAILED',
    ]).has(code) ? code : 'IDENTITY_RELEASE_CONTRACT_FAILED'
  } finally {
    if (sessionMayExist) {
      sessionTeardownAttempted = true
      const staleCookie = lastSessionCookie || cookieHeader(jar)
      sessionTeardownMethod = currentSessionId ? 'session-revoke' : 'logout-fallback'
      try {
        if (currentSessionId) {
          await callIdentity(`/auth/sessions/${encodeURIComponent(currentSessionId)}/revoke`, { method: 'POST' })
        } else {
          await callIdentity('/auth/logout', { method: 'POST' })
        }
      } catch {
        // The replay below is authoritative even when the mutation response is
        // lost after the server may already have committed the teardown.
      }
      if (staleCookie) {
        try {
          const replay = await callIdentity('/auth/me', {}, staleCookie)
          sessionTeardownProven = replay.response.status === 401
            && replay.json?.error === 'Not authenticated'
        } catch {
          sessionTeardownProven = false
        }
      }
    }
  }

  if (!successReport || primaryError || (sessionMayExist && !sessionTeardownProven)) {
    const teardownUnproven = sessionMayExist && !sessionTeardownProven
    return json(503, {
      ok: false,
      error: teardownUnproven
        ? 'IDENTITY_SESSION_TEARDOWN_UNPROVEN'
        : 'IDENTITY_RELEASE_CONTRACT_FAILED',
      ...(primaryError ? { primaryError } : {}),
      sessionTeardownAttempted,
      sessionTeardownProven,
      ...(sessionTeardownMethod ? { sessionTeardownMethod } : {}),
      credentialsIncluded: false,
      piiIncluded: false,
    }, releaseHeaders)
  }
  return json(200, successReport, releaseHeaders)
}

async function authorizedReleaseReadinessProbe(
  env: any,
  configuration: PontoProxyConfiguration,
  request: Request,
  requestId: string,
): Promise<Response> {
  const releaseHeaders = proxyReleaseHeaders(configuration, requestId)
  if (request.method !== 'GET' || !['staging', 'pilot', 'canary'].includes(configuration.rolloutStage)) {
    return json(404, { ok: false, error: 'NOT_FOUND' }, releaseHeaders)
  }
  if (!configuration.coreServiceConfigured || !CLOUDFLARE_VERSION_ID_RE.test(configuration.coreVersionId)) {
    return json(503, { ok: false, error: 'CORE_RELEASE_BINDING_UNAVAILABLE' }, releaseHeaders)
  }
  if (!(await authorizeOneTimeReleaseProbe(env, configuration, request, new ArrayBuffer(0), requestId))) {
    return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
  }

  const control = await readPontoControl(env)
  if (!exactLiveControl(control, configuration)) {
    return json(403, { ok: false, error: 'RELEASE_PROBE_NOT_AUTHORIZED' }, releaseHeaders)
  }
  const timekeepingVersionId = String(control?.versions?.timekeeping?.candidate || '').trim().toLowerCase()
  if (!CLOUDFLARE_VERSION_ID_RE.test(timekeepingVersionId)) {
    return json(503, { ok: false, error: 'TIMEKEEPING_RELEASE_VERSION_UNAVAILABLE' }, releaseHeaders)
  }

  const coreService = configuration.environment === 'staging' ? 'skincos-ponto-core-staging' : 'skincos-ponto-core'
  let upstream: Response
  try {
    upstream = await env.PONTO_CORE.fetch(new Request('https://ponto-core.internal/readiness', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-store',
        'x-request-id': requestId,
        'cloudflare-workers-version-overrides': `${coreService}="${configuration.coreVersionId}"`,
      },
      redirect: 'manual',
    }))
  } catch {
    return json(503, { ok: false, error: 'CORE_RELEASE_READINESS_UNAVAILABLE' }, releaseHeaders)
  }

  const body = await responseJson(upstream.clone())
  const exactVersions = upstream.status === 200
    && body?.ok === true
    && body?.ready === true
    && String(upstream.headers.get('x-skincos-gateway-release-sha') || '').trim().toLowerCase() === configuration.releaseSha
    && String(upstream.headers.get('x-skincos-gateway-version-id') || '').trim().toLowerCase() === configuration.coreVersionId.toLowerCase()
    && String(upstream.headers.get('x-skincos-timekeeping-release-sha') || '').trim().toLowerCase() === configuration.releaseSha
    && String(upstream.headers.get('x-skincos-timekeeping-version-id') || '').trim().toLowerCase() === timekeepingVersionId
  if (!exactVersions) {
    return json(503, { ok: false, error: 'RELEASE_READINESS_VERSION_MISMATCH' }, releaseHeaders)
  }
  return json(200, {
    ok: true,
    ready: true,
    releaseSha: configuration.releaseSha,
    coreVersionId: configuration.coreVersionId,
    timekeepingVersionId,
  }, releaseHeaders)
}

function proxyReleaseHeaders(configuration: PontoProxyConfiguration, requestId: string): Record<string, string> {
  const headers: Record<string, string> = { 'x-request-id': requestId }
  if (configuration.environment) headers['x-skincos-pages-environment'] = configuration.environment
  if (RELEASE_SHA_RE.test(configuration.releaseSha)) headers['x-skincos-pages-release-sha'] = configuration.releaseSha
  return headers
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()

  // Incoming:  /api/ponto/<rest>
  // Outgoing:  <PONTO_API_TARGET>/api/ponto/<rest>
  const prefix = '/api/ponto'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const env = context.env || {}
  const configuration = readProxyConfiguration(env, request)
  const releaseHeaders = proxyReleaseHeaders(configuration, requestId)
  const exposeTarget = String((env?.PONTO_PROXY_EXPOSE_TARGET as string | undefined) || '').trim().toLowerCase() === 'true'

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    // Keep the unauthenticated probe deliberately small. Detailed rollout,
    // target and secret-presence posture is operator information and must not
    // become a public release-window oracle.
    const statusUser = await getInsumosUser(context).catch(() => null)
    const detailed = String(statusUser?.role || '').trim().toUpperCase() === 'ADMIN'
    if (!detailed) {
      return json(
        configuration.ok ? 200 : 503,
        { ok: configuration.ok, ready: configuration.ok },
        releaseHeaders,
      )
    }
    const actorKey = (env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || ''
    const networkKey = (env?.PONTO_NETWORK_CONTEXT_KEY as string | undefined) || ''
    return json(
      configuration.ok ? 200 : 503,
      {
        ok: configuration.ok,
        ready: configuration.ok,
        environment: configuration.environment || undefined,
        rolloutStage: PONTO_ROLLOUT_STAGES.has(configuration.rolloutStage) ? configuration.rolloutStage : undefined,
        releaseSha: RELEASE_SHA_RE.test(configuration.releaseSha) ? configuration.releaseSha : undefined,
        targetConfigured: configuration.targetConfigured,
        targetMatchesEnvironment: configuration.targetMatchesEnvironment,
        targetFrom: configuration.targetConfigured ? 'PONTO_API_TARGET' : undefined,
        ...(exposeTarget && configuration.targetOrigin ? { targetOrigin: configuration.targetOrigin } : {}),
        actorKeyConfigured: !!String(actorKey || '').trim(),
        networkKeyConfigured: !!String(networkKey || '').trim(),
        coreVersionOverrideConfigured: CLOUDFLARE_VERSION_ID_RE.test(configuration.coreVersionId),
        coreServiceConfigured: configuration.coreServiceConfigured,
        identityVersionOverrideConfigured: CLOUDFLARE_VERSION_ID_RE.test(configuration.identityVersionId),
        identityServiceConfigured: configuration.identityServiceConfigured,
        releaseProbeKeyConfigured: configuration.releaseProbeKeyConfigured,
        localDirectTimekeeping: configuration.localDirectTimekeeping,
        issues: configuration.issues,
      },
      releaseHeaders,
    )
  }

  if (!configuration.ok) {
    return json(
      503,
      {
        ok: false,
        error: 'PONTO_PROXY_CONFIG_INVALID',
        issues: configuration.issues,
      },
      releaseHeaders,
    )
  }

  if (rest === '/_release-contract' || rest === '/_release-contract/') {
    return authorizedIdentityReleaseProbe(env, configuration, request, requestId)
  }
  if (rest === '/_release-readiness' || rest === '/_release-readiness/') {
    return authorizedReleaseReadinessProbe(env, configuration, request, requestId)
  }

  const isPublicRoute = ['/health', '/health/', '/readiness', '/readiness/', '/_proxy-status', '/_proxy-status/'].includes(rest)
  const isDeviceRoute = rest === '/device' || rest.startsWith('/device/')
  const isAdminRoute = rest === '/admin' || rest.startsWith('/admin/')
  const requiresActor = !isPublicRoute && !isDeviceRoute

  let actorB64 = ''
  let actorTs = ''
  let actorSig = ''
  let networkContext = ''
  let networkTs = ''
  let networkSignature = ''
  let actor: {
    id: string
    email?: string
    name?: string
    role: string
    allowedUnits: string[]
    releaseSha: string
  } | null = null

  const actorKey = String((env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || '').trim()
  const networkKey = String((env?.PONTO_NETWORK_CONTEXT_KEY as string | undefined) || '').trim()
  let isAdminUser = false

  if (requiresActor) {
    const csrfResponse = requireCsrfForMutations(context)
    if (csrfResponse) return csrfResponse
    const user = await getInsumosUser(context)
    if (!user) {
      return json(
        401,
        { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' },
        { 'x-request-id': requestId },
      )
    }
    if (!actorKey) {
      return json(
        503,
        { ok: false, error: 'ACTOR_KEY_NOT_CONFIGURED', hint: 'Configure PONTO_ACTOR_HMAC_KEY nas variáveis do Pages.' },
        { 'x-request-id': requestId },
      )
    }
    const trustedClientAddress = configuration.localDirectTimekeeping ? '127.0.0.1' : cloudflareClientAddress(request)
    if (!networkKey || !trustedClientAddress) {
      return json(
        503,
        { ok: false, error: 'NETWORK_CONTEXT_UNAVAILABLE', hint: 'O contexto de rede confiável do Ponto não está disponível.' },
        releaseHeaders,
      )
    }
    if (isAdminRoute) {
      const role = normalizeCrmRole(user.role)
      isAdminUser = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'].includes(role)
      if (!isAdminUser) {
        return json(
          403,
          { ok: false, error: 'FORBIDDEN', hint: 'Acesso restrito a gestores.' },
          { 'x-request-id': requestId },
        )
      }
    }
    const role = normalizeCrmRole(user.role)
    const workforceRole = role === 'GESTOR' || role === 'GERENTE'
      ? 'MANAGER'
      : role === 'SUPERVISOR'
        ? 'SUPERVISOR'
        : role === 'CONSULTOR'
          ? 'CONSULTOR'
          : role || 'CONSULTOR'
    actor = {
      id: String(user.id || user.email || ''),
      email: user.email ? String(user.email) : undefined,
      name: user.displayName ? String(user.displayName) : (user.name ? String(user.name) : undefined),
      role: workforceRole,
      allowedUnits: normalizeUnits(user.allowedUnits),
      releaseSha: configuration.releaseSha,
    }
    actorB64 = b64UrlEncodeString(JSON.stringify(actor))
    actorTs = String(Date.now())
  }

  const targetUrl = new URL(configuration.targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/ponto${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  // Cookies and browser Authorization never cross this boundary. Device tokens are
  // accepted only on explicit device routes; CRM users receive signed actor claims.
  const headers = buildUpstreamHeaders(request, requestId, isDeviceRoute)
  headers.set('x-skincos-pages-release-sha', configuration.releaseSha)
  headers.set('x-skincos-pages-environment', configuration.environment)
  if (configuration.localDirectTimekeeping) {
    headers.set('x-skincos-gateway-release-sha', configuration.releaseSha)
    headers.set('x-skincos-gateway-environment', 'local')
  }
  const method = (request.method || 'GET').toUpperCase()
  let body: ArrayBuffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    try { body = await readBodyLimited(request) } catch (error) {
      if ((error as Error)?.message === 'PAYLOAD_TOO_LARGE') return json(413, { ok: false, error: 'PAYLOAD_TOO_LARGE' }, { 'x-request-id': requestId })
      throw error
    }
  }
  if (requiresActor) {
    const nonce = !['GET', 'HEAD', 'OPTIONS'].includes(method) ? newRequestId() : ''
    const bodyHash = await sha256Hex(body || new ArrayBuffer(0))
    const clientAddress = configuration.localDirectTimekeeping ? '127.0.0.1' : cloudflareClientAddress(request)
    if (!clientAddress) {
      return json(503, { ok: false, error: 'NETWORK_CONTEXT_UNAVAILABLE' }, releaseHeaders)
    }
    if (nonce) headers.set('x-request-nonce', nonce)
    actorSig = await signHmacSha256B64Url(actorKey, [actorTs, actorB64, method, `${targetUrl.pathname}${targetUrl.search}`, nonce, bodyHash].join('.'))
    networkContext = `v1:${await signHmacSha256B64Url(networkKey, `ponto-network/v1.${configuration.releaseSha}.${clientAddress}`)}`
    networkTs = String(Date.now())
    networkSignature = await signHmacSha256B64Url(
      networkKey,
      [networkTs, actorB64, method, `${targetUrl.pathname}${targetUrl.search}`, nonce, bodyHash, configuration.releaseSha, networkContext].join('.'),
    )
    headers.set('x-skincos-actor', actorB64)
    headers.set('x-skincos-actor-ts', actorTs)
    headers.set('x-skincos-actor-sig', actorSig)
    headers.set('x-skincos-signature-version', '2')
    headers.set('x-skincos-network-context', networkContext)
    headers.set('x-skincos-network-ts', networkTs)
    headers.set('x-skincos-network-sig', networkSignature)
    headers.set('x-skincos-network-signature-version', '2')
    headers.set('cloudflare-workers-version-key', networkContext)
    if (CLOUDFLARE_VERSION_ID_RE.test(configuration.coreVersionId)) {
      const cohortControlled = configuration.rolloutStage === 'pilot' || configuration.rolloutStage === 'canary'
      if (configuration.rolloutStage === 'staging') {
        const control = await readPontoControl(env)
        if (!exactLiveControl(control, configuration)) {
          return json(
            403,
            { ok: false, error: 'PONTO_RELEASE_CONTROL_NOT_AUTHORIZED' },
            releaseHeaders,
          )
        }
      }
      if (cohortControlled && (!actor || !(await canRoutePontoCandidate(env, configuration, actor, networkContext)))) {
        return json(
          403,
          { ok: false, error: 'PONTO_COHORT_NOT_AUTHORIZED' },
          releaseHeaders,
        )
      }
      const coreService = configuration.environment === 'staging' ? 'skincos-ponto-core-staging' : 'skincos-ponto-core'
      headers.set('cloudflare-workers-version-overrides', `${coreService}="${configuration.coreVersionId}"`)
    }
  }
  if (isDeviceRoute) {
    const clientIp = cloudflareClientIpv4(request)
    if (networkKey && clientIp) {
      const networkTs = String(Date.now())
      const networkSignature = await signHmacSha256B64Url(networkKey, [networkTs, method, `${targetUrl.pathname}${targetUrl.search}`, clientIp].join('.'))
      headers.set('x-skincos-network-ts', networkTs)
      headers.set('x-skincos-network-ip', clientIp)
      headers.set('x-skincos-network-sig', networkSignature)
    }
  }

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
  })

  let upstream: Response
  try {
    upstream = configuration.localDirectTimekeeping
      ? await fetch(upstreamRequest)
      : await env.PONTO_CORE.fetch(upstreamRequest)
  } catch {
    console.error(JSON.stringify({
      level: 'error',
      event: 'ponto_upstream_unavailable',
      requestId,
      method,
      path: targetUrl.pathname,
    }))
    return json(503, {
      ok: false,
      error: 'UPSTREAM_UNAVAILABLE',
      hint: 'O serviço de Controle de Ponto está temporariamente indisponível.',
      requestId,
    }, { 'x-request-id': requestId })
  }

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Cache-Control', 'no-store')
  outHeaders.set('x-request-id', requestId)
  outHeaders.set('x-skincos-pages-release-sha', configuration.releaseSha)
  outHeaders.set('x-skincos-pages-environment', configuration.environment)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
