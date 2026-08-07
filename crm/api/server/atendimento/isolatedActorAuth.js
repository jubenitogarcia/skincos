import { createHmac, timingSafeEqual } from 'node:crypto'

const NONCE = /^[A-Za-z0-9_-]{16,128}$/

function b64UrlDecode(input) {
    const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
    const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : ''
    return Buffer.from(raw + pad, 'base64').toString('utf8')
}

function b64UrlEncode(buffer) {
    return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function safeEqual(left, right) {
    try {
        const a = Buffer.from(String(left || ''))
        const b = Buffer.from(String(right || ''))
        return a.length === b.length && timingSafeEqual(a, b)
    } catch {
        return false
    }
}

function normalizeRole(value) {
    const raw = String(value || '').trim().toUpperCase()
    if (raw === 'ADMIN') return 'GESTOR'
    if (raw === 'OPERADOR') return 'INJETOR'
    return raw
}

function parseActor(encoded) {
    try {
        const value = JSON.parse(b64UrlDecode(encoded))
        if (!value || typeof value !== 'object') return null
        const rawRole = value.role
        const id = String(value.id || value.username || value.email || '').trim()
        if (!id || id.length > 200) return null
        return {
            id,
            username: value.username ? String(value.username) : undefined,
            email: value.email ? String(value.email) : undefined,
            name: value.name ? String(value.name) : undefined,
            role: normalizeRole(rawRole),
            isGlobalAdmin: String(rawRole || '').trim().toUpperCase() === 'ADMIN',
            allowedUnits: Array.isArray(value.allowedUnits) ? value.allowedUnits.map(String).filter(Boolean) : undefined,
            allowedUnitsDeclared: Object.prototype.hasOwnProperty.call(value, 'allowedUnits'),
            allowedModules: Array.isArray(value.allowedModules) ? value.allowedModules.map(String).filter(Boolean) : undefined,
        }
    } catch {
        return null
    }
}

export function actorSignatureMessage({ timestamp, nonce, method, path, encoded }) {
    return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${path}.${encoded}`
}

function requestPath(req) {
    const raw = String(req?.originalUrl || req?.url || req?.path || '/').trim() || '/'
    // This must include the query string when it was sent: otherwise a
    // signature for one filter could be replayed against another scope.
    return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * Signature version 2 binds the actor to the exact request and consumes a
 * nonce in a persistent, single-runtime replay ledger.  It is deliberately
 * only used by the isolated Atendimento process; the shared CRM preserves its
 * existing signature contract until it is separately migrated.
 */
export function createReplayProtectedActorVerifier({
    actorHmacKey,
    replayGuard,
    clock = () => Date.now(),
    onRejected = () => {},
} = {}) {
    const secret = String(actorHmacKey || '').trim()
    if (!secret || !replayGuard || typeof replayGuard.consume !== 'function') {
        throw new Error('ATENDIMENTO_ACTOR_REPLAY_GUARD_REQUIRED')
    }

    return async function verify(req) {
        const headers = req?.headers || {}
        const encoded = String(headers['x-crm-user'] || '').trim()
        const actor = parseActor(encoded)
        const timestamp = String(headers['x-crm-ts'] || '').trim()
        const nonce = String(headers['x-crm-nonce'] || '').trim()
        const signature = String(headers['x-crm-signature'] || '').trim()
        const version = String(headers['x-crm-signature-version'] || '').trim()
        const timestampNumber = Number(timestamp)
        const now = Number(clock())
        if (!actor || version !== '2' || !NONCE.test(nonce) || !Number.isFinite(timestampNumber)
            || Math.abs(now - timestampNumber) > 5 * 60 * 1000 || !signature) {
            onRejected('invalid')
            return null
        }

        const expected = b64UrlEncode(createHmac('sha256', secret).update(actorSignatureMessage({
            timestamp,
            nonce,
            method: String(req?.method || 'GET').trim().toUpperCase(),
            path: requestPath(req),
            encoded,
        })).digest())
        if (!safeEqual(signature, expected)) {
            onRejected('invalid')
            return null
        }

        try {
            const consumed = await replayGuard.consume(nonce, timestampNumber + 5 * 60 * 1000)
            if (!consumed) {
                onRejected('replayed')
                return null
            }
        } catch {
            // Failure to persist replay state is never an authentication
            // bypass.  Do not surface filesystem details to callers.
            onRejected('unavailable')
            return null
        }
        return actor
    }
}

export const __testables = { b64UrlDecode, b64UrlEncode, parseActor, requestPath, safeEqual }
