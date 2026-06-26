import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildConversionReportFromRawRows,
    buildImportRecords,
    buildScheduleDropdowns,
    calculateConversionGoalPlan,
    calculateDoctorConversionRanking,
    calculateAttendanceValue,
    calculatePreviousWeek,
    calculateWeekOfMonth,
    convertColorCodesToScores,
    getDoctorConversionIntervalMultiplier,
    getFilteredBackgroundColorsFromMatrix,
    getReportPeriod,
    normalizeAttendanceRow,
    normalizeCode,
    parseGerenciaGoalTables,
    parseGerenciaWorkbook,
    parseCacheRows,
    parseCurrency,
    parseSheetDate,
    resolveConversionMetricBounds,
    splitIsoDateRangeByMonth,
} from '../domain.js'

function assertNear(actual, expected, delta = 0.001) {
    assert.ok(Math.abs(Number(actual) - Number(expected)) <= delta, `${actual} should be close to ${expected}`)
}

test('calculates the sheet value formula with 3 percent discount and rounding', () => {
    assert.equal(calculateAttendanceValue({ code: '#0799', quantity: 1, discount: false, otherValue: 0, roundValue: false }), 799)
    assert.equal(calculateAttendanceValue({ code: '#0599', quantity: 1, discount: false, otherValue: 66, roundValue: false }), 533)
    assert.equal(calculateAttendanceValue({ code: '#0499', quantity: 2, discount: true, otherValue: 0, roundValue: false }), 968.06)
    assert.equal(calculateAttendanceValue({ code: '#0499', quantity: 1, discount: false, otherValue: 0, roundValue: true }), 500)
})

test('calculates internal doctor conversion metrics using CRM values and weighted ratios', () => {
    const result = calculateDoctorConversionRanking({
        monthlyGoal: 62000,
        monthOperationalDays: 20,
        weekOperationalDays: 5,
        doctors: [
            { id: 'd1', name: 'Dra Zero', realized: 0 },
            { id: 'd2', name: 'Dra Corte', realized: 4000 },
            { id: 'd3', name: 'Dra Positiva', realized: 6000 },
            { id: 'd4', name: 'Dra Destaque', realized: 12000 },
        ],
    })

    assert.equal(result.dailyGoal, 3100)
    assert.equal(result.periodGoal, 15500)
    assert.equal(result.weeklyGoal, 15500)
    assert.equal(result.monthOperationalDays, 20)
    assert.equal(result.periodOperationalDays, 5)
    assertNear(result.average, 5500)
    assert.equal(result.median, 5000)
    assertNear(result.standardDeviation, 5000)
    assertNear(result.cutLine, 10400)
    assertNear(result.interval, 3750)
    assert.equal(result.intervalMultiplier, 0.75)
    assert.deepEqual(result.levelCounts, { level0: 3, level1: 0, level2: 1, level3: 0 })
    assert.equal(result.ratioDivisor, 2)
    assert.match(result.formulas.cutLine, /meta_periodo \* 0\.50/)
    assert.match(result.formulas.interval, /desvio_padrao/)
    assert.match(result.formulas.ratioDivisor, /level0 \* 0/)
    assertNear(result.ratios.upperRatio, 1)
    assertNear(result.ratios.lowerRatio, 0)
    assertNear(result.ratios.innerRatio, 1)
    assertNear(result.ratios.outerRatio, 0)
    assert.deepEqual(result.ranking.map((doctor) => `${doctor.rank}:${doctor.name}:${doctor.score}`), [
        '1:Dra Destaque:2',
        '2:Dra Positiva:0',
        '3:Dra Corte:0',
        '4:Dra Zero:0',
    ])
})

test('separates ranked doctor total from general period attendance total', () => {
    const result = calculateDoctorConversionRanking({
        monthlyGoal: 30000,
        monthOperationalDays: 20,
        weekOperationalDays: 5,
        periodAttendanceTotal: 15000,
        doctors: [
            { id: 'd1', name: 'Dra A', realized: 4000 },
            { id: 'd2', name: 'Dra B', realized: 6000 },
        ],
    })
    assert.equal(result.total, 10000)
    assert.equal(result.rankedDoctorTotal, 10000)
    assert.equal(result.periodAttendanceTotal, 15000)
})

