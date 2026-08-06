import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS,
    COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES,
    buildCommercialDataQualityObservations,
    createCommercialDataQualityStore,
    __testables,
} from '../commercialDataQualityStore.js'

test('builds only aggregate quality findings and preserves source freshness ages', () => {
    const observations = buildCommercialDataQualityObservations({
        core: {
            attendance_membership_gap: 3037,
            unclassified_sale_items: 3255,
            future_attendances: 1,
            identities_without_permission: 2779,
            contact_controls_unready: 1,
            app_registration_snapshot_residual: 3728,
            app_registration_current_snapshot_count: 534,
            app_registration_snapshot_available: true,
            app_registration_snapshot_verified: false,
        },
        reviewRows: [
            { finding_key: 'identity_review.name_merge_pending', observed_count: 189 },
            { finding_key: 'identity_review.lead_app_pending', observed_count: 2140 },
        ],
        freshness: { mirror_synced_age_hours: 602, latest_import_age_hours: 602 },
    })

    assert.equal(observations.find((item) => item.key === 'identity.attendance_membership_gap')?.observedCount, 3037)
    assert.equal(observations.find((item) => item.key === 'identity_review.name_merge_pending')?.observedCount, 189)
    assert.equal(observations.find((item) => item.key === 'identity_review.app_caixa_pending')?.observedCount, 0)
    const snapshotResidual = observations.find((item) => item.key === 'source.app_registration_snapshot_residual')
    assert.equal(snapshotResidual?.observedCount, 0)
    assert.deepEqual(snapshotResidual?.metrics, { currentSnapshotCount: 534, residualRegistrationCount: 0, snapshotVerified: false })
    const snapshotUnverified = observations.find((item) => item.key === 'source.app_registration_snapshot_unverified')
    assert.equal(snapshotUnverified?.observedCount, 1)
    assert.deepEqual(snapshotUnverified?.metrics, { currentSnapshotCount: 534, snapshotVerified: false })
    const freshness = observations.find((item) => item.key === 'source.local_mirror_stale')
    assert.equal(freshness?.observedCount, 1)
    assert.deepEqual(freshness?.metrics, {
        thresholdHours: COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS,
        mirrorSyncedAgeHours: 602,
        latestImportAgeHours: 602,
    })
    assert.equal(JSON.stringify(observations).match(/phone|email|evidence|source_id/i), null)
})

test('accepts a recent import checkpoint when the local mirror is absent', () => {
    const fresh = buildCommercialDataQualityObservations({ freshness: { latestImportAgeHours: 12 } })
        .find((item) => item.key === 'source.local_mirror_stale')
    assert.equal(fresh?.observedCount, 0)
    assert.deepEqual(fresh?.metrics, {
        thresholdHours: COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS,
        latestImportAgeHours: 12,
    })
    assert.doesNotMatch(COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.freshness, /backup_path|source_fingerprint|path/i)
})

test('treats absent or jointly stale source checkpoints as stale', () => {
    const missing = buildCommercialDataQualityObservations({ freshness: {} })
        .find((item) => item.key === 'source.local_mirror_stale')
    assert.equal(missing?.observedCount, 1)
    const stale = buildCommercialDataQualityObservations({ freshness: { mirrorSyncedAgeHours: 49, latestImportAgeHours: 49 } })
        .find((item) => item.key === 'source.local_mirror_stale')
    assert.equal(stale?.observedCount, 1)
    const mirrorFallback = buildCommercialDataQualityObservations({ freshness: { mirrorSyncedAgeHours: 12 } })
        .find((item) => item.key === 'source.local_mirror_stale')
    assert.equal(mirrorFallback?.observedCount, 0)
})

test('accepts a recent mirror checkpoint when the latest import is stale', () => {
    const freshness = buildCommercialDataQualityObservations({
        freshness: { mirrorSyncedAgeHours: 2, latestImportAgeHours: 49 },
    }).find((item) => item.key === 'source.local_mirror_stale')

    assert.equal(freshness?.observedCount, 0)
    assert.deepEqual(freshness?.metrics, {
        thresholdHours: COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS,
        mirrorSyncedAgeHours: 2,
        latestImportAgeHours: 49,
    })
})

