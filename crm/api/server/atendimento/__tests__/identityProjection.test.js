import test from 'node:test'
import assert from 'node:assert/strict'
import {
    assertIdentityProjectionCanBeMaterialized,
    buildCanonicalClientAliasLinks,
    buildPersistedConfirmedIdentityComponents,
    createCanonicalClientAliasResolver,
    guardAutoConfirmedIdentityLinkProposals,
    preserveCanonicalAliasEquivalentLinkTargets,
    recordIdentityProjectionMaterialization,
} from '../identityProjection.js'

test('keeps all persisted source types in the shared confirmed projection', () => {
    const components = buildPersistedConfirmedIdentityComponents({
        registrations: [{ id: 'app-1', name: 'Cliente App' }],
        leadProfiles: [{ id: 'lead-1', name: 'Lead' }],
        leadProfileRegistrationLinks: [{ profileId: 'lead-1', registrationId: 'app-1', status: 'confirmed' }],
    })

    assert.deepEqual(components[0].members.map((member) => `${member.sourceType}:${member.sourceId}`), [
        'app_registration:app-1',
        'lead_profile:lead-1',
    ])
})

test('keeps a retired canonical S and survivor T as physical members of one projection', () => {
    const components = buildPersistedConfirmedIdentityComponents({
        canonicalClients: [
            { id: 'canonical-s', name: 'Nome anterior', mergedIntoId: 'canonical-t' },
            { id: 'canonical-t', name: 'Nome sobrevivente' },
        ],
        caixaCustomers: [{ id: 'cash-1', name: 'Cliente Caixa' }],
        attendanceCaixaLinks: [{ attendanceClientId: 'canonical-s', caixaCustomerId: 'cash-1', status: 'confirmed' }],
    })

    assert.equal(components.length, 1)
    assert.equal(components[0].preferredName, 'Nome sobrevivente')
    assert.deepEqual(components[0].members.map((member) => `${member.sourceType}:${member.sourceId}`), [
        'attendance_client:canonical-s',
        'attendance_client:canonical-t',
        'caixa_customer:cash-1',
    ])
})

test('preserves an existing physical canonical link when a proposal resolves to its survivor', () => {
    const aliases = buildCanonicalClientAliasLinks({
        canonicalClients: [{ id: 'canonical-s', mergedIntoId: 'canonical-t' }, { id: 'canonical-t' }],
    })
    const preserved = preserveCanonicalAliasEquivalentLinkTargets({
        proposals: [{ registrationId: 'app-1', attendanceClientId: 'canonical-t', status: 'auto_confirmed' }],
        persistedLinks: [{ registrationId: 'app-1', attendanceClientId: 'canonical-s', status: 'confirmed' }],
        canonicalAliases: aliases,
        getSourceId: (link) => link.registrationId,
        getTargetId: (link) => link.attendanceClientId,
        setTargetId: (link, attendanceClientId) => ({ ...link, attendanceClientId }),
    })

    assert.equal(preserved[0].attendanceClientId, 'canonical-s')
    assert.equal(preserved[0].status, 'auto_confirmed')
    assert.equal(preserved[0].evidence.canonicalAliasLinkGuard.reason, 'preserved_physical_alias_target')

    const rejected = preserveCanonicalAliasEquivalentLinkTargets({
        proposals: [{ registrationId: 'app-1', attendanceClientId: 'canonical-t', status: 'auto_confirmed' }],
        persistedLinks: [{ registrationId: 'app-1', attendanceClientId: 'canonical-s', status: 'rejected' }],
        canonicalAliases: aliases,
        getSourceId: (link) => link.registrationId,
        getTargetId: (link) => link.attendanceClientId,
        setTargetId: (link, attendanceClientId) => ({ ...link, attendanceClientId }),
    })
    assert.equal(rejected[0].status, 'ambiguous')
    assert.equal(rejected[0].evidence.canonicalAliasLinkGuard.reason, 'terminal_alias_rejection')
})

