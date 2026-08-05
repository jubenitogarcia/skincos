import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
    assertActorCanMutateUnit,
    actorIdentityForMutation,
    atendimentoMigrationStatements,
    canAccessAtendimento,
    collectIdentityReviewSourceLinkTransitions,
    createAtendimentoStore,
    filterConversionReportToActorScope,
    normalizeAttendanceMutation,
} from '../store.js'
import {
    ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION,
    ATTENDANCE_WRITE_SAFETY_MIGRATION_ID,
    attendanceWriteSafetyMigrationPlan,
} from '../writeSafetyMigration.js'

test('records only real automatic source-link topology changes from a reviewed source edge', () => {
    const candidate = {
        reviewType: 'app_caixa',
        sourceType: 'app_registration',
        sourceId: 'app-1',
        targetType: 'caixa_customer',
        targetId: 'cash-1',
    }
    assert.deepEqual(collectIdentityReviewSourceLinkTransitions({
        candidate,
        previousStatus: 'auto_confirmed',
        resultingStatus: 'rejected',
    }), [{
        linkType: 'app_caixa',
        sourceType: 'app_registration',
        sourceId: 'app-1',
        targetType: 'caixa_customer',
        targetId: 'cash-1',
        transition: 'automatic_deactivated',
        resultingStatus: 'rejected',
    }])
    assert.deepEqual(collectIdentityReviewSourceLinkTransitions({
        candidate,
        previousStatus: 'suggested',
        resultingStatus: 'auto_confirmed_spelling',
    }), [{
        linkType: 'app_caixa',
        sourceType: 'app_registration',
        sourceId: 'app-1',
        targetType: 'caixa_customer',
        targetId: 'cash-1',
        transition: 'automatic_activated',
        resultingStatus: 'auto_confirmed_spelling',
    }])
    assert.deepEqual(collectIdentityReviewSourceLinkTransitions({
        candidate: { ...candidate, reviewType: 'attendance_name_merge' },
        previousStatus: 'auto_confirmed',
        resultingStatus: 'rejected',
    }), [])
})

test('recalculates manual values on the server and rejects invalid financial records', () => {
    const normalized = normalizeAttendanceMutation({
        unitSlug: 'novo-hamburgo',
        date: '2026-06-10',
        clientName: ' Cliente ',
        procedureName: ' Botox ',
        code: '799',
        quantity: '2',
        discount: true,
        otherValue: '66,00',
        roundValue: false,
        value: 1,
    })
    assert.equal(normalized.code, '#0799')
    assert.equal(normalized.clientName, 'Cliente')
    assert.equal(normalized.value, 1484.06)
    assert.throws(() => normalizeAttendanceMutation({ ...normalized, date: '2026-02-30' }), /INVALID_SERVICE_DATE/)
    assert.throws(() => normalizeAttendanceMutation({ ...normalized, quantity: 0 }), /INVALID_QUANTITY/)
    assert.throws(() => normalizeAttendanceMutation({ ...normalized, otherValue: 2000 }), /NEGATIVE_CALCULATED_VALUE/)
})

test('enforces unit scope for mutations and includes revision, formula and idempotency migration safeguards', () => {
    const actor = { role: 'INJETOR', allowedUnits: ['Novo Hamburgo'] }
    assert.doesNotThrow(() => assertActorCanMutateUnit(actor, { slug: 'novo-hamburgo' }))
    assert.throws(() => assertActorCanMutateUnit(actor, { slug: 'barra-shopping-sul' }), /UNIT_FORBIDDEN/)
    assert.throws(() => assertActorCanMutateUnit({ role: 'INJETOR', allowedUnits: [] }, { slug: 'novo-hamburgo' }), /UNIT_FORBIDDEN/)
    assert.equal(actorIdentityForMutation({ id: 'operator-1', role: 'INJETOR' }), 'operator-1')
    assert.throws(() => actorIdentityForMutation({ role: 'INJETOR' }), /ACTOR_IDENTITY_REQUIRED/)
    const migration = atendimentoMigrationStatements().join('\n')
    assert.match(migration, /revision integer/i)
    assert.match(migration, /value_formula_version text/i)
    assert.match(migration, /idempotency_key text/i)
    const plan = attendanceWriteSafetyMigrationPlan()
    assert.equal(plan.id, ATTENDANCE_WRITE_SAFETY_MIGRATION_ID)
    assert.equal(plan.legacyFormulaVersion, ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION)
    assert.equal(plan.indexes.find((index) => index.name === 'crm_atendimento_attendances_idempotency_idx')?.sql.includes('create unique index concurrently'), true)
    assert.equal(plan.indexes.find((index) => index.name === 'crm_atendimento_attendances_idempotency_idx')?.sql.includes('idempotency_key is not null'), true)
    assert.equal(plan.indexes.some((index) => index.name === 'crm_atendimento_attendances_unit_injector_period_idx'), true)
    assert.equal(plan.indexes.some((index) => index.name === 'crm_atendimento_attendances_unit_consultant_period_idx'), true)
})

test('scopes atendimento router access by consuming module', () => {
    const legacyConsultant = { role: 'CONSULTOR', allowedModules: [] }
    assert.equal(canAccessAtendimento(legacyConsultant, '/attendances', 'POST'), true)
    assert.equal(canAccessAtendimento({ role: 'ADMIN', allowedModules: [] }, '/attendances', 'POST'), true)
    const procedimentosActor = { role: 'INJETOR', allowedModules: ['procedimentos'] }
    assert.equal(canAccessAtendimento(procedimentosActor, '/management/catalog', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/references', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/offers', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/offers', 'PUT'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/clients', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'POST'), false)

    const faturamentoActor = { role: 'INJETOR', allowedModules: ['faturamento'] }
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/commercial', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/finance', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/catalog', 'GET'), false)
})

test('uses an explicitly managed schema without bootstrapping DDL from the app pool', async () => {
    const queries = []
    const pool = createFakePool([
        (sql) => {
            queries.push(sql)
            if (sql.includes('from crm_atendimento.clients c')) {
                return { rows: [{ name: 'Cliente sintético', usage_count: 1 }], rowCount: 1 }
            }
            return null
        },
    ])
    const result = await createAtendimentoStore({ pool, schemaManaged: true }).clients(
        { unit: 'barra-shopping-sul', q: 'an', limit: 5 },
        { id: 'synthetic-gestor', role: 'GESTOR' },
    )
    assert.deepEqual(result.clients, [{ name: 'Cliente sintético', usageCount: 1 }])
    assert.equal(queries.some((sql) => sql.includes('create extension if not exists pgcrypto')), false)
})