test('requires the full enabled immutable contact ledger and ignores deleted attendance links', () => {
    const core = COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.core
    assert.match(core, /case when has_table_privilege\(current_user, 'crm_atendimento\.commercial_contact_permissions', 'SELECT'\)/)
    for (const table of [
        'commercial_contact_permissions',
        'commercial_contact_permission_events',
        'commercial_actions',
        'commercial_action_events',
        'commercial_policy_config',
    ]) {
        assert.match(core, new RegExp(`has_table_privilege\\(current_user, 'crm_atendimento\\.${table}', 'SELECT'\\)`))
    }
    assert.match(core, /commercial_contact_permission_events'[\s\S]*trace_id/)
    for (const { trigger, requiredBits } of [
        { trigger: 'commercial_contact_permission_events_immutable', requiredBits: [2, 8, 16] },
        { trigger: 'commercial_contact_permission_events_no_truncate', requiredBits: [2, 32] },
        { trigger: 'commercial_action_events_immutable', requiredBits: [2, 8, 16] },
        { trigger: 'commercial_action_events_no_truncate', requiredBits: [2, 32] },
    ]) {
        const start = core.indexOf(`tgname = '${trigger}'`)
        assert.ok(start >= 0)
        const guard = core.slice(start, core.indexOf(')) or', start))
        assert.match(guard, /tgenabled = 'O'/)
        assert.match(guard, /prevent_commercial_ledger_mutation/)
        for (const bit of requiredBits) assert.match(guard, new RegExp(`tgtype & ${bit}`))
    }
    assert.match(core, /attendance\.deleted_at is null/)
    assert.match(core, /latest_app_registration_run/)
    assert.match(core, /app_registration_snapshot_residual/)
    assert.match(core, /app_registration_snapshot_verified/)
    assert.doesNotMatch(core, /source_file|canonical_name|phone_keys|email_keys|cpf_keys/i)
})

test('starts a new SLA window when an observed finding recurs after clearing', () => {
    const recurrence = __testables.commercialObservationTransition({
        previousStatus: 'open', previousCount: 0, observedCount: 4,
    })
    assert.equal(recurrence.shouldStartObservationWindow, true)
    assert.equal(recurrence.shouldReopen, false)
    assert.equal(recurrence.eventType, 'detected')

    const reopen = __testables.commercialObservationTransition({
        previousStatus: 'resolved', previousCount: 0, observedCount: 4,
    })
    assert.equal(reopen.shouldStartObservationWindow, true)
    assert.equal(reopen.shouldReopen, true)
    assert.equal(reopen.eventType, 'reopened')
})

test('resolves an actionable finding when its positive observation clears', () => {
    for (const previousStatus of ['open', 'acknowledged', 'in_progress']) {
        const cleared = __testables.commercialObservationTransition({
            previousStatus, previousCount: 84, observedCount: 0,
        })
        assert.equal(cleared.shouldResolve, true)
        assert.equal(cleared.nextStatus, 'resolved')
        assert.equal(cleared.eventType, 'cleared')
        assert.equal(cleared.shouldRecord, true)
    }

    const suppressed = __testables.commercialObservationTransition({
        previousStatus: 'suppressed', previousCount: 84, observedCount: 0,
    })
    assert.equal(suppressed.shouldResolve, false)
    assert.equal(suppressed.nextStatus, 'suppressed')
})

test('automatically reopens a suppressed finding when it remains observed', () => {
    const reopen = __testables.commercialObservationTransition({
        previousStatus: 'suppressed', previousCount: 4, observedCount: 4,
    })

    assert.equal(reopen.shouldStartObservationWindow, true)
    assert.equal(reopen.shouldReopen, true)
    assert.equal(reopen.nextStatus, 'open')
    assert.equal(reopen.shouldRecord, true)
    assert.equal(reopen.eventType, 'reopened')
})

test('opens a registration residual only for an explicitly verified complete snapshot', () => {
    const observations = buildCommercialDataQualityObservations({
        core: {
            app_registration_snapshot_available: true,
            app_registration_snapshot_verified: true,
            app_registration_snapshot_residual: 4,
            app_registration_current_snapshot_count: 12,
        },
    })
    assert.equal(observations.find((item) => item.key === 'source.app_registration_snapshot_residual')?.observedCount, 4)
    assert.equal(observations.find((item) => item.key === 'source.app_registration_snapshot_unverified')?.observedCount, 0)
})

test('takes the refresh session lock before beginning its repeatable-read snapshot', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql) { calls.push(sql); return { rows: [] } },
        release() { released = true },
    }
    const pool = { async connect() { return client } }
    await __testables.withCommercialDataQualityRefreshTransaction(pool, async (lockedClient) => {
        await lockedClient.query('select source aggregate')
        return 'ok'
    })
    assert.match(calls[0], /pg_advisory_lock/)
    assert.equal(calls[1], 'begin isolation level repeatable read')
    assert.equal(calls[2], 'select source aggregate')
    assert.equal(calls[3], 'commit')
    assert.match(calls[4], /pg_advisory_unlock/)
    assert.equal(released, true)
})

