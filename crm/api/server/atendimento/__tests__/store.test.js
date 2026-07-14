import test from 'node:test'
import assert from 'node:assert/strict'

import { canAccessAtendimento, createAtendimentoStore } from '../store.js'

test('scopes atendimento router access by consuming module', () => {
    const procedimentosActor = { role: 'INJETOR', allowedModules: ['procedimentos'] }
    assert.equal(canAccessAtendimento(procedimentosActor, '/management/catalog', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/references', 'GET'), true)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'GET'), false)
    assert.equal(canAccessAtendimento(procedimentosActor, '/attendances', 'POST'), false)

    const faturamentoActor = { role: 'INJETOR', allowedModules: ['faturamento'] }
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/commercial', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/finance', 'GET'), true)
    assert.equal(canAccessAtendimento(faturamentoActor, '/management/catalog', 'GET'), false)
})

test('marks all-units conversion view as non-consolidated in crm ranking payload', async () => {
    const fakePool = createFakePool(buildConversionPoolHandlers())

    const store = createAtendimentoStore({ pool: fakePool })
    const report = await store.managementConversionReport({ unit: 'all', date: '2026-06-16' }, { role: 'GESTOR' })

    assert.equal(report.doctorRanking.sections[0].unitSlug, 'all')
    assert.equal(report.doctorRanking.sections[0].isAggregate, true)
    assert.equal(Object.keys(report.doctorRanking.sections[0].metrics || {}).length, 0)
    assert.match(report.doctorRanking.sections[0].aggregateNotice || '', /Selecione uma unidade/i)
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
        (sql) => sql.includes('inj.id as doctor_id') && {
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

    const first = await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-07', from: '2026-06-01', to: '2026-06-07' }, actor)
    const second = await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-14', from: '2026-06-08', to: '2026-06-14' }, actor)
    await store.managementConversionReport({ unit: 'novo-hamburgo', date: '2026-06-14', from: '2026-06-08', to: '2026-06-14' }, actor)

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
    assert.equal(secondSection.history.length, 2)
    assert.equal(secondSection.history[0].periodEnd, '2026-06-14')
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
    assert.equal(overview.monthly[0].quantityTotal, 3)
    assert.equal(overview.rankings.procedures[0].quantityTotal, 3)
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
        (sql) => sql.includes('inj.id as doctor_id') && {
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