test('keeps zero doctors ranked and includes active zero values in statistical conversion bounds', () => {
    const result = calculateDoctorConversionRanking({
        monthlyGoal: 10000,
        monthOperationalDays: 10,
        weekOperationalDays: 2,
        doctors: [
            { id: 'd1', name: 'Dra Zero A', realized: 0 },
            { id: 'd2', name: 'Dra Zero B', realized: 0 },
            { id: 'd3', name: 'Dra Venda A', realized: 1000 },
            { id: 'd4', name: 'Dra Venda B', realized: 3000 },
        ],
    })
    assert.equal(result.rankedDoctorTotal, 4000)
    assert.equal(result.average, 1000)
    assert.equal(result.median, 500)
    assert.deepEqual(result.ranking.map((doctor) => `${doctor.name}:${doctor.score}`), [
        'Dra Venda B:3',
        'Dra Venda A:1',
        'Dra Zero A:0',
        'Dra Zero B:0',
    ])
})

test('returns zero ratios when no doctor reaches a weighted ranking level', () => {
    const result = calculateDoctorConversionRanking({
        monthlyGoal: 100000,
        monthOperationalDays: 20,
        weekOperationalDays: 5,
        doctors: [
            { id: 'd1', name: 'Dra A', realized: 0 },
            { id: 'd2', name: 'Dra B', realized: 0 },
        ],
    })
    assert.deepEqual(result.levelCounts, { level0: 2, level1: 0, level2: 0, level3: 0 })
    assert.deepEqual(result.ratios, { upperRatio: 0, lowerRatio: 0, innerRatio: 0, outerRatio: 0 })
})

test('calculates week of month with the official spreadsheet formula', () => {
    assert.equal(calculateWeekOfMonth(new Date('2026-06-16T12:00:00')), 3)
    assert.equal(calculateWeekOfMonth(new Date('2026-07-01T12:00:00')), 1)
    assert.equal(calculateWeekOfMonth(new Date('2026-08-31T12:00:00')), 6)
})

test('uses configurable doctor conversion interval multiplier with stable fallback', () => {
    assert.equal(getDoctorConversionIntervalMultiplier({ conversion: { rankingDoctor: { intervalMultiplier: 0.5 } } }), 0.5)
    assert.equal(getDoctorConversionIntervalMultiplier({ conversion: { rankingDoctor: { intervalMultiplier: -1 } } }), 0.75)
    assert.equal(getDoctorConversionIntervalMultiplier({ conversion: { rankingDoctor: { intervalMultiplier: 'bad' } } }), 0.75)
})

test('resolves conversion metric bounds from selected filters when provided', () => {
    const reportBounds = {
        monthStart: '2026-06-01',
        monthEnd: '2026-06-30',
        weekStart: '2026-06-08',
        weekEnd: '2026-06-14',
    }
    assert.deepEqual(resolveConversionMetricBounds(reportBounds, {}), {
        ...reportBounds,
        metricStart: '2026-06-08',
        metricEnd: '2026-06-14',
        metricSource: 'conversion-week',
    })
    assert.deepEqual(resolveConversionMetricBounds(reportBounds, { from: '2026-05-24', to: '2026-06-22' }), {
        ...reportBounds,
        metricStart: '2026-05-24',
        metricEnd: '2026-06-22',
        metricSource: 'selected-filter',
    })
    assert.deepEqual(resolveConversionMetricBounds(reportBounds, { from: '2026-06-22', to: '2026-05-24' }), {
        ...reportBounds,
        metricStart: '2026-05-24',
        metricEnd: '2026-06-22',
        metricSource: 'selected-filter',
    })
})

