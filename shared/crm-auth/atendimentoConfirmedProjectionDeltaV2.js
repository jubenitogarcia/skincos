import { createHash, createHmac } from 'node:crypto'

import {
  ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
  ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from './atendimentoCrmCoreIdentityMaterializationPolicy.js'
import { fingerprintAtendimentoProjectionIdentityKey } from './atendimentoProjectionIdentityKey.js'

// This is a new, additive delta contract.  It intentionally does not reuse the
// historical outbox that was tied to the legacy global-client identity graph.
// The fixed source profile makes a v5 confirmed-unit feed distinguishable from
// every earlier projection source before a packet is signed or resumed.
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_CONTRACT = 'atendimento/crm-core/confirmed-projection-delta-source-profile/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_CONTRACT = 'skincos-crm/confirmed-projection-delta-batch/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_CONTRACT = 'skincos-crm/confirmed-projection-delta-delivery/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_CONTRACT = 'crm-core/confirmed-projection-delta-receipt/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_CONTRACT = 'atendimento/crm-core/confirmed-projection-delta-checkpoint/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_CONTRACT = 'atendimento/crm-core/confirmed-projection-delta-baseline-binding/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE = 'confirmed-unit-memberships/v5'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH = 20

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{8,160}$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SOURCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/
const REQUEST_ID_PATTERN = /^crm-atendimento-confirmed-delta-v2-\d{6,16}$/

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
  const parsed = value instanceof Date ? value : new Date(String(value ?? '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
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

function unitSlug(value, code) {
  const normalized = text(value, code)
  if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
  return normalized
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) fail(code)
  return normalized
}

function nonNegativeInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) fail(code)
  return normalized
}