test('blocks a source projection before it can rebind commercial identity history', async () => {
    const queries = []
    const client = {
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim()
            queries.push({ sql: normalized, params })
            if (normalized.startsWith('with desired as')) {
                return {
                    rows: [{
                        source_type: 'app_registration', source_id: 'app-1',
                        component_key: 'app_registration:app-1|caixa_customer:cash-1',
                        current_identity_id: '11111111-1111-4111-8111-111111111111',
                    }],
                    rowCount: 1,
                }
            }
            if (normalized.startsWith('select id::text,component_key from crm_atendimento.global_client_identities')) {
                return { rows: [], rowCount: 0 }
            }
            if (normalized.includes("to_regclass('crm_atendimento.commercial_actions') as actions")) {
                return {
                    rows: [{
                        actions: 'actions', permissions: 'permissions', permission_events: 'permission_events',
                        policy: 'policy', audit_events: 'audit_events', canary_column: true,
                    }],
                    rowCount: 1,
                }
            }
            if (normalized.includes('from crm_atendimento.commercial_actions where identity_id=any')) {
                return { rows: [{ actions: 0, permissions: 1, permission_events: 0, canary_entries: 0, audit_identity_events: 0 }], rowCount: 1 }
            }
            return { rows: [], rowCount: 0 }
        },
    }

    await assert.rejects(
        () => assertIdentityProjectionCanBeMaterialized(client, [{
            componentKey: 'app_registration:app-1|caixa_customer:cash-1',
            members: [{ sourceType: 'app_registration', sourceId: 'app-1' }],
        }]),
        { message: 'IDENTITY_PROJECTION_COMMERCIAL_HISTORY_PRESENT', statusCode: 409 },
    )

    assert.equal(queries.some(({ sql }) => sql.startsWith('select pg_advisory_xact_lock')), true)
})

test('records append-only projection lineage and audit evidence when the reviewed workflow is active', async () => {
    const queries = []
    const client = {
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim()
            queries.push({ sql: normalized, params })
            if (normalized.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) {
                return { rows: [{ registry: 'registry', runs: 'runs', member_history: 'history', lineage: 'lineage', audit_events: 'audit' }] }
            }
            if (normalized.startsWith('select id from crm_atendimento.schema_migrations')) {
                return { rows: [{ id: '20260805_identity_review_workflow_v1' }] }
            }
            if (normalized.startsWith('insert into crm_atendimento.identity_materialization_runs')) {
                return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] }
            }
            return { rows: [] }
        },
    }

    const result = await recordIdentityProjectionMaterialization(client, {
        origin: 'test_projection',
        components: [{
            componentKey: 'app_registration:app-1|caixa_customer:cash-1',
            members: [
                { sourceType: 'app_registration', sourceId: 'app-1' },
                { sourceType: 'caixa_customer', sourceId: 'cash-1' },
            ],
        }],
        resultingIdentityIds: new Map([['app_registration:app-1|caixa_customer:cash-1', '33333333-3333-4333-8333-333333333333']]),
        previousIdentityByMember: {
            'app_registration\u0000app-1': '11111111-1111-4111-8111-111111111111',
        },
    })

    assert.deepEqual(result, {
        available: true,
        recorded: true,
        runId: '22222222-2222-4222-8222-222222222222',
        membersCreated: 1,
        membersMoved: 1,
        lineage: 2,
    })
    assert.equal(queries.some(({ sql }) => sql.startsWith('insert into crm_atendimento.identity_member_history')), true)
    assert.equal(queries.some(({ sql }) => sql.startsWith('insert into crm_atendimento.identity_lineage')), true)
    const audit = queries.find(({ sql }) => sql.startsWith('insert into crm_atendimento.audit_events'))
    assert.equal(audit.params[0], 'client-identity.projection.materialized')
    assert.doesNotMatch(JSON.stringify(audit.params), /cash-1|app-1/)
})

test('demotes a new automatic link when a terminal decision already names another target', () => {
    const linkShapes = [
        {
            name: 'app to Caixa',
            source: 'app-1', terminalTarget: 'cash-reviewed', proposedTarget: 'cash-new',
            existing: (source, target) => ({ registrationId: source, caixaCustomerId: target, status: 'confirmed' }),
            proposed: (source, target) => ({ registrationId: source, caixaCustomerId: target, status: 'auto_confirmed', evidence: { method: 'fresh-match' } }),
            getSourceId: (link) => link.registrationId,
            getTargetId: (link) => link.caixaCustomerId,
        },
        {
            name: 'app to Atendimento',
            source: 'app-2', terminalTarget: 'attendance-reviewed', proposedTarget: 'attendance-new',
            existing: (source, target) => ({ registrationId: source, attendanceClientId: target, status: 'rejected' }),
            proposed: (source, target) => ({ registrationId: source, attendanceClientId: target, status: 'auto_confirmed', evidence: { method: 'fresh-match' } }),
            getSourceId: (link) => link.registrationId,
            getTargetId: (link) => link.attendanceClientId,
        },
        {
            name: 'lead to app',
            source: 'lead-1', terminalTarget: 'app-reviewed', proposedTarget: 'app-new',
            existing: (source, target) => ({ profileId: source, registrationId: target, status: 'confirmed' }),
            proposed: (source, target) => ({ profileId: source, registrationId: target, status: 'auto_confirmed', evidence: { method: 'fresh-match' } }),
            getSourceId: (link) => link.profileId,
            getTargetId: (link) => link.registrationId,
        },
        {
            name: 'lead to Caixa',
            source: 'lead-2', terminalTarget: 'cash-reviewed', proposedTarget: 'cash-new',
            existing: (source, target) => ({ profileId: source, caixaCustomerId: target, status: 'rejected' }),
            proposed: (source, target) => ({ profileId: source, caixaCustomerId: target, status: 'auto_confirmed', evidence: { method: 'fresh-match' } }),
            getSourceId: (link) => link.profileId,
            getTargetId: (link) => link.caixaCustomerId,
        },
    ]

    for (const shape of linkShapes) {
        const existing = [shape.existing(shape.source, shape.terminalTarget)]
        const guarded = guardAutoConfirmedIdentityLinkProposals({
            proposals: [shape.proposed(shape.source, shape.proposedTarget)],
            persistedLinks: existing,
            getSourceId: shape.getSourceId,
            getTargetId: shape.getTargetId,
        })

        assert.equal(guarded[0].status, 'ambiguous', shape.name)
        assert.deepEqual(guarded[0].evidence.identityLinkGuard, {
            originalStatus: 'auto_confirmed',
            reason: 'terminal_target_conflict',
            terminalTargetIds: [shape.terminalTarget],
            automaticProposalTargetIds: [shape.proposedTarget],
        }, shape.name)
        assert.deepEqual(existing, [shape.existing(shape.source, shape.terminalTarget)], `${shape.name} preserves the terminal decision`)
    }
})