test('splits selected conversion ranges by month for multi-month goal lookup', () => {
    assert.deepEqual(splitIsoDateRangeByMonth('2026-05-24', '2026-06-22'), [
        {
            monthKey: '2026-05-01',
            monthStart: '2026-05-01',
            monthEnd: '2026-05-31',
            segmentStart: '2026-05-24',
            segmentEnd: '2026-05-31',
        },
        {
            monthKey: '2026-06-01',
            monthStart: '2026-06-01',
            monthEnd: '2026-06-30',
            segmentStart: '2026-06-01',
            segmentEnd: '2026-06-22',
        },
    ])
    assert.deepEqual(splitIsoDateRangeByMonth('2026-06-22', '2026-05-24').map((segment) => segment.monthKey), ['2026-05-01', '2026-06-01'])
})

test('calculates weighted daily and period goals across multiple months', () => {
    const plan = calculateConversionGoalPlan([
        { monthKey: '2026-05-01', monthlyGoal: 220000, monthOperationalDays: 22, periodOperationalDays: 6 },
        { monthKey: '2026-06-01', monthlyGoal: 300000, monthOperationalDays: 20, periodOperationalDays: 16 },
    ])
    assert.equal(plan.monthlyGoal, 520000)
    assert.equal(plan.monthOperationalDays, 42)
    assert.equal(plan.periodOperationalDays, 22)
    assert.equal(plan.periodGoal, 300000)
    assertNear(plan.dailyGoal, 13636.3636)
    assert.equal(plan.weeklyGoal, 300000)
})

test('returns zero daily goal when selected period has no operational days', () => {
    const plan = calculateConversionGoalPlan([
        { monthKey: '2026-06-01', monthlyGoal: 300000, monthOperationalDays: 20, periodOperationalDays: 0 },
    ])
    assert.equal(plan.periodGoal, 0)
    assert.equal(plan.periodOperationalDays, 0)
    assert.equal(plan.dailyGoal, 0)
})

test('normalizes currency, code and dates from spreadsheet-shaped values', () => {
    assert.equal(parseCurrency('R$1.234,56'), 1234.56)
    assert.equal(parseCurrency('R$66,00'), 66)
    assert.equal(normalizeCode('799'), '#0799')
    assert.equal(normalizeCode('#59'), '#0059')
    assert.equal(parseSheetDate('Date(2026,5,16)'), '2026-06-16')
    assert.equal(parseSheetDate('16/06', new Date('2026-06-16T12:00:00Z')), '2026-06-16')
    assert.equal(parseSheetDate('05/01/25'), '2025-01-05')
})

test('builds import records and skips template rows with idempotent source keys', () => {
    const tabs = {
        'Novo Hamburgo': [
            [' ', 'CLIQUE AQUI'],
            ['DATA', 'CLIENTE', 'PROCEDIMENTO', 'CÓDIGO'],
            [false, 'Nome Completo', 'Selecione', 'Selecione'],
            ['10/06/26', 'Cliente Sintético', 'Botox', '#0799', 1, false, 0, false, 799, 'Dra. Teste', 'Consultora Teste', ''],
            ['10/06/26', 'Cliente Sintético 2', 'Botox', '#0599', 1, false, 66, false, '', 'Dra. Teste', 'Consultora Teste', ''],
        ],
        BarraShoppingSul: [
            ['dias'],
            ['DATA', 'CLIENTE', 'PROCEDIMENTO', 'CÓDIGO'],
            ['11/06/26', 'Cliente B', 'Peeling', '#0000', 1, false, 0, false, 0, 'Dr. Teste', 'Consultor B', 'cortesia'],
        ],
    }
    const records = buildImportRecords(tabs, new Date('2026-06-16T12:00:00Z'))
    assert.equal(records.length, 3)
    assert.deepEqual(records.map((row) => `${row.sourceTab}:${row.sourceRow}`), ['Novo Hamburgo:4', 'Novo Hamburgo:5', 'BarraShoppingSul:3'])
    assert.equal(records[1].value, 533)
})