test('reads aggregate observations serially inside one database transaction client', async () => {
    let activeQueries = 0
    let peakQueries = 0
    const calls = []
    const client = {
        async query(sql) {
            activeQueries += 1
            peakQueries = Math.max(peakQueries, activeQueries)
            calls.push(sql)
            await new Promise((resolve) => setImmediate(resolve))
            activeQueries -= 1
            if (sql.startsWith('select has_table_privilege(current_user')) {
                return { rows: [{ can_read_contact_permissions: true }] }
            }
            if (sql.includes('from crm_atendimento.canonical_clients')) {
                return { rows: [{ attendance_membership_gap: 0, unclassified_sale_items: 0, future_attendances: 0, identities_without_permission: 0, contact_controls_unready: 0 }] }
            }
            if (sql.includes("identity_review.name_merge_pending")) return { rows: [] }
            if (sql.includes('with mirror as')) return { rows: [{ mirror_synced_age_hours: 1, latest_import_age_hours: 2 }] }
            throw new Error('Unexpected aggregate quality query')
        },
    }

    const observations = await __testables.querySourceObservations(client)

    assert.equal(peakQueries, 1)
    assert.equal(calls.length, 4)
    assert.equal(observations.find((item) => item.key === 'source.local_mirror_stale')?.observedCount, 0)
})

test('avoids unauthorized contact rows and keeps the quality refresh fail-closed', async () => {
    const calls = []
    const client = {
        async query(sql) {
            calls.push(sql)
            if (sql.startsWith('select has_table_privilege(current_user')) {
                return { rows: [{ can_read_contact_permissions: false }] }
            }
            if (sql.includes('from crm_atendimento.canonical_clients')) {
                assert.doesNotMatch(sql, /from crm_atendimento\.commercial_contact_permissions permission/)
                return { rows: [{ attendance_membership_gap: 0, unclassified_sale_items: 0, future_attendances: 0, identities_without_permission: 0, contact_controls_unready: 1 }] }
            }
            if (sql.includes("identity_review.name_merge_pending")) return { rows: [] }
            if (sql.includes('with mirror as')) return { rows: [{ mirror_synced_age_hours: 1, latest_import_age_hours: 2 }] }
            throw new Error('Unexpected aggregate quality query')
        },
    }

    const observations = await __testables.querySourceObservations(client)

    assert.equal(calls.length, 4)
    assert.equal(observations.find((item) => item.key === 'commercial.contact_controls_unready')?.observedCount, 1)
})

test('fails closed for a unit-scoped GESTOR but retains the ADMIN global exception', () => {
    assert.doesNotThrow(() => __testables.assertCommercialQualityManager({ role: 'GESTOR' }))
    assert.throws(
        () => __testables.assertCommercialQualityManager({ role: 'GESTOR', allowedUnits: [] }),
        /COMMERCIAL_DATA_QUALITY_UNIT_SCOPE_UNSUPPORTED/,
    )
    assert.throws(
        () => __testables.assertCommercialQualityManager({ role: 'GESTOR', allowedUnits: ['novo-hamburgo'] }),
        /COMMERCIAL_DATA_QUALITY_UNIT_SCOPE_UNSUPPORTED/,
    )
    assert.doesNotThrow(() => __testables.assertCommercialQualityManager({ role: 'ADMIN', allowedUnits: [] }))
})

test('drops unexpected metrics and requires an optimistic revision for a finding mutation', () => {
    assert.deepEqual(__testables.sanitizeMetrics({
        thresholdHours: 48,
        mirrorSyncedAgeHours: 602,
        currentSnapshotCount: 534,
        residualRegistrationCount: 3728,
        snapshotVerified: false,
        phone: 'must-not-pass',
        sourcePath: '/private/source',
    }), { thresholdHours: 48, mirrorSyncedAgeHours: 602, currentSnapshotCount: 534, residualRegistrationCount: 3728, snapshotVerified: false })
    assert.throws(() => __testables.normalizeFindingPatch({ status: 'acknowledged' }), /COMMERCIAL_DATA_QUALITY_REVISION_REQUIRED/)
    assert.throws(() => __testables.normalizeFindingPatch({ expectedRevision: 1, status: 'invalid' }), /INVALID_COMMERCIAL_DATA_QUALITY_STATUS/)
    assert.throws(() => __testables.assertFindingId('client-name'), /INVALID_COMMERCIAL_DATA_QUALITY_FINDING/)
})