test('scopes Clientes commercial reads, queues, actions, cadences and offers to explicit GESTOR units', async () => {
    const captured = []
    const identityId = '11111111-1111-4111-8111-111111111111'
    const profileRow = {
        identity_id: identityId,
        canonical_name: 'Cliente restrito',
        source_types: ['attendance_client', 'caixa_customer'],
        last_attendance: '2026-01-10', visit_count: 1, procedure_count: 1,
        completed_procedures: ['Botox'], attendance_units: ['Novo Hamburgo'], future_attendance_count: 0,
        sale_count: 1, lifetime_sales: 900, sales_12m: 900, sales_units: ['Novo Hamburgo'],
        phone: '5551999991111', purchased_procedures: ['Botox'], pending_sale_items: 0,
        active_action_count: 0, last_action_at: null,
    }
    const pool = createFakePool([
        (sql, params) => {
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities') as identities")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'attendance_links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [{}], rowCount: 1 }
            if (sql.includes('with identities as')) {
                captured.push({ kind: 'profiles', sql, params })
                return { rows: [profileRow], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('where action.identity_id = $1')) {
                captured.push({ kind: 'profile-actions', sql, params })
                return { rows: [], rowCount: 0 }
            }
            if (sql.includes('from crm_atendimento.commercial_procedure_cadences cadence') && sql.includes('where $1::text[] is null')) {
                captured.push({ kind: 'cadences', sql, params })
                return { rows: [], rowCount: 0 }
            }
            if (sql.includes('from crm_atendimento.commercial_offers o')) {
                captured.push({ kind: 'offers', sql, params })
                return { rows: [], rowCount: 0 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const scopedGestor = { id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['Novo Hamburgo'] }

    const overview = await store.commercialOverview({}, scopedGestor)
    assert.deepEqual(captured.find((entry) => entry.kind === 'profiles')?.params[1], ['novo-hamburgo'])
    assert.equal(Object.hasOwn(overview.profiles[0], 'phone'), false)
    assert.equal(Object.hasOwn(overview.profiles[0], 'email'), false)

    const detail = await store.commercialProfile(identityId, {}, scopedGestor)
    assert.equal(Object.hasOwn(detail.profile, 'phone'), false)
    assert.deepEqual(captured.find((entry) => entry.kind === 'profile-actions')?.params, [identityId, ['novo-hamburgo']])

    await store.commercialCadences(scopedGestor)
    assert.deepEqual(captured.find((entry) => entry.kind === 'cadences')?.params, [['novo-hamburgo']])
    await store.commercialOffers({}, scopedGestor)
    assert.deepEqual(captured.find((entry) => entry.kind === 'offers')?.params, [['novo-hamburgo']])

    await assert.rejects(
        () => store.commercialOverview({ unit: 'barra-shopping-sul' }, scopedGestor),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.commercialProfile(identityId, { unit: 'barra-shopping-sul' }, scopedGestor),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'draft', cadenceDays: 90, unit: 'barra-shopping-sul' }, scopedGestor),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.createCommercialAction({ identityId, segmentKey: 'return_at_risk', actionType: 'contact', unit: 'barra-shopping-sul' }, scopedGestor),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.upsertCommercialOffer({
            unitSlug: 'barra-shopping-sul', title: 'Oferta restrita', status: 'draft', priceQualifier: 'on_request',
            procedures: [{ procedureId: 'procedure-1', quantity: 1, quantityUnit: 'unidade' }],
        }, scopedGestor),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.commercialOverview({}, { id: 'gestor-empty', role: 'GESTOR', allowedUnits: [] }),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    await assert.rejects(
        () => store.commercialOverview({}, {
            id: 'gestor-malformed-scope', role: 'GESTOR', allowedUnits: 'Novo Hamburgo',
        }),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )

    await store.commercialOverview({}, { id: 'admin-via-pages', role: 'GESTOR', isGlobalAdmin: true, allowedUnits: [] })
    assert.equal(captured.filter((entry) => entry.kind === 'profiles').at(-1)?.params[1], null)
})

test('returns commercial-only references filtered to the declared manager units', async () => {
    const pool = createFakePool([
        (sql) => sql.includes('select slug, name from crm_atendimento.units order by name') && {
            rows: [
                { slug: 'barra-shopping-sul', name: 'Barra Shopping Sul' },
                { slug: 'novo-hamburgo', name: 'Novo Hamburgo' },
            ], rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.professionals p') && {
            rows: [
                { id: 'professional-bss', canonical_id: 'professional-bss', canonical_name: 'Equipe BSS', name: 'Equipe BSS', status: 'Ativo', units: ['Barra Shopping Sul'], roles: ['Consultor'], aliases: [] },
                { id: 'professional-nh', canonical_id: 'professional-nh', canonical_name: 'Equipe NH', name: 'Equipe NH', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Consultor'], aliases: [] },
            ], rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.procedures p') && { rows: [], rowCount: 0 },
    ])
    const refs = await createAtendimentoStore({ pool }).commercialReferences({
        id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['Novo Hamburgo'],
    })

    assert.deepEqual(refs.units.map((unit) => unit.slug), ['novo-hamburgo'])
    assert.deepEqual(refs.professionals.map((professional) => professional.name), ['Equipe NH'])
})

test('does not let a scoped manager manufacture an action unit for an unrelated identity', async () => {
    let actionInserted = false
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions', permission_events: 'permission-events', action_events: 'action-events',
        harmonia_contacts: 'harmonia.contacts', caixa_customers: 'crm_caixa.customers', app_registrations: null, lead_profiles: null,
        permission_event_trace_id: true, permission_events_immutable: true, permission_events_no_truncate: true,
        action_events_immutable: true, action_events_no_truncate: true, action_channel: true, action_contacted_at: true,
        rollout_enabled: true, rollout_canary: true,
    }
    const pool = createFakePool([
        (sql, params) => {
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities') as identities")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'attendance-links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql === 'select id from crm_atendimento.global_client_identities where id = $1') return { rows: [{ id: params[0] }], rowCount: 1 }
            if (sql === 'select active_contact_cooldown_days from crm_atendimento.commercial_policy_config where singleton = true') return { rows: [{ active_contact_cooldown_days: 30 }], rowCount: 1 }
            if (sql === 'select id from crm_atendimento.units where slug = $1') return { rows: [{ id: 'unit-nh' }], rowCount: 1 }
            if (sql.includes('from crm_atendimento.global_client_identity_members member') && sql.includes('as matched')) {
                return { rows: [{ matched: false }], rowCount: 1 }
            }
            if (sql.startsWith('insert into crm_atendimento.commercial_actions(')) actionInserted = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.createCommercialAction({
            identityId: '11111111-1111-4111-8111-111111111111', segmentKey: 'return_at_risk', actionType: 'contact', unit: 'novo-hamburgo',
        }, { id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['Novo Hamburgo'] }),
        { message: 'COMMERCIAL_IDENTITY_UNIT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(actionInserted, false)
})

test('rejects an action owner who is not available for the action unit', async () => {
    let actionUpdated = false
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions', permission_events: 'permission-events', action_events: 'action-events',
        harmonia_contacts: 'harmonia.contacts', caixa_customers: 'crm_caixa.customers', app_registrations: null, lead_profiles: null,
        permission_event_trace_id: true, permission_events_immutable: true, permission_events_no_truncate: true,
        action_events_immutable: true, action_events_no_truncate: true, action_channel: true, action_contacted_at: true,
        rollout_enabled: true, rollout_canary: true,
    }
    const pool = createFakePool([
        (sql) => {
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action')) {
                return { rows: [{ id: 'action-1', identity_id: 'identity-1', status: 'open', contacted_at: null, unit_slug: 'novo-hamburgo' }], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.professionals p')) {
                return { rows: [{ id: 'professional-bss', canonical_id: 'professional-bss', canonical_name: 'Equipe BSS', name: 'Equipe BSS', status: 'Ativo', units: ['Barra Shopping Sul'], roles: ['Consultor'], aliases: [] }], rowCount: 1 }
            }
            if (sql.startsWith('update crm_atendimento.commercial_actions')) actionUpdated = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialAction('action-1', { status: 'closed', owner: 'Equipe BSS' }, { id: 'gestor-global', role: 'GESTOR' }),
        { message: 'PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT', statusCode: 400 },
    )
    assert.equal(actionUpdated, false)
})

test('keeps clinical cadence approval fail-closed while allowing commercial drafts and disabled records', async () => {
    const cadenceWrites = []
    const pool = createFakePool([
        (sql, params) => {
            if (sql.startsWith('select id, status from crm_atendimento.commercial_procedure_cadences')) {
                return { rows: [], rowCount: 0 }
            }
            if (sql.startsWith('insert into crm_atendimento.commercial_procedure_cadences(')) {
                cadenceWrites.push({ sql, params })
                return { rows: [{ id: `cadence-${cadenceWrites.length}` }], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const actor = { id: 'gestor-1', role: 'GESTOR' }

    await store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'draft', cadenceDays: 90 }, actor)
    await store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'disabled', cadenceDays: 90 }, actor)
    await assert.rejects(
        () => store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'approved', cadenceDays: 90 }, actor),
        { message: 'CLINICAL_CADENCE_APPROVAL_REQUIRED', statusCode: 403 },
    )

    assert.deepEqual(cadenceWrites.map(({ params }) => params[3]), ['draft', 'disabled'])
    assert.equal(cadenceWrites.every(({ sql }) => sql.includes('where crm_atendimento.commercial_procedure_cadences.status <> \'approved\'')), true)
})

test('keeps existing approved clinical cadences read-only to a commercial manager', async () => {
    let cadenceWriteAttempted = false
    const pool = createFakePool([
        (sql) => {
            if (sql.startsWith('select id, status from crm_atendimento.commercial_procedure_cadences')) {
                return { rows: [{ id: 'legacy-approved', status: 'approved' }], rowCount: 1 }
            }
            if (sql.startsWith('insert into crm_atendimento.commercial_procedure_cadences(')) cadenceWriteAttempted = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const actor = { id: 'gestor-1', role: 'GESTOR' }

    await assert.rejects(
        () => store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'draft', cadenceDays: 90 }, actor),
        { message: 'CLINICAL_CADENCE_APPROVAL_REQUIRED', statusCode: 403 },
    )
    await assert.rejects(
        () => store.upsertCommercialCadence({ procedureId: 'procedure-1', status: 'disabled', cadenceDays: 90 }, actor),
        { message: 'CLINICAL_CADENCE_APPROVAL_REQUIRED', statusCode: 403 },
    )
    assert.equal(cadenceWriteAttempted, false)
})

test('rejects a scoped GESTOR action update before commercial-contact state is read or written', async () => {
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    let contactStateRead = false
    const pool = createFakePool([
        (sql) => {
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) {
                return { rows: [availability], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action')) {
                return { rows: [{ id: 'action-cross-unit', identity_id: 'identity-1', status: 'open', contacted_at: null }], rowCount: 1 }
            }
            if (sql.includes('commercial_contact_permissions') || sql.includes('harmonia.contacts') || sql.startsWith('update crm_atendimento.commercial_actions')) {
                contactStateRead = true
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialAction('action-cross-unit', { status: 'closed' }, {
            id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['Novo Hamburgo'],
        }),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(contactStateRead, false)
})

test('scopes identity review cross-unit and removes contact and birth data from review responses', async () => {
    const captured = []
    const pool = createFakePool([
        (sql, params) => {
            if (sql.includes("to_regclass('crm_atendimento.client_merge_suggestions') as merges")) {
                return { rows: [{ merges: 'merges', attendance_caixa: 'attendance_caixa', app: 'app', leads: 'leads' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) return { rows: [{ registry: null }], rowCount: 1 }
            if (sql.startsWith('with review_items as')) {
                captured.push({ sql, params })
                return {
                    rows: [{
                        id: 'review-1', type: 'lead_app', source_id: 'lead-1', target_id: 'app-1', status: 'suggested',
                        review_version: 'version-1', decision_state: null, confidence: 0.92,
                        primary_name: 'Ana', secondary_name: 'Ana Silva', total: 1,
                        evidence: { phone: '5551999991111', nested: { email: 'ana@example.test', method: 'unique_name_phone' } },
                        context: {
                            leadPhones: ['5551999991111'], leadEmails: ['ana@example.test'], leadBirthdays: ['1990-01-02'],
                            phoneKey: '5551999991111', safe: 'same_name', nested: { appEmail: 'ana@example.test', unit: 'novo-hamburgo' },
                        },
                    }], rowCount: 1,
                }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const result = await store.identityReviewQueue({}, { id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] })
    assert.deepEqual(captured[0]?.params.at(-1), ['novo-hamburgo'])
    assert.match(captured[0]?.sql || '', /unit_slugs <@ \$5::text\[\]/)
    assert.deepEqual(result.items[0].evidence, { nested: { method: 'unique_name_phone' } })
    assert.deepEqual(result.items[0].context, { safe: 'same_name', nested: { unit: 'novo-hamburgo' } })
})

test('keeps identity-review writes disabled when the no-truncate ledger guard is absent', async () => {
    const pool = createFakePool([
        (sql) => {
            if (sql.includes("to_regclass('crm_atendimento.client_merge_suggestions') as merges")) {
                return { rows: [{ merges: 'merges', attendance_caixa: 'attendance_caixa', app: 'app', leads: 'leads' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) {
                return {
                    rows: [{
                        registry: 'schema_migrations', decisions: 'identity_review_decisions', runs: 'identity_materialization_runs',
                        member_history: 'identity_member_history', lineage: 'identity_lineage', source_link_history: 'identity_source_link_history',
                        run_event_order: true, member_history_event_order: true, decision_resulting_status: true, decision_event_order: true,
                        decision_immutable: true, member_history_immutable: true, lineage_immutable: true, source_link_history_immutable: true,
                        decision_no_truncate: false, member_history_no_truncate: true, lineage_no_truncate: true, source_link_history_no_truncate: true,
                    }], rowCount: 1,
                }
            }
            if (sql.startsWith('select id from crm_atendimento.schema_migrations')) {
                return {
                    rows: [
                        { id: '20260805_identity_review_workflow_v1' },
                        { id: '20260805_identity_review_source_link_ledger_v1' },
                        { id: '20260805_identity_review_ledger_integrity_v1' },
                    ], rowCount: 3,
                }
            }
            if (sql.startsWith('with review_items as')) return { rows: [], rowCount: 0 }
            return null
        },
    ])

    const result = await createAtendimentoStore({ pool }).identityReviewQueue({}, {
        id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['novo-hamburgo'],
    })

    assert.equal(result.workflow.writesReady, false)
})

test('blocks a scoped GESTOR from deciding an identity review that spans another unit', async () => {
    const writes = []
    const sourceId = '11111111-1111-4111-8111-111111111111'
    const targetId = '22222222-2222-4222-8222-222222222222'
    const workflowReady = {
        registry: 'schema_migrations', decisions: 'identity_review_decisions', runs: 'identity_materialization_runs',
        member_history: 'identity_member_history', lineage: 'identity_lineage', source_link_history: 'identity_source_link_history',
        run_event_order: true, member_history_event_order: true, decision_resulting_status: true, decision_event_order: true,
        decision_immutable: true, member_history_immutable: true, lineage_immutable: true, source_link_history_immutable: true,
        decision_no_truncate: true, member_history_no_truncate: true, lineage_no_truncate: true, source_link_history_no_truncate: true,
    }
    const pool = createFakePool([
        (sql, params) => {
            if (sql.startsWith('update crm_atendimento.client_caixa_links')) writes.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities') as identities")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'attendance_links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) return { rows: [workflowReady], rowCount: 1 }
            if (sql.startsWith('select id from crm_atendimento.schema_migrations')) return { rows: [{ id: 'workflow' }, { id: 'source-links' }, { id: 'ledger-integrity' }], rowCount: 3 }
            if (sql.includes('from crm_atendimento.client_caixa_links link') && sql.includes('for update of link')) {
                return {
                    rows: [{
                        row_id: 'link-1', status: 'suggested', evidence: { method: 'name_phone' }, review_version: 'version-1',
                        source_name: 'Cliente Atendimento', target_name: 'Cliente Caixa',
                        context: { attendanceCount: 1, phoneKey: '5551999991111' }, unit_slugs: ['barra-shopping-sul'],
                    }], rowCount: 1,
                }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    await assert.rejects(
        () => store.decideIdentityReview({
            reviewType: 'attendance_caixa', sourceId, targetId, decision: 'confirmed', expectedVersion: 'version-1',
            reason: 'Os registros foram revisados para validar o escopo da unidade.',
        }, { id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] }),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(writes.length, 0)
})

test('blocks a scoped GESTOR from materializing an indirectly cross-unit identity component', async () => {
    const writes = []
    const sourceId = '11111111-1111-4111-8111-111111111111'
    const targetId = '22222222-2222-4222-8222-222222222222'
    const workflowReady = {
        registry: 'schema_migrations', decisions: 'identity_review_decisions', runs: 'identity_materialization_runs',
        member_history: 'identity_member_history', lineage: 'identity_lineage', source_link_history: 'identity_source_link_history',
        run_event_order: true, member_history_event_order: true, decision_resulting_status: true, decision_event_order: true,
        decision_immutable: true, member_history_immutable: true, lineage_immutable: true, source_link_history_immutable: true,
        decision_no_truncate: true, member_history_no_truncate: true, lineage_no_truncate: true, source_link_history_no_truncate: true,
    }
    const pool = createFakePool([
        (sql, params) => {
            if (sql.startsWith('update crm_atendimento.client_caixa_links')) writes.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities') as identities")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'attendance_links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) return { rows: [workflowReady], rowCount: 1 }
            if (sql.startsWith('select id from crm_atendimento.schema_migrations')) return { rows: [{ id: 'workflow' }, { id: 'source-links' }, { id: 'ledger-integrity' }], rowCount: 3 }
            if (sql.includes('from crm_atendimento.client_caixa_links link') && sql.includes('for update of link')) {
                return {
                    rows: [{
                        row_id: 'link-1', status: 'suggested', evidence: { method: 'name_phone' }, review_version: 'version-1',
                        source_name: 'Cliente Atendimento', target_name: 'Cliente Caixa',
                        context: { attendanceCount: 1 }, unit_slugs: ['novo-hamburgo'],
                    }], rowCount: 1,
                }
            }
            if (sql.includes('with affected_components as')) {
                return {
                    rows: [
                        { source_type: 'attendance_client', source_id: sourceId, unit_slugs: ['novo-hamburgo'] },
                        { source_type: 'caixa_customer', source_id: targetId, unit_slugs: ['barra-shopping-sul'] },
                    ], rowCount: 2,
                }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.decideIdentityReview({
            reviewType: 'attendance_caixa', sourceId, targetId, decision: 'confirmed', expectedVersion: 'version-1',
            reason: 'Validação de escopo expandido de componentes da identidade.',
        }, { id: 'gestor-nh', role: 'GESTOR', allowedUnits: ['Novo Hamburgo'] }),
        { message: 'COMMERCIAL_UNIT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(writes.length, 0)
})

test('contains the normalized commercial-offer schema and refuses to treat it as a sheet snapshot', () => {
    const migration = atendimentoMigrationStatements().join('\n')
    assert.match(migration, /commercial_offers/i)
    assert.match(migration, /commercial_offer_procedures/i)
    assert.match(migration, /offer_key text not null/i)
    assert.match(migration, /price_cents integer/i)
    assert.match(migration, /status text not null default 'draft'/i)
    assert.match(migration, /aliases text\[\]/i)
})

test('keeps commercial-contact rollout DDL out of the automatic store bootstrap', () => {
    const migration = atendimentoMigrationStatements().join('\n')
    assert.doesNotMatch(migration, /commercial_contact_writes_enabled/i)
    assert.doesNotMatch(migration, /commercial_contact_canary_identity_ids/i)
    assert.doesNotMatch(migration, /contacted_at/i)
    assert.doesNotMatch(migration, /commercial_actions_contacted_idx/i)
})

test('keeps commercial policy reads fail-closed before the explicit rollout migration', async () => {
    const missingColumn = Object.assign(new Error('column does not exist'), { code: '42703' })
    const pool = createFakePool([
        (sql) => {
            if (sql.includes('commercial_contact_writes_enabled') && !sql.includes('false as')) throw missingColumn
            if (sql.includes('false as commercial_contact_writes_enabled')) {
                return {
                    rows: [{
                        active_contact_cooldown_days: 30,
                        return_risk_thresholds: [90, 180, 365],
                        commercial_contact_writes_enabled: false,
                        commercial_contact_canary_identity_ids: [],
                    }],
                    rowCount: 1,
                }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    const result = await store.commercialPolicy({ role: 'GESTOR' })

    assert.equal(result.policy.commercialContactWritesEnabled, false)
    assert.deepEqual(result.policy.commercialContactCanaryIdentityIds, [])
})

test('fails closed when the append-only commercial ledger migration is absent', async () => {
    const queries = []
    let deniedWritten = false
    const partialAvailability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        action_channel: true,
        action_contacted_at: false,
        rollout_enabled: false,
        rollout_canary: false,
    }
    const pool = createFakePool([
        (sql, params) => {
            queries.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities')")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [partialAvailability], rowCount: 1 }
            if (sql === 'select id from crm_atendimento.global_client_identities where id = $1') return { rows: [{ id: params[0] }], rowCount: 1 }
            if (sql.startsWith('insert into crm_atendimento.commercial_contact_permissions(')) {
                deniedWritten = params[2] === 'denied'
                return { rows: [], rowCount: 1 }
            }
            if (sql.startsWith('select identity_id::text as identity_id, channel, status, evidence_source')) {
                return { rows: [{ identity_id: 'identity-1', channel: 'whatsapp', status: 'denied', evidence_source: 'opt_out', evidence_reference: 'synthetic:stop', expires_at: null, recorded_by: 'manager-1' }], rowCount: 1 }
            }
            if (sql.includes('join crm_caixa.customers customer')) return { rows: [{ identity_id: 'identity-1', phone_key: '5511999999999' }], rowCount: 1 }
            if (sql.includes('from harmonia.contacts')) return { rows: [{ phone_raw: '5511999999999', opted_out_at: null }], rowCount: 1 }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const actor = { id: 'manager-1', role: 'GESTOR' }

    await assert.rejects(
        () => store.recordCommercialContactPermission({
            identityId: 'identity-1', status: 'denied', source: 'opt_out', evidenceReference: 'synthetic:stop',
        }, actor),
        /COMMERCIAL_CONTACT_CONTROLS_NOT_READY/,
    )
    assert.equal(deniedWritten, false)
    assert.equal(queries.some(({ sql }) => sql.startsWith('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids')), false)

    await assert.rejects(
        () => store.recordCommercialContactPermission({
            identityId: 'identity-1', status: 'granted', source: 'synthetic', evidenceReference: 'synthetic:grant', expectedRevision: 0,
        }, actor),
        /COMMERCIAL_CONTACT_CONTROLS_NOT_READY/,
    )
})

test('binds commercial ledger readiness to BEFORE mutation trigger shapes', () => {
    const source = readFileSync(new URL('../store.js', import.meta.url), 'utf8')
    for (const trigger of [
        'commercial_contact_permission_events_immutable',
        'commercial_action_events_immutable',
    ]) {
        assert.match(source, new RegExp(`tgname = '${trigger}'[\\s\\S]*prevent_commercial_ledger_mutation\\(\\)[\\s\\S]*tgtype::integer & 8[\\s\\S]*tgtype::integer & 16`))
    }
    for (const trigger of [
        'commercial_contact_permission_events_no_truncate',
        'commercial_action_events_no_truncate',
    ]) {
        assert.match(source, new RegExp(`tgname = '${trigger}'[\\s\\S]*prevent_commercial_ledger_mutation\\(\\)[\\s\\S]*tgtype::integer & 32`))
    }
})

test('does not let a legacy contacted action without a timestamp bypass the rollout gate', async () => {
    let actionUpdated = false
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    const pool = createFakePool([
        (sql) => {
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action')) {
                return { rows: [{ id: 'action-1', identity_id: 'identity-1', status: 'contacted', contacted_at: null }], rowCount: 1 }
            }
            if (sql.startsWith('select identity_id::text as identity_id, channel, status, evidence_source')) {
                return { rows: [{ identity_id: 'identity-1', channel: 'whatsapp', status: 'granted', evidence_source: 'synthetic', evidence_reference: 'synthetic:consent', expires_at: null, recorded_by: 'manager-1' }], rowCount: 1 }
            }
            if (sql.includes('join crm_caixa.customers customer')) return { rows: [{ identity_id: 'identity-1', phone_key: '5511999999999' }], rowCount: 1 }
            if (sql.includes('from harmonia.contacts')) return { rows: [{ phone_raw: '5511999999999', opted_out_at: null }], rowCount: 1 }
            if (sql.includes('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids')) {
                return { rows: [{ commercial_contact_writes_enabled: false, commercial_contact_canary_identity_ids: [] }], rowCount: 1 }
            }
            if (sql.startsWith('update crm_atendimento.commercial_actions')) actionUpdated = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialAction('action-1', { status: 'contacted' }, { id: 'manager-1', role: 'GESTOR' }),
        /COMMERCIAL_CONTACT_ROLLOUT_DISABLED/,
    )
    assert.equal(actionUpdated, false)
})

test('rejects a stale commercial policy version before it can overwrite the canary', async () => {
    let updateIssued = false
    let lockedPolicyQuery = ''
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    const pool = createFakePool([
        (sql) => {
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql.startsWith('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids,')) {
                lockedPolicyQuery = sql
                return { rows: [{ commercial_contact_writes_enabled: true, commercial_contact_canary_identity_ids: ['11111111-1111-4111-8111-111111111111'], policy_version: 'b'.repeat(32) }], rowCount: 1 }
            }
            if (sql.startsWith('update crm_atendimento.commercial_policy_config')) updateIssued = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialPolicy({
            activeContactCooldownDays: 30,
            returnRiskThresholds: [90, 180, 365],
            commercialContactWritesEnabled: false,
            commercialContactCanaryIdentityIds: [],
            expectedPolicyVersion: 'a'.repeat(32),
        }, { id: 'manager-1', role: 'GESTOR' }),
        /COMMERCIAL_POLICY_CONFLICT/,
    )
    assert.equal(updateIssued, false)
    assert.match(lockedPolicyQuery, /extract\(epoch from updated_at\)::text/)
})

test('accepts only existing materialized identities in a commercial canary selection', async () => {
    const identityId = '11111111-1111-4111-8111-111111111111'
    const availability = {
        permissions: 'permissions', permission_events: 'permission-events', action_events: 'action-events',
        harmonia_contacts: 'harmonia.contacts', caixa_customers: 'caixa.customers', app_registrations: null, lead_profiles: null,
        permission_event_trace_id: true, permission_events_immutable: true, permission_events_no_truncate: true,
        action_events_immutable: true, action_events_no_truncate: true, action_channel: true, action_contacted_at: true,
        rollout_enabled: true, rollout_canary: true,
    }
    let validIdentity = false
    let updateIssued = false
    const pool = createFakePool([
        (sql, params) => {
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql.startsWith('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids,')) {
                return { rows: [{ commercial_contact_writes_enabled: false, commercial_contact_canary_identity_ids: [], policy_version: 'b'.repeat(32) }], rowCount: 1 }
            }
            if (sql.startsWith('select gi.id::text as identity_id')) {
                return { rows: validIdentity ? [{ identity_id: params[0][0] }] : [], rowCount: validIdentity ? 1 : 0 }
            }
            if (sql.startsWith('update crm_atendimento.commercial_policy_config')) {
                updateIssued = true
                return { rows: [{ active_contact_cooldown_days: 30, return_risk_thresholds: [90, 180, 365], commercial_contact_writes_enabled: false, commercial_contact_canary_identity_ids: [identityId], updated_by: 'manager-1', updated_at: '2026-08-05T12:00:00.000Z', policy_version: 'c'.repeat(32) }], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const actor = { id: 'manager-1', role: 'GESTOR' }
    const payload = {
        activeContactCooldownDays: 30,
        returnRiskThresholds: [90, 180, 365],
        commercialContactWritesEnabled: false,
        commercialContactCanaryIdentityIds: [identityId],
        expectedPolicyVersion: 'b'.repeat(32),
    }

    await assert.rejects(() => store.updateCommercialPolicy(payload, actor), { message: 'INVALID_COMMERCIAL_CONTACT_CANARY', statusCode: 400 })
    assert.equal(updateIssued, false)

    validIdentity = true
    const result = await store.updateCommercialPolicy(payload, actor)
    assert.equal(updateIssued, true)
    assert.deepEqual(result.policy.commercialContactCanaryIdentityIds, [identityId])
})

test('requires a current version for every commercial policy write', async () => {
    let policyUpdated = false
    const pool = createFakePool([
        (sql) => {
            if (sql.startsWith('update crm_atendimento.commercial_policy_config')) policyUpdated = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialPolicy({
            activeContactCooldownDays: 30,
            returnRiskThresholds: [90, 180, 365],
        }, { id: 'manager-1', role: 'GESTOR' }),
        { message: 'COMMERCIAL_POLICY_VERSION_REQUIRED', statusCode: 409 },
    )
    assert.equal(policyUpdated, false)
})

test('rejects a stale or versionless affirmative contact permission before it can overwrite a denial', async () => {
    let permissionWritten = false
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions', permission_events: 'permission-events', action_events: 'action-events',
        harmonia_contacts: 'harmonia.contacts', caixa_customers: 'crm_caixa.customers', app_registrations: null, lead_profiles: null,
        permission_event_trace_id: true, permission_events_immutable: true, permission_events_no_truncate: true,
        action_events_immutable: true, action_events_no_truncate: true, action_channel: true, action_contacted_at: true,
        rollout_enabled: true, rollout_canary: true,
    }
    const pool = createFakePool([
        (sql, params) => {
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities') as identities")) {
                return { rows: [{ identities: 'identities', members: 'members', attendance_links: 'attendance-links', sales: 'sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql === 'select id from crm_atendimento.global_client_identities where id = $1') return { rows: [{ id: params[0] }], rowCount: 1 }
            if (sql.includes('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids')) {
                return { rows: [{ commercial_contact_writes_enabled: true, commercial_contact_canary_identity_ids: [params?.[0] || 'identity-1'] }], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.commercial_contact_permissions') && sql.includes('for update')) {
                return { rows: [{ status: 'denied', revision: 4 }], rowCount: 1 }
            }
            if (sql.startsWith('insert into crm_atendimento.commercial_contact_permissions(')) permissionWritten = true
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })
    const payload = {
        identityId: 'identity-1', status: 'granted', source: 'cadastro_assinado', evidenceReference: 'consentimento:atual',
    }

    await assert.rejects(
        () => store.recordCommercialContactPermission(payload, { id: 'manager-1', role: 'GESTOR' }),
        { message: 'COMMERCIAL_CONTACT_PERMISSION_VERSION_REQUIRED', statusCode: 409 },
    )
    await assert.rejects(
        () => store.recordCommercialContactPermission({ ...payload, expectedRevision: 3 }, { id: 'manager-1', role: 'GESTOR' }),
        { message: 'COMMERCIAL_CONTACT_PERMISSION_CONFLICT', statusCode: 409 },
    )
    assert.equal(permissionWritten, false)
})

test('records auditable commercial permission and gates contacted transitions on locked current eligibility', async () => {
    const queries = []
    let permission = null
    let harmoniaOptedOut = false
    let recentContact = false
    let rolloutEnabled = true
    let canaryIdentityIds = ['identity-1']
    let actionUpdated = false
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    const fakePool = createFakePool([
        (sql, params) => {
            queries.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.global_client_identities')")) {
                return { rows: [{ identities: 'crm_atendimento.global_client_identities', members: 'crm_atendimento.global_client_identity_members', attendance_links: 'crm_atendimento.attendance_client_links', sales: 'crm_caixa.sales' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
            if (sql === 'select id from crm_atendimento.global_client_identities where id = $1') return { rows: [{ id: params[0] }], rowCount: 1 }
            if (sql.includes('from crm_atendimento.commercial_contact_permissions') && sql.includes('for update')) {
                return { rows: permission ? [{ status: permission.status }] : [], rowCount: permission ? 1 : 0 }
            }
            if (sql.startsWith('insert into crm_atendimento.commercial_contact_permissions(')) {
                permission = { identityId: params[0], status: params[2], source: params[3], evidenceReference: params[4], expiresAt: params[5], recordedBy: params[6] }
                return { rows: [], rowCount: 1 }
            }
            if (sql.startsWith('select identity_id::text as identity_id, channel, status, evidence_source')) {
                return { rows: permission ? [{ identity_id: permission.identityId, channel: 'whatsapp', status: permission.status, evidence_source: permission.source, evidence_reference: permission.evidenceReference, expires_at: permission.expiresAt, recorded_by: permission.recordedBy, updated_at: '2026-08-04T12:00:00.000Z' }] : [], rowCount: permission ? 1 : 0 }
            }
            if (sql.includes('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids')) {
                return { rows: [{ commercial_contact_writes_enabled: rolloutEnabled, commercial_contact_canary_identity_ids: canaryIdentityIds }], rowCount: 1 }
            }
            if (sql.includes('join crm_caixa.customers customer')) return { rows: [{ identity_id: 'identity-1', phone_key: '5511999999999' }], rowCount: 1 }
            if (sql.includes('from harmonia.contacts')) return { rows: harmoniaOptedOut ? [{ phone_raw: '5511999999999', opted_out_at: '2026-08-04T12:00:00.000Z' }] : [{ phone_raw: '5511999999999', opted_out_at: null }], rowCount: 1 }
            if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action')) return { rows: [{ id: 'action-1', identity_id: 'identity-1', status: 'open', contacted_at: null }], rowCount: 1 }
            if (sql.includes('contacted_at >= now()')) return { rows: recentContact ? [{ id: 'older-contact', contacted_at: '2026-08-04T10:00:00.000Z' }] : [], rowCount: recentContact ? 1 : 0 }
            if (sql.startsWith('update crm_atendimento.commercial_actions')) {
                actionUpdated = true
                return { rows: [], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool: fakePool })
    const actor = { id: 'manager-1', role: 'GESTOR' }

    const recorded = await store.recordCommercialContactPermission({
        identityId: 'identity-1',
        status: 'granted',
        source: 'cadastro_assinado',
        evidenceReference: 'consentimento:registro-1',
        expectedRevision: 0,
        expiresAt: '2030-01-02T03:04:05.000Z',
    }, actor)
    assert.equal(recorded.contactEligibility.status, 'eligible')
    assert.equal(recorded.contactEligibility.expiresAt, '2030-01-02T03:04:05.000Z')
    assert.equal(queries.some(({ sql }) => sql.startsWith('insert into crm_atendimento.commercial_contact_permission_events(')), true)
    const permissionEvent = queries.find(({ sql }) => sql.startsWith('insert into crm_atendimento.commercial_contact_permission_events('))
    assert.equal(permissionEvent.params[7], 'manager-1')
    const permissionTraceId = String(permissionEvent.params[8])
    assert.match(permissionTraceId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
    const permissionAudit = queries.find(({ sql, params }) => sql.startsWith('insert into crm_atendimento.audit_events(')
        && params[0] === 'commercial.contact_permission.recorded')
    assert.doesNotMatch(JSON.stringify(permissionAudit.params), /5511999999999/)
    assert.match(String(permissionAudit.params[1]), /manager-1/)
    assert.equal(JSON.parse(permissionAudit.params[3]).traceId, permissionTraceId)

    const contacted = await store.updateCommercialAction('action-1', { status: 'contacted' }, actor)
    assert.equal(contacted.status, 'contacted')
    assert.equal(actionUpdated, true)
    const actionEvent = queries.find(({ sql }) => sql.startsWith('insert into crm_atendimento.commercial_action_events('))
    assert.equal(actionEvent.params[0], 'action-1')
    assert.equal(actionEvent.params[2], 'updated')
    assert.equal(actionEvent.params[3], 'open')
    assert.equal(actionEvent.params[4], 'contacted')
    const actionTraceId = String(actionEvent.params[5])
    assert.match(actionTraceId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
    assert.doesNotMatch(JSON.stringify(actionEvent.params), /5511999999999/)
    const actionAudit = queries.find(({ sql, params }) => sql.startsWith('insert into crm_atendimento.audit_events(')
        && params[0] === 'commercial.action.updated')
    assert.equal(JSON.parse(actionAudit.params[3]).traceId, actionTraceId)
    assert.equal(queries.filter(({ sql }) => sql === 'set transaction isolation level read committed').length, 2)
    const advisoryLocks = queries.filter(({ sql }) => sql.includes('pg_advisory_xact_lock'))
    // Each commercial transaction also takes the shared identity-graph lock,
    // before its narrower contact/identity locks.  That keeps a source
    // materialization from rebinding an identity while consent is written.
    assert.equal(advisoryLocks.length, 5)
    assert.equal(advisoryLocks.filter(({ params }) => params?.[0] === 'crm_atendimento.identity_graph_materialization').length, 2)
    assert.equal(advisoryLocks.some(({ params }) => params?.[0] === 'skincos.contact-phone:5511999999999'), true)
    assert.ok(
        queries.findIndex(({ sql, params }) => sql.includes('skincos.contact-phone') && params?.[0] === 'skincos.contact-phone:5511999999999')
        < queries.findIndex(({ sql }) => sql.includes('from harmonia.contacts') && sql.includes('for update')),
    )
    assert.equal(queries.some(({ sql }) => sql.includes('from harmonia.contacts') && sql.includes('for update')), true)

    rolloutEnabled = false
    actionUpdated = false
    await assert.rejects(() => store.updateCommercialAction('action-1', { status: 'contacted' }, actor), /COMMERCIAL_CONTACT_ROLLOUT_DISABLED/)
    assert.equal(actionUpdated, false)

    rolloutEnabled = true
    canaryIdentityIds = []
    await assert.rejects(() => store.updateCommercialAction('action-1', { status: 'contacted' }, actor), /COMMERCIAL_CONTACT_CANARY_REQUIRED/)

    canaryIdentityIds = ['identity-1']
    recentContact = true
    actionUpdated = false
    await assert.rejects(() => store.updateCommercialAction('action-1', { status: 'contacted' }, actor), /COMMERCIAL_CONTACT_COOLDOWN_ACTIVE/)
    assert.equal(actionUpdated, false)

    recentContact = false
    harmoniaOptedOut = true
    actionUpdated = false
    await assert.rejects(() => store.updateCommercialAction('action-1', { status: 'contacted' }, actor), /COMMERCIAL_CONTACT_BLOCKED/)
    assert.equal(actionUpdated, false)

    await assert.rejects(() => store.recordCommercialContactPermission({
        identityId: 'identity-1', status: 'denied', source: 'operador', evidenceReference: 'ref-2',
    }, { role: 'GESTOR' }), /ACTOR_IDENTITY_REQUIRED/)
})

test('serializes concurrent contacted transitions so only one action can consume a contact cooldown window', async () => {
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    let contactRecorded = false
    let lockTail = Promise.resolve()

    const runQuery = async (client, input, params = []) => {
        const sql = String(input || '').replace(/\s+/g, ' ').trim()
        if (sql === 'commit' || sql === 'rollback') {
            client.releaseIdentityLock?.()
            client.releaseIdentityLock = null
            return { rows: [], rowCount: 0 }
        }
        if (sql.includes('pg_advisory_xact_lock') && params?.[0] === 'crm_atendimento.commercial-contact:identity-1') {
            const previous = lockTail
            let release
            lockTail = new Promise((resolve) => { release = resolve })
            await previous
            client.releaseIdentityLock = release
            return { rows: [], rowCount: 1 }
        }
        if (sql.includes("to_regclass('crm_atendimento.global_client_identities')")) {
            return { rows: [{ identities: 'crm_atendimento.global_client_identities', members: 'crm_atendimento.global_client_identity_members', attendance_links: 'crm_atendimento.attendance_client_links', sales: 'crm_caixa.sales' }], rowCount: 1 }
        }
        if (sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')")) return { rows: [availability], rowCount: 1 }
        if (sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action')) {
            return { rows: [{ id: params[0], identity_id: 'identity-1', status: 'open', contacted_at: null }], rowCount: 1 }
        }
        if (sql.startsWith('select identity_id::text as identity_id, channel, status, evidence_source')) {
            return { rows: [{ identity_id: 'identity-1', channel: 'whatsapp', status: 'granted', evidence_source: 'synthetic', evidence_reference: 'synthetic:consent', expires_at: null, recorded_by: 'manager-1', updated_at: '2026-08-04T12:00:00.000Z' }], rowCount: 1 }
        }
        if (sql.includes('join crm_caixa.customers customer')) return { rows: [{ identity_id: 'identity-1', phone_key: '5511999999999' }], rowCount: 1 }
        if (sql.includes('from harmonia.contacts')) return { rows: [{ phone_raw: '5511999999999', opted_out_at: null }], rowCount: 1 }
        if (sql.includes('select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids')) {
            return { rows: [{ commercial_contact_writes_enabled: true, commercial_contact_canary_identity_ids: ['identity-1'] }], rowCount: 1 }
        }
        if (sql.startsWith('select active_contact_cooldown_days from crm_atendimento.commercial_policy_config')) return { rows: [{ active_contact_cooldown_days: 30 }], rowCount: 1 }
        if (sql.includes('contacted_at >= now()')) return { rows: contactRecorded ? [{ id: 'action-first', contacted_at: '2026-08-04T12:00:00.000Z' }] : [], rowCount: contactRecorded ? 1 : 0 }
        if (sql.startsWith('update crm_atendimento.commercial_actions')) {
            contactRecorded = true
            return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
    }
    const pool = {
        async connect() {
            const client = {
                releaseIdentityLock: null,
                query(sql, params) { return runQuery(client, sql, params) },
                release() {},
            }
            return client
        },
        query(sql, params) {
            return runQuery({ releaseIdentityLock: null }, sql, params)
        },
    }
    const store = createAtendimentoStore({ pool })
    const actor = { id: 'manager-1', role: 'GESTOR' }
    const settled = await Promise.allSettled([
        store.updateCommercialAction('action-a', { status: 'contacted' }, actor),
        store.updateCommercialAction('action-b', { status: 'contacted' }, actor),
    ])

    assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(settled.filter((result) => result.status === 'rejected').length, 1)
    const rejected = settled.find((result) => result.status === 'rejected')
    assert.match(String(rejected?.reason), /COMMERCIAL_CONTACT_COOLDOWN_ACTIVE/)
})

test('does not allow an action with a recorded contact to re-enter contacted', async () => {
    const availability = {
        permissions: 'crm_atendimento.commercial_contact_permissions',
        permission_events: 'crm_atendimento.commercial_contact_permission_events',
        action_events: 'crm_atendimento.commercial_action_events',
        harmonia_contacts: 'harmonia.contacts',
        caixa_customers: 'crm_caixa.customers',
        app_registrations: null,
        lead_profiles: null,
        permission_event_trace_id: true,
        permission_events_immutable: true,
        permission_events_no_truncate: true,
        action_events_immutable: true,
        action_events_no_truncate: true,
        action_channel: true,
        action_contacted_at: true,
        rollout_enabled: true,
        rollout_canary: true,
    }
    const pool = createFakePool([
        (sql) => sql.includes("to_regclass('crm_atendimento.commercial_contact_permissions')") && { rows: [availability], rowCount: 1 },
        (sql) => sql.includes('from crm_atendimento.commercial_actions action') && sql.includes('for update of action') && {
            rows: [{ id: 'action-1', identity_id: 'identity-1', status: 'open', contacted_at: '2026-08-04T12:00:00.000Z' }],
            rowCount: 1,
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.updateCommercialAction('action-1', { status: 'contacted' }, { id: 'manager-1', role: 'GESTOR' }),
        /COMMERCIAL_CONTACT_ALREADY_RECORDED/,
    )
})

test('initializes Atendimento schema once when concurrent reads arrive', async () => {
    let transactions = 0
    const fakePool = createFakePool([
        (sql) => {
            if (sql === 'begin') transactions += 1
            return null
        },
        (sql) => sql.includes('select slug, name from crm_atendimento.units order by name') && {
            rows: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && { rows: [], rowCount: 0 },
        (sql) => sql.includes('from crm_atendimento.procedures') && { rows: [], rowCount: 0 },
    ])
    const store = createAtendimentoStore({ pool: fakePool })

    await Promise.all([
        store.references({ role: 'GESTOR' }),
        store.references({ role: 'GESTOR' }),
        store.references({ role: 'GESTOR' }),
    ])

    assert.equal(transactions, 1)
})

test('retries Atendimento schema initialization after a transient failure', async () => {
    let firstMigration = true
    let transactions = 0
    const fakePool = createFakePool([
        (sql) => {
            if (sql === 'begin') transactions += 1
            if (sql.includes('create extension if not exists pgcrypto') && firstMigration) {
                firstMigration = false
                throw new Error('transient migration failure')
            }
            return null
        },
        (sql) => sql.includes('select slug, name from crm_atendimento.units order by name') && {
            rows: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && { rows: [], rowCount: 0 },
        (sql) => sql.includes('from crm_atendimento.procedures') && { rows: [], rowCount: 0 },
    ])
    const store = createAtendimentoStore({ pool: fakePool })

    await assert.rejects(() => store.references({ role: 'GESTOR' }), /transient migration failure/)
    await store.references({ role: 'GESTOR' })

    assert.equal(transactions, 2)
})

test('imports source rows with one actor value for both audit columns', async () => {
    const queries = []
    const fakePool = createFakePool([
        (sql, params) => {
            queries.push({ sql, params })
            if (sql.startsWith('insert into crm_atendimento.units(')) {
                return { rows: [{ id: 'unit-1', slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], rowCount: 1 }
            }
            if (sql.startsWith('insert into crm_atendimento.procedures(')) {
                return { rows: [{ id: 'procedure-1', name: 'Botox' }], rowCount: 1 }
            }
            if (sql.startsWith('insert into crm_atendimento.attendances(')) {
                return { rows: [{ id: 'attendance-1', inserted: true }], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool: fakePool })

    const result = await store.importRecords({
        records: [{
            unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', date: '2026-07-24',
            clientName: 'Cliente', procedureName: 'Botox', code: '#0699', quantity: 1,
            discount: false, otherValue: 0, roundValue: false, value: 699,
            injectorName: '', consultantName: '', observation: '',
            sourceSheetId: 'sheet-1', sourceTab: 'Novo Hamburgo', sourceRow: 3,
        }],
        cache: { procedures: [], professionals: [], procedureCodes: [], schedules: [] },
        actor: { id: 'google-sheet-import', role: 'GESTOR' },
    })

    assert.deepEqual(result, { dryRun: false, records: 1, inserted: 1, updated: 0, skipped: 0 })
    const write = queries.find(({ sql }) => sql.startsWith('insert into crm_atendimento.attendances('))
    assert.match(write.sql, /values \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14,\$15,\$16,\$17,\$18,\$19,\$19\)/)
    assert.equal(write.params.at(-1), 'google-sheet-import')
})

test('rejects a direct non-manager attempt to replace the persisted consultant before any write', async () => {
    const queries = []
    const fakePool = createFakePool([
        (sql) => {
            queries.push(sql)
            if (!sql.includes('from crm_atendimento.attendances a') || !sql.includes('where a.id = $1')) return null
            return {
                rows: [{
                    id: 'attendance-1', unit_slug: 'novo-hamburgo', unit_name: 'Novo Hamburgo',
                    service_date: '2026-07-10', client_name: 'Cliente', procedure_name: 'Botox', code: '#0799',
                    quantity: 1, discount: false, other_value: 0, round_value: false, value: 799, revision: 1,
                    injector_canonical_id: 'injector-1', injector_name: 'Dra. A',
                    consultant_canonical_id: 'consultant-1', consultant_name: 'Vitória Silva',
                }], rowCount: 1,
            }
        },
    ])
    const store = createAtendimentoStore({ pool: fakePool })

    await assert.rejects(
        () => store.updateAttendance('attendance-1', { revision: 1, consultantId: 'consultant-2' }, {
            id: 'injector-user', role: 'INJETOR', allowedUnits: ['novo-hamburgo'],
        }),
        { message: 'CONSULTANT_ASSIGNMENT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(queries.some((sql) => sql.startsWith('update crm_atendimento.attendances set')), false)
})

test('rejects a consultant attempt to replace the injector before any write', async () => {
    const queries = []
    const fakePool = createFakePool([
        (sql) => {
            queries.push(sql)
            if (!sql.includes('from crm_atendimento.attendances a') || !sql.includes('where a.id = $1')) return null
            return {
                rows: [{
                    id: 'attendance-1', unit_slug: 'novo-hamburgo', unit_name: 'Novo Hamburgo',
                    service_date: '2026-07-10', client_name: 'Cliente', procedure_name: 'Botox', code: '#0799',
                    quantity: 1, discount: false, other_value: 0, round_value: false, value: 799, revision: 1,
                    injector_canonical_id: 'injector-1', injector_name: 'Dra. A',
                    consultant_canonical_id: 'consultant-1', consultant_name: 'Vitória Silva',
                }], rowCount: 1,
            }
        },
    ])
    const store = createAtendimentoStore({ pool: fakePool })

    await assert.rejects(
        () => store.updateAttendance('attendance-1', { revision: 1, injectorId: 'injector-2' }, {
            id: 'consultant-user', role: 'CONSULTOR', allowedUnits: ['novo-hamburgo'],
        }),
        { message: 'INJECTOR_ASSIGNMENT_FORBIDDEN', statusCode: 403 },
    )
    assert.equal(queries.some((sql) => sql.startsWith('update crm_atendimento.attendances set')), false)
})

test('exposes a single canonical professional reference for confirmed aliases', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('select slug, name from crm_atendimento.units order by name') && {
            rows: [{ slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }], rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && {
            rows: [
                { id: 'raul-short', name: 'Raul Júnior', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'], turnos: [] },
                { id: 'raul-full', name: 'Raul Rosário Júnior', role: 'Injetor', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'], turnos: [] },
                { id: 'doris-short', name: 'Dóris Moisyn', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'], turnos: [] },
                { id: 'doris-full', name: 'Dóris Caroline Moisyn', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'], turnos: [] },
            ], rowCount: 4,
        },
        (sql) => sql.includes('from crm_atendimento.procedures') && { rows: [], rowCount: 0 },
    ])

    const refs = await createAtendimentoStore({ pool: fakePool }).references({ role: 'GESTOR' })
    assert.deepEqual(refs.professionals.map((item) => item.name), ['Dóris Caroline Moisyn', 'Dóris Moisyn', 'Raul Rosário Júnior'])
    assert.deepEqual(refs.professionals.find((item) => item.name === 'Raul Rosário Júnior')?.units.sort(), ['BarraShoppingSul', 'Novo Hamburgo'])
})

test('searches client suggestions only within the requested unit', async () => {
    const fakePool = createFakePool([
        (sql, params) => sql.includes('with candidates as') && {
            rows: [{ name: 'Cynthia Cordova', usage_count: 2 }], rowCount: 1,
        },
    ])
    const store = createAtendimentoStore({ pool: fakePool })
    const result = await store.clients({ unit: 'barra-shopping-sul', q: 'cyn', limit: 8 }, { role: 'GESTOR' })

    assert.deepEqual(result.clients, [{ name: 'Cynthia Cordova', usageCount: 2 }])
    await assert.rejects(
        () => store.clients({ unit: 'barra-shopping-sul', q: 'cyn' }, { role: 'INJETOR', allowedUnits: ['novo-hamburgo'] }),
        { message: 'FORBIDDEN' },
    )
    await assert.rejects(
        () => store.clients({ unit: 'barra-shopping-sul', q: 'cyn' }, { role: 'INJETOR', allowedUnits: [] }),
        { message: 'FORBIDDEN' },
    )
})

test('fails closed for read operations when an actor has an explicit empty unit scope', async () => {
    const captured = []
    const fakePool = createFakePool([
        (sql) => sql.includes('from crm_atendimento.units order by name') && {
            rows: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && {
            rows: [{ id: 'doctor-1', name: 'Dra. A', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] }], rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.procedures') && { rows: [], rowCount: 0 },
        (sql, params) => sql.includes('count(*)::int as total_attendances') && (() => {
            captured.push({ sql, params })
            return { rows: [{ total_attendances: 0, quantity_total: 0, total_value: 0, distinct_clients: 0 }], rowCount: 1 }
        })(),
        (sql) => sql.includes("to_char(a.service_date, 'YYYY-MM') as month") && { rows: [], rowCount: 0 },
        (sql) => sql.includes('p.name as label') && { rows: [], rowCount: 0 },
        (sql) => sql.includes("coalesce(nullif(inj.name, ''), 'Sem injetor') as label") && { rows: [], rowCount: 0 },
        (sql) => sql.includes("coalesce(nullif(con.name, ''), 'Sem consultor') as label") && { rows: [], rowCount: 0 },
    ])
    const store = createAtendimentoStore({ pool: fakePool })
    const actor = { role: 'INJETOR', allowedUnits: [] }

    const refs = await store.references(actor)
    await store.overview({}, actor)

    assert.deepEqual(refs.units, [])
    assert.deepEqual(refs.professionals, [])
    assert.match(captured[0].sql, /1 = 0/)
})

test('filters raw conversion sections before returning them to a unit-restricted actor', () => {
    const report = filterConversionReportToActorScope({
        sections: [
            { unitSlug: 'novo-hamburgo', rows: [{ id: 1 }] },
            { unitSlug: 'barra-shopping-sul', rows: [{ id: 2 }, { id: 3 }] },
        ],
        summary: { sections: 2, rows: 3 },
    }, {}, { role: 'INJETOR', allowedUnits: ['novo-hamburgo'] })

    assert.deepEqual(report.sections.map((section) => section.unitSlug), ['novo-hamburgo'])
    assert.deepEqual(report.summary, { sections: 1, rows: 1 })
})

test('calculates a consolidated all-units conversion view from summed unit capacity', async () => {
    const fakePool = createFakePool(buildConversionPoolHandlers())

    const store = createAtendimentoStore({ pool: fakePool })
    const report = await store.managementConversionReport({ unit: 'all', date: '2026-06-16' }, { role: 'GESTOR' })

    assert.equal(report.doctorRanking.sections[0].unitSlug, 'all')
    assert.equal(report.doctorRanking.sections[0].isAggregate, true)
    assert.equal(report.doctorRanking.sections[0].aggregateNotice, undefined)
    assert.equal(report.doctorRanking.sections[0].metrics.periodAttendanceTotal.weekValue, 23)
    assert.equal(report.doctorRanking.sections[0].metrics.periodGoal.weekValue, 120)
    assert.equal(report.doctorRanking.sections[0].metrics.periodOperationalDays.weekValue, 2)
    assert.equal(report.doctorRanking.sections[0].doctors.length, 2)
    assert.equal(report.doctorRanking.sections[0].calendarMode, 'per-unit-capacity-sum')
    assert.equal(report.doctorRanking.sections[0].calendarCompatible, false)
    assert.equal(report.doctorRanking.sections[0].optimization.statusCode, 'INSUFFICIENT_DOCTORS')
    assert.equal(report.doctorRanking.topDoctors[0].name, 'Dra. A')
})

test('ranks all-units doctors by the points earned in each unit instead of raw production', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('from crm_atendimento.professionals') && {
            rows: [
                { id: 'doctor-points', name: 'Dra. Pontos', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
                { id: 'doctor-support', name: 'Dra. Apoio', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
                { id: 'doctor-raw', name: 'Dra. Bruta', role: 'Injetor', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'] },
                { id: 'doctor-base', name: 'Dra. Base', role: 'Injetor', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'] },
            ], rowCount: 4,
        },
        (sql) => sql.includes('coalesce(sum(a.value), 0)::numeric as total') && sql.includes('group by u.slug') && !sql.includes('inj.id') && {
            rows: [
                { unit_slug: 'novo-hamburgo', total: 15 },
                { unit_slug: 'barra-shopping-sul', total: 170 },
            ], rowCount: 2,
        },
        (sql) => sql.includes('as doctor_id') && {
            rows: [
                { unit_slug: 'novo-hamburgo', doctor_id: 'doctor-points', doctor_name: 'Dra. Pontos', total: 14 },
                { unit_slug: 'novo-hamburgo', doctor_id: 'doctor-support', doctor_name: 'Dra. Apoio', total: 1 },
                { unit_slug: 'barra-shopping-sul', doctor_id: 'doctor-raw', doctor_name: 'Dra. Bruta', total: 90 },
                { unit_slug: 'barra-shopping-sul', doctor_id: 'doctor-base', doctor_name: 'Dra. Base', total: 80 },
            ], rowCount: 4,
        },
        (sql) => sql.includes('from crm_atendimento.schedule_days') && {
            rows: [
                { unit_slug: 'novo-hamburgo', service_date: '2026-06-08', doctor_name: 'Dra. Pontos' },
                { unit_slug: 'barra-shopping-sul', service_date: '2026-06-08', doctor_name: 'Dra. Bruta' },
            ], rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goals') && {
            rows: [
                { unit_slug: 'novo-hamburgo', goal_month: '2026-06-01', value: 0 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', value: 500 },
            ], rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goal_levels') && {
            rows: [
                { unit_slug: 'novo-hamburgo', goal_month: '2026-06-01', level_key: 'first', value: 0 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', level_key: 'first', value: 500 },
            ], rowCount: 2,
        },
        ...buildConversionPoolHandlers(),
    ])

    const report = await createAtendimentoStore({ pool: fakePool }).managementConversionReport({ unit: 'all', date: '2026-06-16' }, { role: 'GESTOR' })
    const section = report.doctorRanking.sections[0]

    assert.equal(section.comparisonMetric, 'unit-score')
    assert.equal(section.doctors[0].name, 'Dra. Pontos')
    assert.ok(section.doctors[0].score > section.doctors.find((doctor) => doctor.name === 'Dra. Bruta').score)
    assert.ok(section.doctors.find((doctor) => doctor.name === 'Dra. Bruta').weekValue > section.doctors[0].weekValue)
    assert.equal(report.doctorRanking.topDoctors[0].name, 'Dra. Pontos')
})

test('exposes period goal and hides monthly goal in unit conversion metrics', async () => {
    const fakePool = createFakePool(buildConversionPoolHandlers())

    const store = createAtendimentoStore({ pool: fakePool })
    const report = await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-16' }, { role: 'GESTOR' })
    const metrics = report.doctorRanking.sections[0].metrics || {}
    const goalPlan = report.doctorRanking.sections[0].goalPlan
    const optimization = report.doctorRanking.sections[0].optimization

    assert.equal(report.doctorRanking.sections[0].unitSlug, 'novo-hamburgo')
    assert.equal(metrics.periodGoal?.label, 'Meta do período')
    assert.equal(metrics.periodGoal?.weekValue, 80)
    assert.equal(metrics.dailyGoal?.weekValue, 80)
    assert.equal(metrics.intervalMultiplier?.label, 'Multiplicador Otimizado')
    assert.equal(metrics.homogeneityScore?.label, 'Homogeneidade')
    assert.equal(typeof metrics.level0?.proportion, 'number')
    assert.equal(metrics.lowerSide?.label, 'Lado Inferior')
    assert.equal(optimization?.objectiveName, 'sse_uniform')
    assert.equal(optimization?.statusCode, 'INSUFFICIENT_DOCTORS')
    assert.equal(Object.values(optimization?.counts || {}).reduce((sum, value) => sum + value, 0), 1)
    assert.equal(Object.values(optimization?.proportions || {}).reduce((sum, value) => sum + value, 0), 1)
    assert.match(optimization?.configHash || '', /^fnv1a-/)
    assert.equal('monthlyGoal' in metrics, false)
    assert.equal(goalPlan?.periodOperationalDays, 1)
    assert.equal(goalPlan?.periodGoal, 80)
    assert.equal(goalPlan?.dailyGoal, 80)
    assert.equal(goalPlan?.segments?.length, 1)
    assert.equal(goalPlan?.segments?.[0]?.monthKey, '2026-06-01')
    assert.equal(report.summary?.scheduleSource, 'crm')
})

test('returns segmented goal plan for cross-month periods without distorting the period goal', async () => {
    const conversionRows = buildConversionRawRows()
    const fakePool = createFakePool([
        (sql) => sql.includes('select source_tab, source_row, cells') && { rows: conversionRows, rowCount: conversionRows.length },
        (sql) => sql.includes('from crm_atendimento.units u') && {
            rows: [{ id: 'unit-bss', slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }],
            rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && {
            rows: [{ id: 'doc-b', name: 'Dra. B', role: 'Injetor', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'] }],
            rowCount: 1,
        },
        (sql) => sql.includes('coalesce(sum(a.value), 0)::numeric as total') && sql.includes('group by u.slug') && !sql.includes('inj.id') && {
            rows: [{ unit_slug: 'barra-shopping-sul', total: 30000 }],
            rowCount: 1,
        },
        (sql) => sql.includes('as doctor_id') && {
            rows: [{ unit_slug: 'barra-shopping-sul', doctor_id: 'doc-b', doctor_name: 'Dra. B', total: 30000, attended_days: 30 }],
            rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.schedule_days') && { rows: [], rowCount: 0 },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goals') && {
            rows: [
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-05-01', value: 31000 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', value: 30000 },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goal_levels') && {
            rows: [
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-05-01', level_key: 'first', value: 31000 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', level_key: 'first', value: 30000 },
            ],
            rowCount: 2,
        },
    ])

    const store = createAtendimentoStore({ pool: fakePool })
    const report = await store.managementConversionReport(
        { unit: 'barra-shopping-sul', date: '2026-06-13', from: '2026-05-15', to: '2026-06-13' },
        { role: 'GESTOR' },
    )
    const section = report.doctorRanking.sections[0]

    assert.equal(section.metrics.periodAttendanceTotal?.weekValue, 30000)
    assert.equal(section.metrics.periodAttendanceTotal?.label, 'Total')
    assert.equal(section.metrics.rankedDoctorTotal?.weekValue, 30000)
    assert.equal(section.metrics.standardDeviation?.label, 'Desvio Padrão diário')
    assert.equal(section.metrics.upperLimit?.label, 'Limite Superior diário')
    assert.equal(section.metrics.lowerLimit?.label, 'Limite Inferior diário')
    assert.equal(section.metrics.ratioDivisor?.label, 'Divisor Razões')
    assert.equal(section.doctors[0]?.workingDays, 30)
    assert.equal(section.doctors[0]?.totalValue, 30000)
    assert.equal(section.doctors[0]?.weekValue, 1000)
    assert.equal(section.metrics.periodGoal?.weekValue, 30000)
    assert.equal(section.metrics.dailyGoal?.weekValue, 1000)
    assert.equal(section.goalPlan?.periodOperationalDays, 30)
    assert.equal(section.goalPlan?.periodGoal, 30000)
    assert.equal(section.goalPlan?.dailyGoal, 1000)
    assert.equal(section.goalPlan?.segments?.length, 2)
    assert.equal(section.goalPlan?.segments?.[0]?.monthKey, '2026-05-01')
    assert.equal(section.goalPlan?.segments?.[0]?.monthOperationalDays, 31)
    assert.equal(section.goalPlan?.segments?.[0]?.periodOperationalDays, 17)
    assert.equal(section.goalPlan?.segments?.[0]?.periodGoal, 17000)
    assert.equal(section.goalPlan?.segments?.[1]?.monthKey, '2026-06-01')
    assert.equal(section.goalPlan?.segments?.[1]?.monthOperationalDays, 30)
    assert.equal(section.goalPlan?.segments?.[1]?.periodOperationalDays, 13)
    assert.equal(section.goalPlan?.segments?.[1]?.periodGoal, 13000)
})

test('persists nullable conversion results idempotently and never reuses a non-applicable multiplier', async () => {
    const persisted = new Map()
    const unitNames = new Map([
        ['unit-nh', { unit_slug: 'novo-hamburgo', unit_name: 'Novo Hamburgo' }],
        ['unit-bss', { unit_slug: 'barra-shopping-sul', unit_name: 'BarraShoppingSul' }],
    ])
    const stateHandlers = [
        (sql, params) => sql.includes('from crm_atendimento.units u') && {
            rows: [...unitNames.entries()]
                .map(([id, unit]) => ({ id, slug: unit.unit_slug, name: unit.unit_name }))
                .filter((unit) => !params.length || params.includes(unit.slug)),
            rowCount: 1,
        },
        (sql) => sql.includes('select * from crm_atendimento.doctor_conversion_config') && {
            rows: [{
                default_interval_multiplier: null,
                interval_multiplier_min: 0,
                interval_multiplier_max: 2,
                objective_name: 'sse_uniform',
                require_all_bands_if_possible: true,
                require_extremes_if_possible: true,
                stability_tie_break: true,
                tie_break_policy: 'previous_then_widest_plateau_center',
                unstable_jump_threshold: 0.5,
            }],
            rowCount: 1,
        },
        (sql, params) => sql.includes('select distinct on (r.unit_id)') && {
            rows: [...persisted.values()]
                .filter((row) => params[0].includes(row.unit_id) && row.period_end < params[1] && row.selected_multiplier != null)
                .sort((left, right) => right.period_end.localeCompare(left.period_end))
                .filter((row, index, rows) => rows.findIndex((candidate) => candidate.unit_id === row.unit_id) === index),
            rowCount: persisted.size,
        },
        (sql, params) => sql.includes('insert into crm_atendimento.doctor_conversion_results(') && (() => {
            const unit = unitNames.get(params[0]) || { unit_slug: '', unit_name: '' }
            const key = `${params[0]}:${params[1]}:${params[2]}:${params[15]}:${params[16]}`
            persisted.set(key, {
                id: key,
                unit_id: params[0],
                ...unit,
                period_start: params[1],
                period_end: params[2],
                report_date: params[3],
                week_of_month: params[4],
                selected_multiplier: params[5],
                previous_interval_multiplier: params[6],
                selection_reason: params[7],
                optimal_plateau: params[8] ? JSON.parse(params[8]) : null,
                homogeneity_score: params[9],
                homogeneity_loss: params[10],
                status_code: params[11],
                optimization_status_code: params[12],
                counts: JSON.parse(params[13]),
                proportions: JSON.parse(params[14]),
                config_hash: params[15],
                calendar_hash: params[16],
                payload: JSON.parse(params[17]),
                computed_at: '2026-06-20T12:00:00.000Z',
            })
            return { rows: [], rowCount: 1 }
        })(),
        (sql, params) => sql.includes('select latest.*') && {
            rows: [...persisted.values()]
                .filter((row) => !params[0] || row.unit_slug === params[0])
                .sort((left, right) => right.period_end.localeCompare(left.period_end))
                .slice(0, Number(params.at(-1) || 12)),
            rowCount: persisted.size,
        },
    ]
    const fakePool = createFakePool([...stateHandlers, ...buildConversionPoolHandlers()])
    const store = createAtendimentoStore({ pool: fakePool })
    const actor = { role: 'GESTOR' }

    const first = await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-07', from: '2026-06-01', to: '2026-06-07' }, actor, { persist: true })
    const second = await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-14', from: '2026-06-08', to: '2026-06-14' }, actor, { persist: true })
    await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-14', from: '2026-06-08', to: '2026-06-14' }, actor, { persist: true })

    const firstOptimization = first.doctorRanking.sections[0].optimization
    const secondSection = second.doctorRanking.sections[0]
    assert.equal(secondSection.optimization.previousIntervalMultiplier, firstOptimization.selectedMultiplier)
    assert.equal(secondSection.optimization.tieBreakPolicy, 'previous_then_widest_plateau_center')
    assert.equal(secondSection.optimization.statusCode, 'INSUFFICIENT_DOCTORS')
    assert.equal(secondSection.optimization.optimizationStatusCode, 'NO_VARIANCE')
    assert.equal(secondSection.optimization.selectedMultiplier, null)
    assert.equal(secondSection.optimization.selectionReason, 'not_applicable')
    assert.equal(secondSection.optimization.optimalPlateau, null)
    assert.deepEqual(secondSection.optimization.homogeneityCurve, [])
    assert.match(secondSection.optimization.configHash, /^fnv1a-/)
    assert.match(secondSection.optimization.calendarHash, /^calendar-fnv1a-/)
    assert.equal(Object.hasOwn(secondSection, 'history'), false)
    assert.equal(persisted.size, 2)
})

test('returns row-based overview metrics with explicit quantity totals', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('count(*)::int as total_attendances') && {
            rows: [{ total_attendances: 2, quantity_total: 3, total_value: 1598, distinct_clients: 1 }],
            rowCount: 1,
        },
        (sql) => sql.includes("to_char(a.service_date, 'YYYY-MM') as month") && {
            rows: [{ month: '2026-06', count: 2, quantity_total: 3, value: 1598 }],
            rowCount: 1,
        },
        (sql) => sql.includes('p.name as label') && {
            rows: [{ label: 'Botox', count: 2, quantity_total: 3, value: 1598 }],
            rowCount: 1,
        },
        (sql) => sql.includes("coalesce(nullif(inj.name, ''), 'Sem injetor') as label") && {
            rows: [{ label: 'Dra. A', count: 2, quantity_total: 3, value: 1598 }],
            rowCount: 1,
        },
        (sql) => sql.includes("coalesce(nullif(con.name, ''), 'Sem consultor') as label") && {
            rows: [{ label: 'Consultora A', count: 2, quantity_total: 3, value: 1598 }],
            rowCount: 1,
        },
    ])

    const store = createAtendimentoStore({ pool: fakePool })
    const overview = await store.overview({}, { role: 'GESTOR' })

    assert.equal(overview.summary.totalAttendances, 2)
    assert.equal(overview.summary.quantityTotal, 3)
    assert.equal(overview.summary.countMode, 'row')
    assert.equal(overview.summary.averageTicket, 799)
    assert.equal(overview.summary.distinctClients, 1)
    assert.equal(overview.monthly[0].quantityTotal, 3)
    assert.equal(overview.rankings.procedures[0].quantityTotal, 3)
})

test('applies all attendance filters together before calculating overview metrics', async () => {
    const captured = []
    const fakePool = createFakePool([
        (sql, params) => sql.includes('count(*)::int as total_attendances') && (() => {
            captured.push({ sql, params })
            return { rows: [{ total_attendances: 0, quantity_total: 0, total_value: 0, distinct_clients: 0 }], rowCount: 1 }
        })(),
        (sql) => sql.includes("to_char(a.service_date, 'YYYY-MM') as month") && { rows: [], rowCount: 0 },
        (sql) => sql.includes('p.name as label') && { rows: [], rowCount: 0 },
        (sql) => sql.includes("coalesce(nullif(inj.name, ''), 'Sem injetor') as label") && { rows: [], rowCount: 0 },
        (sql) => sql.includes("coalesce(nullif(con.name, ''), 'Sem consultor') as label") && { rows: [], rowCount: 0 },
    ])
    await createAtendimentoStore({ pool: fakePool }).overview({
        unit: 'novo-hamburgo',
        from: '2026-06-01',
        to: '2026-06-30',
        procedure: 'Botox',
        code: '#0799',
        injector: 'Dra. A',
        consultant: 'Consultora A',
        search: 'cliente',
    }, { role: 'INJETOR', allowedUnits: ['novo-hamburgo'] })

    assert.equal(captured.length, 1)
    assert.match(captured[0].sql, /u\.slug = any\(\$1\)/)
    assert.match(captured[0].sql, /a\.service_date >=/)
    assert.match(captured[0].sql, /a\.service_date <=/)
    assert.match(captured[0].sql, /p\.name =/)
    assert.match(captured[0].sql, /a\.code =/)
    assert.match(captured[0].sql, /inj\.name =/)
    assert.match(captured[0].sql, /con\.name =/)
    assert.match(captured[0].sql, /lower\(a\.client_name\) like/)
})

test('returns finance totals with explicit quantity totals by unit', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes("from crm_atendimento.management_items") && {
            rows: [{ source_tab: 'Caixa', source_row: 1, category: 'finance', label: 'Linha', active: true, sensitive: false, unit_slug: 'novo-hamburgo', record_date: '2026-06-10', payload: {}, imported_at: null, id: 'item-1' }],
            rowCount: 1,
        },
        (sql) => sql.includes('count(*)::int as count') && sql.includes('group by u.slug, u.name') && {
            rows: [{ unit_slug: 'novo-hamburgo', unit_name: 'Novo Hamburgo', count: 2, quantity_total: 3, value: 1598 }],
            rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goals g') && { rows: [], rowCount: 0 },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goal_levels gl') && { rows: [], rowCount: 0 },
        (sql) => sql.includes('select slug, name from crm_atendimento.units order by name') && {
            rows: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
            rowCount: 1,
        },
        (sql) => sql.includes('from crm_atendimento.goal_table_rows') && { rows: [], rowCount: 0 },
    ])

    const store = createAtendimentoStore({ pool: fakePool })
    const finance = await store.managementFinance({ role: 'GESTOR' })

    assert.equal(finance.attendanceTotals?.units[0].count, 2)
    assert.equal(finance.attendanceTotals?.units[0].quantityTotal, 3)
    assert.equal(finance.attendanceTotals?.units[0].value, 1598)
})

test('does not suggest injector names on closed no-service days', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('from crm_atendimento.schedule_days s') && sql.includes('limit 1') && {
            rows: [{ date: '2026-06-10', doctor_name: 'Sem Atendimento', unit_slug: 'novo-hamburgo', unit_name: 'Novo Hamburgo' }],
            rowCount: 1,
        },
    ])

    const store = createAtendimentoStore({ pool: fakePool })
    const result = await store.doctorSuggestion({ unit: 'novo-hamburgo', date: '2026-06-10' }, { role: 'GESTOR' })

    assert.equal(result.doctorName, '')
})

test('reads conversion configuration without repairing or mutating it', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('update crm_atendimento.doctor_conversion_config set config_hash') && (() => {
            throw new Error('READ_MUST_NOT_WRITE_CONFIG')
        })(),
        (sql) => sql.includes('select * from crm_atendimento.doctor_conversion_config') && {
            rows: [{
                default_interval_multiplier: null,
                interval_multiplier_min: 0,
                interval_multiplier_max: 2,
                objective_name: 'sse_uniform',
                require_all_bands_if_possible: true,
                require_extremes_if_possible: true,
                stability_tie_break: true,
                tie_break_policy: 'previous_then_widest_plateau_center',
                unstable_jump_threshold: 0.5,
                config_hash: 'legacy-stale-hash',
            }],
            rowCount: 1,
        },
    ])

    const result = await createAtendimentoStore({ pool: fakePool }).doctorConversionConfig()
    assert.match(result.config.configHash, /^fnv1a-/)
    assert.notEqual(result.config.configHash, 'legacy-stale-hash')
})

test('returns remuneration only as a versioned legacy preview policy', async () => {
    const fakePool = createFakePool([
        (sql) => sql.includes('a.value > 0') && sql.includes('order by inj.name, a.service_date asc') && {
            rows: [{
                id: 'attendance-1',
                unit_slug: 'novo-hamburgo',
                unit_name: 'Novo Hamburgo',
                service_date: '2026-06-10',
                client_name: 'Cliente',
                procedure_name: 'Botox',
                code: '#3000',
                quantity: 1,
                discount: false,
                other_value: 0,
                round_value: false,
                value: 3000,
                injector_name: 'Dra. A',
                consultant_name: '',
            }],
            rowCount: 1,
        },
    ])

    const preview = await createAtendimentoStore({ pool: fakePool }).reportPreview(
        { unit: 'novo-hamburgo', from: '2026-06-10', to: '2026-06-10' },
        { role: 'GESTOR' },
    )
    assert.equal(preview.doctors[0].remuneration, 300)
    assert.equal(preview.doctors[0].remunerationFormulaVersion, 'attendance-remuneration/legacy-preview-v1')
    assert.equal(preview.remunerationPolicy.businessStatus, 'pending_confirmation')
})

test('blocks a same-identity review undo when that historical identity has commercial evidence', async () => {
    const queries = []
    const sourceClientId = '11111111-1111-4111-8111-111111111111'
    const targetClientId = '22222222-2222-4222-8222-222222222222'
    const identityId = '33333333-3333-4333-8333-333333333333'
    const sourceVersion = '35c54b6916b6b8191a17f8500ab103d8'
    const pool = createFakePool([
        (sql, params) => {
            queries.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.client_merge_suggestions') as merges")) {
                return { rows: [{ merges: 'merges', attendance_caixa: 'links', app: 'app', leads: 'leads' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) {
                return {
                    rows: [{
                        registry: 'schema_migrations', decisions: 'identity_review_decisions', runs: 'identity_materialization_runs',
                        member_history: 'identity_member_history', lineage: 'identity_lineage', source_link_history: 'identity_source_link_history',
                        run_event_order: true, member_history_event_order: true, decision_resulting_status: true, decision_event_order: true,
                        decision_immutable: true, member_history_immutable: true, lineage_immutable: true, source_link_history_immutable: true,
                        decision_no_truncate: true, member_history_no_truncate: true, lineage_no_truncate: true, source_link_history_no_truncate: true,
                    }],
                    rowCount: 1,
                }
            }
            if (sql.startsWith('select id from crm_atendimento.schema_migrations')) {
                return { rows: [{ id: '20260805_identity_review_workflow_v1' }, { id: '20260805_identity_review_source_link_ledger_v1' }, { id: '20260805_identity_review_ledger_integrity_v1' }], rowCount: 3 }
            }
            if (sql.includes('from crm_atendimento.client_merge_suggestions m') && sql.includes('for update of m')) {
                return {
                    rows: [{
                        row_id: 'merge-1', status: 'confirmed', evidence: {}, review_version: sourceVersion,
                        source_name: 'Cliente A', target_name: 'Cliente B', context: {},
                    }],
                    rowCount: 1,
                }
            }
            if (sql.includes('from crm_atendimento.identity_review_decisions') && sql.includes('limit 1 for update')) {
                return {
                    rows: [{
                        id: 'decision-1', event_order: 10, decision: 'confirmed', source_status: 'pending', resulting_status: 'confirmed',
                        source_version: sourceVersion, materialization_run_id: 'run-1', source_snapshot: {}, created_at: '2026-08-05T00:00:00.000Z',
                    }],
                    rowCount: 1,
                }
            }
            if (sql.startsWith('update crm_atendimento.client_merge_suggestions')) {
                return { rows: [{ status: 'pending', review_version: '8af5f0ef4bd5fce3a63d653f7aef947e' }], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.identity_materialization_runs') && sql.includes('where id=$1::uuid for share')) {
                return {
                    rows: [{
                        event_order: 11,
                        summary: {
                            sourceIdentityId: identityId,
                            targetIdentityId: identityId,
                            survivorIdentityId: identityId,
                            retiredIdentityId: null,
                        },
                    }],
                    rowCount: 1,
                }
            }
            if (sql.startsWith('select details from crm_atendimento.schema_migrations')) {
                return { rows: [{ details: { sourceLinkLedgerCutoverRunEventOrder: 0 } }], rowCount: 1 }
            }
            if (sql.includes('from crm_atendimento.identity_materialization_runs') && sql.includes('where id=$1::uuid for update')) {
                return {
                    rows: [{
                        id: 'run-1', status: 'applied',
                        created_at: '2026-08-05T00:00:00.000Z',
                        summary: {
                            sourceIdentityId: identityId,
                            targetIdentityId: identityId,
                            survivorIdentityId: identityId,
                            retiredIdentityId: null,
                        },
                    }],
                    rowCount: 1,
                }
            }
            if (sql.includes('from crm_atendimento.identity_member_history where materialization_run_id=$1::uuid')) {
                return { rows: [], rowCount: 0 }
            }
            if (sql.includes('from crm_atendimento.commercial_actions where identity_id=any($1::uuid[])')) {
                return { rows: [{ actions: 1, permissions: 0, permission_events: 0, canary_entries: 0, audit_identity_events: 0 }], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.undoIdentityReviewDecision({
            reviewType: 'attendance_name_merge',
            sourceId: sourceClientId,
            targetId: targetClientId,
            expectedVersion: sourceVersion,
            reason: 'Há histórico comercial que impede a reversão automática.',
        }, { id: 'gestor-1', role: 'GESTOR' }),
        { message: 'IDENTITY_REVIEW_COMMERCIAL_HISTORY_PRESENT', statusCode: 409 },
    )

    const historyGuard = queries.find(({ sql }) => sql.includes('from crm_atendimento.commercial_actions where identity_id=any($1::uuid[])'))
    assert.deepEqual(historyGuard?.params, [[identityId]])
    assert.equal(queries.some(({ sql }) => sql.startsWith('insert into crm_atendimento.identity_materialization_runs(')), false)
    assert.equal(queries.some(({ sql }) => sql.startsWith('insert into crm_atendimento.identity_review_decisions(')), false)
})

test('blocks an undo when a later automatic source link remains active without a member move', async () => {
    const queries = []
    const sourceClientId = '11111111-1111-4111-8111-111111111111'
    const targetClientId = '22222222-2222-4222-8222-222222222222'
    const survivorIdentityId = '33333333-3333-4333-8333-333333333333'
    const retiredIdentityId = '44444444-4444-4444-8444-444444444444'
    const sourceVersion = '35c54b6916b6b8191a17f8500ab103d8'
    const pool = createFakePool([
        (sql, params) => {
            queries.push({ sql, params })
            if (sql.includes("to_regclass('crm_atendimento.client_merge_suggestions') as merges")) {
                return { rows: [{ merges: 'merges', attendance_caixa: 'links', app: 'app', leads: 'leads' }], rowCount: 1 }
            }
            if (sql.includes("to_regclass('crm_atendimento.schema_migrations') as registry")) {
                return {
                    rows: [{
                        registry: 'schema_migrations', decisions: 'identity_review_decisions', runs: 'identity_materialization_runs',
                        member_history: 'identity_member_history', lineage: 'identity_lineage', source_link_history: 'identity_source_link_history',
                        run_event_order: true, member_history_event_order: true, decision_resulting_status: true, decision_event_order: true,
                        decision_immutable: true, member_history_immutable: true, lineage_immutable: true, source_link_history_immutable: true,
                        decision_no_truncate: true, member_history_no_truncate: true, lineage_no_truncate: true, source_link_history_no_truncate: true,
                    }],
                    rowCount: 1,
                }
            }
            if (sql.startsWith('select id from crm_atendimento.schema_migrations')) {
                return { rows: [{ id: '20260805_identity_review_workflow_v1' }, { id: '20260805_identity_review_source_link_ledger_v1' }, { id: '20260805_identity_review_ledger_integrity_v1' }], rowCount: 3 }
            }
            if (sql.includes('from crm_atendimento.client_merge_suggestions m') && sql.includes('for update of m')) {
                return {
                    rows: [{
                        row_id: 'merge-1', status: 'confirmed', evidence: {}, review_version: sourceVersion,
                        source_name: 'Cliente A', target_name: 'Cliente B', context: {},
                    }],
                    rowCount: 1,
                }
            }
            if (sql.includes('from crm_atendimento.identity_review_decisions') && sql.includes('limit 1 for update')) {
                return {
                    rows: [{
                        id: 'decision-1', event_order: 10, decision: 'confirmed', source_status: 'pending', resulting_status: 'confirmed',
                        source_version: sourceVersion, materialization_run_id: 'run-1', source_snapshot: {}, created_at: '2026-08-05T00:00:00.000Z',
                    }],
                    rowCount: 1,
                }
            }
            if (sql.includes('from crm_atendimento.identity_materialization_runs') && sql.includes('where id=$1::uuid for share')) {
                return {
                    rows: [{
                        event_order: 22,
                        summary: {
                            sourceIdentityId: survivorIdentityId,
                            targetIdentityId: retiredIdentityId,
                            survivorIdentityId,
                            retiredIdentityId,
                        },
                    }],
                    rowCount: 1,
                }
            }
            if (sql.startsWith('select details from crm_atendimento.schema_migrations')) {
                return { rows: [{ details: { sourceLinkLedgerCutoverRunEventOrder: 0 } }], rowCount: 1 }
            }
            if (sql.includes('latest_source_links as (')) {
                return { rows: [{ link_type: 'attendance_caixa', source_type: 'attendance_client', source_id: sourceClientId }], rowCount: 1 }
            }
            return null
        },
    ])
    const store = createAtendimentoStore({ pool })

    await assert.rejects(
        () => store.undoIdentityReviewDecision({
            reviewType: 'attendance_name_merge',
            sourceId: sourceClientId,
            targetId: targetClientId,
            expectedVersion: sourceVersion,
            reason: 'Uma confirmação automática posterior ainda depende desta identidade.',
        }, { id: 'gestor-1', role: 'GESTOR' }),
        { message: 'IDENTITY_REVIEW_UNDO_DEPENDENT_DECISION', statusCode: 409 },
    )

    const dependencyCheck = queries.find(({ sql }) => sql.includes('latest_source_links as ('))
    assert.deepEqual(dependencyCheck?.params, ['run-1', 22, 'attendance_client', sourceClientId, 'attendance_client', targetClientId])
    assert.match(dependencyCheck?.sql || '', /links\.transition='automatic_activated'/)
    assert.match(dependencyCheck?.sql || '', /links\.event_order>\$2::bigint/)
    assert.match(dependencyCheck?.sql || '', /run\.status in \('applied','not_applicable'\)/)
    assert.equal(queries.some(({ sql }) => sql.startsWith('update crm_atendimento.client_merge_suggestions')), false)
    assert.equal(queries.some(({ sql }) => sql.startsWith('update crm_atendimento.global_client_identity_members')), false)
})

function buildConversionPoolHandlers() {
    const conversionRows = buildConversionRawRows()

    return [
        (sql) => sql.includes('select source_tab, source_row, cells') && { rows: conversionRows, rowCount: conversionRows.length },
        (sql) => sql.includes('from crm_atendimento.units u') && {
            rows: [
                { id: 'unit-nh', slug: 'novo-hamburgo', name: 'Novo Hamburgo' },
                { id: 'unit-bss', slug: 'barra-shopping-sul', name: 'BarraShoppingSul' },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.professionals') && {
            rows: [
                { id: 'doc-a', name: 'Dra. A', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
                { id: 'doc-b', name: 'Dra. B', role: 'Injetor', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'] },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('coalesce(sum(a.value), 0)::numeric as total') && sql.includes('group by u.slug') && !sql.includes('inj.id') && {
            rows: [
                { unit_slug: 'novo-hamburgo', total: 14 },
                { unit_slug: 'barra-shopping-sul', total: 9 },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('as doctor_id') && {
            rows: [
                { unit_slug: 'novo-hamburgo', doctor_id: 'doc-a', doctor_name: 'Dra. A', total: 14, attended_days: 1 },
                { unit_slug: 'barra-shopping-sul', doctor_id: 'doc-b', doctor_name: 'Dra. B', total: 9, attended_days: 1 },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.schedule_days') && {
            rows: [
                { unit_slug: 'novo-hamburgo', service_date: '2026-06-08', doctor_name: 'Dra. A' },
                { unit_slug: 'barra-shopping-sul', service_date: '2026-06-08', doctor_name: 'Dra. B' },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goals') && {
            rows: [
                { unit_slug: 'novo-hamburgo', goal_month: '2026-06-01', value: 80 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', value: 40 },
            ],
            rowCount: 2,
        },
        (sql) => sql.includes('from crm_atendimento.monthly_unit_goal_levels') && {
            rows: [
                { unit_slug: 'novo-hamburgo', goal_month: '2026-06-01', level_key: 'first', value: 80 },
                { unit_slug: 'barra-shopping-sul', goal_month: '2026-06-01', level_key: 'first', value: 40 },
            ],
            rowCount: 2,
        },
    ]
}

function buildConversionRawRows() {
    const cells = (sourceRow, values) => ({
        source_row: sourceRow,
        cells: values.map((value, index) => ({ col: index + 1, a1: `${index + 1}${sourceRow}`, value })),
    })
    const bxIndex = 76
    const bzIndex = 78
    const withWidth = (base) => Array.from({ length: bzIndex }, (_, index) => base[index] ?? '')
    return [
        cells(1, withWidth({ 0: 'Nome', 2: 'JUNHO', [bxIndex - 1]: 'PONTUAÇÃO', [bzIndex - 1]: 'POSIÇÃO' })),
        cells(2, withWidth({ 2: '1ª', 3: '2ª', [bxIndex - 1]: 'BX', [bzIndex - 1]: 'BZ' })),
        cells(3, withWidth({ 0: 'META SEMANAL', 1: 'Novo Hamburgo', 3: 20 })),
        cells(4, withWidth({ 0: 'LINHA CORTE', 1: 'Novo Hamburgo', 3: 12 })),
        cells(5, withWidth({ 0: 'INTERVALO', 1: 'Novo Hamburgo', 3: 4 })),
        cells(6, withWidth({ 0: 'Dra. B', 1: 'Novo Hamburgo', 3: 9, [bxIndex - 1]: 1, [bzIndex - 1]: '2ª' })),
        cells(7, withWidth({ 0: 'Dra. A', 1: 'Novo Hamburgo', 3: 14, [bxIndex - 1]: 3, [bzIndex - 1]: '1ª' })),
    ]
}

function createFakePool(handlers) {
    const query = async (sql, params = []) => {
        const normalizedSql = String(sql || '').replace(/\s+/g, ' ').trim()
        for (const handler of handlers) {
            const result = handler(normalizedSql, params)
            if (result) return result
        }
        return { rows: [], rowCount: 0 }
    }
    return {
        async connect() {
            return {
                query,
                release() {},
            }
        },
        query,
    }
}