test('normalizes a single attendance row with unit, staff and observation fields', () => {
    const row = normalizeAttendanceRow({
        tabName: 'BarraShoppingSul',
        rowNumber: 9,
        row: ['15/06/26', 'Cliente Sintético', 'Sculptra', '#1899', 1, false, 0, false, 1899, 'Injetora B', 'Consultora B', 'Observação'],
    })
    assert.equal(row.unitSlug, 'barra-shopping-sul')
    assert.equal(row.unitName, 'BarraShoppingSul')
    assert.equal(row.date, '2026-06-15')
    assert.equal(row.value, 1899)
    assert.equal(row.sourceRow, 9)
})

test('parses cache rows into procedure, code and professional references', () => {
    const cache = parseCacheRows([
        ['PROCEDIMENTOS', 'CODIGOS', '', 'NOME', 'STATUS', 'UNIDADES', 'CARGOS', 'TURNOS'],
        ['Botox', '#0799', '', 'Dra. Sintética', 'Ativo', 'Novo Hamburgo, BarraShoppingSul', 'Injetor', 'Manhã', '#ffffff', '#000000', '', '', 2026, '2026-06-16|Novo Hamburgo', 'Dra. Sintética'],
        ['Preenchimento', '#0599', '', 'Consultora Sintética', 'Ativo', 'Novo Hamburgo', 'Coordenador, Consultor', 'Tarde'],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Procedimento', '#0799', '#0599'],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Botox', true, false],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Preenchimento', false, true],
    ])
    assert.deepEqual(cache.procedures, ['Botox', 'Preenchimento'])
    assert.deepEqual(cache.codes, ['#0599', '#0799'])
    assert.equal(cache.professionals.length, 2)
    assert.deepEqual(cache.professionals[0].roles, ['Coordenador', 'Consultor'])
    assert.deepEqual(cache.professionals[0].units, ['Novo Hamburgo'])
    assert.deepEqual(cache.schedules, [{
        year: 2026,
        date: '2026-06-16',
        unitSlug: 'novo-hamburgo',
        unitName: 'Novo Hamburgo',
        doctorName: 'Dra. Sintética',
    }])
    assert.deepEqual(cache.procedureCodes, [
        { procedureName: 'Botox', code: '#0799' },
        { procedureName: 'Preenchimento', code: '#0599' },
    ])
})