test('demotes conflicting automatic proposals in one batch without merging their identities', () => {
    const proposals = [
        { registrationId: 'app-1', caixaCustomerId: 'cash-a', status: 'auto_confirmed' },
        { registrationId: 'app-1', caixaCustomerId: 'cash-b', status: 'auto_confirmed' },
    ]
    const guarded = guardAutoConfirmedIdentityLinkProposals({
        proposals,
        getSourceId: (link) => link.registrationId,
        getTargetId: (link) => link.caixaCustomerId,
    })

    assert.deepEqual(guarded.map((link) => link.status), ['ambiguous', 'ambiguous'])
    assert.equal(guarded.every((link) => link.evidence.identityLinkGuard.reason === 'multiple_automatic_targets'), true)

    const components = buildPersistedConfirmedIdentityComponents({
        registrations: [{ id: 'app-1', name: 'Cliente App' }],
        caixaCustomers: [{ id: 'cash-a', name: 'Caixa A' }, { id: 'cash-b', name: 'Caixa B' }],
        registrationCaixaLinks: guarded,
    })
    assert.deepEqual(components.map((component) => component.componentKey), [
        'app_registration:app-1',
        'caixa_customer:cash-a',
        'caixa_customer:cash-b',
    ])
})

test('treats merged canonical source aliases as one protected automatic-link endpoint', () => {
    const resolveCanonical = createCanonicalClientAliasResolver({
        canonicalClients: [
            { id: 'canonical-s', mergedIntoId: 'canonical-t' },
            { id: 'canonical-t' },
        ],
    })
    const guarded = guardAutoConfirmedIdentityLinkProposals({
        proposals: [{ clientId: 'canonical-t', caixaCustomerId: 'cash-new', status: 'auto_confirmed' }],
        persistedLinks: [{ clientId: 'canonical-s', caixaCustomerId: 'cash-existing', status: 'confirmed' }],
        getSourceId: (link) => link.clientId,
        getTargetId: (link) => link.caixaCustomerId,
        normalizeSourceId: resolveCanonical,
    })

    assert.equal(guarded[0].status, 'ambiguous')
})

test('does not add a second automatic target beside a previously accepted automatic edge', () => {
    const guarded = guardAutoConfirmedIdentityLinkProposals({
        proposals: [{ registrationId: 'app-1', caixaCustomerId: 'cash-new', status: 'auto_confirmed' }],
        persistedLinks: [{ registrationId: 'app-1', caixaCustomerId: 'cash-existing', status: 'auto_confirmed' }],
        getSourceId: (link) => link.registrationId,
        getTargetId: (link) => link.caixaCustomerId,
    })

    assert.equal(guarded[0].status, 'ambiguous')
    assert.equal(guarded[0].evidence.identityLinkGuard.reason, 'terminal_target_conflict')
})

test('keeps a repeated automatic proposal for the same target eligible for the existing terminal row', () => {
    const guarded = guardAutoConfirmedIdentityLinkProposals({
        proposals: [{ profileId: 'lead-1', registrationId: 'app-reviewed', status: 'auto_confirmed' }],
        persistedLinks: [{ profileId: 'lead-1', registrationId: 'app-reviewed', status: 'confirmed' }],
        getSourceId: (link) => link.profileId,
        getTargetId: (link) => link.registrationId,
    })

    assert.equal(guarded[0].status, 'auto_confirmed')
    assert.equal(guarded[0].evidence, undefined)
})
