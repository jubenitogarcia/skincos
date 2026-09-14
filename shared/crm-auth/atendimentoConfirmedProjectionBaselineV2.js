import { createHash, createHmac } from 'node:crypto'

import { fingerprintAtendimentoProjectionIdentityKey } from './atendimentoProjectionIdentityKey.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE,
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from './atendimentoConfirmedProjectionDeltaV2.js'

// The legacy backfill contract is intentionally not reused here.  It names a
// global identity graph, while this packet family is bound to the isolated v5
// confirmed-unit source profile before it is serialized or signed.
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_CONTRACT = 'atendimento/crm-core/confirmed-projection-baseline/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_CONTRACT = 'skincos-crm/confirmed-projection-baseline-batch/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_CONTRACT = 'skincos-crm/confirmed-projection-baseline-delivery/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT = 'crm-core/confirmed-projection-baseline-receipt/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT = 'crm-core/confirmed-projection-baseline-readback/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH = 20
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS = 10_000
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_BATCHES = 500
export const ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES = Object.freeze({
  PREPARED: 'baseline-prepared',
  ACCEPTED: 'baseline-accepted',
  READY: 'delta-ready',
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{8,160}$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SOURCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/

function fail(code) {
  throw new Error(code)
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

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function digestValue(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) fail(code)
  return normalized
}

function timestamp(value, code) {
  const normalized = value instanceof Date ? value.toISOString() : text(value, code)
  if (!TIMESTAMP_PATTERN.test(normalized) || Number.isNaN(new Date(normalized).getTime())) fail(code)
  return normalized
}

function sourceTimestamp(value, code) {
  const raw = value instanceof Date ? value.toISOString() : text(value, code)
  const match = SOURCE_TIMESTAMP_PATTERN.exec(raw)
  if (!match || Number.isNaN(new Date(raw).getTime())) fail(code)
  return `${match[1]}.${match[2].padEnd(6, '0')}Z`
}

function uuid(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) fail(code)
  return normalized
}

function nonNegativeInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) fail(code)
  return normalized
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) fail(code)
  return normalized
}

function keyId(value, code) {
  const normalized = text(value, code)
  if (!KEY_ID_PATTERN.test(normalized)) fail(code)
  return normalized
}

function hmacKey(value, code) {
  const normalized = text(value, code)
  if (Buffer.byteLength(normalized, 'utf8') < 32) fail(code)
  return normalized
}