test('parses Gerencia workbook into normalized catalog, inventory and raw snapshots', () => {
    const parsed = parseGerenciaWorkbook({
        Procedimento: {
            values: [
                ['TRATAMENTO', '#0799', '#0599'],
                ['Botox', true, false],
                ['Preenchimento', false, true],
            ],
            formulas: [],
        },
        Equipe: {
            values: [
                ['NOME', 'SITUAÇÃO', 'UNIDADE', 'CARGO', 'TURNO', 'APELIDO', 'TELEFONE', 'EMAIL', 'INSTAGRAM'],
                ['Dra. Sintética', 'Ativo', 'Novo Hamburgo', 'Injetor', 'Manhã', 'Dra S', '(51) 99999-0000', 'dra@example.test', '@dra'],
            ],
            formulas: [],
            styles: [
                [],
                [{ backgroundColor: '#6d9eeb', fontColor: '#ffffff', fontFamily: 'Arial', fontSize: 10, fontWeight: 'bold', fontStyle: 'normal' }],
            ],
        },
        Inventário: {
            values: [
                ['PRODUTO', 'BARRASHOPPINGSUL', 'NOVO HAMBURGO'],
                ['Produto A', 3, 8],
            ],
            formulas: [],
        },
        Horário: {
            values: [
                ['', '', '', '', '', 'JANEIRO', 2026, 'BARRASHOPPINGSUL'],
                ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO', 'SEGUNDA', 'TERÇA'],
                ['', '', '', '1', '2', '3', '4', '', '', '', '1', '2', '3', '4'],
                ['', '', '', 'Sem Atendimento', 'Dra. NH', 'Dra. NH', '', '', '', '', 'Dra. BSS', 'Dra. BSS', 'Dra. BSS', ''],
            ],
            formulas: [],
        },
        Comercial: {
            values: [
                ['META', 'HOJE'],
                ['Novo Hamburgo', 1000],
            ],
            formulas: [['', '=SUM(A1:A2)']],
        },
    }, { spreadsheetId: 'gerencia-test', now: new Date('2026-06-16T12:00:00Z') })
    assert.equal(parsed.spreadsheetId, 'gerencia-test')
    assert.deepEqual(parsed.procedures, ['Botox', 'Preenchimento'])
    assert.deepEqual(parsed.procedureCodes, [
        { procedureName: 'Botox', code: '#0799' },
        { procedureName: 'Preenchimento', code: '#0599' },
    ])
    assert.equal(parsed.professionals[0].phone, '(51) 99999-0000')
    assert.equal(parsed.professionals[0].backgroundColor, '#6d9eeb')
    assert.deepEqual(parsed.inventory[0], { product: 'Produto A', barraShoppingSul: 3, novoHamburgo: 8, sourceRow: 2 })
    assert.equal(parsed.schedules.length, 8)
    assert.deepEqual(parsed.schedules.find((item) => item.unitSlug === 'novo-hamburgo' && item.date === '2026-01-02')?.doctorName, 'Dra. NH')
    assert.deepEqual(parsed.schedules.find((item) => item.unitSlug === 'barra-shopping-sul' && item.date === '2026-01-01')?.doctorName, 'Dra. BSS')
    assert.equal(parsed.tabs.find((tab) => tab.tabName === 'Comercial').formulaCount, 1)
    assert.equal(parsed.rawRows.some((row) => row.tabName === 'Equipe' && row.sensitive), true)
    assert.equal(parsed.managementItems.some((item) => item.sourceTab === 'Comercial' && item.category === 'commercial'), true)
})

test('parses Gerencia Meta tables and monthly goals from unit blocks', () => {
    const values = [
        ['NOVO HAMBURGO', 'NOVO HAMBURGO'],
        ['FATURAMENTO'],
        ['PERÍODO', '2025', '2026', 'CRESCIMENTO MENSAL', 'CRESCIMENTO ANUAL', 'REP. ATUAL', 'REP. IDEAL', 'REP. MÉDIA', '1ª META', '2ª META', '3ª META', 'SUPER META'],
        ['JANEIRO', 1000, 1200, 0.2, 0.2, 0.1, 0.1, 0.1, 1300, { result: 1400 }, { result: 1500 }, { result: 1600 }],
        ['TOTAL', 1000, 1200, 0.2, 0.2, 1, 1, 1, 1300, 1400, 1500, 1600],
        [], [], [], [], [], [], [], [], [], [], [],
        ['BARRASHOPPINGSUL', 'BARRASHOPPINGSUL'],
        ['FATURAMENTO'],
        ['PERÍODO', '2025', '2026', 'CRESCIMENTO MENSAL', 'CRESCIMENTO ANUAL', 'REP. ATUAL', 'REP. IDEAL', 'REP. MÉDIA', '1ª META', '2ª META', '3ª META', 'SUPER META'],
        ['FEVEREIRO', 2000, 2200, 0.1, 0.1, 0.2, 0.2, 0.2, { result: 2300 }, { result: 2400 }, { result: 2500 }, { result: 2600 }],
        ['TOTAL', 2000, 2200, 0.1, 0.1, 1, 1, 1, 2300, 2400, 2500, 2600],
    ]
    const formulas = values.map((row) => row.map(() => ''))
    formulas[3][8] = '=C4*1.1'
    const parsed = parseGerenciaGoalTables('Meta 2026', values, formulas)
    assert.equal(parsed.rows.length, 6)
    assert.deepEqual(parsed.monthlyGoals.map((goal) => `${goal.unitSlug}:${goal.month}:${goal.value}`), [
        'novo-hamburgo:2026-01-01:1300',
        'barra-shopping-sul:2026-02-01:2300',
    ])
    assert.deepEqual(parsed.monthlyGoalLevels.map((goal) => `${goal.unitSlug}:${goal.month}:${goal.levelKey}:${goal.value}`), [
        'novo-hamburgo:2026-01-01:first:1300',
        'novo-hamburgo:2026-01-01:second:1400',
        'novo-hamburgo:2026-01-01:third:1500',
        'novo-hamburgo:2026-01-01:super:1600',
        'barra-shopping-sul:2026-02-01:first:2300',
        'barra-shopping-sul:2026-02-01:second:2400',
        'barra-shopping-sul:2026-02-01:third:2500',
        'barra-shopping-sul:2026-02-01:super:2600',
    ])
    assert.equal(parsed.rows.find((row) => row.unitSlug === 'novo-hamburgo' && row.label === 'JANEIRO')?.formulas[8], '=C4*1.1')
})

