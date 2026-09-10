import { createHash } from 'node:crypto'
import { fingerprintAtendimentoProjectionIdentityKey } from './atendimentoProjectionIdentityKey.js'

// Neutral handoff contract shared by the Atendimento producer and CRM Core
// consumer. This module has no dependency on either runtime; only opaque
// identity UUIDs, unit slugs, digests and release descriptors cross the edge.

export const CRM_CORE_PROJECTION_DELTA_BASELINE_CONTRACT = 'atendimento/crm-core/projection-delta-baseline/v3'
export const CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT = 'atendimento/crm-core/projection-delta-baseline-readback/v3'
export const CRM_CORE_PROJECTION_DELTA_BASELINE_STATES = Object.freeze({
    PREPARED: 'baseline-prepared',
    ACCEPTED: 'baseline-accepted',
    READY: 'delta-ready',
})
export const CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS = 10_000
export const CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES = 500
export const CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS = 20

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const BATCH_ID_PATTERN = /^backfill:atendimento:[A-Za-z0-9_-]{8,160}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function fail(code) {
    const error = new Error(code)
    error.code = code
    throw error
}

function object(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
    return value
}

function exactKeys(value, keys, code) {
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code)
}

function text(value, code) {
    const normalized = String(value ?? '').trim()
    if (!normalized) fail(code)
    return normalized
}

function timestamp(value, code) {
    const normalized = value instanceof Date ? value.toISOString() : text(value, code)
    if (!TIMESTAMP_PATTERN.test(normalized) || Number.isNaN(new Date(normalized).getTime())) fail(code)
    return normalized
}

function sha256(value, code) {
    const normalized = text(value, code).toLowerCase()
    if (!SHA256_PATTERN.test(normalized)) fail(code)
    return normalized
}

function positiveInteger(value, code, maximum = CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS) {
    const normalized = Number(value)
    if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) fail(code)
    return normalized
}

function nonNegativeInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
    const normalized = Number(value)
    if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) fail(code)
    return normalized
}

function identityId(value, code) {
    const normalized = text(value, code).toLowerCase()
    if (!UUID_PATTERN.test(normalized)) fail(code)
    return normalized
}

function unitSlug(value, code) {
    const normalized = text(value, code)
    if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
    return normalized
}

function unitSlugs(value, code, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS) fail(code)
    const normalized = value.map((entry) => unitSlug(entry, code)).sort()
    if (new Set(normalized).size !== normalized.length) fail(code)
    return Object.freeze(normalized)
}