function hmacPart(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}\u0000${value}`).digest('base64url')
}

function hmacReference(key, namespace, value, prefix) {
  const part = hmacPart(key, namespace, value)
  if (!OPAQUE_PATTERN.test(part)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_HMAC_INVALID')
  return `${prefix}:${part}`
}

function unitSlug(value, code) {
  const normalized = text(value, code)
  if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
  return normalized
}

function unitSlugs(value, code, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS) fail(code)
  const normalized = value.map((entry) => unitSlug(entry, code)).sort()
  if (new Set(normalized).size !== normalized.length) fail(code)
  return Object.freeze(normalized)
}

function target(value, code) {
  const descriptor = object(value, code)
  exactKeys(descriptor, ['environment', 'release', 'artifactDigest'], code)
  const environment = text(descriptor.environment, code)
  const release = text(descriptor.release, code).toLowerCase()
  const artifactDigest = digestValue(descriptor.artifactDigest, code)
  if (!['staging', 'production'].includes(environment) || !RELEASE_PATTERN.test(release)) fail(code)
  return Object.freeze({ environment, release, artifactDigest })
}

function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}

function sourceProfilePin(value, code) {
  const pin = object(value, code)
  exactKeys(pin, ['semantics', 'digest'], code)
  const normalized = Object.freeze({ semantics: text(pin.semantics, code), digest: digestValue(pin.digest, code) })
  const expected = createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE)
  if (normalized.semantics !== expected.semantics || normalized.digest !== expected.digest) fail(code)
  return normalized
}

function source(value, code) {
  const descriptor = object(value, code)
  exactKeys(descriptor, ['owner', 'scope', 'baselineKeyId', 'deltaKeyId', 'identityKeyFingerprint', 'unitAllowlist'], code)
  const owner = text(descriptor.owner, code)
  const scope = text(descriptor.scope, code)
  if (owner !== 'atendimento' || scope !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE) fail(code)
  return Object.freeze({
    owner,
    scope,
    baselineKeyId: keyId(descriptor.baselineKeyId, code),
    deltaKeyId: keyId(descriptor.deltaKeyId, code),
    identityKeyFingerprint: digestValue(descriptor.identityKeyFingerprint, code),
    unitAllowlist: unitSlugs(descriptor.unitAllowlist, code),
  })
}

export function createAtendimentoConfirmedProjectionBaselineV2Source({ owner, scope, baselineKeyId, deltaKeyId, identityHmacKey, unitAllowlist } = {}) {
  return source({
    owner,
    scope,
    baselineKeyId,
    deltaKeyId,
    identityKeyFingerprint: fingerprintAtendimentoProjectionIdentityKey(identityHmacKey, {
      requiredCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_HMAC_KEY_REQUIRED',
      unsafeCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_HMAC_KEY_UNSAFE',
    }),
    unitAllowlist,
  }, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_SOURCE_INVALID')
}

function row(value, code) {
  const entry = object(value, code)
  const snake = ['identity_id', 'unit_slug', 'observed_at']
  const camel = ['identityId', 'unitSlug', 'observedAt']
  if (!((Object.keys(entry).length === snake.length && snake.every((key) => Object.hasOwn(entry, key)))
    || (Object.keys(entry).length === camel.length && camel.every((key) => Object.hasOwn(entry, key))))) fail(code)
  const rawObservedAt = entry.observed_at ?? entry.observedAt
  return Object.freeze({
    identityId: uuid(entry.identity_id ?? entry.identityId, code),
    unitSlug: unitSlug(entry.unit_slug ?? entry.unitSlug, code),
    observedAt: timestamp(rawObservedAt instanceof Date ? rawObservedAt : new Date(rawObservedAt), code),
    sourceObservedAt: sourceTimestamp(rawObservedAt, code),
  })
}

function rows(value, code) {
  if (!Array.isArray(value) || value.length > ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS) fail(code)
  const normalized = value.map((entry) => row(entry, code)).sort((left, right) => (
    left.identityId.localeCompare(right.identityId) || left.unitSlug.localeCompare(right.unitSlug)
  ))
  const keys = new Set(normalized.map((entry) => `${entry.identityId}\u0000${entry.unitSlug}`))
  if (keys.size !== normalized.length) fail(code)
  return Object.freeze(normalized)
}

export function createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows: suppliedRows, capturedAt, watermark = 0 } = {}) {
  const normalizedRows = rows(suppliedRows, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_SNAPSHOT_INVALID')
  const normalizedCapturedAt = timestamp(capturedAt, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_SNAPSHOT_INVALID')
  const normalizedWatermark = nonNegativeInteger(watermark, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_SNAPSHOT_INVALID')
  const snapshot = Object.freeze({
    capturedAt: normalizedCapturedAt,
    membershipDigest: digest(normalizedRows.map(({ identityId, unitSlug, observedAt }) => ({ identityId, unitSlug, observedAt }))),
    rowCount: normalizedRows.length,
    unitSlugs: Object.freeze([...new Set(normalizedRows.map((entry) => entry.unitSlug))].sort()),
    watermark: normalizedWatermark,
  })
  return Object.freeze({ snapshot, rows: normalizedRows })
}

function eventFromRow(value, { key, capturedAt }) {
  const sourceReference = hmacReference(key, 'confirmed-projection-source-reference/v2', value.identityId, 'source')
  const projectionReference = hmacReference(key, 'confirmed-projection-reference/v2', value.identityId, 'projection')
  const id = hmacReference(key, 'confirmed-projection-baseline-event/v2', `${sourceReference}\u0000${projectionReference}\u0000${value.unitSlug}\u0000${value.sourceObservedAt}\u0000${capturedAt}`, 'event')
  return Object.freeze({
    contractVersion: 'crm-projection-event/v2',
    id,
    projection: Object.freeze({ reference: projectionReference, kind: 'client-reference' }),
    source: Object.freeze({ owner: 'atendimento', reference: sourceReference }),
    unitScope: Object.freeze({ unitSlug: value.unitSlug }),
    revision: 1,
    operation: 'upsert',
    occurredAt: value.observedAt,
  })
}

function assertEvent(value, code) {
  const event = object(value, code)
  exactKeys(event, ['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt'], code)
  const projection = object(event.projection, code)
  const eventSource = object(event.source, code)
  const scope = object(event.unitScope, code)
  exactKeys(projection, ['reference', 'kind'], code)
  exactKeys(eventSource, ['owner', 'reference'], code)
  exactKeys(scope, ['unitSlug'], code)
  if (event.contractVersion !== 'crm-projection-event/v2'
    || !/^event:[A-Za-z0-9_-]{8,160}$/.test(text(event.id, code))
    || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(text(projection.reference, code))
    || projection.kind !== 'client-reference'
    || eventSource.owner !== 'atendimento'
    || !/^source:[A-Za-z0-9_-]{8,160}$/.test(text(eventSource.reference, code))
    || event.revision !== 1 || event.operation !== 'upsert') fail(code)
  return Object.freeze({
    contractVersion: event.contractVersion,
    id: event.id,
    projection: Object.freeze({ reference: projection.reference, kind: projection.kind }),
    source: Object.freeze({ owner: eventSource.owner, reference: eventSource.reference }),
    unitScope: Object.freeze({ unitSlug: unitSlug(scope.unitSlug, code) }),
    revision: 1,
    operation: 'upsert',
    occurredAt: timestamp(event.occurredAt, code),
  })
}

function eventsDigest(events) {
  return digest(events)
}

function cursorDigest(capturedAt, sourceProfile, events) {
  return digest({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_CONTRACT,
    scope: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE,
    sourceProfile,
    capturedAt,
    sourceReferences: events.map((event) => event.source.reference),
    unitSlugs: events.map((event) => event.unitScope.unitSlug),
  })
}

function batchId(key, keyIdentifier, sourceProfileDigest, capturedAt, eventDigest) {
  return `baseline:atendimento:${hmacPart(key, 'confirmed-projection-baseline-batch/v2', `${keyIdentifier}\u0000${sourceProfileDigest}\u0000${capturedAt}\u0000${eventDigest}`)}`
}

export function createAtendimentoConfirmedProjectionBaselineV2Batch({ rows: suppliedRows, capturedAt, hmacKey: suppliedHmacKey, keyId: suppliedKeyId, target: suppliedTarget, sourceProfile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE } = {}) {
  const key = hmacKey(suppliedHmacKey, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_HMAC_KEY_REQUIRED')
  const keyIdentifier = keyId(suppliedKeyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_KEY_ID_INVALID')
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_TARGET_INVALID')
  const captured = timestamp(capturedAt, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_SNAPSHOT_INVALID')
  const normalizedRows = rows(suppliedRows, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  if (normalizedRows.length < 1 || normalizedRows.length > ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const profile = createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(sourceProfile)
  const events = Object.freeze([...normalizedRows]
    .sort((left, right) => left.sourceObservedAt.localeCompare(right.sourceObservedAt) || left.identityId.localeCompare(right.identityId) || left.unitSlug.localeCompare(right.unitSlug))
    .map((entry) => eventFromRow(entry, { key, capturedAt: captured })))
  const eventDigest = eventsDigest(events)
  return assertAtendimentoConfirmedProjectionBaselineV2Batch({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_CONTRACT,
    batchId: batchId(key, keyIdentifier, profile.digest, captured, eventDigest),
    producer: { owner: 'atendimento', scope: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE, keyId: keyIdentifier },
    sourceProfile: profile,
    sourceSnapshot: {
      capturedAt: captured,
      cursorDigest: cursorDigest(captured, profile, events),
      rowCount: events.length,
      unitSlugs: [...new Set(events.map((event) => event.unitScope.unitSlug))].sort(),
    },
    target: targetValue,
    events,
    integrity: { algorithm: 'sha256', eventCount: events.length, eventsDigest: eventDigest },
  })
}

export function assertAtendimentoConfirmedProjectionBaselineV2Batch(value) {
  const batch = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  exactKeys(batch, ['contract', 'batchId', 'producer', 'sourceProfile', 'sourceSnapshot', 'target', 'events', 'integrity'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const producer = object(batch.producer, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const snapshot = object(batch.sourceSnapshot, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const integrity = object(batch.integrity, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  exactKeys(producer, ['owner', 'scope', 'keyId'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  exactKeys(snapshot, ['capturedAt', 'cursorDigest', 'rowCount', 'unitSlugs'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  exactKeys(integrity, ['algorithm', 'eventCount', 'eventsDigest'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const sourceProfile = sourceProfilePin(batch.sourceProfile, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const capturedAt = timestamp(snapshot.capturedAt, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const rowCount = positiveInteger(snapshot.rowCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID', ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH)
  const units = unitSlugs(snapshot.unitSlugs, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const targetValue = target(batch.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  if (batch.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_CONTRACT
    || !/^baseline:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(batch.batchId, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID'))
    || producer.owner !== 'atendimento'
    || producer.scope !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE
    || !KEY_ID_PATTERN.test(text(producer.keyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID'))
    || integrity.algorithm !== 'sha256'
    || integrity.eventCount !== rowCount
    || !SHA256_PATTERN.test(text(integrity.eventsDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID'))
    || !Array.isArray(batch.events) || batch.events.length !== rowCount) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  const events = Object.freeze(batch.events.map((entry) => assertEvent(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')))
  const eventIds = new Set()
  const projections = new Set()
  for (const event of events) {
    const projectionKey = `${event.unitScope.unitSlug}\u0000${event.projection.reference}`
    if (eventIds.has(event.id) || projections.has(projectionKey) || !units.includes(event.unitScope.unitSlug)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
    eventIds.add(event.id)
    projections.add(projectionKey)
  }
  if (integrity.eventsDigest !== eventsDigest(events)
    || digestValue(snapshot.cursorDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID') !== cursorDigest(capturedAt, sourceProfile, events)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BATCH_INVALID')
  return Object.freeze({
    contract: batch.contract,
    batchId: batch.batchId,
    producer: Object.freeze({ owner: producer.owner, scope: producer.scope, keyId: producer.keyId }),
    sourceProfile,
    sourceSnapshot: Object.freeze({ capturedAt, cursorDigest: String(snapshot.cursorDigest).toLowerCase(), rowCount, unitSlugs: units }),
    target: targetValue,
    events,
    integrity: Object.freeze({ algorithm: integrity.algorithm, eventCount: integrity.eventCount, eventsDigest: String(integrity.eventsDigest).toLowerCase() }),
  })
}

export function digestAtendimentoConfirmedProjectionBaselineV2Batch(value) {
  return digest(assertAtendimentoConfirmedProjectionBaselineV2Batch(value))
}

export function createAtendimentoConfirmedProjectionBaselineV2SigningInput({ keyId: suppliedKeyId, batchDigest: suppliedBatchDigest, sourceProfileDigest, target: suppliedTarget } = {}) {
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_TARGET_INVALID')
  const profileDigest = digestValue(sourceProfileDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  if (profileDigest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  return [
    ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_CONTRACT,
    keyId(suppliedKeyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID'),
    'Ed25519',
    digestValue(suppliedBatchDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID'),
    profileDigest,
    targetValue.environment,
    targetValue.release,
    targetValue.artifactDigest,
  ].join('\n')
}

function signature(value, code) {
  const normalized = text(value, code)
  if (!/^[A-Za-z0-9_-]{80,512}$/.test(normalized)) fail(code)
  return normalized
}

export function assertAtendimentoConfirmedProjectionBaselineV2Delivery(value) {
  const delivery = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  exactKeys(delivery, ['contract', 'keyId', 'algorithm', 'batchDigest', 'sourceProfileDigest', 'signature'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  const sourceProfileDigest = digestValue(delivery.sourceProfileDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  if (delivery.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_CONTRACT
    || delivery.algorithm !== 'Ed25519'
    || sourceProfileDigest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID')
  return Object.freeze({
    contract: delivery.contract,
    keyId: keyId(delivery.keyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID'),
    algorithm: delivery.algorithm,
    batchDigest: digestValue(delivery.batchDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID'),
    sourceProfileDigest,
    signature: signature(delivery.signature, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_DELIVERY_INVALID'),
  })
}

function descriptor(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['batchId', 'batchDigest', 'capturedAt', 'cursorDigest', 'fromOrdinal', 'toOrdinal', 'rowCount', 'unitSlugs', 'eventCount'], code)
  const rowCount = positiveInteger(entry.rowCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH)
  const eventCount = positiveInteger(entry.eventCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH)
  const fromOrdinal = positiveInteger(entry.fromOrdinal, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS)
  const toOrdinal = positiveInteger(entry.toOrdinal, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS)
  if (!/^baseline:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(entry.batchId, code))
    || rowCount !== eventCount || toOrdinal - fromOrdinal + 1 !== rowCount) fail(code)
  return Object.freeze({
    batchId: entry.batchId,
    batchDigest: digestValue(entry.batchDigest, code),
    capturedAt: timestamp(entry.capturedAt, code),
    cursorDigest: digestValue(entry.cursorDigest, code),
    fromOrdinal,
    toOrdinal,
    rowCount,
    unitSlugs: unitSlugs(entry.unitSlugs, code),
    eventCount,
  })
}

export function createAtendimentoConfirmedProjectionBaselineV2Backfill({ batches, rowCount, eventCount = rowCount, unitSlugs: suppliedUnitSlugs } = {}) {
  if (!Array.isArray(batches) || batches.length > ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_BATCHES) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID')
  const normalized = batches.map((entry) => descriptor(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID'))
  let expectedOrdinal = 1
  for (const batch of normalized) {
    if (batch.fromOrdinal !== expectedOrdinal) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID')
    expectedOrdinal = batch.toOrdinal + 1
  }
  const normalizedRowCount = nonNegativeInteger(rowCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID', ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS)
  const normalizedEventCount = nonNegativeInteger(eventCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID', ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS)
  const units = unitSlugs(suppliedUnitSlugs ?? [...new Set(normalized.flatMap((batch) => batch.unitSlugs))].sort(), 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID', { allowEmpty: true })
  if (expectedOrdinal - 1 !== normalizedRowCount || normalizedEventCount !== normalizedRowCount
    || normalized.reduce((sum, batch) => sum + batch.eventCount, 0) !== normalizedEventCount
    || JSON.stringify([...new Set(normalized.flatMap((batch) => batch.unitSlugs))].sort()) !== JSON.stringify(units)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_BACKFILL_INVALID')
  return Object.freeze({ manifestDigest: digest(normalized), batches: Object.freeze(normalized), rowCount: normalizedRowCount, eventCount: normalizedEventCount, unitSlugs: units })
}

function backfill(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['manifestDigest', 'batches', 'rowCount', 'eventCount', 'unitSlugs'], code)
  const normalized = createAtendimentoConfirmedProjectionBaselineV2Backfill(entry)
  if (digestValue(entry.manifestDigest, code) !== normalized.manifestDigest) fail(code)
  return normalized
}

function snapshot(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['capturedAt', 'membershipDigest', 'rowCount', 'unitSlugs', 'watermark'], code)
  return Object.freeze({
    capturedAt: timestamp(entry.capturedAt, code),
    membershipDigest: digestValue(entry.membershipDigest, code),
    rowCount: nonNegativeInteger(entry.rowCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS),
    unitSlugs: unitSlugs(entry.unitSlugs, code, { allowEmpty: true }),
    watermark: nonNegativeInteger(entry.watermark, code),
  })
}

function receipt(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['contractVersion', 'status', 'batchId', 'eventCount', 'sourceProfileDigest', 'target'], code)
  const sourceProfileDigest = digestValue(entry.sourceProfileDigest, code)
  if (entry.contractVersion !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT
    || !['accepted', 'idempotent'].includes(text(entry.status, code))
    || !/^baseline:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(entry.batchId, code))
    || sourceProfileDigest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail(code)
  return Object.freeze({
    contractVersion: entry.contractVersion,
    status: entry.status,
    batchId: entry.batchId,
    eventCount: positiveInteger(entry.eventCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_EVENTS_PER_BATCH),
    sourceProfileDigest,
    target: target(entry.target, code),
  })
}

function readback(value, code) {
  if (value === null) return null
  const entry = object(value, code)
  exactKeys(entry, ['contract', 'status', 'manifestDigest', 'membershipDigest', 'watermark', 'verifiedBatchCount', 'verifiedEventCount', 'sourceProfileDigest', 'target'], code)
  const sourceProfileDigest = digestValue(entry.sourceProfileDigest, code)
  if (entry.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT
    || entry.status !== 'verified'
    || sourceProfileDigest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail(code)
  return Object.freeze({
    contract: entry.contract,
    status: entry.status,
    manifestDigest: digestValue(entry.manifestDigest, code),
    membershipDigest: digestValue(entry.membershipDigest, code),
    watermark: nonNegativeInteger(entry.watermark, code),
    verifiedBatchCount: nonNegativeInteger(entry.verifiedBatchCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_BATCHES),
    verifiedEventCount: nonNegativeInteger(entry.verifiedEventCount, code, ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_MAX_ROWS),
    sourceProfileDigest,
    target: target(entry.target, code),
  })
}

function sameList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function assertRelationships({ source: sourceValue, sourceProfile, snapshot: snapshotValue, backfill: backfillValue, target: targetValue, receipts, readback: readbackValue }, code) {
  if (snapshotValue.rowCount !== backfillValue.rowCount
    || snapshotValue.rowCount !== backfillValue.eventCount
    || !sameList(snapshotValue.unitSlugs, backfillValue.unitSlugs)
    || snapshotValue.unitSlugs.some((unit) => !sourceValue.unitAllowlist.includes(unit))
    || backfillValue.batches.some((batch) => batch.capturedAt !== snapshotValue.capturedAt || batch.unitSlugs.some((unit) => !snapshotValue.unitSlugs.includes(unit)))) fail(code)
  if (receipts !== null) {
    if (!Array.isArray(receipts) || receipts.length !== backfillValue.batches.length) fail(code)
    for (const [index, entry] of receipts.entries()) {
      const batch = backfillValue.batches[index]
      if (entry.batchId !== batch.batchId || entry.eventCount !== batch.eventCount || entry.sourceProfileDigest !== sourceProfile.digest || !sameTarget(entry.target, targetValue)) fail(code)
    }
  }
  if (readbackValue !== null && (readbackValue.manifestDigest !== backfillValue.manifestDigest
    || readbackValue.membershipDigest !== snapshotValue.membershipDigest
    || readbackValue.watermark !== snapshotValue.watermark
    || readbackValue.verifiedBatchCount !== backfillValue.batches.length
    || readbackValue.verifiedEventCount !== backfillValue.eventCount
    || readbackValue.sourceProfileDigest !== sourceProfile.digest
    || !sameTarget(readbackValue.target, targetValue))) fail(code)
}

export function createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: suppliedTarget, source: suppliedSource, snapshot: suppliedSnapshot, backfill: suppliedBackfill, sourceProfile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE } = {}) {
  const baseline = {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_CONTRACT,
    state: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.PREPARED,
    target: target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID'),
    source: source(suppliedSource, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID'),
    sourceProfile: createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(sourceProfile),
    snapshot: snapshot(suppliedSnapshot, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID'),
    backfill: backfill(suppliedBackfill, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID'),
    receipts: null,
    readback: null,
  }
  assertRelationships(baseline, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  return assertAtendimentoConfirmedProjectionBaselineV2(baseline)
}

export function assertAtendimentoConfirmedProjectionBaselineV2(value) {
  const baseline = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  exactKeys(baseline, ['contract', 'state', 'target', 'source', 'sourceProfile', 'snapshot', 'backfill', 'receipts', 'readback'], 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const targetValue = target(baseline.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const sourceValue = source(baseline.source, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const sourceProfile = sourceProfilePin(baseline.sourceProfile, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const snapshotValue = snapshot(baseline.snapshot, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const backfillValue = backfill(baseline.backfill, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  const receipts = baseline.receipts === null ? null : Object.freeze(baseline.receipts.map((entry) => receipt(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')))
  const readbackValue = readback(baseline.readback, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  if (baseline.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_CONTRACT
    || !Object.values(ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES).includes(baseline.state)
    || (baseline.state === ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.PREPARED && (receipts !== null || readbackValue !== null))
    || (baseline.state === ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.ACCEPTED && (receipts === null || readbackValue !== null))
    || (baseline.state === ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY && (receipts === null || readbackValue === null))) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  assertRelationships({ source: sourceValue, sourceProfile, snapshot: snapshotValue, backfill: backfillValue, target: targetValue, receipts, readback: readbackValue }, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INVALID')
  return Object.freeze({
    contract: baseline.contract,
    state: baseline.state,
    target: targetValue,
    source: sourceValue,
    sourceProfile,
    snapshot: snapshotValue,
    backfill: backfillValue,
    receipts,
    readback: readbackValue,
  })
}

export function digestAtendimentoConfirmedProjectionBaselineV2(value) {
  return digest(assertAtendimentoConfirmedProjectionBaselineV2(value))
}

export function acceptAtendimentoConfirmedProjectionBaselineV2(value, suppliedReceipts) {
  const baseline = assertAtendimentoConfirmedProjectionBaselineV2(value)
  if (baseline.state !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.PREPARED || !Array.isArray(suppliedReceipts)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_ACCEPTANCE_INVALID')
  const receipts = suppliedReceipts.map((entry) => receipt(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_ACCEPTANCE_INVALID'))
  return assertAtendimentoConfirmedProjectionBaselineV2({ ...baseline, state: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.ACCEPTED, receipts, readback: null })
}

export function markAtendimentoConfirmedProjectionBaselineV2Ready(value, suppliedReadback) {
  const baseline = assertAtendimentoConfirmedProjectionBaselineV2(value)
  if (baseline.state !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.ACCEPTED) fail('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_INVALID')
  const verifiedReadback = readback(suppliedReadback, 'ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_INVALID')
  return assertAtendimentoConfirmedProjectionBaselineV2({ ...baseline, state: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY, readback: verifiedReadback })
}

export const __testables = Object.freeze({ canonicalize, digest, hmacPart, sameTarget, sourceProfilePin })
