import assert from 'node:assert/strict'
import test from 'node:test'

import {
    COMMERCIAL_OPERATIONS_SAFETY_FLAGS,
    __testables,
    commercialOperationsReadiness,
    createCommercialOperationsStore,
} from '../commercialOperationsStore.js'

const actor = Object.freeze({
    id: 'gestor.crm',
    role: 'GESTOR',
    allowedUnits: ['centro'],
    allowedUnitsDeclared: true,
})

function readyAvailability() {
    return {
        actions: true,
        action_events: true,
        mutations: true,
        campaigns: true,
        members: true,
        campaign_events: true,
        absences: true,
        action_event_immutable: true,
        action_event_no_truncate: true,
        mutation_immutable: true,
        mutation_no_truncate: true,
        campaign_event_immutable: true,
        campaign_event_no_truncate: true,
        migration_registry: true,
    }
}

function experimentGuardAvailability({ ready = true } = {}) {
    return {
        assignments: ready,
        experiments: ready,
        assignments_read: ready,
        experiments_read: ready,
        migration_ready: ready,
    }
}

test('fails closed for a manager without an explicit unit claim and retains hard-disabled flags', () => {
    assert.deepEqual(__testables.commercialOperationsUnitScope({ id: 'gestor.crm', role: 'GESTOR' }), [])
    assert.throws(() => __testables.requestedUnitScope({ id: 'gestor.crm', role: 'GESTOR' }, 'centro'), /COMMERCIAL_UNIT_FORBIDDEN/)
    assert.deepEqual(COMMERCIAL_OPERATIONS_SAFETY_FLAGS, {
        commercialContactWritesEnabled: false,
        messagesEnabled: false,
        automationEnabled: false,
        consentWritesEnabled: false,
        outboundDispatchEnabled: false,
    })
})

test('requires an opaque actor subject before deriving operational audit or idempotency identity', () => {
    assert.equal(__testables.actorPrincipal({ subject: 'crm:gestor-1', id: 'legacy-ignored' }), 'crm:gestor-1')
    assert.equal(__testables.actorPrincipal({ id: 'gestor.crm' }), 'gestor.crm')
    assert.throws(
        () => __testables.actorPrincipal({ username: 'operator@example.test', email: 'operator@example.test' }),
        (error) => error?.code === 'ACTOR_IDENTITY_REQUIRED' && error?.statusCode === 401,
    )
})

test('treats every required consent/block and identity source as stale until a complete validated checkpoint exists', async () => {
    assert.equal(__testables.COMMERCIAL_REQUIRED_SOURCE_IDS.includes('consent.harmonia_opt_outs'), true)
    assert.equal(__testables.COMMERCIAL_REQUIRED_SOURCE_IDS.includes('blocks.commercial_permissions'), true)
    assert.equal(__testables.COMMERCIAL_REQUIRED_SOURCE_IDS.includes('identity.global_graph'), true)
    const calls = []
    const healthy = await __testables.sourceStale({
        async query(sql, values) {
            calls.push({ sql, values })
            return { rows: [{ checkpoint_count: __testables.COMMERCIAL_REQUIRED_SOURCE_IDS.length, stale: false }] }
        },
    }, { sourceCheckpoints: true })
    assert.equal(healthy, false)
    assert.deepEqual(calls[0].values, [__testables.COMMERCIAL_REQUIRED_SOURCE_IDS])
    const missing = await __testables.sourceStale({
        async query() { return { rows: [{ checkpoint_count: __testables.COMMERCIAL_REQUIRED_SOURCE_IDS.length - 1, stale: false }] } },
    }, { sourceCheckpoints: true })
    assert.equal(missing, true)
})

