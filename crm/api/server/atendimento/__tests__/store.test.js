import test from 'node:test'
import assert from 'node:assert/strict'

import {
    assertActorCanMutateUnit,
    actorIdentityForMutation,
    atendimentoMigrationStatements,
    canAccessAtendimento,
    createAtendimentoStore,
    filterConversionReportToActorScope,
    normalizeAttendanceMutation,
} from '../store.js'
import {
    ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION,
    ATTENDANCE_WRITE_SAFETY_MIGRATION_ID,
    attendanceWriteSafetyMigrationPlan,
} from '../writeSafetyMigration.js'

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
    assert.equal(canAccessAtendimento(procedimentosActor, '/clients', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'POST'), false)

    const faturamentoActor = { role: 'INJETOR', allowedModules: ['faturamento'] }
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/commercial', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/finance', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/catalog', 'GET'), false)
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
            rows: [{ unit_slug: 'barra-shopping-sul', doctor_id: 'doc-b', doctor_name: 'Dra. B', total: 30000 }],
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
    assert.equal(section.metrics.standardDeviation?.label, 'Desvio Padrão')
    assert.equal(section.metrics.upperLimit?.label, 'Limite Superior')
    assert.equal(section.metrics.lowerLimit?.label, 'Limite Inferior')
    assert.equal(section.metrics.ratioDivisor?.label, 'Divisor Razões')
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
                { unit_slug: 'novo-hamburgo', doctor_id: 'doc-a', doctor_name: 'Dra. A', total: 14 },
                { unit_slug: 'barra-shopping-sul', doctor_id: 'doc-b', doctor_name: 'Dra. B', total: 9 },
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
