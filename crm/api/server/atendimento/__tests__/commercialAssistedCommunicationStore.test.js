import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    __testables,
    commercialAssistedReadiness,
    createCommercialAssistedCommunicationStore,
} from '../commercialAssistedCommunicationStore.js'

const identityId = '11111111-1111-4111-8111-111111111111'
const attemptId = '22222222-2222-4222-8222-222222222222'
const manager = Object.freeze({ actorSubject: 'crm:gestor-fixture', role: 'GESTOR', allowedUnits: ['centro'] })
const hmacKey = () => randomBytes(32).toString('base64url')

function availableRow() {
    return {
        offer_snapshots: true, templates: true, attempts: true, events: true, webhook_receipts: true,
        control_mutations: true, handoffs: true, emergency_controls: true, registry: true,
        permissions_read: true, sources_read: true, harmonia_read: true, actions_read: true, offers_read: true,
        canary_read: true, identity_members_read: true, offer_dependencies_read: true, phone_sources_read: true,
    }
}

function integrityRow() {
    return {
        snapshots_immutable: true, snapshots_no_truncate: true, templates_immutable: true, templates_no_truncate: true,
        attempts_immutable: true, attempts_no_truncate: true, events_immutable: true, events_no_truncate: true,
        receipts_immutable: true, receipts_no_truncate: true, controls_immutable: true, controls_no_truncate: true,
        action_context_guard: true,
    }
}

function readinessQuery(sql) {
    if (sql.includes('commercial_assisted_action_context_immutable')) return { rows: [integrityRow()] }
    if (sql.includes("to_regclass('crm_atendimento.commercial_assisted_offer_snapshots')")) return { rows: [availableRow()] }
    if (sql.includes('from crm_atendimento.schema_migrations')) {
        return { rows: [
            { id: '20260807_commercial_assisted_whatsapp_v2' },
            { id: '20260807_commercial_canary_selector_v2' },
            { id: '20260807_clientes_source_operations_v2' },
        ] }
    }
    throw new Error(`unexpected readiness query: ${sql}`)
}

test('RBAC requires an opaque actorSubject, preserves unit scope and readiness fails closed on a missing integrity guard', async () => {
    assert.deepEqual(__testables.unitScope(manager), ['centro'])
    assert.throws(() => __testables.actorRef(hmacKey(), { id: 'legacy-manager', role: 'GESTOR' }), /ACTOR_IDENTITY_REQUIRED/)
    const store = createCommercialAssistedCommunicationStore({ pool: { query: async (sql) => readinessQuery(sql) } })
    const readiness = await store.readiness(manager)
    assert.equal(readiness.ready, true)
    assert.equal(readiness.safety.providerSend, false)
    await assert.rejects(() => store.readiness({ role: 'GESTOR', allowedUnits: ['centro'] }), /ACTOR_IDENTITY_REQUIRED/)

    const missing = await commercialAssistedReadiness({
        async query(sql) {
            if (sql.includes('commercial_assisted_action_context_immutable')) return { rows: [{ ...integrityRow(), action_context_guard: false }] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_assisted_offer_snapshots')")) return { rows: [availableRow()] }
            if (sql.includes('from crm_atendimento.schema_migrations')) return { rows: [{ id: '20260807_commercial_assisted_whatsapp_v2' }, { id: '20260807_commercial_canary_selector_v2' }, { id: '20260807_clientes_source_operations_v2' }] }
            throw new Error(`unexpected query: ${sql}`)
        },
    })
    assert.equal(missing.ready, false)
    assert.equal(missing.appendOnlyReady, false)
})

test('source proof acquires every source transaction lock before rechecking freshness and fails closed for incomplete or busy sources', async () => {
    const calls = []
    const now = new Date().toISOString()
    const healthy = await __testables.lockAndReadSourceHealth({
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] }
            if (sql.includes('clientes_source_operation_checkpoints')) return { rows: __testables.REQUIRED_SOURCE_IDS.map((source_id) => ({ source_id, last_status: 'complete', validated_snapshot_complete: true, reconciliation_required: false, validated_at: now })) }
            throw new Error(`unexpected source query: ${sql}`)
        },
    })
    assert.equal(healthy.status, 'healthy')
    assert.equal(calls.filter((call) => call.sql.includes('pg_try_advisory_xact_lock')).length, __testables.REQUIRED_SOURCE_IDS.length)
    assert.ok(calls.findIndex((call) => call.sql.includes('clientes_source_operation_checkpoints')) > calls.map((call) => call.sql).findLastIndex((sql) => sql.includes('pg_try_advisory_xact_lock')))

    const incomplete = await __testables.lockAndReadSourceHealth({
        async query(sql) {
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] }
            return { rows: __testables.REQUIRED_SOURCE_IDS.slice(1).map((source_id) => ({ source_id, last_status: 'complete', validated_snapshot_complete: true, reconciliation_required: false, validated_at: now })) }
        },
    })
    assert.deepEqual(incomplete, { status: 'stale', snapshotComplete: false, observedSources: __testables.REQUIRED_SOURCE_IDS.length - 1 })
    await assert.rejects(() => __testables.lockAndReadSourceHealth({ async query() { return { rows: [{ acquired: false }] } } }), /COMMERCIAL_ASSISTED_SOURCE_OPERATION_BUSY/)
})

