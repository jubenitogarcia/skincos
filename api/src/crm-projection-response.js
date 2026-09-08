import { isCanonicalUnitScope } from '../../shared/identity-contract/index.js';

const RESPONSE_LIMIT = 128 * 1024;
const RESPONSE_TIMEOUT_MS = 3_000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const EVENT_ID = /^event:[A-Za-z0-9_-]{8,160}$/;
const PROJECTION_REFERENCE = /^projection:[A-Za-z0-9_-]{8,160}$/;
const SOURCE_REFERENCE = /^source:[A-Za-z0-9_-]{8,160}$/;

function reject() { throw new TypeError('CRM_PROJECTION_RESPONSE_INVALID'); }

function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) reject();
}

function orderedUnits(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64
        || value.some((unit) => typeof unit !== 'string' || unit !== unit.trim() || !isCanonicalUnitScope(unit))
        || new Set(value).size !== value.length) reject();
    const sorted = [...value].sort();
    if (value.some((unit, index) => unit !== sorted[index])) reject();
}

function canonicalDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) reject();
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) reject();
}

/** Validate the closed wire contract, then reconstruct only its opaque fields. */
export function validateCrmProjectionPayload(value, { units, requestId }) {
    orderedUnits(units);
    exact(value, ['ok', 'contractVersion', 'state', 'scope', 'projections', 'count', 'requestId']);
    if (value.ok !== true || value.contractVersion !== 'crm-core/projection-read/v2' || value.state !== 'available'
        || typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) || value.requestId !== requestId) reject();
    exact(value.scope, ['mode', 'units']);
    orderedUnits(value.scope.units);
    if (value.scope.mode !== 'intersection' || JSON.stringify(value.scope.units) !== JSON.stringify(units)
        || !Array.isArray(value.projections) || value.projections.length > 100
        || !Number.isSafeInteger(value.count) || value.count !== value.projections.length) reject();
    const keys = new Set();
    const eventIds = new Set();
    const projections = value.projections.map((event) => {
        exact(event, ['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt']);
        exact(event.projection, ['reference', 'kind']);
        exact(event.source, ['owner', 'reference']);
        exact(event.unitScope, ['unitSlug']);
        if (event.contractVersion !== 'crm-projection-event/v2'
            || typeof event.id !== 'string' || !EVENT_ID.test(event.id)
            || event.projection.kind !== 'client-reference'
            || typeof event.projection.reference !== 'string' || !PROJECTION_REFERENCE.test(event.projection.reference)
            || event.source.owner !== 'atendimento'
            || typeof event.source.reference !== 'string' || !SOURCE_REFERENCE.test(event.source.reference)
            || !units.includes(event.unitScope.unitSlug)
            || !Number.isSafeInteger(event.revision) || event.revision < 1
            || !['upsert', 'revoke'].includes(event.operation)) reject();
        canonicalDate(event.occurredAt);
        const key = `${event.unitScope.unitSlug}:${event.projection.reference}`;
        if (keys.has(key) || eventIds.has(event.id)) reject();
        keys.add(key);
        eventIds.add(event.id);
        return {
            contractVersion: 'crm-projection-event/v2', id: event.id,
            projection: { reference: event.projection.reference, kind: 'client-reference' },
            source: { owner: 'atendimento', reference: event.source.reference },
            unitScope: { unitSlug: event.unitScope.unitSlug },
            revision: event.revision, operation: event.operation, occurredAt: event.occurredAt,
        };
    });
    return {
        ok: true, contractVersion: 'crm-core/projection-read/v2', state: 'available',
        scope: { mode: 'intersection', units: [...units] }, projections, count: projections.length, requestId,
    };
}

async function boundedJson(response, timeoutMs) {
    const length = response.headers.get('content-length');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
        || (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) || !response.body) reject();
    const reader = response.body.getReader();
    let timer;
    const read = async () => {
        const chunks = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > RESPONSE_LIMIT) reject();
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    };
    try {
        const deadline = new Promise((_, fail) => { timer = setTimeout(() => fail(new TypeError('CRM_PROJECTION_RESPONSE_TIMEOUT')), timeoutMs); });
        return await Promise.race([read(), deadline]);
    } finally {
        clearTimeout(timer);
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

const safeJson = (status, payload) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** Never forward upstream errors, cookies, credentials, redirects or arbitrary headers. */
export async function validatedCrmProjectionResponse(response, expected, { timeoutMs = RESPONSE_TIMEOUT_MS } = {}) {
    try {
        if (response.status !== 200) {
            void response.body?.cancel().catch(() => {});
            const failures = { 400: 'CRM_PROJECTION_QUERY_INVALID', 401: 'CRM_IDENTITY_REQUIRED', 403: 'CRM_PROJECTION_SCOPE_FORBIDDEN' };
            return safeJson(failures[response.status] ? response.status : 503, {
                ok: false, error: failures[response.status] || 'CRM_PROJECTION_UNAVAILABLE',
            });
        }
        return safeJson(200, validateCrmProjectionPayload(await boundedJson(response, timeoutMs), expected));
    } catch {
        void response.body?.cancel().catch(() => {});
        return safeJson(503, { ok: false, error: 'CRM_PROJECTION_RESPONSE_INVALID' });
    }
}