function hmacKey(value) {
  const normalized = text(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_REQUIRED')
  if (Buffer.byteLength(normalized, 'utf8') < 32) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_UNSAFE')
  return normalized
}

function keyId(value, code = 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_KEY_ID_INVALID') {
  const normalized = text(value, code)
  if (!KEY_ID_PATTERN.test(normalized)) fail(code)
  return normalized
}

function hmacPart(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}\u0000${value}`).digest('base64url')
}

function hmacReference(key, namespace, value, prefix) {
  const part = hmacPart(key, namespace, value)
  if (!OPAQUE_PATTERN.test(part)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_INVALID')
  return `${prefix}:${part}`
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

function relationAllowlist(value, code) {
  if (!Array.isArray(value) || value.length !== ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS.length) fail(code)
  const expected = [...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS]
  if (value.some((entry, index) => entry !== expected[index])) fail(code)
  return Object.freeze(expected)
}

export function createAtendimentoConfirmedProjectionDeltaV2SourceProfile() {
  const sourceRelationAllowlist = Object.freeze([...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS])
  const profile = {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_CONTRACT,
    semantics: ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
    sourceRelationAllowlist,
    sourceRelationDigest: digest({ semantics: ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION, sourceRelationAllowlist }),
    sourcePolicyDigest: digest({
      semantics: ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
      sourceRelationAllowlist,
      confirmedMembershipCte: ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
    }),
  }
  return assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(profile)
}

export function assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(value) {
  const profile = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  exactKeys(profile, ['contract', 'semantics', 'sourceRelationAllowlist', 'sourceRelationDigest', 'sourcePolicyDigest'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  const sourceRelationAllowlist = relationAllowlist(profile.sourceRelationAllowlist, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  const sourceRelationDigest = digestValue(profile.sourceRelationDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  const sourcePolicyDigest = digestValue(profile.sourcePolicyDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  if (profile.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_CONTRACT
    || profile.semantics !== ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION
    || sourceRelationDigest !== digest({ semantics: profile.semantics, sourceRelationAllowlist })
    || sourcePolicyDigest !== digest({
      semantics: profile.semantics,
      sourceRelationAllowlist,
      confirmedMembershipCte: ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
    })) {
    fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE_INVALID')
  }
  return Object.freeze({
    contract: profile.contract,
    semantics: profile.semantics,
    sourceRelationAllowlist,
    sourceRelationDigest,
    sourcePolicyDigest,
  })
}

export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE = createAtendimentoConfirmedProjectionDeltaV2SourceProfile()

export function digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(value = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE) {
  return digest(assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(value))
}

function sourceProfilePin(value, code) {
  const pin = object(value, code)
  exactKeys(pin, ['semantics', 'digest'], code)
  const profile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE
  const normalized = Object.freeze({ semantics: text(pin.semantics, code), digest: digestValue(pin.digest, code) })
  if (normalized.semantics !== profile.semantics || normalized.digest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(profile)) fail(code)
  return normalized
}

export function createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(value = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE) {
  const profile = assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(value)
  return Object.freeze({ semantics: profile.semantics, digest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(profile) })
}

function row(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['event_order', 'event_id', 'identity_id', 'unit_slug', 'revision', 'operation', 'occurred_at'], code)
  const operation = text(entry.operation, code)
  if (!['upsert', 'revoke'].includes(operation)) fail(code)
  return Object.freeze({
    eventOrder: positiveInteger(entry.event_order, code),
    eventId: uuid(entry.event_id, code),
    identityId: uuid(entry.identity_id, code),
    unitSlug: unitSlug(entry.unit_slug, code),
    revision: positiveInteger(entry.revision, code),
    operation,
    occurredAt: timestamp(entry.occurred_at, code),
    sourceOccurredAt: sourceTimestamp(entry.occurred_at, code),
  })
}

export function assertAtendimentoConfirmedProjectionDeltaV2Row(value) {
  return row(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_ROW_INVALID')
}

function eventFromRow(value, { key }) {
  const sourceReference = hmacReference(key, 'confirmed-projection-source-reference/v2', value.identityId, 'source')
  const projectionReference = hmacReference(key, 'confirmed-projection-reference/v2', value.identityId, 'projection')
  const eventId = hmacReference(key, 'confirmed-projection-delta-event/v2', `${value.eventOrder}\u0000${value.eventId}\u0000${value.identityId}\u0000${value.unitSlug}\u0000${value.revision}\u0000${value.operation}\u0000${value.sourceOccurredAt}`, 'event')
  return Object.freeze({
    contractVersion: 'crm-projection-event/v2',
    id: eventId,
    projection: Object.freeze({ reference: projectionReference, kind: 'client-reference' }),
    source: Object.freeze({ owner: 'atendimento', reference: sourceReference }),
    unitScope: Object.freeze({ unitSlug: value.unitSlug }),
    revision: value.revision,
    operation: value.operation,
    occurredAt: value.occurredAt,
  })
}

function event(value, code) {
  const entry = object(value, code)
  exactKeys(entry, ['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt'], code)
  const projection = object(entry.projection, code)
  const source = object(entry.source, code)
  const scope = object(entry.unitScope, code)
  exactKeys(projection, ['reference', 'kind'], code)
  exactKeys(source, ['owner', 'reference'], code)
  exactKeys(scope, ['unitSlug'], code)
  if (entry.contractVersion !== 'crm-projection-event/v2'
    || !/^event:[A-Za-z0-9_-]{8,160}$/.test(text(entry.id, code))
    || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(text(projection.reference, code))
    || projection.kind !== 'client-reference'
    || source.owner !== 'atendimento'
    || !/^source:[A-Za-z0-9_-]{8,160}$/.test(text(source.reference, code))
    || !['upsert', 'revoke'].includes(text(entry.operation, code))) fail(code)
  return Object.freeze({
    contractVersion: entry.contractVersion,
    id: entry.id,
    projection: Object.freeze({ reference: projection.reference, kind: projection.kind }),
    source: Object.freeze({ owner: source.owner, reference: source.reference }),
    unitScope: Object.freeze({ unitSlug: unitSlug(scope.unitSlug, code) }),
    revision: positiveInteger(entry.revision, code),
    operation: entry.operation,
    occurredAt: timestamp(entry.occurredAt, code),
  })
}

function eventsDigest(events) {
  return digest(events)
}

function batchId(key, keyIdentifier, sourceProfileDigest, fromExclusive, toInclusive, eventDigest) {
  return `delta:atendimento:${hmacPart(key, 'confirmed-projection-delta-batch/v2', `${keyIdentifier}\u0000${sourceProfileDigest}\u0000${fromExclusive}\u0000${toInclusive}\u0000${eventDigest}`)}`
}

export function createAtendimentoConfirmedProjectionDeltaV2Batch({ rows, fromExclusive, toInclusive, hmacKey: suppliedHmacKey, keyId: suppliedKeyId, target: suppliedTarget, sourceProfile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE } = {}) {
  const key = hmacKey(suppliedHmacKey)
  const keyIdentifier = keyId(suppliedKeyId)
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_TARGET_INVALID')
  const profilePin = createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(sourceProfile)
  const from = nonNegativeInteger(fromExclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CURSOR_INVALID')
  const to = positiveInteger(toInclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CURSOR_INVALID')
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const normalizedRows = rows.map((entry) => row(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')).sort((left, right) => left.eventOrder - right.eventOrder)
  if (normalizedRows[0].eventOrder <= from || normalizedRows.at(-1).eventOrder !== to || to <= from) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CURSOR_GAP')
  if (new Set(normalizedRows.map((entry) => entry.eventOrder)).size !== normalizedRows.length) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const events = Object.freeze(normalizedRows.map((entry) => eventFromRow(entry, { key })))
  const eventDigest = eventsDigest(events)
  return assertAtendimentoConfirmedProjectionDeltaV2Batch({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_CONTRACT,
    batchId: batchId(key, keyIdentifier, profilePin.digest, from, to, eventDigest),
    producer: { owner: 'atendimento', scope: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE, keyId: keyIdentifier },
    sourceProfile: profilePin,
    sourceDelta: { fromExclusive: from, toInclusive: to, rowCount: events.length },
    target: targetValue,
    events,
    integrity: { algorithm: 'sha256', eventCount: events.length, eventsDigest: eventDigest },
  })
}

export function assertAtendimentoConfirmedProjectionDeltaV2Batch(value) {
  const batch = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  exactKeys(batch, ['contract', 'batchId', 'producer', 'sourceProfile', 'sourceDelta', 'target', 'events', 'integrity'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const producer = object(batch.producer, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const sourceDelta = object(batch.sourceDelta, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const integrity = object(batch.integrity, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  exactKeys(producer, ['owner', 'scope', 'keyId'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  exactKeys(sourceDelta, ['fromExclusive', 'toInclusive', 'rowCount'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  exactKeys(integrity, ['algorithm', 'eventCount', 'eventsDigest'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const sourceProfile = sourceProfilePin(batch.sourceProfile, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const fromExclusive = nonNegativeInteger(sourceDelta.fromExclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const toInclusive = positiveInteger(sourceDelta.toInclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const rowCount = positiveInteger(sourceDelta.rowCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID', ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH)
  if (batch.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_CONTRACT
    || !/^delta:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(batch.batchId, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID'))
    || producer.owner !== 'atendimento'
    || producer.scope !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE
    || !KEY_ID_PATTERN.test(text(producer.keyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID'))
    || toInclusive <= fromExclusive
    || rowCount > toInclusive - fromExclusive
    || integrity.algorithm !== 'sha256'
    || integrity.eventCount !== rowCount
    || !SHA256_PATTERN.test(text(integrity.eventsDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID'))) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const targetValue = target(batch.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  if (!Array.isArray(batch.events) || batch.events.length !== rowCount) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  const events = Object.freeze(batch.events.map((entry) => event(entry, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')))
  const identities = new Set()
  for (const entry of events) {
    const identity = `${entry.unitScope.unitSlug}\u0000${entry.projection.reference}\u0000${entry.revision}`
    if (identities.has(identity)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
    identities.add(identity)
  }
  if (integrity.eventsDigest !== eventsDigest(events)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_INVALID')
  return Object.freeze({
    contract: batch.contract,
    batchId: batch.batchId,
    producer: Object.freeze({ owner: producer.owner, scope: producer.scope, keyId: producer.keyId }),
    sourceProfile,
    sourceDelta: Object.freeze({ fromExclusive, toInclusive, rowCount }),
    target: targetValue,
    events,
    integrity: Object.freeze({ algorithm: integrity.algorithm, eventCount: integrity.eventCount, eventsDigest: integrity.eventsDigest }),
  })
}

export function digestAtendimentoConfirmedProjectionDeltaV2Batch(value) {
  return digest(assertAtendimentoConfirmedProjectionDeltaV2Batch(value))
}

function signature(value, code) {
  const normalized = text(value, code)
  if (!/^[A-Za-z0-9_-]{80,512}$/.test(normalized)) fail(code)
  return normalized
}

export function createAtendimentoConfirmedProjectionDeltaV2SigningInput({ keyId: suppliedKeyId, batchDigest: suppliedBatchDigest, sourceProfileDigest, target: suppliedTarget } = {}) {
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_TARGET_INVALID')
  return [
    ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_CONTRACT,
    keyId(suppliedKeyId),
    'Ed25519',
    digestValue(suppliedBatchDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID'),
    digestValue(sourceProfileDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID'),
    targetValue.environment,
    targetValue.release,
    targetValue.artifactDigest,
  ].join('\n')
}

export function assertAtendimentoConfirmedProjectionDeltaV2Delivery(value) {
  const delivery = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID')
  exactKeys(delivery, ['contract', 'keyId', 'algorithm', 'batchDigest', 'sourceProfileDigest', 'signature'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID')
  if (delivery.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_CONTRACT || delivery.algorithm !== 'Ed25519') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID')
  const sourceProfileDigest = digestValue(delivery.sourceProfileDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID')
  if (sourceProfileDigest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID')
  return Object.freeze({ contract: delivery.contract, keyId: keyId(delivery.keyId), algorithm: delivery.algorithm, batchDigest: digestValue(delivery.batchDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID'), sourceProfileDigest, signature: signature(delivery.signature, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_INVALID') })
}

export function assertAtendimentoConfirmedProjectionDeltaV2Receipt(value, { batch, requestId: suppliedRequestId } = {}) {
  const normalizedBatch = assertAtendimentoConfirmedProjectionDeltaV2Batch(batch)
  const expectedRequestId = text(suppliedRequestId, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  if (!REQUEST_ID_PATTERN.test(expectedRequestId)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  const receipt = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  exactKeys(receipt, ['ok', 'contractVersion', 'status', 'batchId', 'eventCount', 'sourceProfileDigest', 'target', 'requestId', 'fromExclusive', 'toInclusive'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  const receiptTarget = target(receipt.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  if (receipt.ok !== true
    || receipt.contractVersion !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_CONTRACT
    || !['accepted', 'idempotent'].includes(receipt.status)
    || receipt.batchId !== normalizedBatch.batchId
    || receipt.eventCount !== normalizedBatch.events.length
    || digestValue(receipt.sourceProfileDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID') !== normalizedBatch.sourceProfile.digest
    || !sameTarget(receiptTarget, normalizedBatch.target)
    || receipt.requestId !== expectedRequestId
    || receipt.fromExclusive !== normalizedBatch.sourceDelta.fromExclusive
    || receipt.toInclusive !== normalizedBatch.sourceDelta.toInclusive) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RECEIPT_INVALID')
  return Object.freeze({ ok: true, contractVersion: receipt.contractVersion, status: receipt.status, batchId: receipt.batchId, eventCount: receipt.eventCount, sourceProfileDigest: normalizedBatch.sourceProfile.digest, target: receiptTarget, requestId: expectedRequestId, fromExclusive: receipt.fromExclusive, toInclusive: receipt.toInclusive })
}

export function createAtendimentoConfirmedProjectionDeltaV2BaselineBinding({ baselineDigest, target: suppliedTarget, sourceProfile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE, identityKeyFingerprint, deltaKeyId } = {}) {
  const profile = assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(sourceProfile)
  return assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_CONTRACT,
    baselineDigest,
    target: suppliedTarget,
    sourceProfile: createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin(profile),
    identityKeyFingerprint,
    deltaKeyId,
  })
}

export function assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding(value) {
  const binding = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID')
  exactKeys(binding, ['contract', 'baselineDigest', 'target', 'sourceProfile', 'identityKeyFingerprint', 'deltaKeyId'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID')
  const normalizedTarget = target(binding.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID')
  const sourceProfile = sourceProfilePin(binding.sourceProfile, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID')
  if (binding.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_CONTRACT
    || !SHA256_PATTERN.test(String(binding.identityKeyFingerprint || '').toLowerCase())) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID')
  return Object.freeze({
    contract: binding.contract,
    baselineDigest: digestValue(binding.baselineDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID'),
    target: normalizedTarget,
    sourceProfile,
    identityKeyFingerprint: String(binding.identityKeyFingerprint).toLowerCase(),
    deltaKeyId: keyId(binding.deltaKeyId, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_INVALID'),
  })
}

export function createAtendimentoConfirmedProjectionDeltaV2Checkpoint({ state = 'running', target: suppliedTarget, baselineBinding, hmacKey, capturedAt, watermark, fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest, pending = null } = {}) {
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const binding = assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding(baselineBinding)
  if (!sameTarget(targetValue, binding.target)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const keyFingerprint = fingerprintAtendimentoProjectionIdentityKey(hmacKey, {
    requiredCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_REQUIRED',
    unsafeCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_UNSAFE',
  })
  if (keyFingerprint !== binding.identityKeyFingerprint) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const checkpoint = {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_CONTRACT,
    state,
    target: targetValue,
    baselineBinding: binding,
    hmacKeyFingerprint: keyFingerprint,
    sourceSnapshot: { capturedAt: timestamp(capturedAt, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), watermark: nonNegativeInteger(watermark, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID') },
    progress: { fromExclusive: nonNegativeInteger(fromExclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), deliveredCount: nonNegativeInteger(deliveredCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), batchCount: nonNegativeInteger(batchCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), acceptedCount: nonNegativeInteger(acceptedCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), idempotentCount: nonNegativeInteger(idempotentCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), reconciliationDigest: digestValue(reconciliationDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID') },
    pending,
  }
  return assertAtendimentoConfirmedProjectionDeltaV2Checkpoint(checkpoint)
}

export function assertAtendimentoConfirmedProjectionDeltaV2Checkpoint(value) {
  const checkpoint = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  exactKeys(checkpoint, ['contract', 'state', 'target', 'baselineBinding', 'hmacKeyFingerprint', 'sourceSnapshot', 'progress', 'pending'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const targetValue = target(checkpoint.target, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const binding = assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding(checkpoint.baselineBinding)
  const bindingTarget = binding.target
  const sourceProfile = binding.sourceProfile
  const snapshot = object(checkpoint.sourceSnapshot, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const progress = object(checkpoint.progress, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  exactKeys(snapshot, ['capturedAt', 'watermark'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  exactKeys(progress, ['fromExclusive', 'deliveredCount', 'batchCount', 'acceptedCount', 'idempotentCount', 'reconciliationDigest'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const watermark = nonNegativeInteger(snapshot.watermark, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const fromExclusive = nonNegativeInteger(progress.fromExclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const acceptedCount = nonNegativeInteger(progress.acceptedCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const idempotentCount = nonNegativeInteger(progress.idempotentCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  if (checkpoint.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_CONTRACT
    || !['running', 'completed'].includes(checkpoint.state)
    || binding.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_BINDING_CONTRACT
    || !sameTarget(targetValue, bindingTarget)
    || fromExclusive > watermark
    || !SHA256_PATTERN.test(String(checkpoint.hmacKeyFingerprint || '').toLowerCase())
    || String(checkpoint.hmacKeyFingerprint).toLowerCase() !== binding.identityKeyFingerprint
    || acceptedCount + idempotentCount !== nonNegativeInteger(progress.batchCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
    || (checkpoint.state === 'completed' && (checkpoint.pending !== null || fromExclusive !== watermark))) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  if (checkpoint.pending !== null) {
    const pending = object(checkpoint.pending, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
    exactKeys(pending, ['batch', 'delivery', 'requestId'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
    const batch = assertAtendimentoConfirmedProjectionDeltaV2Batch(pending.batch)
    const delivery = assertAtendimentoConfirmedProjectionDeltaV2Delivery(pending.delivery)
    if (!REQUEST_ID_PATTERN.test(text(pending.requestId, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'))
      || !sameTarget(batch.target, targetValue)
      || batch.sourceProfile.digest !== sourceProfile.digest
      || batch.producer.keyId !== binding.deltaKeyId
      || delivery.keyId !== binding.deltaKeyId
      || delivery.batchDigest !== digestAtendimentoConfirmedProjectionDeltaV2Batch(batch)
      || delivery.sourceProfileDigest !== sourceProfile.digest
      || batch.sourceDelta.fromExclusive !== fromExclusive) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  }
  return Object.freeze({
    contract: checkpoint.contract,
    state: checkpoint.state,
    target: targetValue,
    baselineBinding: binding,
    hmacKeyFingerprint: String(checkpoint.hmacKeyFingerprint).toLowerCase(),
    sourceSnapshot: Object.freeze({ capturedAt: timestamp(snapshot.capturedAt, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), watermark }),
    progress: Object.freeze({ fromExclusive, deliveredCount: nonNegativeInteger(progress.deliveredCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), batchCount: nonNegativeInteger(progress.batchCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID'), acceptedCount, idempotentCount, reconciliationDigest: digestValue(progress.reconciliationDigest, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID') }),
    pending: checkpoint.pending === null ? null : checkpoint.pending,
  })
}

export const __testables = Object.freeze({ canonicalize, digest, hmacPart, sameTarget, sourceProfilePin })