test('builds the Gerencia Conversão report with Apps Script filtering rules', () => {
    const cells = (sourceRow, values) => ({
        sourceRow,
        cells: values.map((value, index) => ({ col: index + 1, a1: `${index + 1}${sourceRow}`, value })),
    })
    const bxIndex = 76
    const bzIndex = 78
    const withWidth = (base) => {
        const values = Array.from({ length: bzIndex }, (_, index) => base[index] ?? '')
        return values
    }
    const rawRows = [
        cells(1, withWidth({ 0: 'Nome', 2: 'JUNHO', [bxIndex - 1]: 'Total', [bzIndex - 1]: 'Meta' })),
        cells(2, withWidth({ 2: '1ª', 3: '2ª', 4: '3ª', [bxIndex - 1]: 'BX', [bzIndex - 1]: 'BZ' })),
        cells(3, withWidth({ 0: 'Dra. A', 1: 'BarraShoppingSul', 2: 10, 3: 20, [bxIndex - 1]: 100, [bzIndex - 1]: 200 })),
        cells(4, withWidth({ 0: 'META MENSAL', 1: 'BarraShoppingSul', 2: 999, 3: 999 })),
        cells(5, withWidth({ 0: 'TOTAL', 1: 'BarraShoppingSul', 2: 10, 3: 20 })),
        cells(6, withWidth({ 0: 'Dra. NH', 1: 'Novo Hamburgo', 2: 0, 3: 0 })),
    ]
    const report = buildConversionReportFromRawRows(rawRows, new Date('2026-06-16T12:00:00'))
    assert.equal(calculatePreviousWeek(new Date('2026-06-16T12:00:00')), 2)
    assert.deepEqual(getReportPeriod(new Date('2026-06-16T12:00:00')), {
        targetYear: 2026,
        targetMonth: 6,
        weekNumber: 2,
        monthName: 'JUNHO',
    })
    assert.equal(report.sections.length, 1)
    assert.equal(report.sections[0].unitName, 'BarraShoppingSul')
    assert.equal(report.sections[0].rows.some((row) => row.label === 'META MENSAL'), false)
    assert.equal(report.sections[0].rows.some((row) => row.label === 'TOTAL'), true)
    assert.equal(report.source.weekColumn, 'D')
    assert.equal(report.tempExport.sheetName, 'TempExport')
    assert.equal(report.tempExport.fileName, 'Informe Conversão - 2ª Semana')
    assert.equal(report.tempExport.drivePath, '2026/06/2')
    assert.equal(report.tempExport.pdf.portrait, false)
})