test('fails closed when the analytics experiment guard is absent and permits only an empty active holdout result', async () => {
    const unitId = '33333333-3333-4333-8333-333333333333'
    const identityId = '22222222-2222-4222-8222-222222222222'
    await assert.rejects(() => __testables.assertNoActiveExperimentHoldout({
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_experiment_assignments')")) {
                return { rows: [experimentGuardAvailability({ ready: false })] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }, { unitId, identityIds: [identityId] }), /COMMERCIAL_EXPERIMENT_GUARD_NOT_READY/)

    const calls = []
    await __testables.assertNoActiveExperimentHoldout({
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (sql.includes("to_regclass('crm_atendimento.commercial_experiment_assignments')")) {
                return { rows: [experimentGuardAvailability()] }
            }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes('from crm_atendimento.commercial_experiment_assignments assignment')) return { rows: [] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }, { unitId, identityIds: [identityId] })
    assert.equal(calls.some((call) => call.sql.includes('from crm_atendimento.commercial_experiment_assignments assignment')), true)
    const holdoutQuery = calls.find((call) => call.sql.includes('from crm_atendimento.commercial_experiment_assignments assignment'))
    assert.equal(holdoutQuery.values[2].join(','), 'control,excluded')
    assert.match(holdoutQuery.sql, /experiment\.state='active'/)
    assert.match(holdoutQuery.sql, /experiment\.starts_at <= now\(\)/)
    assert.match(holdoutQuery.sql, /experiment\.ends_at > now\(\)/)
})

test('reports migration readiness only when relations and append-only triggers are present', async () => {
    const queries = []
    const db = {
        async query(sql, values = []) {
            queries.push({ sql, values })
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    const readiness = await commercialOperationsReadiness(db)
    assert.equal(readiness.ready, true)
    assert.equal(readiness.appendOnlyReady, true)
    assert.equal(readiness.safety.automationEnabled, false)
    assert.equal(queries.length, 2)
    assert.equal(queries.some(({ sql }) => sql.includes('from crm_atendimento.schema_migrations')), true)

    const incomplete = await commercialOperationsReadiness({
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [{ ...readyAvailability(), campaign_event_no_truncate: false }] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    })
    assert.equal(incomplete.ready, false)
    assert.equal(incomplete.appendOnlyReady, false)
})

test('serializes idempotency before reading the ledger and never passes raw reason or key to SQL', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'a'.repeat(32)
    const calls = []
    const client = {
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) {
                return { rows: [{ request_fingerprint: values[0] ? calls.find((call) => call.sql.includes('pg_advisory_xact_lock'))?.values[0] : '', response: { operation: 'replayed' } }] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        // Obtain the exact HMAC request fingerprint through the same public
        // normalizer, then replay it from the append-only mutation ledger.
        const context = __testables.mutationInput(actor, 'campaign_update', {
            idempotencyKey: 'campaign:opaque-key-123', reason: 'Ajuste operacional seguro', expectedRevision: 1,
        }, { campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'paused' })
        client.query = async (sql, values = []) => {
            calls.push({ sql, values })
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) return { rows: [{ request_fingerprint: context.requestFingerprint, response: { operation: 'replayed' } }] }
            throw new Error(`unexpected sql: ${sql}`)
        }
        const replay = await __testables.runCommercialOperationMutation(client, {
            actor,
            operation: 'campaign_update',
            payload: { idempotencyKey: 'campaign:opaque-key-123', reason: 'Ajuste operacional seguro', expectedRevision: 1 },
            fingerprintPayload: { campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'paused' },
            execute: async () => { throw new Error('a replay must not execute mutable work') },
        })
        assert.equal(replay.idempotent, true)
        assert.equal(replay.operation, 'replayed')
        const advisory = calls.findIndex((call) => call.sql.includes('pg_advisory_xact_lock'))
        const ledger = calls.findIndex((call) => call.sql.includes('from crm_atendimento.commercial_operation_mutations'))
        assert.ok(advisory >= 0 && advisory < ledger)
        const serialized = JSON.stringify(calls)
        assert.doesNotMatch(serialized, /campaign:opaque-key-123|Ajuste operacional seguro/)
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})

test('projects rebalance and Customer 360 data without raw owner or technical event identifiers', async () => {
    const actionId = '11111111-1111-4111-8111-111111111111'
    const plan = __testables.projectRebalancePlan([
        { id: actionId, owner: '5511999999999', status: 'open', revision: 3, unit_slug: 'centro', absent_owner: true },
    ], { 'gestor.crm': 4 })
    assert.deepEqual(plan, [{ actionId, fromOwner: null, toOwner: 'gestor.crm', expectedRevision: 3, unit: 'centro' }])
    const event = __testables.projectTimeline({
        id: 'internal-event-id', type: 'action', occurredAt: '2026-08-07T00:00:00.000Z', source: 'CRM ação', unit: 'centro',
        actor: 'customer@example.com', trace_id: '33333333-3333-4333-8333-333333333333', context: { phone: '5511999999999' },
    })
    assert.doesNotMatch(event.id, /internal-event-id/)
    assert.equal(event.actor, null)
    assert.equal(event.correlationId, '33333333-3333-4333-8333-333333333333')
    assert.deepEqual(Object.keys(event).sort(), ['actor', 'campaignId', 'consentReview', 'correlationId', 'id', 'occurredAt', 'offerId', 'source', 'status', 'type', 'unit'])
})

test('exposes an injected readiness-only store without opening a mutation path', async () => {
    const pool = {
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_experiment_assignments')")) return { rows: [experimentGuardAvailability({ ready: false })] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    const store = createCommercialOperationsStore({ pool })
    const readiness = await store.readiness(actor)
    assert.equal(readiness.ready, true)
    assert.equal(readiness.safety.commercialContactWritesEnabled, false)
    assert.equal(readiness.experimentCrossoverGuard.ready, false)
})

test('records an opt-out request as an outcome without writing consent or dispatching contact', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'b'.repeat(32)
    const actionId = '11111111-1111-4111-8111-111111111111'
    const identityId = '22222222-2222-4222-8222-222222222222'
    const calls = []
    const client = {
        release() {},
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) return { rows: [] }
            if (sql.includes('where action.id=$1 for update of action')) {
                return { rows: [{ id: actionId, identity_id: identityId, revision: 2, status: 'contacted', owner: 'gestor.crm', unit_slug: 'centro' }] }
            }
            if (sql.includes('update crm_atendimento.commercial_actions')) return { rows: [] }
            if (sql.includes('insert into crm_atendimento.commercial_action_events')) return { rows: [] }
            if (sql.includes('from crm_atendimento.commercial_campaign_members') && sql.includes('where action_id=$1 for update')) return { rows: [] }
            if (sql.includes('has_table_privilege')) return { rows: [{
                permissions: false, source_checkpoints: false, identity_members: false, review_decisions: false,
                attendance_caixa_links: false, app_attendance_links: false, app_caixa_links: false,
                lead_app_links: false, lead_caixa_links: false,
            }] }
            if (sql.includes('select action.id::text,action.segment_key')) return { rows: [{
                id: actionId, segment_key: 'synthetic', action_type: 'follow_up', status: 'responded', owner: 'gestor.crm',
                due_date: '2026-08-08', revision: 3, outcome_code: 'opt_out_requested', created_at: '2026-08-07T00:00:00.000Z',
                updated_at: '2026-08-07T00:01:00.000Z', unit_slug: 'centro', permission_status: 'review_required',
                permission_expires_at: null, source_stale: true, identity_in_review: true,
            }] }
            if (sql.includes('insert into crm_atendimento.commercial_operation_mutations')) return { rows: [] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        const store = createCommercialOperationsStore({ pool: { connect: async () => client } })
        const result = await store.recordOutcome(actionId, {
            idempotencyKey: 'action:synthetic-outcome-1', expectedRevision: 2,
            reason: 'Solicitação sintética de opt-out', outcomeCode: 'opt_out_requested',
        }, actor)
        assert.equal(result.requiresSeparateConsentWorkflow, true)
        assert.equal(result.action.outcomeCode, 'opt_out_requested')
        assert.equal(result.safety.messagesEnabled, false)
        assert.equal(calls.some((call) => /(?:insert into|update)\s+crm_atendimento\.commercial_contact_permissions/i.test(call.sql)), false)
        assert.equal(calls.some((call) => /harmonia|dispatch|webhook/i.test(call.sql)), false)
        assert.equal(calls.find((call) => call.sql.includes('update crm_atendimento.commercial_actions')).values[2], 'opt_out_requested')
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})

test('rejects a stale optimistic revision before an action reassignment can write evidence', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'c'.repeat(32)
    const actionId = '11111111-1111-4111-8111-111111111111'
    const calls = []
    const client = {
        release() {},
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) return { rows: [] }
            if (sql.includes('where action.id=$1 for update of action')) {
                return { rows: [{ id: actionId, identity_id: '22222222-2222-4222-8222-222222222222', revision: 3, status: 'open', owner: 'gestor.crm', unit_slug: 'centro' }] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        const store = createCommercialOperationsStore({ pool: { connect: async () => client } })
        await assert.rejects(() => store.reassignAction(actionId, {
            idempotencyKey: 'action:synthetic-reassign-1', expectedRevision: 2,
            reason: 'Redistribuição sintética', owner: 'gestor.backup',
        }, actor), /COMMERCIAL_ACTION_CONFLICT/)
        assert.equal(calls.some((call) => call.sql.includes('update crm_atendimento.commercial_actions')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_action_events')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_operation_mutations')), false)
        assert.equal(calls.at(-1).sql, 'rollback')
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})

test('rejects campaign creation when an active experiment has the identity in control or excluded', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'd'.repeat(32)
    const identityId = '22222222-2222-4222-8222-222222222222'
    const unitId = '33333333-3333-4333-8333-333333333333'
    const calls = []
    const client = {
        release() {},
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_experiment_assignments')")) return { rows: [experimentGuardAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) return { rows: [] }
            if (sql.includes('select id::text,slug from crm_atendimento.units where slug=$1')) return { rows: [{ id: unitId, slug: 'centro' }] }
            if (sql.includes('from crm_atendimento.commercial_experiment_assignments assignment')) {
                return { rows: [{ identity_id: identityId, variant: 'control' }] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        const store = createCommercialOperationsStore({ pool: { connect: async () => client } })
        await assert.rejects(() => store.createCampaign({
            idempotencyKey: 'campaign:synthetic-holdout-1', reason: 'Coorte sintética de experimento',
            name: 'Retorno sintético', segmentKey: 'return', segmentVersion: 'v1', unit: 'centro', owner: 'gestor.crm',
            filters: { status: ['open'] }, identityIds: [identityId], cutoffAt: '2026-08-07T12:00:00.000Z',
            assignmentWindowStart: '2026-08-08T00:00:00.000Z', assignmentWindowEnd: '2026-08-15T00:00:00.000Z', controlGroupPercent: 20,
        }, actor), /COMMERCIAL_EXPERIMENT_HOLDOUT_ACTIVE/)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_campaigns')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_campaign_members')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_operation_mutations')), false)
        assert.equal(calls.at(-1).sql, 'rollback')
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})

test('rejects action reassignment before action, campaign or ledger writes for an active experiment holdout', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'e'.repeat(32)
    const actionId = '11111111-1111-4111-8111-111111111111'
    const identityId = '22222222-2222-4222-8222-222222222222'
    const unitId = '33333333-3333-4333-8333-333333333333'
    const calls = []
    const client = {
        release() {},
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_actions')")) return { rows: [readyAvailability()] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_experiment_assignments')")) return { rows: [experimentGuardAvailability()] }
            if (sql.includes('where id=$1 and rolled_back_at is null')) return { rows: [{ id: '20260807_commercial_operations_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_operation_mutations')) return { rows: [] }
            if (sql.includes('where action.id=$1 for update of action')) {
                return { rows: [{ id: actionId, identity_id: identityId, unit_id: unitId, revision: 2, status: 'open', owner: 'gestor.crm', unit_slug: 'centro' }] }
            }
            if (sql.includes('from crm_atendimento.commercial_experiment_assignments assignment')) {
                return { rows: [{ identity_id: identityId, variant: 'excluded' }] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        const store = createCommercialOperationsStore({ pool: { connect: async () => client } })
        await assert.rejects(() => store.reassignAction(actionId, {
            idempotencyKey: 'action:synthetic-holdout-1', expectedRevision: 2,
            reason: 'Redistribuição sintética bloqueada', owner: 'gestor.backup',
        }, actor), /COMMERCIAL_EXPERIMENT_HOLDOUT_ACTIVE/)
        assert.equal(calls.some((call) => call.sql.includes('update crm_atendimento.commercial_actions')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_action_events')), false)
        assert.equal(calls.some((call) => call.sql.includes('update crm_atendimento.commercial_campaign_members')), false)
        assert.equal(calls.some((call) => call.sql.includes('insert into crm_atendimento.commercial_operation_mutations')), false)
        assert.equal(calls.at(-1).sql, 'rollback')
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})