function membershipRow(value) {
    const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID')
    const keys = Object.keys(row)
    const snakeShape = keys.length === 3 && ['identity_id', 'unit_slug', 'observed_at'].every((key) => keys.includes(key))
    const camelShape = keys.length === 3 && ['identityId', 'unitSlug', 'observedAt'].every((key) => keys.includes(key))
    if (!snakeShape && !camelShape) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID')
    return Object.freeze({
        identityId: identityId(row.identity_id ?? row.identityId, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID'),
        unitSlug: unitSlug(row.unit_slug ?? row.unitSlug, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID'),
        observedAt: timestamp(row.observed_at ?? row.observedAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID'),
    })
}

function normalizedMembershipRows(rows) {
    if (!Array.isArray(rows) || rows.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID')
    const normalizedRows = rows.map(membershipRow).sort((left, right) => (
        `${left.identityId}\u0000${left.unitSlug}`.localeCompare(`${right.identityId}\u0000${right.unitSlug}`)
    ))
    const keys = new Set(normalizedRows.map((row) => `${row.identityId}\u0000${row.unitSlug}`))
    if (keys.size !== normalizedRows.length) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID')
    return normalizedRows
}

function target(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['environment', 'release', 'artifactDigest'], code)
    const environment = text(descriptor.environment, code)
    const release = text(descriptor.release, code).toLowerCase()
    if (!['staging', 'production'].includes(environment) || !RELEASE_PATTERN.test(release)) fail(code)
    return Object.freeze({ environment, release, artifactDigest: sha256(descriptor.artifactDigest, code) })
}

function keyId(value, code) {
    const normalized = text(value, code)
    if (!KEY_ID_PATTERN.test(normalized)) fail(code)
    return normalized
}

function source(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['owner', 'scope', 'backfillKeyId', 'deltaKeyId', 'identityKeyFingerprint', 'unitAllowlist'], code)
    const owner = text(descriptor.owner, code)
    const scope = text(descriptor.scope, code)
    if (owner !== 'atendimento' || scope !== 'global-client-identities/v1') fail(code)
    return Object.freeze({
        owner,
        scope,
        backfillKeyId: keyId(descriptor.backfillKeyId, code),
        deltaKeyId: keyId(descriptor.deltaKeyId, code),
        identityKeyFingerprint: sha256(descriptor.identityKeyFingerprint, code),
        unitAllowlist: unitSlugs(descriptor.unitAllowlist, code),
    })
}

/**
 * Builds the stored source pin from an operator-supplied identity HMAC. Only
 * its non-secret fingerprint is retained in the baseline document.
 */
export function createAtendimentoProjectionDeltaBaselineSource({
    owner,
    scope,
    backfillKeyId,
    deltaKeyId,
    identityHmacKey,
    unitAllowlist,
} = {}) {
    return source({
        owner,
        scope,
        backfillKeyId,
        deltaKeyId,
        identityKeyFingerprint: fingerprintAtendimentoProjectionIdentityKey(identityHmacKey),
        unitAllowlist,
    }, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SOURCE_INVALID')
}

function snapshot(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['capturedAt', 'cursorDigest', 'rowCount', 'unitSlugs', 'watermark'], code)
    return Object.freeze({
        capturedAt: timestamp(descriptor.capturedAt, code),
        cursorDigest: sha256(descriptor.cursorDigest, code),
        rowCount: nonNegativeInteger(descriptor.rowCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS),
        unitSlugs: unitSlugs(descriptor.unitSlugs, code, { allowEmpty: true }),
        watermark: nonNegativeInteger(descriptor.watermark, code),
    })
}

function backfillBatch(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['batchId', 'batchDigest', 'capturedAt', 'cursorDigest', 'fromOrdinal', 'toOrdinal', 'rowCount', 'unitSlugs', 'eventCount'], code)
    const batchId = text(descriptor.batchId, code)
    if (!BATCH_ID_PATTERN.test(batchId)) fail(code)
    const rowCount = positiveInteger(descriptor.rowCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS)
    const eventCount = positiveInteger(descriptor.eventCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS)
    if (eventCount !== rowCount) fail(code)
    const fromOrdinal = positiveInteger(descriptor.fromOrdinal, code)
    const toOrdinal = positiveInteger(descriptor.toOrdinal, code)
    if (toOrdinal < fromOrdinal || toOrdinal - fromOrdinal + 1 !== rowCount) fail(code)
    return Object.freeze({
        batchId,
        batchDigest: sha256(descriptor.batchDigest, code),
        capturedAt: timestamp(descriptor.capturedAt, code),
        cursorDigest: sha256(descriptor.cursorDigest, code),
        fromOrdinal,
        toOrdinal,
        rowCount,
        unitSlugs: unitSlugs(descriptor.unitSlugs, code),
        eventCount,
    })
}

function setEquals(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

function subset(subsetValues, supersetValues) {
    const allowed = new Set(supersetValues)
    return subsetValues.every((value) => allowed.has(value))
}

function backfill(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['manifestDigest', 'batches', 'rowCount', 'eventCount', 'unitSlugs'], code)
    const rowCount = nonNegativeInteger(descriptor.rowCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS)
    const eventCount = nonNegativeInteger(descriptor.eventCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS)
    if (eventCount !== rowCount || !Array.isArray(descriptor.batches)
        || descriptor.batches.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES) fail(code)
    const batches = descriptor.batches.map((entry) => backfillBatch(entry, code))
    if (new Set(batches.map((batch) => batch.batchId)).size !== batches.length) fail(code)
    let expectedOrdinal = 1
    for (const batch of batches) {
        if (batch.fromOrdinal !== expectedOrdinal) fail(code)
        expectedOrdinal = batch.toOrdinal + 1
    }
    if (expectedOrdinal - 1 !== rowCount || batches.reduce((sum, batch) => sum + batch.eventCount, 0) !== eventCount) fail(code)
    const aggregateUnits = unitSlugs(descriptor.unitSlugs, code, { allowEmpty: true })
    const batchUnits = [...new Set(batches.flatMap((batch) => batch.unitSlugs))].sort()
    if (!setEquals(batchUnits, aggregateUnits) || batches.some((batch) => !subset(batch.unitSlugs, aggregateUnits))) fail(code)
    const manifestDigest = sha256(descriptor.manifestDigest, code)
    if (manifestDigest !== digest(batches)) fail(code)
    return Object.freeze({ manifestDigest, batches: Object.freeze(batches), rowCount, eventCount, unitSlugs: aggregateUnits })
}

export function createAtendimentoProjectionDeltaBaselineBackfill({ batches, rowCount, eventCount = rowCount, unitSlugs: suppliedUnitSlugs } = {}) {
    if (!Array.isArray(batches) || batches.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_BACKFILL_INVALID')
    const normalizedBatches = batches.map((entry) => backfillBatch(entry, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_BACKFILL_INVALID'))
    const unitValues = suppliedUnitSlugs || [...new Set(normalizedBatches.flatMap((batch) => batch.unitSlugs))].sort()
    return backfill({
        manifestDigest: digest(normalizedBatches),
        batches: normalizedBatches,
        rowCount,
        eventCount,
        unitSlugs: unitValues,
    }, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_BACKFILL_INVALID')
}

function seed(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['membershipDigest', 'capturedAt', 'rowCount', 'unitSlugs', 'revision'], code)
    const revision = positiveInteger(descriptor.revision, code)
    if (revision !== 1) fail(code)
    return Object.freeze({
        membershipDigest: sha256(descriptor.membershipDigest, code),
        capturedAt: timestamp(descriptor.capturedAt, code),
        rowCount: nonNegativeInteger(descriptor.rowCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS),
        unitSlugs: unitSlugs(descriptor.unitSlugs, code, { allowEmpty: true }),
        revision,
    })
}

function receiptEntry(value, code) {
    const descriptor = object(value, code)
    // This is the exact CRM Core v2 HTTP result. batchDigest belongs to the
    // signed delivery and manifest, not to this receiver response.
    exactKeys(descriptor, ['contractVersion', 'status', 'batchId', 'eventCount', 'target'], code)
    if (descriptor.contractVersion !== 'crm-core/projection-backfill-receipt/v2'
        || !['accepted', 'idempotent'].includes(text(descriptor.status, code))) fail(code)
    return Object.freeze({
        contractVersion: descriptor.contractVersion,
        status: descriptor.status,
        batchId: text(descriptor.batchId, code),
        eventCount: positiveInteger(descriptor.eventCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS),
        target: target(descriptor.target, code),
    })
}

function receipts(value, code) {
    if (value === null) return null
    if (!Array.isArray(value) || value.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES) fail(code)
    const entries = value.map((entry) => receiptEntry(entry, code))
    if (new Set(entries.map((entry) => entry.batchId)).size !== entries.length) fail(code)
    return Object.freeze(entries)
}

function proof(value, code) {
    const descriptor = object(value, code)
    exactKeys(descriptor, ['contract', 'status', 'pins', 'counts', 'digests'], code)
    if (descriptor.contract !== 'crm-core/projection-baseline-batch-readback/v1'
        || text(descriptor.status, code) !== 'batch-ledger-readback-verified') fail(code)
    const pins = object(descriptor.pins, code)
    exactKeys(pins, ['producer', 'target', 'unitSlugs'], code)
    const producer = object(pins.producer, code)
    exactKeys(producer, ['owner', 'scope', 'keyId'], code)
    const owner = text(producer.owner, code)
    const scope = text(producer.scope, code)
    if (owner !== 'atendimento' || scope !== 'global-client-identities/v1') fail(code)
    const producerKeyId = keyId(producer.keyId, code)
    const proofTarget = target(pins.target, code)
    const proofUnits = unitSlugs(pins.unitSlugs, code)
    const counts = object(descriptor.counts, code)
    exactKeys(counts, ['events', 'sources', 'units'], code)
    const eventCount = positiveInteger(counts.events, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS)
    const sourceCount = positiveInteger(counts.sources, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCH_EVENTS)
    const unitCount = positiveInteger(counts.units, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS)
    const digests = object(descriptor.digests, code)
    exactKeys(digests, ['batch', 'events', 'cursor', 'receipt', 'ledger', 'sources', 'readback'], code)
    const normalizedDigests = Object.freeze({
        batch: sha256(digests.batch, code),
        events: sha256(digests.events, code),
        cursor: sha256(digests.cursor, code),
        receipt: sha256(digests.receipt, code),
        ledger: sha256(digests.ledger, code),
        sources: sha256(digests.sources, code),
        readback: sha256(digests.readback, code),
    })
    const normalized = {
        contract: descriptor.contract,
        status: descriptor.status,
        pins: { producer: { owner, scope, keyId: producerKeyId }, target: proofTarget, unitSlugs: proofUnits },
        counts: { events: eventCount, sources: sourceCount, units: unitCount },
        digests: normalizedDigests,
    }
    const withoutReadback = { ...normalized, digests: Object.fromEntries(Object.entries(normalizedDigests).filter(([name]) => name !== 'readback')) }
    if (digest(withoutReadback) !== normalizedDigests.readback) fail(code)
    return Object.freeze({
        ...normalized,
        pins: Object.freeze({ ...normalized.pins, producer: Object.freeze(normalized.pins.producer), unitSlugs: Object.freeze([...proofUnits]) }),
        counts: Object.freeze(normalized.counts),
        digests: normalizedDigests,
    })
}

function proofEntries(value, code, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES) fail(code)
    return Object.freeze(value.map((entry) => proof(entry, code)))
}

function readback(value, code) {
    if (value === null) return null
    const descriptor = object(value, code)
    exactKeys(descriptor, ['contract', 'status', 'manifestDigest', 'membershipDigest', 'watermark', 'verifiedBatchCount', 'verifiedEventCount', 'ledgerProofDigest', 'proofs', 'target'], code)
    if (descriptor.contract !== CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT
        || text(descriptor.status, code) !== 'verified') fail(code)
    const verifiedProofs = proofEntries(descriptor.proofs, code, { allowEmpty: true })
    const ledgerProofDigest = sha256(descriptor.ledgerProofDigest, code)
    const expectedLedgerProofDigest = digest(verifiedProofs.map((entry) => ({ batchDigest: entry.digests.batch, readbackDigest: entry.digests.readback })))
    if (ledgerProofDigest !== expectedLedgerProofDigest) fail(code)
    return Object.freeze({
        contract: descriptor.contract,
        status: descriptor.status,
        manifestDigest: sha256(descriptor.manifestDigest, code),
        membershipDigest: sha256(descriptor.membershipDigest, code),
        watermark: nonNegativeInteger(descriptor.watermark, code),
        verifiedBatchCount: nonNegativeInteger(descriptor.verifiedBatchCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_BATCHES),
        verifiedEventCount: nonNegativeInteger(descriptor.verifiedEventCount, code, CRM_CORE_PROJECTION_DELTA_BASELINE_MAX_ROWS),
        ledgerProofDigest,
        proofs: verifiedProofs,
        target: target(descriptor.target, code),
    })
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    return value
}

function digest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function assertRelationships({ targetValue, sourceValue, snapshotValue, backfillValue, seedValue, receiptValue, readbackValue }, code) {
    if (backfillValue.rowCount !== snapshotValue.rowCount
        || backfillValue.eventCount !== snapshotValue.rowCount
        || !same(backfillValue.unitSlugs, snapshotValue.unitSlugs)
        || seedValue.capturedAt !== snapshotValue.capturedAt
        || seedValue.rowCount !== snapshotValue.rowCount
        || !same(seedValue.unitSlugs, snapshotValue.unitSlugs)
        || !subset(snapshotValue.unitSlugs, sourceValue.unitAllowlist)
        || backfillValue.batches.some((batch) => batch.capturedAt !== snapshotValue.capturedAt || !subset(batch.unitSlugs, snapshotValue.unitSlugs))) fail(code)
    if (receiptValue) {
        if (receiptValue.length !== backfillValue.batches.length) fail(code)
        for (const [index, entry] of receiptValue.entries()) {
            const batch = backfillValue.batches[index]
            if (!batch || entry.eventCount !== batch.eventCount || !same(entry.target, targetValue)) fail(code)
            if (entry.batchId !== batch.batchId) fail(code)
        }
    }
    if (readbackValue && (readbackValue.manifestDigest !== backfillValue.manifestDigest
        || readbackValue.membershipDigest !== seedValue.membershipDigest
        || readbackValue.watermark !== snapshotValue.watermark
        || readbackValue.verifiedBatchCount !== backfillValue.batches.length
        || readbackValue.verifiedEventCount !== backfillValue.eventCount
        || !same(readbackValue.target, targetValue)
        || readbackValue.proofs.length !== backfillValue.batches.length)) fail(code)
    if (readbackValue) {
        for (const [index, batch] of backfillValue.batches.entries()) {
            const pageProof = readbackValue.proofs[index]
            const receiptEntry = receiptValue?.[index]
            if (!pageProof || !receiptEntry
                || pageProof.digests.batch !== batch.batchDigest
                || pageProof.digests.cursor !== batch.cursorDigest
                || pageProof.digests.receipt !== digest(receiptEntry)
                || pageProof.pins.producer.owner !== sourceValue.owner
                || pageProof.pins.producer.scope !== sourceValue.scope
                || pageProof.pins.producer.keyId !== sourceValue.backfillKeyId
                || !same(pageProof.pins.target, targetValue)
                || !same(pageProof.pins.unitSlugs, batch.unitSlugs)
                || pageProof.counts.events !== batch.eventCount
                || pageProof.counts.sources !== batch.eventCount
                || pageProof.counts.units !== batch.unitSlugs.length) fail(code)
        }
    }
    if (!sourceValue.backfillKeyId || !sourceValue.deltaKeyId || !sourceValue.identityKeyFingerprint || sourceValue.unitAllowlist.length < 1) fail(code)
}

export function assertAtendimentoProjectionDeltaBaseline(value) {
    const baseline = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    exactKeys(baseline, ['contract', 'state', 'target', 'source', 'snapshot', 'backfill', 'seed', 'receipts', 'readback'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    if (baseline.contract !== CRM_CORE_PROJECTION_DELTA_BASELINE_CONTRACT
        || !Object.values(CRM_CORE_PROJECTION_DELTA_BASELINE_STATES).includes(baseline.state)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const targetValue = target(baseline.target, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const sourceValue = source(baseline.source, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const snapshotValue = snapshot(baseline.snapshot, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const backfillValue = backfill(baseline.backfill, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const seedValue = seed(baseline.seed, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const receiptValue = receipts(baseline.receipts, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const readbackValue = readback(baseline.readback, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    if (baseline.state === CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED && (receiptValue || readbackValue)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_STATE_INVALID')
    if (baseline.state === CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED && (!receiptValue || readbackValue)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_STATE_INVALID')
    if (baseline.state === CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY && (!receiptValue || !readbackValue)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_STATE_INVALID')
    assertRelationships({ targetValue, sourceValue, snapshotValue, backfillValue, seedValue, receiptValue, readbackValue }, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_RELATIONSHIP_INVALID')
    return Object.freeze({
        contract: CRM_CORE_PROJECTION_DELTA_BASELINE_CONTRACT,
        state: baseline.state,
        target: targetValue,
        source: sourceValue,
        snapshot: snapshotValue,
        backfill: backfillValue,
        seed: seedValue,
        receipts: receiptValue,
        readback: readbackValue,
    })
}

export function createAtendimentoProjectionDeltaBaselineSeed({ rows, capturedAt } = {}) {
    const normalizedRows = normalizedMembershipRows(rows)
    const normalizedCapturedAt = timestamp(capturedAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SEED_INVALID')
    return Object.freeze({
        membershipDigest: digest(normalizedRows),
        capturedAt: normalizedCapturedAt,
        rowCount: normalizedRows.length,
        unitSlugs: Object.freeze([...new Set(normalizedRows.map((row) => row.unitSlug))].sort()),
        revision: 1,
    })
}

export function createAtendimentoProjectionDeltaBaselineSnapshot({ rows, capturedAt, watermark } = {}) {
    const normalizedRows = normalizedMembershipRows(rows)
    const seed = createAtendimentoProjectionDeltaBaselineSeed({ rows: normalizedRows, capturedAt })
    const normalizedWatermark = nonNegativeInteger(watermark, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_SNAPSHOT_INVALID')
    const cursorDigest = digest({ capturedAt: seed.capturedAt, membershipDigest: seed.membershipDigest, watermark: normalizedWatermark })
    return Object.freeze({
        snapshot: Object.freeze({
            capturedAt: seed.capturedAt,
            cursorDigest,
            rowCount: seed.rowCount,
            unitSlugs: seed.unitSlugs,
            watermark: normalizedWatermark,
        }),
        seed,
    })
}

export function digestAtendimentoProjectionDeltaBaseline(value) {
    return digest(assertAtendimentoProjectionDeltaBaseline(value))
}

export function createAtendimentoProjectionDeltaBaselinePrepared({ target: suppliedTarget, source: suppliedSource, snapshot: suppliedSnapshot, backfill: suppliedBackfill, seed: suppliedSeed } = {}) {
    const targetValue = target(suppliedTarget, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const sourceValue = source(suppliedSource, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const snapshotValue = snapshot(suppliedSnapshot, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const backfillValue = backfill(suppliedBackfill, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    const seedValue = seed(suppliedSeed, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INVALID')
    assertRelationships({ targetValue, sourceValue, snapshotValue, backfillValue, seedValue, receiptValue: null, readbackValue: null }, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_RELATIONSHIP_INVALID')
    return assertAtendimentoProjectionDeltaBaseline({
        contract: CRM_CORE_PROJECTION_DELTA_BASELINE_CONTRACT,
        state: CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED,
        target: targetValue,
        source: sourceValue,
        snapshot: snapshotValue,
        backfill: backfillValue,
        seed: seedValue,
        receipts: null,
        readback: null,
    })
}

export function acceptAtendimentoProjectionDeltaBaseline(baseline, suppliedReceipts) {
    const current = assertAtendimentoProjectionDeltaBaseline(baseline)
    if (current.state !== CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_TRANSITION_INVALID')
    const acceptedReceipts = receipts(suppliedReceipts, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_RECEIPT_INVALID')
    if (!acceptedReceipts) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_RECEIPT_INVALID')
    return assertAtendimentoProjectionDeltaBaseline({ ...current, state: CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED, receipts: acceptedReceipts })
}

export function markAtendimentoProjectionDeltaReady(baseline, suppliedReadback) {
    const current = assertAtendimentoProjectionDeltaBaseline(baseline)
    if (current.state !== CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_TRANSITION_INVALID')
    const verifiedReadback = readback(suppliedReadback, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_READBACK_INVALID')
    if (!verifiedReadback) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_READBACK_INVALID')
    return assertAtendimentoProjectionDeltaBaseline({ ...current, state: CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY, readback: verifiedReadback })
}

export const __testables = Object.freeze({
    UUID_PATTERN,
    UNIT_SLUG_PATTERN,
    canonicalize,
    digest,
    same,
})