test('derives Gerencia Conversão doctor ranking from goals, cut line and score columns', () => {
    const cells = (sourceRow, values) => ({
        sourceRow,
        cells: values.map((value, index) => ({ col: index + 1, a1: `${index + 1}${sourceRow}`, value })),
    })
    const bxIndex = 76
    const bzIndex = 78
    const withWidth = (base) => Array.from({ length: bzIndex }, (_, index) => base[index] ?? '')
    const rawRows = [
        cells(1, withWidth({ 0: 'Nome', 2: 'JUNHO', [bxIndex - 1]: 'PONTUAÇÃO', [bzIndex - 1]: 'POSIÇÃO' })),
        cells(2, withWidth({ 2: '1ª', 3: '2ª', [bxIndex - 1]: 'BX', [bzIndex - 1]: 'BZ' })),
        cells(3, withWidth({ 0: 'META SEMANAL', 1: 'Novo Hamburgo', 3: 20 })),
        cells(4, withWidth({ 0: 'LINHA CORTE', 1: 'Novo Hamburgo', 3: 12 })),
        cells(5, withWidth({ 0: 'INTERVALO', 1: 'Novo Hamburgo', 3: 4 })),
        cells(6, withWidth({ 0: 'Dra. B', 1: 'Novo Hamburgo', 3: 9, [bxIndex - 1]: 1, [bzIndex - 1]: '2ª' })),
        cells(7, withWidth({ 0: 'Dra. A', 1: 'Novo Hamburgo', 3: 14, [bxIndex - 1]: 3, [bzIndex - 1]: '1ª' })),
    ]
    const report = buildConversionReportFromRawRows(rawRows, new Date('2026-06-16T12:00:00'))
    assert.equal(report.doctorRanking.sections.length, 1)
    assert.equal(report.doctorRanking.sections[0].metrics.periodGoal.weekValue, 20)
    assert.equal(report.doctorRanking.sections[0].metrics.cutLine.weekValue, 12)
    assert.equal(report.doctorRanking.topDoctors[0].name, 'Dra. A')
    assert.equal(report.doctorRanking.topDoctors[0].score, 3)
    assert.equal(report.doctorRanking.topDoctors[0].position, '1ª')
})

test('returns warnings when Gerencia Conversão month or week are not available', () => {
    const cells = (sourceRow, values) => ({
        sourceRow,
        cells: values.map((value, index) => ({ col: index + 1, a1: `${index + 1}${sourceRow}`, value })),
    })
    const missingMonth = buildConversionReportFromRawRows([
        cells(1, ['Nome', '', 'MAIO']),
        cells(2, ['', '', '1ª']),
    ], new Date('2026-06-16T12:00:00'))
    assert.equal(missingMonth.sections.length, 0)
    assert.match(missingMonth.warnings[0], /Mês JUNHO/)

    const missingWeek = buildConversionReportFromRawRows([
        cells(1, ['Nome', '', 'JUNHO', 'JUNHO']),
        cells(2, ['', '', '1ª', '3ª']),
    ], new Date('2026-06-16T12:00:00'))
    assert.equal(missingWeek.sections.length, 0)
    assert.match(missingWeek.warnings[0], /Semana 2ª/)
})

test('converts Apps Script color codes to excellence scores', () => {
    assert.deepEqual(convertColorCodesToScores([['#6d9eeb', '#93c47d', '#ffd966', '#e06666', '#ffffff', '#000000']]), [[3, 2, 1, 0, 0, 'Erro']])
})

test('mirrors Apps Script background lookup from cached C3:BV14 colors', () => {
    const backgroundColors = [
        ['#6d9eeb', '#93c47d'],
        ['#ffd966', '#e06666'],
    ]
    assert.deepEqual(getFilteredBackgroundColorsFromMatrix(['C3', 'D4', '$B$2', 'bad'], backgroundColors), [
        ['#6d9eeb'],
        ['#e06666'],
        ['Erro'],
        ['Erro'],
    ])
})

test('builds Gerencia schedule dropdowns from active injectors by unit', () => {
    const dropdowns = buildScheduleDropdowns([
        { name: 'Dra. NH', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
        { name: 'Dra. BSS', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetora'] },
        { name: 'Consultora', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Consultor'] },
        { name: 'Inativa', status: 'Inativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
    ])
    assert.deepEqual(dropdowns.find((item) => item.unitSlug === 'novo-hamburgo')?.values, ['Dra. NH', 'Sem Atendimento'])
    assert.deepEqual(dropdowns.find((item) => item.unitSlug === 'barra-shopping-sul')?.values, ['Dra. BSS', 'Sem Atendimento'])
})