test('lists sanitized findings and global queue metrics for a GESTOR', async () => {
    const findingId = '2b1e13be-2f3d-4a73-9b1b-4e02c54f1101'
    const availability = {
        findings: 'crm_atendimento.commercial_data_quality_findings',
        events: 'crm_atendimento.commercial_data_quality_finding_events',
        events_immutable: true,
        events_no_truncate: true,
    }
    const pool = {
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_data_quality_findings')")) return { rows: [availability] }
            if (sql.includes('where id = $1 and rolled_back_at is null')) return { rows: [{ id: '20260805_commercial_data_quality_queue_v1' }] }
            if (sql.includes('order by (observed_count > 0) desc')) {
                return { rows: [{
                    id: findingId,
                    finding_key: 'source.local_mirror_stale', severity: 'high', status: 'open', owner: '', observed_count: 1,
                    metrics: { thresholdHours: 48, mirrorSyncedAgeHours: 602, latestImportAgeHours: 602, phone: 'redact-me' },
                    sla_due_at: '2026-08-06T00:00:00.000Z', first_detected_at: '2026-08-05T00:00:00.000Z',
                    last_observed_at: '2026-08-05T00:00:00.000Z', last_evaluated_at: '2026-08-05T00:00:00.000Z',
                    acknowledged_at: null, resolved_at: null, revision: 1, updated_at: '2026-08-05T00:00:00.000Z',
                }] }
            }
            if (sql.includes('count(*) filter (where observed_count > 0)')) return { rows: [{ findings: 1, current_findings: 1, overdue: 0, unassigned: 1 }] }
            if (sql.includes('select severity as key')) return { rows: [{ key: 'high', count: 1 }] }
            if (sql.includes('select status as key')) return { rows: [{ key: 'open', count: 1 }] }
            if (sql.includes('select count(*)::int as count')) return { rows: [{ count: 1 }] }
            if (sql.includes("where finding_key = 'source.local_mirror_stale'")) return { rows: [{ metrics: { thresholdHours: 48, mirrorSyncedAgeHours: 602, sourcePath: '/private' } }] }
            throw new Error(`Unexpected SQL: ${sql}`)
        },
    }
    const store = createCommercialDataQualityStore({ pool })
    const result = await store.list({}, { id: 'gestor-1', role: 'GESTOR' })

    assert.equal(result.total, 1)
    assert.equal(result.metrics.currentFindings, 1)
    assert.equal(result.metrics.unassigned, 1)
    assert.deepEqual(result.sourceFreshness, { thresholdHours: 48, mirrorSyncedAgeHours: 602 })
    assert.deepEqual(result.findings[0].metrics, {
        thresholdHours: 48,
        mirrorSyncedAgeHours: 602,
        latestImportAgeHours: 602,
    })
    assert.equal(JSON.stringify(result).match(/redact-me|sourcePath|phone/i), null)
})

test('fails closed when an event trigger does not prove its required immutable or truncate semantics', async () => {
    for (const availability of [
        { events_immutable: false, events_no_truncate: true },
        { events_immutable: true, events_no_truncate: false },
    ]) {
        const pool = {
            async query(sql) {
                if (sql.includes("to_regclass('crm_atendimento.commercial_data_quality_findings')")) {
                    assert.match(sql, /prevent_commercial_data_quality_event_mutation/)
                    assert.match(sql, /tgtype & 2/)
                    assert.match(sql, /tgtype & 8/)
                    assert.match(sql, /tgtype & 16/)
                    assert.match(sql, /tgtype & 32/)
                    return { rows: [{
                        findings: 'crm_atendimento.commercial_data_quality_findings',
                        events: 'crm_atendimento.commercial_data_quality_finding_events',
                        ...availability,
                    }] }
                }
                throw new Error(`Unexpected SQL: ${sql}`)
            },
        }

        const store = createCommercialDataQualityStore({ pool })
        await assert.rejects(
            () => store.list({}, { id: 'quality-operator', role: 'ADMIN' }),
            (error) => error?.code === 'COMMERCIAL_DATA_QUALITY_QUEUE_NOT_READY',
        )
    }
})

