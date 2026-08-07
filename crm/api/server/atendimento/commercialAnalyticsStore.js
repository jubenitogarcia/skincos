import { createHash, createHmac, randomUUID } from 'node:crypto'

import { createPgPool } from '../harmonia/store/pg.js'
import {
    buildCommercialFunnel,
    buildExperimentAssignments,
    buildExperimentResult,
    buildQualityTimeSeries,
    buildSegmentDrift,
    buildSegmentMembershipSnapshot,
    commercialAnalyticsError,
    normalizeAnalyticsFilters,
    normalizeAttributionWindows,
    normalizeSegmentDefinition,
    sanitizeAnalyticsPayload,
} from './commercialAnalytics.js'
import { COMMERCIAL_ANALYTICS_MIGRATION_ID } from './commercialAnalyticsMigration.js'

const UNIT_KEY = /^[a-z][a-z0-9-]{1,79}$/
const KEY = /^[A-Za-z][A-Za-z0-9._-]{0,119}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,240}$/
const PII_VALUE = /@|\+?\d[\d\s().-]{6,}\d/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const EVENT_TYPES = new Set([
    'eligible', 'selected', 'action_created', 'contacted', 'delivered',
    'responded', 'scheduled', 'attended', 'purchased', 'returned',
])
const SNAPSHOT_MEMBER_KEYS = new Set(['identityId', 'identity_id', 'bucket', 'segmentBucket', 'segment_bucket'])

function analyticsError(code, statusCode = 409) {
    const error = commercialAnalyticsError(code, statusCode)
    error.code = code
    error.statusCode = statusCode
    return error
}

