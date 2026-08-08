import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

export const COMMERCIAL_CANARY_SELECTOR_VERSION = 2
export const COMMERCIAL_CANARY_MAX_IDENTITIES = 100
export const COMMERCIAL_CANARY_CANDIDATE_TTL_MS = 10 * 60 * 1000
export const COMMERCIAL_CANARY_VALIDATION_TYPES = Object.freeze(['synthetic', 'explicit_approved'])

const COMMERCIAL_CANARY_GCM_TAG_LENGTH = 16
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT = /^[a-z0-9][a-z0-9-]{1,79}$/
const POLICY_VERSION = /^[a-f0-9]{32}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const FORBIDDEN_JUSTIFICATION = /(?:\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\d[\d\s().-]{6,}\d\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)/i

function domainError(code, statusCode = 400) {
    const error = new Error(code)
    error.statusCode = statusCode
    return error
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (!value || typeof value !== 'object') return JSON.stringify(value)
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function normalizeCanaryUnit(value) {
    const unit = String(value || '').trim().toLowerCase()
    if (!UNIT.test(unit)) throw domainError('COMMERCIAL_CANARY_UNIT_REQUIRED')
    return unit
}

export function normalizeCanarySearch(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120)
}

export function normalizeCanaryJustification(value) {
    const justification = String(value || '').trim().replace(/\s+/g, ' ')
    if (justification.length < 10 || justification.length > 500 || FORBIDDEN_JUSTIFICATION.test(justification)) {
        throw domainError('COMMERCIAL_CANARY_JUSTIFICATION_INVALID')
    }
    return justification
}

export function normalizeCanaryIdempotencyKey(value) {
    const key = String(value || '').trim()
    if (!IDEMPOTENCY_KEY.test(key)) throw domainError('COMMERCIAL_CANARY_IDEMPOTENCY_KEY_INVALID')
    return key
}

export function normalizeCanaryPolicyVersion(value) {
    const version = String(value || '').trim().toLowerCase()
    if (!POLICY_VERSION.test(version)) throw domainError('COMMERCIAL_POLICY_VERSION_REQUIRED', 409)
    return version
}

export function normalizeCanaryExpectedRevision(value, code = 'COMMERCIAL_CANARY_VERSION_REQUIRED') {
    const revision = Number(value)
    if (!Number.isInteger(revision) || revision < 0 || revision > 2_147_483_647) throw domainError(code, 409)
    return revision
}

export function normalizeCanaryValidationType(value) {
    const type = String(value || '').trim()
    if (!COMMERCIAL_CANARY_VALIDATION_TYPES.includes(type)) throw domainError('COMMERCIAL_CANARY_VALIDATION_TYPE_INVALID')
    return type
}

export function normalizeCanaryApprovalReference(value) {
    const reference = String(value || '').trim()
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(reference)) throw domainError('COMMERCIAL_CANARY_APPROVAL_REFERENCE_INVALID')
    return reference
}

export function maskCanaryDisplayName(value) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean)
    if (!words.length) return 'Cliente mascarado'
    return words.map((word) => `${word.slice(0, 1)}${'•'.repeat(Math.min(Math.max(word.length - 1, 2), 8))}`).join(' ')
}