test('updates a cleared finding with its expected revision inside an audited transaction', async () => {
    const findingId = '36ecf9bb-8e2a-4696-9dd1-c7b9c6f72831'
    const availability = {
        findings: 'crm_atendimento.commercial_data_quality_findings',
        events: 'crm_atendimento.commercial_data_quality_finding_events',
        events_immutable: true,
        events_no_truncate: true,
    }
    const current = {
        id: findingId, finding_key: 'identity.attendance_membership_gap', severity: 'critical', status: 'open',
        owner: null, observed_count: 0, metrics: {}, sla_due_at: null, first_detected_at: null,
        last_observed_at: null, last_evaluated_at: '2026-08-05T00:00:00.000Z', acknowledged_at: null,
        resolved_at: null, revision: 1, updated_at: '2026-08-05T00:00:00.000Z',
    }
    const transactionCalls = []
    let released = false
    const client = {
        async query(sql) {
            transactionCalls.push(sql)
            if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] }
            if (sql.includes('where id = $1 for update')) return { rows: [current] }
            if (sql.includes('update crm_atendimento.commercial_data_quality_findings')) {
                return { rows: [{ ...current, status: 'resolved', resolved_at: '2026-08-05T00:01:00.000Z', revision: 2 }] }
            }
            if (sql.includes('insert into crm_atendimento.commercial_data_quality_finding_events')) return { rows: [] }
            throw new Error(`Unexpected transaction SQL: ${sql}`)
        },
        release() { released = true },
    }
    const pool = {
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_data_quality_findings')")) return { rows: [availability] }
            if (sql.includes('where id = $1 and rolled_back_at is null')) return { rows: [{ id: '20260805_commercial_data_quality_queue_v1' }] }
            throw new Error(`Unexpected pool SQL: ${sql}`)
        },
        async connect() { return client },
    }

    const store = createCommercialDataQualityStore({ pool })
    const result = await store.update(findingId, { expectedRevision: 1, status: 'resolved' }, { id: 'quality-operator', role: 'ADMIN' })

    assert.equal(result.finding.status, 'resolved')
    assert.equal(result.finding.revision, 2)
    assert.equal(transactionCalls[0], 'begin')
    assert.equal(transactionCalls.some((sql) => sql.includes('insert into crm_atendimento.commercial_data_quality_finding_events')), true)
    assert.equal(transactionCalls.at(-1), 'commit')
    assert.equal(released, true)
})

test('refuses to suppress an actively observed finding', async () => {
    const findingId = '4edb9dbe-2f3d-4a73-9b1b-4e02c54f1101'
    const availability = {
        findings: 'crm_atendimento.commercial_data_quality_findings',
        events: 'crm_atendimento.commercial_data_quality_finding_events',
        events_immutable: true,
        events_no_truncate: true,
    }
    const current = {
        id: findingId, finding_key: 'sales.unclassified_items', severity: 'high', status: 'open',
        owner: null, observed_count: 3, metrics: {}, sla_due_at: '2026-08-06T00:00:00.000Z',
        first_detected_at: '2026-08-05T00:00:00.000Z', last_observed_at: '2026-08-05T00:00:00.000Z',
        last_evaluated_at: '2026-08-05T00:00:00.000Z', acknowledged_at: null, resolved_at: null,
        revision: 1, updated_at: '2026-08-05T00:00:00.000Z',
    }
    const transactionCalls = []
    let released = false
    const client = {
        async query(sql) {
            transactionCalls.push(sql)
            if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] }
            if (sql.includes('where id = $1 for update')) return { rows: [current] }
            throw new Error(`Unexpected transaction SQL: ${sql}`)
        },
        release() { released = true },
    }
    const pool = {
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_data_quality_findings')")) return { rows: [availability] }
            if (sql.includes('where id = $1 and rolled_back_at is null')) return { rows: [{ id: '20260805_commercial_data_quality_queue_v1' }] }
            throw new Error(`Unexpected pool SQL: ${sql}`)
        },
        async connect() { return client },
    }

    const store = createCommercialDataQualityStore({ pool })
    await assert.rejects(
        () => store.update(findingId, { expectedRevision: 1, status: 'suppressed' }, { id: 'quality-operator', role: 'ADMIN' }),
        (error) => error?.code === 'COMMERCIAL_DATA_QUALITY_SUPPRESSION_REQUIRES_CLEARED_FINDING',
    )

    assert.equal(transactionCalls.some((sql) => sql.includes('update crm_atendimento.commercial_data_quality_findings')), false)
    assert.equal(transactionCalls.some((sql) => sql.includes('insert into crm_atendimento.commercial_data_quality_finding_events')), false)
    assert.equal(transactionCalls.at(-1), 'rollback')
    assert.equal(released, true)
})