function text(value, maximum = 240) {
    return String(value ?? '').trim().slice(0, maximum)
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function opaqueActorId(actor) {
    const id = text(actor?.id || actor?.username, 160)
    if (!id || id.includes('@') || /[\u0000-\u001f\u007f]/.test(id)) throw analyticsError('ANALYTICS_ACTOR_ID_REQUIRED', 401)
    return id
}

function role(actor) {
    return text(actor?.role, 40).toUpperCase()
}

function isGlobal(actor) {
    return actor?.isGlobalAdmin === true || role(actor) === 'ADMIN'
}

function assertManager(actor) {
    if (isGlobal(actor)) return
    if (role(actor) !== 'GESTOR') throw analyticsError('FORBIDDEN', 403)
}

function allowedUnitSlugs(actor) {
    return [...new Set((Array.isArray(actor?.allowedUnits) ? actor.allowedUnits : [])
        .map((value) => text(value, 80).toLowerCase())
        .filter((value) => UNIT_KEY.test(value)))]
}

function scopedUnits(actor, requestedUnit = null) {
    assertManager(actor)
    const requested = requestedUnit ? text(requestedUnit, 80).toLowerCase() : null
    if (requested && !UNIT_KEY.test(requested)) throw analyticsError('ANALYTICS_UNIT_INVALID', 400)
    if (isGlobal(actor)) return requested ? [requested] : null
    const allowed = allowedUnitSlugs(actor)
    if (!allowed.length) throw analyticsError('ANALYTICS_UNIT_SCOPE_REQUIRED', 403)
    if (requested && !allowed.includes(requested)) throw analyticsError('FORBIDDEN_UNIT_SCOPE', 403)
    return requested ? [requested] : allowed
}

function assertGlobal(actor) {
    assertManager(actor)
    if (!isGlobal(actor)) throw analyticsError('ANALYTICS_GLOBAL_SCOPE_REQUIRED', 403)
}

function normalizeReason(value) {
    const reason = text(value, 1000)
    if (reason.length < 3 || PII_VALUE.test(reason) || /[\u0000-\u001f\u007f]/.test(reason)) throw analyticsError('ANALYTICS_REASON_INVALID', 400)
    return reason
}

function normalizeDateTime(value, field) {
    const raw = text(value, 64)
    const parsed = Date.parse(raw)
    if (!raw || !Number.isFinite(parsed)) throw analyticsError(`ANALYTICS_${field}_INVALID`, 400)
    return new Date(parsed).toISOString()
}

function normalizeDate(value, field) {
    const raw = text(value, 32).slice(0, 10)
    if (!DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`))) {
        throw analyticsError(`ANALYTICS_${field}_INVALID`, 400)
    }
    return raw
}

function normalizeUuid(value, code = 'ANALYTICS_UUID_INVALID') {
    const id = text(value, 80).toLowerCase()
    if (!UUID.test(id)) throw analyticsError(code, 400)
    return id
}

async function lockExperimentCrossoverAssignments(client, unitId, assignments) {
    // Operations uses this same lock namespace while it verifies that an
    // identity is not an active control/excluded member. Take every lock in
    // deterministic order before persisting assignments so an assignment
    // cannot race an eligible commercial mutation into a silent crossover.
    const unit = normalizeUuid(unitId, 'ANALYTICS_EXPERIMENT_UNIT_INVALID')
    const identityIds = [...new Set((Array.isArray(assignments) ? assignments : [])
        .map((assignment) => normalizeUuid(assignment?.identityId, 'ANALYTICS_EXPERIMENT_IDENTITY_INVALID')))]
        .sort()
    for (const identityId of identityIds) {
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
            `commercial-experiment-crossover:${unit}:${identityId}`,
        ])
    }
}

function normalizeCount(value, code = 'ANALYTICS_COUNT_INVALID') {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) throw analyticsError(code, 400)
    return parsed
}

function normalizeRevenueCents(value) {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 9_000_000_000_000) {
        throw analyticsError('ANALYTICS_EVENT_REVENUE_INVALID', 400)
    }
    return parsed
}

function normalizeKey(value, code, maximum = 120) {
    const normalized = text(value, maximum)
    if (!KEY.test(normalized) || PII_VALUE.test(normalized)) throw analyticsError(code, 400)
    return normalized
}

function normalizeOptionalUuid(value, code) {
    if (value === null || value === undefined || text(value) === '') return null
    return normalizeUuid(value, code)
}

function normalizeOptionalOpaque(value, code, maximum = 160) {
    const normalized = text(value, maximum)
    if (!normalized) return null
    if (!KEY.test(normalized) || PII_VALUE.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw analyticsError(code, 400)
    }
    return normalized
}

function normalizeSafeObject(value, code, { allowEmpty = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw analyticsError(code, 400)
    const sanitized = sanitizeAnalyticsPayload(value)
    if (!sanitized || Array.isArray(sanitized) || (!allowEmpty && Object.keys(sanitized).length === 0)) throw analyticsError(code, 400)
    if (JSON.stringify(stable(sanitized)) !== JSON.stringify(stable(value))) throw analyticsError(code, 400)
    const aggregate = (candidate, depth = 0) => {
        if (depth > 4 || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw analyticsError(code, 400)
        const result = {}
        for (const [key, item] of Object.entries(candidate)) {
            if (!KEY.test(key) || PII_VALUE.test(key)) throw analyticsError(code, 400)
            if (item === null || typeof item === 'boolean') {
                result[key] = item
            } else if (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER) {
                result[key] = item
            } else if (item && typeof item === 'object' && !Array.isArray(item)) {
                result[key] = aggregate(item, depth + 1)
            } else {
                // Metrics are aggregate numbers/booleans only. Textual labels
                // would make this store an accidental PII transport.
                throw analyticsError(code, 400)
            }
        }
        return result
    }
    return aggregate(sanitized)
}

function normalizeSnapshotMembers(value) {
    if (!Array.isArray(value) || value.length > 50_000) throw analyticsError('ANALYTICS_SNAPSHOT_MEMBERS_INVALID', 400)
    const byIdentity = new Map()
    for (const candidate of value) {
        const record = typeof candidate === 'string' ? { identityId: candidate } : candidate
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw analyticsError('ANALYTICS_SNAPSHOT_MEMBERS_INVALID', 400)
        if (Object.keys(record).some((key) => !SNAPSHOT_MEMBER_KEYS.has(key))) throw analyticsError('ANALYTICS_SNAPSHOT_MEMBERS_INVALID', 400)
        const identityId = normalizeUuid(record.identityId || record.identity_id, 'ANALYTICS_SNAPSHOT_IDENTITY_INVALID')
        const bucket = text(record.bucket || record.segmentBucket || record.segment_bucket, 120)
        if (bucket && (!KEY.test(bucket) || PII_VALUE.test(bucket))) throw analyticsError('ANALYTICS_SNAPSHOT_BUCKET_INVALID', 400)
        if (byIdentity.has(identityId) && byIdentity.get(identityId).bucket !== (bucket || null)) {
            throw analyticsError('ANALYTICS_SNAPSHOT_IDENTITY_CONFLICT', 409)
        }
        byIdentity.set(identityId, { identityId, bucket: bucket || null })
    }
    return [...byIdentity.values()].sort((left, right) => left.identityId.localeCompare(right.identityId))
}

function assertSystemWriter(actor) {
    if (actor?.system !== true || role(actor) !== 'SYSTEM') throw analyticsError('ANALYTICS_SYSTEM_WRITER_REQUIRED', 403)
    return opaqueActorId(actor)
}

function mapWindow(row) {
    if (!row) return null
    return {
        id: row.id,
        version: row.version,
        responseDays: Number(row.response_days),
        appointmentDays: Number(row.appointment_days),
        attendanceDays: Number(row.attendance_days),
        saleDays: Number(row.sale_days),
        returnDays: Number(row.return_days),
        effectiveFrom: row.effective_from || null,
        expiresAt: row.expires_at || null,
        createdAt: row.created_at || null,
    }
}

function mapSegment(row) {
    if (!row) return null
    return {
        id: row.id,
        key: row.segment_key,
        revision: Number(row.revision || row.current_revision || 0),
        version: row.version_key || `revision-${Number(row.revision || row.current_revision || 0)}`,
        status: row.current_status || row.status || 'draft',
        criteria: sanitizeAnalyticsPayload(row.criteria) || {},
        thresholds: sanitizeAnalyticsPayload(row.thresholds) || {},
        percentiles: sanitizeAnalyticsPayload(row.percentiles) || {},
        effectiveFrom: row.effective_from || null,
        createdAt: row.created_at || null,
    }
}

function mapExperiment(row) {
    if (!row) return null
    return {
        id: row.id,
        key: row.experiment_key,
        campaignId: row.campaign_id || null,
        segmentVersionId: row.segment_version_id,
        unit: row.unit_slug || null,
        attributionWindowId: row.attribution_window_id,
        controlGroupPercent: Number(row.control_group_percent),
        state: row.state,
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        revision: Number(row.revision || 0),
        createdAt: row.created_at || null,
    }
}

function mapMetric(row) {
    return {
        sourceKey: row.source_key,
        findingKey: row.finding_key || null,
        unitSlug: row.unit_slug || null,
        metrics: sanitizeAnalyticsPayload(row.metrics) || {},
        occurredAt: row.bucket_date || row.created_at || null,
    }
}

function mapEvent(row) {
    return {
        identityId: row.identity_id,
        unitSlug: row.unit_slug || null,
        campaignId: row.campaign_id || null,
        campaignKey: row.campaign_key || null,
        segmentKey: row.segment_key || null,
        offerId: row.offer_id || null,
        eventType: row.event_type,
        channel: row.channel || null,
        owner: row.owner_id || null,
        policyVersion: row.policy_version || null,
        occurredAt: row.occurred_at,
        revenue: Number(row.revenue_cents || 0) / 100,
    }
}

export function createCommercialAnalyticsStore({
    pool,
    databaseUrl,
    mutationHmacKey = process.env.COMMERCIAL_ANALYTICS_MUTATION_HMAC_KEY,
    clock = () => new Date(),
} = {}) {
    const pgPool = pool || createPgPool(databaseUrl || process.env.DATABASE_URL)
    if (!pgPool) throw analyticsError('COMMERCIAL_ANALYTICS_POOL_REQUIRED', 503)
    const secret = text(mutationHmacKey, 512)

    async function withTransaction(callback) {
        const client = await pgPool.connect()
        let open = false
        try {
            await client.query('begin')
            open = true
            await client.query(`set local lock_timeout = '3s'`)
            await client.query(`set local statement_timeout = '30s'`)
            const result = await callback(client)
            await client.query('commit')
            open = false
            return result
        } catch (error) {
            if (open) {
                try { await client.query('rollback') } catch { /* preserve original error */ }
            }
            throw error
        } finally {
            client.release()
        }
    }

    async function readiness(connection = pgPool) {
        const availability = await connection.query(`select
            to_regclass('crm_atendimento.schema_migrations') as registry,
            to_regclass('crm_atendimento.commercial_attribution_windows') as windows,
            to_regclass('crm_atendimento.commercial_segment_definitions') as definitions,
            to_regclass('crm_atendimento.commercial_segment_versions') as versions,
            to_regclass('crm_atendimento.commercial_analytics_metric_snapshots') as metrics,
            to_regclass('crm_atendimento.commercial_analytics_events') as events,
            to_regclass('crm_atendimento.commercial_analytics_mutations') as mutations,
            to_regclass('crm_atendimento.commercial_experiments') as experiments,
            to_regclass('crm_atendimento.commercial_experiment_assignments') as assignments`)
        const row = availability.rows[0] || {}
        if (!Object.values(row).every(Boolean)) return { ready: false, migrationId: COMMERCIAL_ANALYTICS_MIGRATION_ID }
        const migration = await connection.query(`select id from crm_atendimento.schema_migrations where id=$1 and rolled_back_at is null`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        return { ready: !!migration.rows[0]?.id, migrationId: COMMERCIAL_ANALYTICS_MIGRATION_ID }
    }

    async function ensureReady(connection = pgPool) {
        const status = await readiness(connection)
        if (!status.ready) throw analyticsError('COMMERCIAL_ANALYTICS_NOT_READY', 503)
        return status
    }

    function mutationKey(actorId, operation, idempotencyKey) {
        if (!secret) throw analyticsError('COMMERCIAL_ANALYTICS_MUTATION_KEY_NOT_CONFIGURED', 503)
        const value = text(idempotencyKey, 240)
        if (!IDEMPOTENCY_KEY.test(value)) throw analyticsError('ANALYTICS_IDEMPOTENCY_KEY_INVALID', 400)
        return createHmac('sha256', secret).update(`${actorId}:${operation}:${value}`).digest('hex')
    }

    async function runMutation(client, { actor, operation, idempotencyKey, request }, work) {
        const actorId = opaqueActorId(actor)
        const key = mutationKey(actorId, operation, idempotencyKey)
        const requestFingerprint = digest(sanitizeAnalyticsPayload(request) || {})
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-analytics:${actorId}:${operation}:${key}`])
        const existing = await client.query(`select request_fingerprint,response from crm_atendimento.commercial_analytics_mutations
            where actor_id=$1 and operation=$2 and mutation_key=$3 for update`, [actorId, operation, key])
        if (existing.rows[0]) {
            if (existing.rows[0].request_fingerprint !== requestFingerprint) throw analyticsError('ANALYTICS_IDEMPOTENCY_CONFLICT', 409)
            return existing.rows[0].response
        }
        const response = sanitizeAnalyticsPayload(await work()) || {}
        await client.query(`insert into crm_atendimento.commercial_analytics_mutations(actor_id,operation,mutation_key,request_fingerprint,response)
            values ($1,$2,$3,$4,$5::jsonb)`, [actorId, operation, key, requestFingerprint, JSON.stringify(response)])
        return response
    }

    async function unitRecord(client, value, { required = false } = {}) {
        const slug = text(value, 80).toLowerCase()
        if (!slug) {
            if (required) throw analyticsError('ANALYTICS_UNIT_REQUIRED', 400)
            return { id: null, slug: null }
        }
        if (!UNIT_KEY.test(slug)) throw analyticsError('ANALYTICS_UNIT_INVALID', 400)
        const result = await client.query(`select id::text,slug from crm_atendimento.units where slug=$1`, [slug])
        if (!result.rows[0]) throw analyticsError('ANALYTICS_UNIT_NOT_FOUND', 404)
        return result.rows[0]
    }

    function systemEventKey(event) {
        if (!secret) throw analyticsError('COMMERCIAL_ANALYTICS_MUTATION_KEY_NOT_CONFIGURED', 503)
        return createHmac('sha256', secret)
            .update(`commercial-analytics-event:${JSON.stringify(stable(event))}`)
            .digest('hex')
    }

    async function recordMetricSnapshot(payload, actor) {
        await ensureReady()
        const actorId = assertSystemWriter(actor)
        const sourceKey = normalizeKey(payload?.sourceKey || payload?.source_key, 'ANALYTICS_METRIC_SOURCE_INVALID')
        const findingKey = payload?.findingKey || payload?.finding_key
            ? normalizeKey(payload.findingKey || payload.finding_key, 'ANALYTICS_METRIC_FINDING_INVALID', 160)
            : null
        const bucketDate = normalizeDate(payload?.bucketDate || payload?.bucket_date || clock().toISOString(), 'METRIC_BUCKET_DATE')
        const metrics = normalizeSafeObject(payload?.metrics, 'ANALYTICS_METRIC_PAYLOAD_INVALID', { allowEmpty: true })
        return withTransaction(async (client) => {
            const unit = await unitRecord(client, payload?.unit || payload?.unitSlug || payload?.unit_slug)
            const metricsHash = digest({ sourceKey, findingKey, unit: unit.slug, bucketDate, metrics })
            return runMutation(client, {
                actor,
                operation: 'metric_snapshot_record',
                idempotencyKey: payload?.idempotencyKey,
                request: { sourceKey, findingKey, unit: unit.slug, bucketDate, metricsHash, metrics },
            }, async () => {
                const inserted = await client.query(`insert into crm_atendimento.commercial_analytics_metric_snapshots(
                        source_key,finding_key,unit_id,bucket_date,metrics,metrics_hash)
                    values($1,$2,$3::uuid,$4::date,$5::jsonb,$6)
                    on conflict do nothing returning source_key,finding_key,unit_id::text,bucket_date,metrics,created_at`, [
                    sourceKey, findingKey, unit.id, bucketDate, JSON.stringify(metrics), metricsHash,
                ])
                const row = inserted.rows[0] || (await client.query(`select source_key,finding_key,unit_id::text,bucket_date,metrics,created_at
                    from crm_atendimento.commercial_analytics_metric_snapshots
                    where source_key=$1 and finding_key is not distinct from $2 and unit_id is not distinct from $3::uuid
                        and bucket_date=$4::date and metrics_hash=$5`, [sourceKey, findingKey, unit.id, bucketDate, metricsHash])).rows[0]
                return { metric: mapMetric({ ...row, unit_slug: unit.slug }), actor: actorId }
            })
        })
    }

    async function recordSegmentSnapshot(payload, actor) {
        await ensureReady()
        const actorId = assertSystemWriter(actor)
        const segmentVersionId = normalizeUuid(payload?.segmentVersionId || payload?.segment_version_id, 'ANALYTICS_SEGMENT_VERSION_ID_INVALID')
        const snapshotDate = normalizeDate(payload?.snapshotDate || payload?.snapshot_date || clock().toISOString(), 'SNAPSHOT_DATE')
        const members = normalizeSnapshotMembers(payload?.members)
        const metrics = payload?.metrics === undefined ? {} : normalizeSafeObject(payload.metrics, 'ANALYTICS_SNAPSHOT_METRICS_INVALID', { allowEmpty: true })
        return withTransaction(async (client) => {
            const unit = await unitRecord(client, payload?.unit || payload?.unitSlug || payload?.unit_slug)
            const version = await client.query(`select version.id::text,version.revision,version.version_key,version.criteria,definition.segment_key
                from crm_atendimento.commercial_segment_versions version
                join crm_atendimento.commercial_segment_definitions definition on definition.id=version.segment_id
                where version.id=$1::uuid`, [segmentVersionId])
            const row = version.rows[0]
            if (!row) throw analyticsError('ANALYTICS_SEGMENT_VERSION_NOT_FOUND', 404)
            const criteria = sanitizeAnalyticsPayload(row.criteria) || {}
            const snapshot = buildSegmentMembershipSnapshot({
                key: row.segment_key,
                version: row.version_key,
                criteria: Object.keys(criteria).length ? criteria : { source: 'durable' },
            }, members, { snapshotAt: `${snapshotDate}T00:00:00.000Z`, unitSlug: unit.slug })
            return runMutation(client, {
                actor,
                operation: 'segment_snapshot_create',
                idempotencyKey: payload?.idempotencyKey,
                request: {
                    segmentVersionId, unit: unit.slug, snapshotDate,
                    membershipHash: snapshot.membershipHash, population: snapshot.memberCount,
                    distribution: snapshot.distribution, metrics,
                },
            }, async () => {
                if (members.length) {
                    const known = await client.query(`select id::text from crm_atendimento.global_client_identities
                        where id = any($1::uuid[])`, [members.map((member) => member.identityId)])
                    if (known.rows.length !== members.length) throw analyticsError('ANALYTICS_SNAPSHOT_IDENTITIES_MISSING', 409)
                }
                const inserted = await client.query(`insert into crm_atendimento.commercial_segment_membership_snapshots(
                        segment_version_id,unit_id,snapshot_date,membership_hash,population,distribution,metrics)
                    values($1::uuid,$2::uuid,$3::date,$4,$5,$6::jsonb,$7::jsonb)
                    on conflict do nothing returning id::text`, [
                    segmentVersionId, unit.id, snapshotDate, snapshot.membershipHash, snapshot.memberCount,
                    JSON.stringify(snapshot.distribution), JSON.stringify(metrics),
                ])
                const snapshotId = inserted.rows[0]?.id || (await client.query(`select id::text
                    from crm_atendimento.commercial_segment_membership_snapshots
                    where segment_version_id=$1::uuid and unit_id is not distinct from $2::uuid
                        and snapshot_date=$3::date and membership_hash=$4`, [segmentVersionId, unit.id, snapshotDate, snapshot.membershipHash])).rows[0]?.id
                if (!snapshotId) throw analyticsError('ANALYTICS_SNAPSHOT_PERSISTENCE_FAILED', 503)
                if (inserted.rows[0]) {
                    for (let start = 0; start < members.length; start += 500) {
                        const batch = members.slice(start, start + 500)
                        const values = []; const params = []
                        for (const member of batch) {
                            params.push(snapshotId, member.identityId, unit.id, member.bucket)
                            const offset = params.length - 3
                            values.push(`($${offset}::uuid,$${offset + 1}::uuid,$${offset + 2}::uuid,$${offset + 3})`)
                        }
                        await client.query(`insert into crm_atendimento.commercial_segment_memberships(snapshot_id,identity_id,unit_id,bucket_key)
                            values ${values.join(',')} on conflict do nothing`, params)
                    }
                }
                return {
                    snapshot: {
                        id: snapshotId,
                        segmentVersionId,
                        unit: unit.slug,
                        snapshotDate,
                        population: snapshot.memberCount,
                        distribution: snapshot.distribution,
                    },
                    actor: actorId,
                }
            })
        })
    }

    async function recordAnalyticsEvent(payload, actor) {
        await ensureReady()
        const actorId = assertSystemWriter(actor)
        const identityId = normalizeUuid(payload?.identityId || payload?.identity_id, 'ANALYTICS_EVENT_IDENTITY_INVALID')
        const unitSlug = text(payload?.unit || payload?.unitSlug || payload?.unit_slug, 80).toLowerCase()
        const eventType = text(payload?.eventType || payload?.event_type, 80).toLowerCase()
        if (!EVENT_TYPES.has(eventType)) throw analyticsError('ANALYTICS_EVENT_TYPE_INVALID', 400)
        const occurredAt = normalizeDateTime(payload?.occurredAt || payload?.occurred_at || clock().toISOString(), 'EVENT_OCCURRED_AT')
        const campaignId = normalizeOptionalUuid(payload?.campaignId || payload?.campaign_id, 'ANALYTICS_EVENT_CAMPAIGN_INVALID')
        const offerId = normalizeOptionalUuid(payload?.offerId || payload?.offer_id, 'ANALYTICS_EVENT_OFFER_INVALID')
        const correlationId = normalizeOptionalUuid(payload?.correlationId || payload?.correlation_id, 'ANALYTICS_EVENT_CORRELATION_INVALID')
        const channel = normalizeOptionalOpaque(payload?.channel, 'ANALYTICS_EVENT_CHANNEL_INVALID', 80)
        const ownerId = normalizeOptionalOpaque(payload?.ownerId || payload?.owner_id, 'ANALYTICS_EVENT_OWNER_INVALID')
        const policyVersion = normalizeOptionalOpaque(payload?.policyVersion || payload?.policy_version, 'ANALYTICS_EVENT_POLICY_INVALID', 120)
        const revenueCents = payload?.revenueCents === undefined && payload?.revenue_cents === undefined
            ? null
            : normalizeRevenueCents(payload?.revenueCents ?? payload?.revenue_cents)
        return withTransaction(async (client) => {
            const unit = await unitRecord(client, unitSlug, { required: true })
            const prerequisites = await client.query(`select
                exists(select 1 from crm_atendimento.global_client_identities where id=$1::uuid) as identity,
                ($2::uuid is null or exists(select 1 from crm_atendimento.commercial_campaigns where id=$2::uuid and unit_id=$4::uuid)) as campaign,
                ($3::uuid is null or exists(select 1 from crm_atendimento.commercial_offers where id=$3::uuid and unit_id=$4::uuid)) as offer`, [
                identityId, campaignId, offerId, unit.id,
            ])
            if (!Object.values(prerequisites.rows[0] || {}).every(Boolean)) throw analyticsError('ANALYTICS_EVENT_PREREQUISITE_MISSING', 409)
            const event = { identityId, unit: unit.slug, campaignId, offerId, eventType, channel, ownerId, policyVersion, revenueCents, occurredAt, correlationId }
            const eventKey = systemEventKey(event)
            return runMutation(client, {
                actor,
                operation: 'analytics_event_record',
                idempotencyKey: payload?.idempotencyKey,
                request: { ...event, eventKey },
            }, async () => {
                const inserted = await client.query(`insert into crm_atendimento.commercial_analytics_events(
                        event_key,identity_id,unit_id,campaign_id,offer_id,event_type,channel,owner_id,policy_version,revenue_cents,occurred_at,correlation_id)
                    values($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12::uuid)
                    on conflict do nothing returning identity_id::text,unit_id::text,campaign_id::text,offer_id::text,event_type,channel,owner_id,policy_version,revenue_cents,occurred_at`, [
                    eventKey, identityId, unit.id, campaignId, offerId, eventType, channel, ownerId, policyVersion, revenueCents, occurredAt, correlationId,
                ])
                const persisted = inserted.rows[0] || (await client.query(`select identity_id::text,unit_id::text,campaign_id::text,offer_id::text,event_type,channel,owner_id,policy_version,revenue_cents,occurred_at
                    from crm_atendimento.commercial_analytics_events where event_key=$1`, [eventKey])).rows[0]
                if (!persisted) throw analyticsError('ANALYTICS_EVENT_PERSISTENCE_FAILED', 503)
                return { event: { type: persisted.event_type, unit: unit.slug, occurredAt: persisted.occurred_at }, actor: actorId }
            })
        })
    }

    async function visibleMetrics(filters, actor) {
        const units = scopedUnits(actor, filters.unit)
        const params = []
        const where = []
        if (units !== null) {
            params.push(units)
            where.push(`unit.slug = any($${params.length}::text[])`)
        }
        if (filters.findingKey) { params.push(filters.findingKey); where.push(`snapshot.finding_key=$${params.length}`) }
        if (filters.sourceKey) { params.push(filters.sourceKey); where.push(`snapshot.source_key=$${params.length}`) }
        if (filters.from) { params.push(filters.from); where.push(`snapshot.bucket_date >= $${params.length}::date`) }
        if (filters.to) { params.push(filters.to); where.push(`snapshot.bucket_date <= $${params.length}::date`) }
        params.push(filters.limit)
        const result = await pgPool.query(`select snapshot.source_key,snapshot.finding_key,unit.slug as unit_slug,snapshot.metrics,
                snapshot.bucket_date,snapshot.created_at
            from crm_atendimento.commercial_analytics_metric_snapshots snapshot
            left join crm_atendimento.units unit on unit.id=snapshot.unit_id
            ${where.length ? `where ${where.join(' and ')}` : ''}
            order by snapshot.bucket_date desc,snapshot.created_at desc limit $${params.length}`, params)
        return result.rows.map(mapMetric)
    }

    async function quality(query, actor) {
        await ensureReady()
        const filters = normalizeAnalyticsFilters(query)
        const metrics = await visibleMetrics(filters, actor)
        if (!isGlobal(actor)) {
            return {
                scope: 'unit_aggregate',
                filters,
                ...buildQualityTimeSeries({ metricSnapshots: metrics, asOf: clock(), granularity: filters.granularity }),
                findingsAvailable: false,
            }
        }
        const [findings, events] = await Promise.all([
            pgPool.query(`select finding_key,severity,status,owner,observed_count,sla_due_at,first_detected_at,last_observed_at,
                    last_evaluated_at,acknowledged_at,resolved_at from crm_atendimento.commercial_data_quality_findings
                order by finding_key`),
            pgPool.query(`select finding.finding_key,event.event_type,event.status,event.observed_count,event.created_at
                from crm_atendimento.commercial_data_quality_finding_events event
                join crm_atendimento.commercial_data_quality_findings finding on finding.id=event.finding_id
                order by event.created_at asc`),
        ])
        return {
            scope: 'global_aggregate',
            filters,
            ...buildQualityTimeSeries({ findings: findings.rows, findingEvents: events.rows, metricSnapshots: metrics, asOf: clock(), granularity: filters.granularity }),
            findingsAvailable: true,
        }
    }

    async function resolvedWindows(filters) {
        const params = []
        const where = [`effective_from <= now()`, `(expires_at is null or expires_at > now())`]
        if (filters?.attributionWindowVersion) { params.push(text(filters.attributionWindowVersion, 120)); where.push(`version=$${params.length}`) }
        const result = await pgPool.query(`select * from crm_atendimento.commercial_attribution_windows
            where ${where.join(' and ')} order by effective_from desc limit 1`, params)
        return mapWindow(result.rows[0])
    }

    async function funnel(query, actor) {
        await ensureReady()
        const filters = normalizeAnalyticsFilters(query)
        const units = scopedUnits(actor, filters.unit)
        const params = []
        const eventWhere = []
        if (units !== null) { params.push(units); eventWhere.push(`unit.slug = any($${params.length}::text[])`) }
        if (filters.from) { params.push(filters.from); eventWhere.push(`event.occurred_at >= $${params.length}::date`) }
        if (filters.to) { params.push(filters.to); eventWhere.push(`event.occurred_at < ($${params.length}::date + interval '1 day')`) }
        const eventSql = `select event.identity_id::text,event.event_type,event.channel,event.owner_id,event.policy_version,event.occurred_at,event.revenue_cents,
                unit.slug as unit_slug,event.campaign_id::text,campaign.segment_key,event.offer_id::text
            from crm_atendimento.commercial_analytics_events event
            left join crm_atendimento.units unit on unit.id=event.unit_id
            left join crm_atendimento.commercial_campaigns campaign on campaign.id=event.campaign_id
            ${eventWhere.length ? `where ${eventWhere.join(' and ')}` : ''}`
        const memberParams = units === null ? [] : [units]
        const memberWhere = units === null ? '' : 'where unit.slug = any($1::text[])'
        const actionParams = units === null ? [] : [units]
        const actionWhere = units === null ? '' : 'where unit.slug = any($1::text[])'
        const assignmentParams = units === null ? [] : [units]
        const assignmentWhere = units === null ? '' : 'where unit.slug = any($1::text[])'
        const [events, members, actions, assignments, window] = await Promise.all([
            pgPool.query(eventSql, params),
            pgPool.query(`select member.identity_id::text,unit.slug as unit_slug,member.created_at,campaign.id::text as campaign_id,
                    campaign.segment_key,member.owner,member.offer_id::text
                from crm_atendimento.commercial_campaign_members member
                join crm_atendimento.units unit on unit.id=member.unit_id
                join crm_atendimento.commercial_campaigns campaign on campaign.id=member.campaign_id ${memberWhere}`, memberParams),
            pgPool.query(`select action.identity_id::text,action.status,action.contacted_at,action.created_at,action.updated_at,
                    unit.slug as unit_slug,member.campaign_id::text,campaign.segment_key,member.owner,member.offer_id::text
                from crm_atendimento.commercial_actions action
                left join crm_atendimento.units unit on unit.id=action.unit_id
                left join crm_atendimento.commercial_campaign_members member on member.action_id=action.id
                left join crm_atendimento.commercial_campaigns campaign on campaign.id=member.campaign_id ${actionWhere}`, actionParams),
            pgPool.query(`select assignment.identity_id::text,assignment.variant,assignment.eligible,unit.slug as unit_slug
                from crm_atendimento.commercial_experiment_assignments assignment
                join crm_atendimento.units unit on unit.id=assignment.unit_id ${assignmentWhere}`, assignmentParams),
            resolvedWindows(query),
        ])
        const funnelResult = buildCommercialFunnel({
            eligibleIdentities: events.rows.filter((row) => row.event_type === 'eligible'),
            campaignMembers: members.rows,
            actions: actions.rows,
            events: events.rows.map(mapEvent),
            assignments: assignments.rows,
            windows: window || undefined,
            filters,
        })
        return { scope: units === null ? 'global_aggregate' : 'unit_aggregate', filters, attributionWindow: window, ...funnelResult }
    }

    async function attributionWindows(query, actor) {
        await ensureReady()
        assertManager(actor)
        const limit = Math.min(100, Math.max(1, Number(query?.limit || 30)))
        const result = await pgPool.query(`select * from crm_atendimento.commercial_attribution_windows order by effective_from desc limit $1`, [limit])
        return { windows: result.rows.map(mapWindow) }
    }

    async function createAttributionWindow(payload, actor) {
        await ensureReady()
        assertGlobal(actor)
        const actorId = opaqueActorId(actor)
        const normalized = normalizeAttributionWindows(payload)
        const reason = normalizeReason(payload?.reason)
        const effectiveFrom = normalizeDateTime(payload?.effectiveFrom || payload?.effective_from || clock().toISOString(), 'EFFECTIVE_FROM')
        const expiresAt = payload?.expiresAt || payload?.expires_at ? normalizeDateTime(payload.expiresAt || payload.expires_at, 'EXPIRES_AT') : null
        if (expiresAt && expiresAt <= effectiveFrom) throw analyticsError('ANALYTICS_WINDOW_PERIOD_INVALID', 400)
        return withTransaction(async (client) => runMutation(client, {
            actor, operation: 'attribution_window_create', idempotencyKey: payload?.idempotencyKey,
            request: { version: normalized.version, ...normalized, effectiveFrom, expiresAt, reason },
        }, async () => {
            const inserted = await client.query(`insert into crm_atendimento.commercial_attribution_windows(
                    version,response_days,appointment_days,attendance_days,sale_days,return_days,effective_from,expires_at,author_id,reason)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [
                normalized.version, normalized.responseDays, normalized.appointmentDays, normalized.attendanceDays,
                normalized.saleDays, normalized.returnDays, effectiveFrom, expiresAt, actorId, reason,
            ])
            return { window: mapWindow(inserted.rows[0]) }
        }))
    }

    async function segmentDefinitions(query, actor) {
        await ensureReady()
        assertManager(actor)
        const limit = Math.min(100, Math.max(1, Number(query?.limit || 50)))
        const result = await pgPool.query(`select definition.id,definition.segment_key,definition.current_revision,definition.current_status,
                version.version_key,version.criteria,version.thresholds,version.percentiles,version.effective_from,version.created_at
            from crm_atendimento.commercial_segment_definitions definition
            left join crm_atendimento.commercial_segment_versions version on version.segment_id=definition.id and version.revision=definition.current_revision
            order by definition.segment_key limit $1`, [limit])
        return { segments: result.rows.map(mapSegment) }
    }

    async function createSegmentVersion(payload, actor) {
        await ensureReady()
        assertGlobal(actor)
        const actorId = opaqueActorId(actor)
        const normalized = normalizeSegmentDefinition(payload)
        const expectedRevision = payload?.expectedRevision === undefined ? null : normalizeCount(payload.expectedRevision, 'ANALYTICS_SEGMENT_REVISION_INVALID')
        return withTransaction(async (client) => runMutation(client, {
            actor, operation: 'segment_version_create', idempotencyKey: payload?.idempotencyKey,
            request: { ...normalized, expectedRevision },
        }, async () => {
            const current = await client.query(`select id,current_revision from crm_atendimento.commercial_segment_definitions where segment_key=$1 for update`, [normalized.key])
            let segmentId; let revision
            if (!current.rows[0]) {
                segmentId = randomUUID(); revision = 1
                if (expectedRevision !== null && expectedRevision !== 0) throw analyticsError('ANALYTICS_SEGMENT_VERSION_CONFLICT', 409)
                await client.query(`insert into crm_atendimento.commercial_segment_definitions(id,segment_key,current_revision,current_status)
                    values($1,$2,$3,'active')`, [segmentId, normalized.key, revision])
            } else {
                segmentId = current.rows[0].id; const currentRevision = Number(current.rows[0].current_revision)
                if (expectedRevision !== null && expectedRevision !== currentRevision) throw analyticsError('ANALYTICS_SEGMENT_VERSION_CONFLICT', 409)
                revision = currentRevision + 1
                await client.query(`update crm_atendimento.commercial_segment_definitions set current_revision=$2,current_status='active',updated_at=now() where id=$1`, [segmentId, revision])
            }
            const duplicateVersion = await client.query(`select id from crm_atendimento.commercial_segment_versions
                where segment_id=$1::uuid and version_key=$2 for update`, [segmentId, normalized.version])
            if (duplicateVersion.rows[0]) throw analyticsError('ANALYTICS_SEGMENT_VERSION_KEY_CONFLICT', 409)
            const inserted = await client.query(`insert into crm_atendimento.commercial_segment_versions(
                    segment_id,revision,version_key,criteria,thresholds,percentiles,effective_from,author_id)
                values($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8) returning *`, [
                segmentId, revision, normalized.version, JSON.stringify(normalized.criteria), JSON.stringify(normalized.thresholds),
                JSON.stringify(normalized.percentiles), normalized.effectiveFrom || null, actorId,
            ])
            return { segment: mapSegment({ ...inserted.rows[0], segment_key: normalized.key, current_status: 'active' }) }
        }))
    }

    async function segmentDrift(query, actor) {
        await ensureReady()
        assertManager(actor)
        const segmentKey = text(query?.segmentKey || query?.segment, 120)
        if (!KEY.test(segmentKey)) throw analyticsError('ANALYTICS_SEGMENT_KEY_INVALID', 400)
        const units = scopedUnits(actor, query?.unit)
        const params = [segmentKey]
        const where = ['definition.segment_key=$1']
        if (units !== null) { params.push(units); where.push(`unit.slug=any($${params.length}::text[])`) }
        const result = await pgPool.query(`select snapshot.snapshot_date,snapshot.created_at,snapshot.population as member_count,snapshot.distribution,unit.slug as unit_slug
            from crm_atendimento.commercial_segment_membership_snapshots snapshot
            join crm_atendimento.commercial_segment_versions version on version.id=snapshot.segment_version_id
            join crm_atendimento.commercial_segment_definitions definition on definition.id=version.segment_id
            left join crm_atendimento.units unit on unit.id=snapshot.unit_id
            where ${where.join(' and ')} order by snapshot.snapshot_date asc,snapshot.created_at asc`, params)
        const byUnit = new Map()
        for (const row of result.rows) {
            const key = row.unit_slug || 'all'
            const rows = byUnit.get(key) || []
            rows.push(row)
            byUnit.set(key, rows)
        }
        return { segmentKey, drift: Object.fromEntries([...byUnit.entries()].map(([unit, snapshots]) => [unit, buildSegmentDrift(snapshots)])) }
    }

    async function experiments(query, actor) {
        await ensureReady()
        const units = scopedUnits(actor, query?.unit)
        const params = []
        const where = []
        if (units !== null) { params.push(units); where.push(`unit.slug=any($${params.length}::text[])`) }
        const result = await pgPool.query(`select experiment.*,unit.slug as unit_slug from crm_atendimento.commercial_experiments experiment
            join crm_atendimento.units unit on unit.id=experiment.unit_id ${where.length ? `where ${where.join(' and ')}` : ''}
            order by experiment.created_at desc limit 100`, params)
        return { experiments: result.rows.map(mapExperiment) }
    }

    async function createExperiment(payload, actor) {
        await ensureReady()
        assertManager(actor)
        const actorId = opaqueActorId(actor)
        const experimentKey = text(payload?.experimentKey || payload?.key, 120)
        const seed = text(payload?.seed, 120)
        if (!KEY.test(experimentKey) || !KEY.test(seed)) throw analyticsError('ANALYTICS_EXPERIMENT_KEY_INVALID', 400)
        const unitSlug = text(payload?.unit, 80).toLowerCase()
        const units = scopedUnits(actor, unitSlug)
        if (!units?.length) throw analyticsError('ANALYTICS_UNIT_REQUIRED', 400)
        const segmentVersionId = normalizeUuid(payload?.segmentVersionId, 'ANALYTICS_SEGMENT_VERSION_ID_INVALID')
        const attributionWindowId = normalizeUuid(payload?.attributionWindowId, 'ANALYTICS_WINDOW_ID_INVALID')
        const campaignId = payload?.campaignId ? normalizeUuid(payload.campaignId, 'ANALYTICS_CAMPAIGN_ID_INVALID') : null
        const controlGroupPercent = Number(payload?.controlGroupPercent)
        if (!Number.isInteger(controlGroupPercent) || controlGroupPercent < 1 || controlGroupPercent > 99) throw analyticsError('ANALYTICS_CONTROL_GROUP_INVALID', 400)
        const startsAt = normalizeDateTime(payload?.startsAt, 'EXPERIMENT_START')
        const endsAt = normalizeDateTime(payload?.endsAt, 'EXPERIMENT_END')
        if (endsAt <= startsAt) throw analyticsError('ANALYTICS_EXPERIMENT_PERIOD_INVALID', 400)
        const reason = normalizeReason(payload?.reason)
        return withTransaction(async (client) => runMutation(client, {
            actor, operation: 'experiment_create', idempotencyKey: payload?.idempotencyKey,
            request: { experimentKey, unitSlug, segmentVersionId, attributionWindowId, campaignId, seed, controlGroupPercent, startsAt, endsAt, reason },
        }, async () => {
            const unit = await client.query(`select id,slug from crm_atendimento.units where slug=$1`, [unitSlug])
            if (!unit.rows[0]) throw analyticsError('ANALYTICS_UNIT_NOT_FOUND', 404)
            const prerequisites = await client.query(`select
                exists(select 1 from crm_atendimento.commercial_segment_versions where id=$1::uuid) as segment,
                exists(select 1 from crm_atendimento.commercial_attribution_windows where id=$2::uuid) as window,
                ($3::uuid is null or exists(select 1 from crm_atendimento.commercial_campaigns where id=$3::uuid and unit_id=$4::uuid)) as campaign`, [segmentVersionId, attributionWindowId, campaignId, unit.rows[0].id])
            if (!Object.values(prerequisites.rows[0] || {}).every(Boolean)) throw analyticsError('ANALYTICS_EXPERIMENT_PREREQUISITE_MISSING', 409)
            const inserted = await client.query(`insert into crm_atendimento.commercial_experiments(
                    experiment_key,campaign_id,segment_version_id,unit_id,attribution_window_id,seed,control_group_percent,state,starts_at,ends_at,author_id,reason)
                values($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11) returning *`, [
                experimentKey, campaignId, segmentVersionId, unit.rows[0].id, attributionWindowId, seed,
                controlGroupPercent, startsAt, endsAt, actorId, reason,
            ])
            return { experiment: mapExperiment({ ...inserted.rows[0], unit_slug: unit.rows[0].slug }) }
        }))
    }

    async function assignExperiment(payload, actor) {
        await ensureReady()
        assertManager(actor)
        const experimentId = normalizeUuid(payload?.experimentId, 'ANALYTICS_EXPERIMENT_ID_INVALID')
        const snapshotId = normalizeUuid(payload?.snapshotId, 'ANALYTICS_SNAPSHOT_ID_INVALID')
        return withTransaction(async (client) => {
            const experiment = await client.query(`select experiment.*,unit.slug as unit_slug from crm_atendimento.commercial_experiments experiment
                join crm_atendimento.units unit on unit.id=experiment.unit_id where experiment.id=$1::uuid for update`, [experimentId])
            const row = experiment.rows[0]
            if (!row) throw analyticsError('ANALYTICS_EXPERIMENT_NOT_FOUND', 404)
            scopedUnits(actor, row.unit_slug)
            return runMutation(client, {
                actor, operation: 'experiment_assign', idempotencyKey: payload?.idempotencyKey,
                request: { experimentId, snapshotId, unit: row.unit_slug },
            }, async () => {
                const members = await client.query(`select member.identity_id::text,unit.slug as unit_slug
                    from crm_atendimento.commercial_segment_memberships member
                    join crm_atendimento.commercial_segment_membership_snapshots snapshot on snapshot.id=member.snapshot_id
                    join crm_atendimento.units unit on unit.id=member.unit_id
                    where snapshot.id=$1::uuid and snapshot.segment_version_id=$2::uuid and (snapshot.unit_id is null or snapshot.unit_id=$3::uuid)`, [snapshotId, row.segment_version_id, row.unit_id])
                if (!members.rows.length) throw analyticsError('ANALYTICS_EXPERIMENT_MEMBERSHIP_EMPTY', 409)
                const existing = await client.query(`select identity_id::text,variant,eligible,unit_id::text from crm_atendimento.commercial_experiment_assignments where experiment_id=$1::uuid`, [experimentId])
                const assignments = buildExperimentAssignments(members.rows, {
                    experimentKey: row.experiment_key,
                    seed: row.seed,
                    controlPercent: Number(row.control_group_percent),
                    existingAssignments: existing.rows.map((item) => ({ ...item, unit_slug: row.unit_slug })),
                })
                await lockExperimentCrossoverAssignments(client, row.unit_id, assignments)
                for (const assignment of assignments.filter((item) => !item.preserved)) {
                    await client.query(`insert into crm_atendimento.commercial_experiment_assignments(experiment_id,identity_id,unit_id,variant,eligible,exclusion_reason)
                        values($1,$2::uuid,$3::uuid,$4,$5,$6) on conflict(experiment_id,identity_id) do nothing`, [
                        experimentId, assignment.identityId, row.unit_id, assignment.variant, assignment.eligible, assignment.exclusionReason,
                    ])
                }
                const summary = assignments.reduce((accumulator, item) => {
                    accumulator.total += 1; accumulator[item.variant] = (accumulator[item.variant] || 0) + 1; return accumulator
                }, { total: 0, control: 0, treatment: 0, excluded: 0 })
                return { experimentId, assignments: summary }
            })
        })
    }

    async function experimentResult(experimentIdValue, actor) {
        await ensureReady()
        const experimentId = normalizeUuid(experimentIdValue, 'ANALYTICS_EXPERIMENT_ID_INVALID')
        const experiment = await pgPool.query(`select experiment.*,unit.slug as unit_slug from crm_atendimento.commercial_experiments experiment
            join crm_atendimento.units unit on unit.id=experiment.unit_id where experiment.id=$1::uuid`, [experimentId])
        const row = experiment.rows[0]
        if (!row) throw analyticsError('ANALYTICS_EXPERIMENT_NOT_FOUND', 404)
        scopedUnits(actor, row.unit_slug)
        const [assignments, events] = await Promise.all([
            pgPool.query(`select identity_id::text,variant,eligible from crm_atendimento.commercial_experiment_assignments where experiment_id=$1::uuid`, [experimentId]),
            pgPool.query(`select event.identity_id::text,event.event_type,event.revenue_cents,event.occurred_at
                from crm_atendimento.commercial_analytics_events event
                where event.unit_id=$1::uuid and event.occurred_at >= $2 and event.occurred_at <= $3`, [row.unit_id, row.starts_at, row.ends_at]),
        ])
        return { experiment: mapExperiment(row), ...buildExperimentResult(assignments.rows, events.rows.map(mapEvent)) }
    }

    return {
        readiness,
        recordMetricSnapshot,
        recordSegmentSnapshot,
        recordAnalyticsEvent,
        quality,
        funnel,
        attributionWindows,
        createAttributionWindow,
        segmentDefinitions,
        createSegmentVersion,
        segmentDrift,
        experiments,
        createExperiment,
        assignExperiment,
        experimentResult,
    }
}

export const __testables = {
    digest,
    isGlobal,
    lockExperimentCrossoverAssignments,
    mapEvent,
    normalizeReason,
    normalizeSnapshotMembers,
    opaqueActorId,
    normalizeSafeObject,
    scopedUnits,
}