export function createCommercialCanaryCandidateCodec(secret, { now = () => Date.now(), ttlMs = COMMERCIAL_CANARY_CANDIDATE_TTL_MS } = {}) {
    const material = Buffer.from(String(secret || ''), 'utf8')
    if (material.length < 32) throw domainError('COMMERCIAL_CANARY_SELECTOR_KEY_NOT_CONFIGURED', 503)
    const key = createHash('sha256').update(material).digest()

    function verifyPayload(payload) {
        if (!payload || payload.v !== COMMERCIAL_CANARY_SELECTOR_VERSION || !UUID.test(String(payload.identityId || ''))) {
            throw domainError('COMMERCIAL_CANARY_CANDIDATE_INVALID', 409)
        }
        normalizeCanaryUnit(payload.unit)
        const issuedAt = Number(payload.issuedAt)
        if (!Number.isFinite(issuedAt) || issuedAt > now() + 60_000 || now() - issuedAt > ttlMs) {
            throw domainError('COMMERCIAL_CANARY_CANDIDATE_EXPIRED', 409)
        }
    }

    return {
        encode({ identityId, unit }) {
            const payload = { v: COMMERCIAL_CANARY_SELECTOR_VERSION, identityId: String(identityId || '').toLowerCase(), unit: normalizeCanaryUnit(unit), issuedAt: now() }
            verifyPayload(payload)
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
            const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
            return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
        },
        decode(reference) {
            try {
                const bytes = Buffer.from(String(reference || ''), 'base64url')
                if (bytes.length < 12 + COMMERCIAL_CANARY_GCM_TAG_LENGTH + 1) throw new Error('short')
                const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 })
                decipher.setAuthTag(bytes.subarray(12, 12 + COMMERCIAL_CANARY_GCM_TAG_LENGTH))
                const raw = Buffer.concat([decipher.update(bytes.subarray(12 + COMMERCIAL_CANARY_GCM_TAG_LENGTH)), decipher.final()]).toString('utf8')
                const payload = JSON.parse(raw)
                verifyPayload(payload)
                return { identityId: String(payload.identityId).toLowerCase(), unit: normalizeCanaryUnit(payload.unit), issuedAt: Number(payload.issuedAt) }
            } catch (error) {
                if (String(error?.message || '').startsWith('COMMERCIAL_CANARY_')) throw error
                throw domainError('COMMERCIAL_CANARY_CANDIDATE_INVALID', 409)
            }
        },
    }
}

export function canaryOpaqueIdentityHash(secret, identityId) {
    if (!UUID.test(String(identityId || ''))) throw domainError('COMMERCIAL_CANARY_IDENTITY_INVALID')
    const material = Buffer.from(String(secret || ''), 'utf8')
    if (material.length < 32) throw domainError('COMMERCIAL_CANARY_SELECTOR_KEY_NOT_CONFIGURED', 503)
    return createHmac('sha256', material).update(`commercial-canary:v${COMMERCIAL_CANARY_SELECTOR_VERSION}:${String(identityId).toLowerCase()}`).digest('hex')
}

export function commercialCanaryRequestHash(secret, payload) {
    const material = Buffer.from(String(secret || ''), 'utf8')
    if (material.length < 32) throw domainError('COMMERCIAL_CANARY_SELECTOR_KEY_NOT_CONFIGURED', 503)
    return createHmac('sha256', material).update(canonicalJson(payload)).digest('hex')
}

export function summarizeCommercialCanaryCandidates(candidates) {
    const values = Array.isArray(candidates) ? candidates : []
    const summary = {
        totalCohort: values.length,
        eligible: 0,
        blocked: 0,
        inReview: 0,
        permissionsExpiring: 0,
        phonesUncorrelated: 0,
        staleSources: 0,
        pendingIdentityDecisions: 0,
        duplicateSelections: 0,
        outOfScope: 0,
        notValidated: 0,
        impact: { messagesSent: 0, commercialWritesEnabled: false, contactsRecorded: 0, actionsCreated: 0 },
    }
    for (const candidate of values) {
        const eligibility = String(candidate?.eligibility || 'review_required')
        if (eligibility === 'eligible') summary.eligible += 1
        else if (eligibility === 'blocked') summary.blocked += 1
        else summary.inReview += 1
        if (candidate?.permissionStatus === 'expiring') summary.permissionsExpiring += 1
        if (candidate?.phoneStatus !== 'correlated') summary.phonesUncorrelated += 1
        if (candidate?.freshness !== 'healthy') summary.staleSources += 1
        if (candidate?.identityQuality !== 'confirmed_multi_source') summary.pendingIdentityDecisions += 1
        if (candidate?.validationStatus !== 'valid') summary.notValidated += 1
        if (candidate?.outOfScope === true) summary.outOfScope += 1
    }
    return summary
}

export function commercialCanaryApplyAllowed(summary) {
    return Number(summary?.totalCohort || 0) > 0 &&
        Number(summary?.eligible || 0) === Number(summary?.totalCohort || 0) &&
        Number(summary?.blocked || 0) === 0 &&
        Number(summary?.inReview || 0) === 0 &&
        Number(summary?.staleSources || 0) === 0 &&
        Number(summary?.notValidated || 0) === 0 &&
        Number(summary?.outOfScope || 0) === 0
}

export const __testables = {
    canonicalJson,
    domainError,
}