test('raw signed webhook replay is atomically deduplicated before any STOP/permission write', async () => {
    const secret = hmacKey()
    const timestamp = String(Date.now())
    const rawBody = Buffer.from(JSON.stringify({ eventId: 'fixture-event-0001', attemptId, eventType: 'stop', occurredAt: '2026-08-07T12:00:00.000Z' }), 'utf8')
    const signature = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody])).digest('base64url')
    const calls = []
    let receiptValues = null
    const client = {
        release() {},
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (['begin', 'commit', 'rollback'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes('insert into crm_atendimento.commercial_assisted_webhook_receipts')) {
                receiptValues = values
                return { rows: [] }
            }
            if (sql.includes('from crm_atendimento.commercial_assisted_webhook_receipts')) {
                return { rows: [{ attempt_id: attemptId, event_type: 'stop', event_payload_hash: receiptValues[3] }] }
            }
            throw new Error(`unexpected transactional query: ${sql}`)
        },
    }
    const store = createCommercialAssistedCommunicationStore({
        pool: { query: async (sql) => readinessQuery(sql), connect: async () => client }, auditHmacKey: secret,
    })
    const result = await store.processWebhook({ rawBody, timestamp, signature })
    assert.equal(result.deduplicated, true)
    assert.equal(calls.some((call) => /commercial_contact_permissions/i.test(call.sql)), false)
    assert.equal(calls.some((call) => /event_payload_hash/i.test(call.sql)), true)
})

test('store contains explicit unit/canary/consent, snapshot, single-use handoff, emergency-off and monotonic STOP guards', async () => {
    const source = await readFile(fileURLToPath(new URL('../commercialAssistedCommunicationStore.js', import.meta.url)), 'utf8')
    assert.match(source, /COMMERCIAL_UNIT_FORBIDDEN/)
    assert.match(source, /COMMERCIAL_ASSISTED_CANARY_REQUIRED/)
    assert.match(source, /COMMERCIAL_ASSISTED_PERMISSION_REQUIRED/)
    assert.match(source, /lockContactPhone\(client, phone\)[\s\S]*assertNoOptOut/)
    assert.match(source, /for share of offer_snapshot/)
    assert.match(source, /COMMERCIAL_ASSISTED_HANDOFF_UNAVAILABLE/)
    assert.match(source, /state='revealed'/)
    assert.match(source, /COMMERCIAL_ASSISTED_EMERGENCY_OFF/)
    assert.match(source, /COMMERCIAL_ASSISTED_WEBHOOK_TRANSITION_INVALID/)
    assert.match(source, /COMMERCIAL_ASSISTED_WEBHOOK_REPLAY_CONFLICT/)
    assert.doesNotMatch(source, /wa[.]me|providerSend:\s*true|externalDispatch:\s*true|\bfetch\s*\(/i)
})
