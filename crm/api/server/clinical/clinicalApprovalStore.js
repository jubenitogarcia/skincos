import { createHash } from 'node:crypto'
import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { normalizeUnit } from '../atendimento/domain.js'

const RULE_STATUSES = new Set(['draft', 'submitted', 'approved', 'rejected', 'expired', 'disabled'])
const EVENT_TYPES = new Set(['created', 'revision_created', 'submitted', 'approved', 'rejected', 'expired', 'disabled'])
const MUTATING_ROLES = new Set(['GESTOR', 'ADMIN'])

function domainError(code, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function roleOf(actor) {
    return String(actor?.role || '').trim().toUpperCase()
}

function actorIdOf(actor) {
    const id = String(actor?.id || actor?.username || '').trim()
    if (!id) throw domainError('CLINICAL_APPROVAL_ACTOR_REQUIRED', 401)
    return id.slice(0, 200)
}

function actorRoleOf(actor) {
    return roleOf(actor) || 'UNKNOWN'
}

function isGlobal(actor) {
    return actor?.isGlobalAdmin === true || roleOf(actor) === 'ADMIN'
}

function allowedUnitSlugs(actor) {
    if (isGlobal(actor)) return null
    if (!Object.prototype.hasOwnProperty.call(actor || {}, 'allowedUnits')) {
        // Clinical approval is never global by omission.  A reviewer must
        // carry an explicit signed unit claim; otherwise a missing claim
        // would silently widen the approval scope.
        return roleOf(actor) === 'CLINICAL_APPROVER' ? [] : null
    }
    if (!Array.isArray(actor.allowedUnits)) return []
    return actor.allowedUnits.map((item) => normalizeUnit(item).slug).filter(Boolean)
}

function assertRole(actor, roles, statusCode = 403) {
    if (!roles.has(roleOf(actor)) && !(isGlobal(actor) && roles.has('ADMIN'))) throw domainError('CLINICAL_APPROVAL_FORBIDDEN', statusCode)
}

function assertUnitScope(actor, unitSlug, { required = false } = {}) {
    const allowed = allowedUnitSlugs(actor)
    if (allowed === null) return
    if (!allowed.length || (required && !unitSlug) || (unitSlug && !allowed.includes(unitSlug))) throw domainError('CLINICAL_APPROVAL_UNIT_FORBIDDEN', 403)
}

function cleanText(value, min, max, code) {
    const text = String(value ?? '').trim()
    if (text.length < min || text.length > max) throw domainError(code, 400)
    return text
}

function dateValue(value, code, required = true) {
    const raw = String(value ?? '').trim()
    if (!raw && !required) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw domainError(code, 400)
    const parsed = new Date(`${raw}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw domainError(code, 400)
    return raw
}

function normalizeRuleInput(payload = {}) {
    const procedureId = String(payload.procedureId || '').trim()
    if (!procedureId || !/^[0-9a-f-]{16,}$/i.test(procedureId)) throw domainError('CLINICAL_APPROVAL_PROCEDURE_REQUIRED', 400)
    const intervalMinDays = Number(payload.intervalMinDays ?? payload.cadenceDays)
    const intervalMaxDays = Number(payload.intervalMaxDays ?? payload.cadenceDays)
    if (!Number.isInteger(intervalMinDays) || !Number.isInteger(intervalMaxDays) || intervalMinDays < 1 || intervalMaxDays < intervalMinDays || intervalMaxDays > 1095) {
        throw domainError('CLINICAL_APPROVAL_INTERVAL_INVALID', 400)
    }
    const effectiveFrom = dateValue(payload.effectiveFrom || new Date().toISOString().slice(0, 10), 'CLINICAL_APPROVAL_EFFECTIVE_DATE_INVALID')
    const expiresAt = dateValue(payload.expiresAt, 'CLINICAL_APPROVAL_EXPIRY_INVALID', false)
    if (expiresAt && expiresAt <= effectiveFrom) throw domainError('CLINICAL_APPROVAL_EXPIRY_INVALID', 400)
    const unitValue = String(payload.unit || payload.unitSlug || '').trim()
    const unitSlug = unitValue && unitValue !== 'all' ? normalizeUnit(unitValue).slug : null
    return {
        procedureId,
        unitSlug,
        intervalMinDays,
        intervalMaxDays,
        justification: cleanText(payload.justification, 10, 2000, 'CLINICAL_APPROVAL_JUSTIFICATION_REQUIRED'),
        evidenceReference: cleanText(payload.evidenceReference || payload.evidence, 3, 1000, 'CLINICAL_APPROVAL_EVIDENCE_REQUIRED'),
        effectiveFrom,
        expiresAt,
    }
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim()
    if (!key || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw domainError('CLINICAL_APPROVAL_IDEMPOTENCY_KEY_REQUIRED', 400)
    return key
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== 'object') return value
    return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stableValue(value[key])
        return out
    }, {})
}

function requestHash(operation, payload) {
    return createHash('sha256').update(JSON.stringify(stableValue({ operation, payload }))).digest('hex')
}

function mapRule(row) {
    if (!row) return null
    const status = RULE_STATUSES.has(row.current_status) ? row.current_status : 'disabled'
    const expired = status === 'approved' && row.expires_at && String(row.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)
    return {
        id: row.id,
        procedureId: row.procedure_id,
        procedureName: row.procedure_name || '',
        unitId: row.unit_id || null,
        unitSlug: row.unit_slug || '',
        unitName: row.unit_name || '',
        revision: Number(row.current_revision || 1),
        intervalMinDays: Number(row.interval_min_days || 0),
        intervalMaxDays: Number(row.interval_max_days || 0),
        cadenceDays: Number(row.interval_min_days || 0) === Number(row.interval_max_days || 0) ? Number(row.interval_min_days || 0) : null,
        justification: row.justification || '',
        evidenceReference: row.evidence_reference || '',
        effectiveFrom: row.effective_from ? String(row.effective_from).slice(0, 10) : null,
        expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
        status: expired ? 'expired' : status,
        authorId: row.author_id || '',
        approverId: row.approver_id || null,
        approvedAt: row.approved_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    }
}

function mapEvent(row) {
    return {
        id: row.id,
        ruleId: row.rule_id,
        revision: Number(row.revision),
        eventType: row.event_type,
        previousStatus: row.previous_status || null,
        status: row.status,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        reason: row.reason || null,
        recordedAt: row.recorded_at || null,
    }
}

async function tableReady(pool) {
    if (!pool) return false
    try {
        const result = await pool.query(`select
            to_regclass('clinical_approval.schema_migrations') as registry,
            to_regclass('clinical_approval.rules') as rules,
            to_regclass('clinical_approval.rule_revisions') as revisions,
            to_regclass('clinical_approval.rule_events') as events,
            to_regclass('clinical_approval.command_dedup') as dedup`)
        const row = result.rows[0] || {}
        if (!row.registry || !row.rules || !row.revisions || !row.events || !row.dedup) return false
        const applied = await pool.query(`select 1 from clinical_approval.schema_migrations where id = $1 and rolled_back_at is null`, ['20260806_clinical_cadence_approval_v1'])
        return Boolean(applied.rows[0])
    } catch {
        return false
    }
}

export function createClinicalApprovalStore(options = {}) {
    const pgPool = options.pool || createPgPool(options.databaseUrl)
    let readinessPromise = null

    async function ensureReady() {
        if (!pgPool) throw domainError('CLINICAL_APPROVAL_DATABASE_NOT_CONFIGURED', 503)
        if (!readinessPromise) {
            readinessPromise = tableReady(pgPool).then((ready) => {
                if (!ready) throw domainError('CLINICAL_APPROVAL_DOMAIN_NOT_READY', 503)
                return true
            }).catch((error) => {
                readinessPromise = null
                throw error
            })
        }
        await readinessPromise
    }

    function withCommand(operation, payload, actor, idempotencyKey, fn) {
        const actorId = actorIdOf(actor)
        const key = normalizeIdempotencyKey(idempotencyKey || payload?.idempotencyKey)
        const hash = requestHash(operation, payload)
        return withPgTransaction(pgPool, async (client) => {
            const previous = await client.query(`select request_hash, result from clinical_approval.command_dedup
                where actor_id = $1 and idempotency_key = $2 and operation = $3`, [actorId, key, operation])
            if (previous.rows[0]) {
                if (previous.rows[0].request_hash !== hash) throw domainError('CLINICAL_APPROVAL_IDEMPOTENCY_CONFLICT', 409)
                return previous.rows[0].result
            }
            const result = await fn(client, { actorId, key })
            await client.query(`insert into clinical_approval.command_dedup(actor_id, idempotency_key, operation, request_hash, result)
                values ($1,$2,$3,$4,$5::jsonb)`, [actorId, key, operation, hash, JSON.stringify(result)])
            return result
        })
    }

    async function resolveUnit(client, unitSlug, actor, required = false) {
        assertUnitScope(actor, unitSlug, { required })
        if (!unitSlug) return null
        const result = await client.query(`select id, slug, name from crm_atendimento.units where slug = $1 limit 1`, [unitSlug])
        if (!result.rows[0]) throw domainError('CLINICAL_APPROVAL_UNIT_NOT_FOUND', 404)
        return result.rows[0]
    }

    async function readRule(client, id, forUpdate = false) {
        const result = await client.query(`select r.*, p.name as procedure_name, u.slug as unit_slug, u.name as unit_name
            from clinical_approval.rules r
            join crm_atendimento.procedures p on p.id = r.procedure_id
            left join crm_atendimento.units u on u.id = r.unit_id
            where r.id = $1 ${forUpdate ? 'for update' : ''}`, [id])
        return result.rows[0] || null
    }

    async function event(client, rule, eventType, actor, previousStatus, reason, idempotencyKey, details = {}) {
        if (!EVENT_TYPES.has(eventType)) throw domainError('CLINICAL_APPROVAL_EVENT_INVALID', 500)
        await client.query(`insert into clinical_approval.rule_events(
            rule_id, revision, event_type, previous_status, status, actor_id, actor_role, reason, idempotency_key, details)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [
            rule.id, Number(rule.current_revision), eventType, previousStatus || null, rule.current_status,
            actorIdOf(actor), actorRoleOf(actor), reason || null, idempotencyKey || null, JSON.stringify(details),
        ])
    }

    async function revision(client, rule, input, actor, status) {
        await client.query(`insert into clinical_approval.rule_revisions(
            rule_id, revision, interval_min_days, interval_max_days, justification, evidence_reference,
            effective_from, expires_at, status, author_id, approver_id, approved_at, recorded_by)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
            rule.id, Number(rule.current_revision), input.intervalMinDays, input.intervalMaxDays,
            input.justification, input.evidenceReference, input.effectiveFrom, input.expiresAt,
            status, rule.author_id, rule.approver_id || null, rule.approved_at || null, actorIdOf(actor),
        ])
    }

    async function loadUnitId(client, unitSlug, actor, required = false) {
        return (await resolveUnit(client, unitSlug, actor, required))?.id || null
    }

    return {
        async health() {
            const ready = await tableReady(pgPool)
            return { ok: true, ready, domain: 'clinical-approval', writesEnabled: false, pii: false }
        },

        async readiness() {
            const ready = await tableReady(pgPool)
            return { ok: ready, ready, domain: 'clinical-approval', dependencies: { database: ready, schema: ready } }
        },

        async listRules(query = {}, actor) {
            await ensureReady()
            assertRole(actor, new Set(['GESTOR', 'ADMIN', 'CLINICAL_APPROVER']))
            const where = ['1=1']
            const params = []
            const allowed = allowedUnitSlugs(actor)
            if (allowed !== null) {
                if (!allowed.length) return { rules: [], total: 0 }
                params.push(allowed)
                where.push(`u.slug = any($${params.length}::text[])`)
            }
            const unit = String(query.unit || query.unitSlug || '').trim()
            if (unit && unit !== 'all') {
                const slug = normalizeUnit(unit).slug
                assertUnitScope(actor, slug)
                params.push(slug)
                where.push(`u.slug = $${params.length}`)
            }
            const status = String(query.status || '').trim()
            if (status) {
                if (!RULE_STATUSES.has(status)) throw domainError('CLINICAL_APPROVAL_STATUS_INVALID', 400)
                if (status === 'expired') {
                    where.push(`(r.current_status = 'expired' or (r.current_status = 'approved' and r.expires_at is not null and r.expires_at <= current_date))`)
                } else {
                    params.push(status)
                    where.push(`r.current_status = $${params.length}`)
                }
            }
            if (query.id !== undefined && query.id !== null && String(query.id).trim()) {
                params.push(String(query.id).trim())
                where.push(`r.id = $${params.length}`)
            }
            const result = await pgPool.query(`select r.*, p.name as procedure_name, u.slug as unit_slug, u.name as unit_name
                from clinical_approval.rules r
                join crm_atendimento.procedures p on p.id = r.procedure_id
                left join crm_atendimento.units u on u.id = r.unit_id
                where ${where.join(' and ')}
                order by r.updated_at desc, r.id`, params)
            return { rules: result.rows.map(mapRule), total: result.rows.length }
        },

        async getRule(id, actor) {
            await ensureReady()
            assertRole(actor, new Set(['GESTOR', 'ADMIN', 'CLINICAL_APPROVER']))
            const result = await this.listRules({ id }, actor)
            const rule = result.rules.find((item) => item.id === String(id)) || null
            if (!rule) throw domainError('CLINICAL_APPROVAL_NOT_FOUND', 404)
            const events = await pgPool.query(`select id, rule_id, revision, event_type, previous_status, status, actor_id, actor_role, reason, recorded_at
                from clinical_approval.rule_events where rule_id = $1 order by event_order`, [id])
            return { rule, events: events.rows.map(mapEvent) }
        },

        async createDraft(payload, actor, idempotencyKey) {
            await ensureReady()
            assertRole(actor, MUTATING_ROLES)
            const input = normalizeRuleInput(payload)
            const actorId = actorIdOf(actor)
            const unitRequired = allowedUnitSlugs(actor) !== null
            return withCommand('create_draft', input, actor, idempotencyKey, async (client, command) => {
                const unitId = await loadUnitId(client, input.unitSlug, actor, unitRequired)
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`clinical-approval:${input.procedureId}:${unitId || 'global'}`])
                const existing = await client.query(`select * from clinical_approval.rules
                    where procedure_id = $1 and unit_id is not distinct from $2 for update`, [input.procedureId, unitId])
                let rule
                const previous = existing.rows[0]
                if (!previous) {
                    const inserted = await client.query(`insert into clinical_approval.rules(
                        procedure_id, unit_id, current_revision, interval_min_days, interval_max_days, justification,
                        evidence_reference, effective_from, expires_at, current_status, author_id)
                        values ($1,$2,1,$3,$4,$5,$6,$7,$8,'draft',$9) returning *`, [
                        input.procedureId, unitId, input.intervalMinDays, input.intervalMaxDays, input.justification,
                        input.evidenceReference, input.effectiveFrom, input.expiresAt, actorId,
                    ])
                    rule = inserted.rows[0]
                    await revision(client, rule, input, actor, 'draft')
                    await event(client, rule, 'created', actor, null, input.justification, command.key, { evidenceRecorded: true })
                } else {
                    const nextRevision = Number(previous.current_revision) + 1
                    const updated = await client.query(`update clinical_approval.rules set
                        current_revision = $2, interval_min_days = $3, interval_max_days = $4, justification = $5,
                        evidence_reference = $6, effective_from = $7, expires_at = $8, current_status = 'draft',
                        author_id = $9, approver_id = null, approved_at = null, updated_at = now()
                        where id = $1 returning *`, [
                        previous.id, nextRevision, input.intervalMinDays, input.intervalMaxDays, input.justification,
                        input.evidenceReference, input.effectiveFrom, input.expiresAt, actorId,
                    ])
                    rule = updated.rows[0]
                    await revision(client, rule, input, actor, 'draft')
                    await event(client, rule, 'revision_created', actor, previous.current_status, input.justification, command.key, { evidenceRecorded: true })
                }
                return { rule: mapRule(rule), idempotent: false }
            })
        },

        async submit(id, payload = {}, actor, idempotencyKey) {
            await ensureReady()
            assertRole(actor, MUTATING_ROLES)
            const expectedRevision = Number(payload.expectedRevision)
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw domainError('CLINICAL_APPROVAL_EXPECTED_REVISION_REQUIRED', 400)
            return withCommand('submit', { id, expectedRevision }, actor, idempotencyKey, async (client, command) => {
                const rule = await readRule(client, id, true)
                if (!rule) throw domainError('CLINICAL_APPROVAL_NOT_FOUND', 404)
                assertUnitScope(actor, rule.unit_slug, { required: allowedUnitSlugs(actor) !== null })
                if (Number(rule.current_revision) !== expectedRevision) throw domainError('CLINICAL_APPROVAL_REVISION_CONFLICT', 409)
                if (!['draft', 'rejected'].includes(rule.current_status)) throw domainError('CLINICAL_APPROVAL_STATUS_CONFLICT', 409)
                const updated = await client.query(`update clinical_approval.rules set current_status = 'submitted', updated_at = now()
                    where id = $1 and current_revision = $2 returning *`, [id, expectedRevision])
                const next = updated.rows[0]
                await event(client, next, 'submitted', actor, rule.current_status, payload.reason, command.key)
                return { rule: mapRule(next), idempotent: false }
            })
        },

        async approve(id, payload = {}, actor, idempotencyKey) {
            await ensureReady()
            assertRole(actor, new Set(['CLINICAL_APPROVER']))
            const expectedRevision = Number(payload.expectedRevision)
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw domainError('CLINICAL_APPROVAL_EXPECTED_REVISION_REQUIRED', 400)
            return withCommand('approve', { id, expectedRevision }, actor, idempotencyKey, async (client, command) => {
                const rule = await readRule(client, id, true)
                if (!rule) throw domainError('CLINICAL_APPROVAL_NOT_FOUND', 404)
                assertUnitScope(actor, rule.unit_slug, { required: allowedUnitSlugs(actor) !== null })
                if (actorIdOf(actor) === String(rule.author_id || '')) throw domainError('CLINICAL_APPROVAL_SELF_APPROVAL', 403)
                if (Number(rule.current_revision) !== expectedRevision) throw domainError('CLINICAL_APPROVAL_REVISION_CONFLICT', 409)
                if (rule.current_status !== 'submitted') throw domainError('CLINICAL_APPROVAL_STATUS_CONFLICT', 409)
                const today = new Date().toISOString().slice(0, 10)
                if (rule.expires_at && String(rule.expires_at).slice(0, 10) <= today) throw domainError('CLINICAL_APPROVAL_WINDOW_INVALID', 409)
                const updated = await client.query(`update clinical_approval.rules set current_status = 'approved', approver_id = $2,
                    approved_at = now(), updated_at = now() where id = $1 and current_revision = $3 returning *`, [id, actorIdOf(actor), expectedRevision])
                const next = updated.rows[0]
                await event(client, next, 'approved', actor, rule.current_status, payload.reason || 'approved', command.key, { recommendationAutomation: false })
                return { rule: mapRule(next), idempotent: false }
            })
        },

        async reject(id, payload = {}, actor, idempotencyKey) {
            await ensureReady()
            assertRole(actor, new Set(['CLINICAL_APPROVER']))
            const reason = cleanText(payload.reason, 3, 1000, 'CLINICAL_APPROVAL_REASON_REQUIRED')
            const expectedRevision = Number(payload.expectedRevision)
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw domainError('CLINICAL_APPROVAL_EXPECTED_REVISION_REQUIRED', 400)
            return withCommand('reject', { id, expectedRevision, reason }, actor, idempotencyKey, async (client, command) => {
                const rule = await readRule(client, id, true)
                if (!rule) throw domainError('CLINICAL_APPROVAL_NOT_FOUND', 404)
                assertUnitScope(actor, rule.unit_slug, { required: allowedUnitSlugs(actor) !== null })
                if (Number(rule.current_revision) !== expectedRevision || rule.current_status !== 'submitted') throw domainError('CLINICAL_APPROVAL_STATUS_CONFLICT', 409)
                const updated = await client.query(`update clinical_approval.rules set current_status = 'rejected', approver_id = $2,
                    approved_at = null, updated_at = now() where id = $1 and current_revision = $3 returning *`, [id, actorIdOf(actor), expectedRevision])
                const next = updated.rows[0]
                await event(client, next, 'rejected', actor, rule.current_status, reason, command.key)
                return { rule: mapRule(next), idempotent: false }
            })
        },

        async disable(id, payload = {}, actor, idempotencyKey) {
            await ensureReady()
            assertRole(actor, new Set(['CLINICAL_APPROVER', 'GESTOR', 'ADMIN']))
            const reason = cleanText(payload.reason || 'disabled by authorized operator', 3, 1000, 'CLINICAL_APPROVAL_REASON_REQUIRED')
            const expectedRevision = Number(payload.expectedRevision)
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw domainError('CLINICAL_APPROVAL_EXPECTED_REVISION_REQUIRED', 400)
            return withCommand('disable', { id, expectedRevision, reason }, actor, idempotencyKey, async (client, command) => {
                const rule = await readRule(client, id, true)
                if (!rule) throw domainError('CLINICAL_APPROVAL_NOT_FOUND', 404)
                assertUnitScope(actor, rule.unit_slug, { required: allowedUnitSlugs(actor) !== null })
                if (roleOf(actor) === 'GESTOR' && rule.author_id !== actorIdOf(actor)) throw domainError('CLINICAL_APPROVAL_FORBIDDEN', 403)
                if (Number(rule.current_revision) !== expectedRevision || rule.current_status === 'disabled') throw domainError('CLINICAL_APPROVAL_STATUS_CONFLICT', 409)
                const updated = await client.query(`update clinical_approval.rules set current_status = 'disabled', updated_at = now()
                    where id = $1 and current_revision = $2 returning *`, [id, expectedRevision])
                const next = updated.rows[0]
                await event(client, next, 'disabled', actor, rule.current_status, reason, command.key)
                return { rule: mapRule(next), idempotent: false }
            })
        },

        async expireDue(actor, idempotencyKey = `expiry-${new Date().toISOString().slice(0, 10)}`) {
            await ensureReady()
            assertRole(actor, new Set(['CLINICAL_APPROVER', 'SYSTEM']))
            return withCommand('expire_due', {}, actor, idempotencyKey, async (client, command) => {
                const result = await client.query(`select r.*, u.slug as unit_slug from clinical_approval.rules r
                    left join crm_atendimento.units u on u.id = r.unit_id
                    where r.current_status = 'approved' and r.expires_at is not null and r.expires_at <= current_date for update`)
                let expired = 0
                for (const row of result.rows) {
                    const allowed = allowedUnitSlugs(actor)
                    if (allowed !== null && !allowed.includes(row.unit_slug || '')) continue
                    const updated = await client.query(`update clinical_approval.rules set current_status = 'expired', updated_at = now()
                        where id = $1 and current_status = 'approved' returning *`, [row.id])
                    if (!updated.rows[0]) continue
                    await event(client, updated.rows[0], 'expired', actor, 'approved', 'approval expired', command.key)
                    expired += 1
                }
                return { expired, idempotent: false }
            })
        },

        async listApprovedForCommercial({ procedureNames = [], unitSlugs = null } = {}) {
            if (!(await tableReady(pgPool))) return { ready: false, cadences: [] }
            const names = Array.isArray(procedureNames) ? procedureNames.map(String).filter(Boolean) : []
            if (!names.length) return { ready: true, cadences: [] }
            const params = [names]
            let unitFilter = ''
            if (Array.isArray(unitSlugs)) {
                params.push(unitSlugs.map((item) => normalizeUnit(item).slug))
                unitFilter = `and u.slug = any($${params.length}::text[])`
            }
            try {
                const result = await pgPool.query(`select r.*, p.name as procedure_name, u.slug as unit_slug, u.name as unit_name
                    from clinical_approval.rules r join crm_atendimento.procedures p on p.id = r.procedure_id
                    left join crm_atendimento.units u on u.id = r.unit_id
                    where r.current_status = 'approved' and r.effective_from <= current_date
                      and (r.expires_at is null or r.expires_at > current_date)
                      and p.name = any($1::text[]) ${unitFilter}
                    order by p.name, u.name nulls first`, params)
                return { ready: true, cadences: result.rows.map(mapRule) }
            } catch {
                // A commercial read must never fall back to a stale or legacy
                // cadence when the independent clinical domain is unavailable.
                return { ready: false, cadences: [] }
            }
        },

        async close() {
            if (pgPool && typeof pgPool.end === 'function') await pgPool.end()
        },
    }
}

export const clinicalApprovalRuleStatuses = Object.freeze([...RULE_STATUSES])
export const clinicalApprovalTestHelpers = Object.freeze({ normalizeRuleInput, normalizeIdempotencyKey, requestHash, mapRule, allowedUnitSlugs })
