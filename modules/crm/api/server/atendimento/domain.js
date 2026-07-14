const UNIT_ALIASES = new Map([
    ['novo hamburgo', { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
    ['novohamburgo', { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
    ['barra shopping sul', { slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }],
    ['barrashoppingsul', { slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }],
    ['barra-shopping-sul', { slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }],
])

export const OPERATIONAL_TABS = ['Novo Hamburgo', 'BarraShoppingSul']
export const SOURCE_SHEET_ID = '17zQieASD5QXO2ABUuBpVMMOOs-jo3QBpTxFfrVHtw3A'
export const GERENCIA_SOURCE_SHEET_ID = '1OBJ3RAjQqV3cQNN8xzSbRgu4leTMsSFM2X5TOnrGmSI'
export const GERENCIA_APPS_SCRIPT_CONFIG = {
    sheets: {
        team: 'Equipe',
        schedule: 'Horário',
        conversion: 'Conversão',
        tempExport: 'TempExport',
    },
    noServiceLabel: 'Sem Atendimento',
    scheduleUnits: [
        { unitName: 'Novo Hamburgo', unitSlug: 'novo-hamburgo', columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
        { unitName: 'BarraShoppingSul', unitSlug: 'barra-shopping-sul', columns: ['H', 'I', 'J', 'K', 'L', 'M', 'N'] },
    ],
    schedulePattern: {
        startRow: 4,
        blockHeight: 14,
        patternRows: [4, 6, 8, 10, 12, 14],
    },
    noServiceStyle: {
        background: '#000000',
        fontColor: '#ffffff',
        fontWeight: 'bold',
        fontStyle: 'normal',
    },
    conversion: {
        columns: { bx: 'BX', bz: 'BZ' },
        unitsOrder: ['BarraShoppingSul', 'Novo Hamburgo'],
        rankingDoctor: {
            intervalMultiplier: 0.75,
            intervalMultiplierMin: 0,
            intervalMultiplierMax: 2,
            objectiveName: 'sse_uniform',
            requireAllBandsIfPossible: true,
            requireExtremesIfPossible: true,
            stabilityTieBreak: true,
            unstableJumpThreshold: 0.5,
        },
        ignoreLabels: [
            'META MENSAL',
            'META SEMANAL',
            'META DIÁRIA',
            'MÉDIA',
            'MEDIANA',
            'RAZÃO SUPERIOR',
            'RAZÃO INTERIOR',
            'RAZÃO EXTERIOR',
            'RAZÃO INFERIOR',
        ],
        specialRows: ['TOTAL', 'LINHA CORTE', 'INTERVALO'],
        weeksPerMonth: 6,
    },
    reports: {
        folderId: '1g73i6P8alSfY7SA-m86B1Q2zvTVVPukd',
        fileNamePrefix: 'Informe Conversão',
        pdfPortrait: false,
        deleteTempAfterExport: true,
        pdfExportRetries: 3,
        pdfExportBackoffMs: 2000,
    },
    cache: {
        styleMapKey: 'staffStyleMap_v1',
        backgroundPrefix: 'bgColors',
        ttlSecondsStyles: 3600,
        ttlSecondsBackgrounds: 300,
    },
    backgroundCacheRange: 'C3:BV14',
    onEditMaxCells: 400,
    features: {
        onEditMaxCells: 400,
        autoInitializeLayoutOnOpen: false,
    },
}

function stringifyStructuredCell(value) {
    if (value == null) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(stringifyStructuredCell).filter(Boolean).join(' ').trim()
    if (typeof value !== 'object') return ''
    if (Array.isArray(value.richText)) return value.richText.map((part) => String(part?.text ?? '')).join('').trim()
    for (const key of ['formattedValue', 'stringValue', 'text', 'result', 'value', 'displayValue']) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const text = stringifyStructuredCell(value[key])
            if (text) return text
        }
    }
    return ''
}

export function stringifyCellValue(value) {
    return stringifyStructuredCell(value)
}

const MONTH_NAMES_PT_BR_UPPER = [
    'JANEIRO',
    'FEVEREIRO',
    'MARÇO',
    'ABRIL',
    'MAIO',
    'JUNHO',
    'JULHO',
    'AGOSTO',
    'SETEMBRO',
    'OUTUBRO',
    'NOVEMBRO',
    'DEZEMBRO',
]

const MONTH_NAME_TO_NUMBER = new Map(MONTH_NAMES_PT_BR_UPPER.map((name, index) => [normalizeText(name), index + 1]))

export function normalizeText(value) {
    return stringifyCellValue(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

const INVALID_PROFESSIONAL_NAME_KEYS = new Set(['', '[object object]', 'object object', 'injetor', 'consultor', 'selecione'])

// Confirmed local roster overrides while the source team sheet still marks these records as active.
const INACTIVE_CONVERSION_PROFESSIONAL_KEYS = new Set(['doris moisyn', 'doris caroline moisyn'])

const CONVERSION_PROFESSIONAL_CANONICAL_NAMES = new Map([
    ['raul junior', 'Raul Rosário Júnior'],
    ['raul rosario junior', 'Raul Rosário Júnior'],
    ['rafaela ferreira', 'Rafaela Machado Ferreira'],
    ['rafaela machado ferreira', 'Rafaela Machado Ferreira'],
])

export function isMeaningfulProfessionalName(value) {
    return !INVALID_PROFESSIONAL_NAME_KEYS.has(normalizeText(value))
}

export function isConversionProfessionalEligible(value) {
    const key = normalizeText(value)
    return !INVALID_PROFESSIONAL_NAME_KEYS.has(key) && !INACTIVE_CONVERSION_PROFESSIONAL_KEYS.has(key)
}

export function getCanonicalConversionProfessionalName(value) {
    const raw = stringifyCellValue(value)
    return CONVERSION_PROFESSIONAL_CANONICAL_NAMES.get(normalizeText(raw)) || raw
}

export function consolidateConversionProfessionals(doctors = []) {
    const byName = new Map()
    for (const doctor of Array.isArray(doctors) ? doctors : []) {
        if (!isConversionProfessionalEligible(doctor?.name)) continue
        const name = getCanonicalConversionProfessionalName(doctor.name)
        const key = normalizeText(name)
        const current = byName.get(key)
        if (current) {
            current.realized += Number(doctor?.realized || 0)
            current.sourceIds.push(String(doctor?.id || '').trim())
            continue
        }
        byName.set(key, {
            ...doctor,
            name,
            realized: Number(doctor?.realized || 0),
            sourceIds: [String(doctor?.id || '').trim()].filter(Boolean),
        })
    }
    return Array.from(byName.values())
}

export function normalizeUnit(value) {
    const raw = String(value ?? '').trim()
    const key = normalizeText(raw).replace(/[^a-z0-9]+/g, ' ').trim()
    const compact = key.replace(/\s+/g, '')
    const found = UNIT_ALIASES.get(key) || UNIT_ALIASES.get(compact) || UNIT_ALIASES.get(raw)
    if (found) return found
    const slug = key.replace(/\s+/g, '-')
    return { slug: slug || 'unknown', name: raw || 'Unknown' }
}

export function parseBoolean(value) {
    if (value === true) return true
    if (value === false) return false
    const raw = normalizeText(value)
    if (!raw) return false
    return ['1', 'true', 'sim', 'yes', 'y', 'x'].includes(raw)
}

export function parseDecimal(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const raw = String(value ?? '').trim()
    if (!raw) return fallback
    const cleaned = raw
        .replace(/[^\d,.-]/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.')
    const num = Number(cleaned)
    return Number.isFinite(num) ? num : fallback
}

export function columnLetterToIndex(letter) {
    return String(letter || '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .split('')
        .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1
}

export function parseCurrency(value, fallback = 0) {
    return parseDecimal(value, fallback)
}

export function getEffectiveCellValue(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result
        if (Object.prototype.hasOwnProperty.call(value, 'formattedValue')) return value.formattedValue
        if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value
    }
    return value
}

export function splitList(value) {
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

export function normalizeRole(value) {
    const raw = normalizeText(value)
    if (raw === 'consultora') return 'consultor'
    if (raw === 'injetora') return 'injetor'
    return raw
}

export function normalizeCode(value) {
    const raw = String(value ?? '').trim().toUpperCase()
    if (!raw || raw === 'SELECIONE') return ''
    const digits = raw.match(/\d+/)?.[0] || ''
    if (!digits) return raw
    return `#${digits.padStart(4, '0')}`
}

export function codeNumericValue(code) {
    const digits = String(code || '').match(/\d+/)?.[0] || ''
    if (!digits) return null
    const num = Number(digits)
    return Number.isFinite(num) ? num : null
}

export function roundToNearestTen(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.round(num / 10) * 10
}

export function calculateAttendanceValue(input) {
    const base = codeNumericValue(input?.code)
    if (base == null) return null
    const quantity = parseDecimal(input?.quantity, 0)
    const other = parseCurrency(input?.otherValue ?? input?.other, 0)
    const discount = parseBoolean(input?.discount)
    const shouldRound = parseBoolean(input?.roundValue ?? input?.round)
    const factor = discount ? 0.97 : 1
    const raw = base * quantity * factor - other
    const value = shouldRound ? roundToNearestTen(raw) : raw
    return Math.round((value + Number.EPSILON) * 100) / 100
}

export function determineShift(unitNameOrSlug, dateInput = new Date()) {
    const unit = normalizeUnit(unitNameOrSlug)
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    if (Number.isNaN(date.getTime())) return null
    const h = date.getHours()
    const m = date.getMinutes()
    if (unit.slug === 'novo-hamburgo') {
        if ((h === 8 && m >= 30) || (h > 8 && h < 16) || (h === 16 && m <= 30)) return 'Manhã'
        if ((h === 12 && m >= 30) || (h > 12 && h < 20) || (h === 20 && m <= 30)) return 'Tarde'
    }
    if (unit.slug === 'barra-shopping-sul') {
        if (h >= 10 && h < 18) return 'Manhã'
        if (h >= 14 && h < 22) return 'Tarde'
    }
    return null
}

export function parseSheetDate(value, now = new Date()) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10)
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const epoch = Date.UTC(1899, 11, 30)
        const date = new Date(epoch + Math.round(value) * 86400000)
        return date.toISOString().slice(0, 10)
    }
    const raw = String(value ?? '').trim()
    if (!raw || raw.toLowerCase() === 'false') return ''
    const gviz = raw.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/)
    if (gviz) {
        const year = Number(gviz[1])
        const month = Number(gviz[2]) + 1
        const day = Number(gviz[3])
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const br = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
    if (br) {
        const day = Number(br[1])
        const month = Number(br[2])
        let year = br[3] ? Number(br[3]) : now.getFullYear()
        if (year < 100) year += 2000
        const date = new Date(Date.UTC(year, month - 1, day))
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        }
    }
    return ''
}

export function spreadsheetColumnLabel(index) {
    let n = Number(index) + 1
    if (!Number.isInteger(n) || n <= 0) return ''
    let label = ''
    while (n > 0) {
        const rem = (n - 1) % 26
        label = String.fromCharCode(65 + rem) + label
        n = Math.floor((n - 1) / 26)
    }
    return label
}

export function getMonthNamePtBrUpper(monthIndex0) {
    return MONTH_NAMES_PT_BR_UPPER[monthIndex0] || ''
}

export function calculatePreviousWeek(dateInput = new Date()) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    if (Number.isNaN(date.getTime())) return 0
    const day = date.getDate()
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
    const firstWeekday = firstDayOfMonth.getDay() || 7
    const totalDays = day + (firstWeekday - 1)
    let previousWeek = (totalDays / 7) - 1
    if (previousWeek < 0.5) {
        const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1)
        const lastDayPrev = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0)
        const prevMonthFirstWeekday = previousMonth.getDay() || 7
        previousWeek = Math.ceil((lastDayPrev.getDate() + prevMonthFirstWeekday) / 7)
    } else {
        previousWeek = Math.ceil(previousWeek)
    }
    return previousWeek
}

export function calculateWeekOfMonth(dateInput = new Date()) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    if (Number.isNaN(date.getTime())) return 0
    const day = date.getDate()
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
    const firstWeekday = firstDayOfMonth.getDay() || 7
    return Math.floor((day + firstWeekday - 2) / 7) + 1
}

export function getReportDate(dateInput = new Date()) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    if (Number.isNaN(date.getTime())) {
        const now = new Date()
        return { targetYear: now.getFullYear(), targetMonth: now.getMonth() + 1 }
    }
    const currentMonth = date.getMonth()
    const day = date.getDate()
    const firstDay = new Date(date.getFullYear(), currentMonth, 1)
    const firstWeekday = firstDay.getDay() || 7
    const totalDays = day + (firstWeekday - 1)
    const previousWeek = (totalDays / 7) - 1
    let targetMonthIndex = currentMonth
    let targetYear = date.getFullYear()
    if (previousWeek < 0.5) {
        targetMonthIndex = (currentMonth - 1 + 12) % 12
        if (currentMonth === 0) targetYear -= 1
    }
    return { targetYear, targetMonth: targetMonthIndex + 1 }
}

export function getReportPeriod(dateInput = new Date()) {
    const { targetYear, targetMonth } = getReportDate(dateInput)
    const weekNumber = calculatePreviousWeek(dateInput)
    const monthName = getMonthNamePtBrUpper(targetMonth - 1)
    return { targetYear, targetMonth, weekNumber, monthName }
}

export const DEFAULT_CONVERSION_INTERVAL_MULTIPLIER = 0.75
export const DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN = 0
export const DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX = 2
export const DEFAULT_CONVERSION_OBJECTIVE = 'sse_uniform'
export const DEFAULT_CONVERSION_TIE_BREAK_POLICY = 'previous_then_widest_plateau_center'

export function getDoctorConversionIntervalMultiplier(config = GERENCIA_APPS_SCRIPT_CONFIG) {
    const configured = Number(
        process.env.ATENDIMENTO_CONVERSION_INTERVAL_MULTIPLIER
        || process.env.CRM_RANKING_DOCTOR_INTERVAL_MULTIPLIER
        || config?.conversion?.rankingDoctor?.intervalMultiplier
        || config?.rankingDoctor?.intervalMultiplier,
    )
    return Number.isFinite(configured) && configured >= 0
        ? configured
        : DEFAULT_CONVERSION_INTERVAL_MULTIPLIER
}

function boundedNumber(value, fallback, min, max) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return fallback
    return Math.min(max, Math.max(min, numeric))
}

export function getDoctorConversionOptimizationConfig(config = GERENCIA_APPS_SCRIPT_CONFIG, overrides = {}) {
    const rankingConfig = config?.conversion?.rankingDoctor || config?.rankingDoctor || {}
    const intervalMultiplierMin = boundedNumber(
        overrides.intervalMultiplierMin ?? rankingConfig.intervalMultiplierMin,
        DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN,
        DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN,
        DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
    )
    const intervalMultiplierMax = boundedNumber(
        overrides.intervalMultiplierMax ?? rankingConfig.intervalMultiplierMax,
        DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
        intervalMultiplierMin,
        DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
    )
    const previousIntervalMultiplier = overrides.previousIntervalMultiplier != null && Number.isFinite(Number(overrides.previousIntervalMultiplier))
        ? boundedNumber(overrides.previousIntervalMultiplier, intervalMultiplierMin, intervalMultiplierMin, intervalMultiplierMax)
        : null
    return {
        intervalMultiplierMin,
        intervalMultiplierMax,
        defaultIntervalMultiplier: null,
        previousIntervalMultiplier,
        objectiveName: String(overrides.objectiveName || rankingConfig.objectiveName || DEFAULT_CONVERSION_OBJECTIVE),
        requireAllBandsIfPossible: overrides.requireAllBandsIfPossible ?? rankingConfig.requireAllBandsIfPossible ?? true,
        requireExtremesIfPossible: overrides.requireExtremesIfPossible ?? rankingConfig.requireExtremesIfPossible ?? true,
        stabilityTieBreak: overrides.stabilityTieBreak ?? rankingConfig.stabilityTieBreak ?? true,
        tieBreakPolicy: String(overrides.tieBreakPolicy || rankingConfig.tieBreakPolicy || DEFAULT_CONVERSION_TIE_BREAK_POLICY),
        unstableJumpThreshold: boundedNumber(
            overrides.unstableJumpThreshold ?? rankingConfig.unstableJumpThreshold,
            0.5,
            0,
            DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
        ),
    }
}

function normalizeIsoDateInput(value) {
    const raw = String(value ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
    const date = new Date(`${raw}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10) === raw ? raw : ''
}

function isoMonthBounds(dateIso) {
    const normalized = normalizeIsoDateInput(dateIso)
    if (!normalized) return null
    const year = Number(normalized.slice(0, 4))
    const month = Number(normalized.slice(5, 7))
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const monthKey = `${year}-${String(month).padStart(2, '0')}-01`
    return {
        monthKey,
        monthStart: monthKey,
        monthEnd: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
}

export function splitIsoDateRangeByMonth(startInput, endInput) {
    const start = normalizeIsoDateInput(startInput)
    const end = normalizeIsoDateInput(endInput)
    if (!start || !end) return []
    const rangeStart = start <= end ? start : end
    const rangeEnd = start <= end ? end : start
    const first = new Date(`${rangeStart.slice(0, 7)}-01T00:00:00Z`)
    const last = new Date(`${rangeEnd.slice(0, 7)}-01T00:00:00Z`)
    const segments = []
    const current = new Date(first)
    while (current <= last) {
        const monthIso = current.toISOString().slice(0, 10)
        const bounds = isoMonthBounds(monthIso)
        if (bounds) {
            segments.push({
                ...bounds,
                segmentStart: bounds.monthStart < rangeStart ? rangeStart : bounds.monthStart,
                segmentEnd: bounds.monthEnd > rangeEnd ? rangeEnd : bounds.monthEnd,
            })
        }
        current.setUTCMonth(current.getUTCMonth() + 1)
    }
    return segments
}

export function calculateConversionGoalPlan(segments = []) {
    const normalizedSegments = (Array.isArray(segments) ? segments : []).map((segment) => {
        const monthlyGoal = Number(segment?.monthlyGoal || 0)
        const monthOperationalDays = Math.max(0, Number(segment?.monthOperationalDays || 0))
        const periodOperationalDays = Math.max(0, Number(segment?.periodOperationalDays || 0))
        const dailyGoal = monthOperationalDays > 0 ? monthlyGoal / monthOperationalDays : 0
        const periodGoal = dailyGoal * periodOperationalDays
        return {
            ...segment,
            monthlyGoal,
            monthOperationalDays,
            periodOperationalDays,
            dailyGoal,
            periodGoal,
        }
    })
    const monthlyGoal = normalizedSegments.reduce((sum, segment) => sum + segment.monthlyGoal, 0)
    const monthOperationalDays = normalizedSegments.reduce((sum, segment) => sum + segment.monthOperationalDays, 0)
    const periodOperationalDays = normalizedSegments.reduce((sum, segment) => sum + segment.periodOperationalDays, 0)
    const periodGoal = normalizedSegments.reduce((sum, segment) => sum + segment.periodGoal, 0)
    const dailyGoal = periodOperationalDays > 0
        ? periodGoal / periodOperationalDays
        : 0
    return {
        monthlyGoal,
        monthOperationalDays,
        periodOperationalDays,
        dailyGoal,
        weeklyGoal: periodGoal,
        periodGoal,
        segments: normalizedSegments,
    }
}

export function resolveConversionMetricBounds(reportBounds = {}, query = {}) {
    const fallbackStart = normalizeIsoDateInput(reportBounds.weekStart)
    const fallbackEnd = normalizeIsoDateInput(reportBounds.weekEnd) || fallbackStart
    const from = normalizeIsoDateInput(query?.from)
    const to = normalizeIsoDateInput(query?.to)
    if (!from && !to) {
        return {
            ...reportBounds,
            metricStart: fallbackStart,
            metricEnd: fallbackEnd,
            metricSource: 'conversion-week',
        }
    }
    const start = from || to
    const end = to || from
    return {
        ...reportBounds,
        metricStart: start <= end ? start : end,
        metricEnd: start <= end ? end : start,
        metricSource: 'selected-filter',
    }
}

function finiteNumbers(values) {
    return (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((value) => Number.isFinite(value))
}

function average(values) {
    const numbers = finiteNumbers(values)
    if (!numbers.length) return 0
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
}

function median(values) {
    const numbers = finiteNumbers(values).sort((a, b) => a - b)
    if (!numbers.length) return 0
    const mid = Math.floor(numbers.length / 2)
    return numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2
}

function sampleStandardDeviation(values) {
    const numbers = finiteNumbers(values)
    if (numbers.length < 2) return 0
    const avg = average(numbers)
    const variance = numbers.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (numbers.length - 1)
    return Math.sqrt(variance)
}

function quantile(values, probability) {
    const numbers = finiteNumbers(values).sort((a, b) => a - b)
    if (!numbers.length) return 0
    const position = (numbers.length - 1) * Math.min(1, Math.max(0, Number(probability || 0)))
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.ceil(position)
    if (lowerIndex === upperIndex) return numbers[lowerIndex]
    const weight = position - lowerIndex
    return numbers[lowerIndex] + ((numbers[upperIndex] - numbers[lowerIndex]) * weight)
}

function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
}

export function stableConfigHash(value) {
    const input = stableSerialize(value)
    let hash = 2166136261
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function calculateDoctorConversionDiagnostics(values) {
    const numbers = finiteNumbers(values)
    const count = numbers.length
    const avg = average(numbers)
    const medianValue = median(numbers)
    const mad = median(numbers.map((value) => Math.abs(value - medianValue)))
    const q1 = quantile(numbers, 0.25)
    const q3 = quantile(numbers, 0.75)
    const secondMoment = count > 0 ? numbers.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / count : 0
    const thirdMoment = count > 0 ? numbers.reduce((sum, value) => sum + ((value - avg) ** 3), 0) / count : 0
    const fourthMoment = count > 0 ? numbers.reduce((sum, value) => sum + ((value - avg) ** 4), 0) / count : 0
    const modifiedZScores = numbers.map((value) => mad > 0 ? (0.6745 * (value - medianValue)) / mad : 0)
    const outlierCount = modifiedZScores.filter((value) => Math.abs(value) > 3.5).length
    return {
        mad,
        iqr: q3 - q1,
        q1,
        q3,
        skewness: secondMoment > 0 ? thirdMoment / (secondMoment ** 1.5) : 0,
        kurtosis: secondMoment > 0 ? fourthMoment / (secondMoment ** 2) : 0,
        modifiedZScores,
        outlierCount,
        outlierHeavy: outlierCount >= 2 && outlierCount / Math.max(count, 1) >= 0.25,
    }
}

export function classifyDoctorConversionValue(value, cutLine, interval) {
    const realized = Number(value || 0)
    const safeCutLine = Number(cutLine || 0)
    const safeInterval = Math.max(0, Number(interval || 0))
    const lowerLimit = safeCutLine - safeInterval
    const upperLimit = safeCutLine + safeInterval
    if (realized < lowerLimit) return { level: 0, score: 0, classification: 'Abaixo da faixa' }
    if (realized < safeCutLine) return { level: 1, score: 1, classification: 'Próximo da linha de corte' }
    if (realized <= upperLimit) return { level: 2, score: 2, classification: 'Acima da linha de corte' }
    return { level: 3, score: 3, classification: 'Destaque' }
}

function emptyLevelCounts() {
    return { level0: 0, level1: 0, level2: 0, level3: 0 }
}

function classifyConversionCounts(realized, cutOff, stdevSample, multiplier) {
    const counts = emptyLevelCounts()
    const interval = Math.max(0, Number(stdevSample || 0)) * Math.max(0, Number(multiplier || 0))
    for (const value of finiteNumbers(realized)) {
        const classification = classifyDoctorConversionValue(value, cutOff, interval)
        counts[`level${classification.level}`] += 1
    }
    return counts
}

function upperBound(sortedValues, target) {
    let low = 0
    let high = sortedValues.length
    while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (sortedValues[middle] <= target) low = middle + 1
        else high = middle
    }
    return low
}

function buildConversionDistanceIndex(realized, cutOff, stdevSample) {
    const below = []
    const upper = []
    for (const value of realized) {
        const distance = Math.abs(value - cutOff) / stdevSample
        if (value < cutOff) below.push(distance)
        else upper.push(distance)
    }
    below.sort((left, right) => left - right)
    upper.sort((left, right) => left - right)
    return { below, upper }
}

function classifyConversionCountsFromDistanceIndex(index, multiplier) {
    const level1 = upperBound(index.below, multiplier)
    const level2 = upperBound(index.upper, multiplier)
    return {
        level0: index.below.length - level1,
        level1,
        level2,
        level3: index.upper.length - level2,
    }
}

function proportionsFromCounts(counts, total) {
    const denominator = Math.max(0, Number(total || 0))
    return {
        p0: denominator > 0 ? counts.level0 / denominator : 0,
        p1: denominator > 0 ? counts.level1 / denominator : 0,
        p2: denominator > 0 ? counts.level2 / denominator : 0,
        p3: denominator > 0 ? counts.level3 / denominator : 0,
    }
}

export function calculateConversionHomogeneity(counts, total) {
    const proportions = proportionsFromCounts(counts, total)
    const loss = [proportions.p0, proportions.p1, proportions.p2, proportions.p3]
        .reduce((sum, proportion) => sum + ((proportion - 0.25) ** 2), 0)
    return {
        proportions,
        loss,
        score: Math.max(0, Math.min(1, 1 - ((4 / 3) * loss))),
    }
}

export function optimizeDoctorConversionInterval({
    realized = [],
    cutOff = 0,
    stdevSample = 0,
    previousIntervalMultiplier = null,
    defaultIntervalMultiplier = null,
    intervalMultiplierMin = DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN,
    intervalMultiplierMax = DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
    requireAllBandsIfPossible = true,
    requireExtremesIfPossible = true,
    stabilityTieBreak = true,
    tieBreakPolicy = DEFAULT_CONVERSION_TIE_BREAK_POLICY,
} = {}) {
    const values = finiteNumbers(realized)
    const total = values.length
    const minK = boundedNumber(intervalMultiplierMin, DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN, DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN, DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX)
    const maxK = boundedNumber(intervalMultiplierMax, DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX, minK, DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX)
    const previousK = previousIntervalMultiplier != null && Number.isFinite(Number(previousIntervalMultiplier))
        ? boundedNumber(previousIntervalMultiplier, minK, minK, maxK)
        : null
    const stdev = Math.max(0, Number(stdevSample || 0))
    if (!total) {
        const counts = emptyLevelCounts()
        return {
            selectedMultiplier: null,
            selectionReason: 'not_applicable',
            optimalPlateau: null,
            optimalPlateaus: [],
            homogeneityCurve: [],
            counts,
            ...calculateConversionHomogeneity(counts, 0),
            statusCode: 'NO_DATA',
            breakpointCount: 0,
            candidatesEvaluated: 0,
            allBandsPopulated: false,
            extremesPopulated: false,
        }
    }
    if (stdev === 0) {
        const counts = classifyConversionCounts(values, cutOff, 0, 0)
        return {
            selectedMultiplier: null,
            selectionReason: 'not_applicable',
            optimalPlateau: null,
            optimalPlateaus: [],
            homogeneityCurve: [],
            counts,
            ...calculateConversionHomogeneity(counts, total),
            statusCode: 'NO_VARIANCE',
            breakpointCount: 0,
            candidatesEvaluated: 1,
            allBandsPopulated: Object.values(counts).every((count) => count > 0),
            extremesPopulated: counts.level0 > 0 && counts.level3 > 0,
        }
    }

    const breakpoints = [...new Set(values
        .map((value) => Math.abs(value - Number(cutOff || 0)) / stdev)
        .filter((value) => Number.isFinite(value) && value >= minK && value <= maxK))]
        .sort((left, right) => left - right)
    const distanceIndex = buildConversionDistanceIndex(values, Number(cutOff || 0), stdev)
    const boundaries = [minK, ...breakpoints.filter((value) => value > minK && value < maxK), maxK]
    const curve = []
    const buildSegment = (start, end, endInclusive = false) => {
        const counts = classifyConversionCountsFromDistanceIndex(distanceIndex, start)
        const homogeneity = calculateConversionHomogeneity(counts, total)
        return {
            start,
            end,
            startInclusive: true,
            endInclusive,
            width: Math.max(0, end - start),
            counts,
            ...homogeneity,
            allBandsPopulated: Object.values(counts).every((count) => count > 0),
            extremesPopulated: counts.level0 > 0 && counts.level3 > 0,
        }
    }
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        curve.push(buildSegment(boundaries[index], boundaries[index + 1], false))
    }
    const maxPoint = buildSegment(maxK, maxK, true)
    const finalSegment = curve[curve.length - 1]
    const sameCounts = (left, right) => ['level0', 'level1', 'level2', 'level3']
        .every((key) => left?.counts?.[key] === right?.counts?.[key])
    if (finalSegment && sameCounts(finalSegment, maxPoint)) finalSegment.endInclusive = true
    else curve.push(maxPoint)

    const mergedCurve = []
    for (const segment of curve) {
        const previous = mergedCurve[mergedCurve.length - 1]
        if (previous && previous.end === segment.start && sameCounts(previous, segment)) {
            previous.end = segment.end
            previous.endInclusive = segment.endInclusive
            previous.width = Math.max(0, previous.end - previous.start)
        } else {
            mergedCurve.push({ ...segment })
        }
    }

    let feasible = mergedCurve
    if (requireAllBandsIfPossible && feasible.some((segment) => segment.allBandsPopulated)) {
        feasible = feasible.filter((segment) => segment.allBandsPopulated)
    } else if (requireExtremesIfPossible && feasible.some((segment) => segment.extremesPopulated)) {
        feasible = feasible.filter((segment) => segment.extremesPopulated)
    }
    const bestLoss = Math.min(...feasible.map((segment) => segment.loss))
    const lossTolerance = 1e-12
    const optimalPlateaus = feasible.filter((segment) => Math.abs(segment.loss - bestLoss) <= lossTolerance)
    const containsMultiplier = (segment, multiplier) => multiplier != null
        && multiplier >= segment.start
        && (multiplier < segment.end || (segment.endInclusive && multiplier <= segment.end))
    const plateauCenter = (segment) => segment.width > 0 ? (segment.start + segment.end) / 2 : segment.start
    const distanceToPlateau = (segment, multiplier) => {
        if (multiplier == null || containsMultiplier(segment, multiplier)) return 0
        return Math.min(Math.abs(multiplier - segment.start), Math.abs(multiplier - segment.end))
    }

    let selectedPlateau = stabilityTieBreak && previousK != null
        ? optimalPlateaus.find((segment) => containsMultiplier(segment, previousK))
        : null
    let selectionReason = selectedPlateau ? 'previous_in_optimal_plateau' : 'widest_optimal_plateau_center'
    if (!selectedPlateau) {
        const globalCenter = (minK + maxK) / 2
        selectedPlateau = [...optimalPlateaus].sort((left, right) => right.width - left.width
            || distanceToPlateau(left, previousK) - distanceToPlateau(right, previousK)
            || Math.abs(plateauCenter(left) - globalCenter) - Math.abs(plateauCenter(right) - globalCenter)
            || left.start - right.start)[0]
        if (selectedPlateau?.width === 0) selectionReason = 'optimal_singleton'
    }
    const selectedMultiplier = selectionReason === 'previous_in_optimal_plateau'
        ? previousK
        : plateauCenter(selectedPlateau)
    const selectedCounts = classifyConversionCountsFromDistanceIndex(distanceIndex, selectedMultiplier)
    const selectedHomogeneity = calculateConversionHomogeneity(selectedCounts, total)
    const serializePlateau = (segment, isOptimal = false) => ({
        start: segment.start,
        end: segment.end,
        startInclusive: segment.startInclusive,
        endInclusive: segment.endInclusive,
        width: segment.width,
        homogeneityScore: segment.score,
        loss: segment.loss,
        counts: segment.counts,
        proportions: segment.proportions,
        isOptimal,
    })
    const optimalSet = new Set(optimalPlateaus)
    const selected = {
        selectedMultiplier,
        selectionReason,
        optimalPlateau: serializePlateau(selectedPlateau, true),
        optimalPlateaus: optimalPlateaus.map((segment) => serializePlateau(segment, true)),
        homogeneityCurve: mergedCurve.map((segment) => serializePlateau(segment, optimalSet.has(segment))),
        counts: selectedCounts,
        ...selectedHomogeneity,
        allBandsPopulated: Object.values(selectedCounts).every((count) => count > 0),
        extremesPopulated: selectedCounts.level0 > 0 && selectedCounts.level3 > 0,
    }
    return {
        ...selected,
        tieBreakPolicy,
        legacyDefaultIntervalMultiplier: defaultIntervalMultiplier,
        statusCode: selected.allBandsPopulated
            ? 'OPTIMAL_ALL_BANDS'
            : selected.extremesPopulated
                ? 'OPTIMAL_EXTREMES_ONLY'
                : 'BEST_EFFORT',
        breakpointCount: breakpoints.length,
        candidatesEvaluated: mergedCurve.length,
    }
}

export function calculateDoctorConversionRanking({
    doctors = [],
    monthlyGoal = 0,
    periodAttendanceTotal,
    monthOperationalDays = 0,
    weekOperationalDays = 0,
    dailyGoal,
    periodGoal,
    weeklyGoal,
    intervalMultiplier = null,
    intervalMultiplierMin = DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MIN,
    intervalMultiplierMax = DEFAULT_CONVERSION_INTERVAL_MULTIPLIER_MAX,
    previousIntervalMultiplier = null,
    objectiveName = DEFAULT_CONVERSION_OBJECTIVE,
    requireAllBandsIfPossible = true,
    requireExtremesIfPossible = true,
    stabilityTieBreak = true,
    tieBreakPolicy = DEFAULT_CONVERSION_TIE_BREAK_POLICY,
    unstableJumpThreshold = 0.5,
} = {}) {
    const doctorRows = consolidateConversionProfessionals(doctors)
        .map((doctor) => ({
            ...doctor,
            realized: Number(doctor?.realized || 0),
            name: stringifyCellValue(doctor?.name),
        }))
        .filter((doctor) => doctor.name)
    const values = doctorRows.map((doctor) => doctor.realized)
    const valuesForStatistics = values
    const rankedDoctorTotal = values.reduce((sum, value) => sum + value, 0)
    const safePeriodAttendanceTotal = Number.isFinite(Number(periodAttendanceTotal))
        ? Number(periodAttendanceTotal)
        : rankedDoctorTotal
    const monthlyGoalValue = Number(monthlyGoal || 0)
    const safeMonthDays = Math.max(0, Number(monthOperationalDays || 0))
    const safeWeekDays = Math.max(0, Number(weekOperationalDays || 0))
    const dailyGoalValue = Number.isFinite(Number(dailyGoal))
        ? Number(dailyGoal)
        : (safeMonthDays > 0 ? monthlyGoalValue / safeMonthDays : 0)
    const periodGoalValue = Number.isFinite(Number(periodGoal))
        ? Number(periodGoal)
        : Number.isFinite(Number(weeklyGoal))
            ? Number(weeklyGoal)
        : dailyGoalValue * safeWeekDays
    const avg = average(valuesForStatistics)
    const medianValue = median(valuesForStatistics)
    const standardDeviation = sampleStandardDeviation(valuesForStatistics)
    const cutLine = (avg * 0.3) + (medianValue * 0.2) + (dailyGoalValue * 0.5)
    const optimizationConfig = getDoctorConversionOptimizationConfig(GERENCIA_APPS_SCRIPT_CONFIG, {
        defaultIntervalMultiplier: intervalMultiplier,
        intervalMultiplierMin,
        intervalMultiplierMax,
        previousIntervalMultiplier,
        objectiveName,
        requireAllBandsIfPossible,
        requireExtremesIfPossible,
        stabilityTieBreak,
        tieBreakPolicy,
        unstableJumpThreshold,
    })
    const optimized = optimizeDoctorConversionInterval({
        realized: valuesForStatistics,
        cutOff: cutLine,
        stdevSample: standardDeviation,
        ...optimizationConfig,
    })
    const effectiveIntervalMultiplier = optimized.selectedMultiplier
    const interval = standardDeviation * (effectiveIntervalMultiplier ?? 0)
    const lowerLimit = cutLine - interval
    const upperLimit = cutLine + interval
    const levelCounts = emptyLevelCounts()
    const distributionDiagnostics = calculateDoctorConversionDiagnostics(valuesForStatistics)
    const classified = doctorRows.map((doctor, doctorIndex) => {
        const classification = classifyDoctorConversionValue(doctor.realized, cutLine, interval)
        levelCounts[`level${classification.level}`] += 1
        return {
            ...doctor,
            weekValue: doctor.realized,
            totalValue: doctor.realized,
            average: avg,
            median: medianValue,
            monthlyGoal: monthlyGoalValue,
            dailyGoal: dailyGoalValue,
            periodGoal: periodGoalValue,
            weeklyGoal: periodGoalValue,
            cutLine,
            interval,
            lowerLimit,
            upperLimit,
            modifiedZ: distributionDiagnostics.modifiedZScores[doctorIndex] || 0,
            distanceToCutOff: doctor.realized - cutLine,
            distanceToLowerLimit: doctor.realized - lowerLimit,
            distanceToUpperLimit: doctor.realized - upperLimit,
            ...classification,
        }
    })
    const ratioDivisor = (levelCounts.level0 * 0) + (levelCounts.level1 * 1) + (levelCounts.level2 * 2) + (levelCounts.level3 * 3)
    const ratios = ratioDivisor > 0
        ? {
            upperRatio: ((levelCounts.level2 * 2) + (levelCounts.level3 * 3)) / ratioDivisor,
            lowerRatio: levelCounts.level1 / ratioDivisor,
            innerRatio: ((levelCounts.level1 * 1) + (levelCounts.level2 * 2)) / ratioDivisor,
            outerRatio: (levelCounts.level3 * 3) / ratioDivisor,
        }
        : { upperRatio: 0, lowerRatio: 0, innerRatio: 0, outerRatio: 0 }
    const proportions = proportionsFromCounts(levelCounts, doctorRows.length)
    const balancedReasons = {
        lowerSide: proportions.p0 + proportions.p1,
        upperSide: proportions.p2 + proportions.p3,
        center: proportions.p1 + proportions.p2,
        extremes: proportions.p0 + proportions.p3,
    }
    const minimum = valuesForStatistics.length ? Math.min(...valuesForStatistics) : 0
    const maximum = valuesForStatistics.length ? Math.max(...valuesForStatistics) : 0
    const unstableJump = effectiveIntervalMultiplier != null
        && optimizationConfig.previousIntervalMultiplier != null
        && Math.abs(effectiveIntervalMultiplier - optimizationConfig.previousIntervalMultiplier) > optimizationConfig.unstableJumpThreshold
    let statusCode = optimized.statusCode
    if (!doctorRows.length) statusCode = 'NO_DATA'
    else if (doctorRows.length < 4) statusCode = 'INSUFFICIENT_DOCTORS'
    else if (standardDeviation === 0) statusCode = 'NO_VARIANCE'
    else if (cutLine <= minimum) statusCode = 'CUT_OFF_BELOW_MIN'
    else if (cutLine >= maximum) statusCode = 'CUT_OFF_ABOVE_MAX'
    else if (distributionDiagnostics.outlierHeavy) statusCode = 'OUTLIER_HEAVY'
    else if (unstableJump) statusCode = 'UNSTABLE_JUMP'
    const configHash = stableConfigHash({
        formula: { averageWeight: 0.3, medianWeight: 0.2, dailyGoalWeight: 0.5 },
        intervalMultiplierMin: optimizationConfig.intervalMultiplierMin,
        intervalMultiplierMax: optimizationConfig.intervalMultiplierMax,
        objectiveName: optimizationConfig.objectiveName,
        requireAllBandsIfPossible: optimizationConfig.requireAllBandsIfPossible,
        requireExtremesIfPossible: optimizationConfig.requireExtremesIfPossible,
        stabilityTieBreak: optimizationConfig.stabilityTieBreak,
        tieBreakPolicy: optimizationConfig.tieBreakPolicy,
        unstableJumpThreshold: optimizationConfig.unstableJumpThreshold,
    })
    const ranking = classified
        .sort((left, right) => Number(right.realized || 0) - Number(left.realized || 0)
            || Number(right.level || 0) - Number(left.level || 0)
            || left.name.localeCompare(right.name, 'pt-BR'))
        .map((doctor, index) => ({
            ...doctor,
            rank: index + 1,
            position: '',
        }))
    return {
        total: rankedDoctorTotal,
        rankedDoctorTotal,
        periodAttendanceTotal: safePeriodAttendanceTotal,
        eligibleDoctorCount: doctorRows.length,
        monthlyGoal: monthlyGoalValue,
        monthOperationalDays: safeMonthDays,
        periodOperationalDays: safeWeekDays,
        dailyGoal: dailyGoalValue,
        periodGoal: periodGoalValue,
        weeklyGoal: periodGoalValue,
        average: avg,
        median: medianValue,
        standardDeviation,
        cutLine,
        interval,
        intervalMultiplier: effectiveIntervalMultiplier,
        selectedMultiplier: effectiveIntervalMultiplier,
        defaultIntervalMultiplier: optimizationConfig.defaultIntervalMultiplier,
        previousIntervalMultiplier: optimizationConfig.previousIntervalMultiplier,
        intervalMultiplierMin: optimizationConfig.intervalMultiplierMin,
        intervalMultiplierMax: optimizationConfig.intervalMultiplierMax,
        objectiveName: optimizationConfig.objectiveName,
        tieBreakPolicy: optimizationConfig.tieBreakPolicy,
        selectionReason: optimized.selectionReason,
        optimalPlateau: optimized.optimalPlateau,
        optimalPlateaus: optimized.optimalPlateaus,
        homogeneityCurve: optimized.homogeneityCurve,
        lowerLimit,
        upperLimit,
        levelCounts,
        proportions,
        balancedReasons,
        homogeneityLoss: optimized.loss,
        homogeneityScore: optimized.score,
        optimizationStatusCode: optimized.statusCode,
        statusCode,
        configHash,
        diagnostics: {
            skewness: distributionDiagnostics.skewness,
            kurtosis: distributionDiagnostics.kurtosis,
            mad: distributionDiagnostics.mad,
            iqr: distributionDiagnostics.iqr,
            outlierCount: distributionDiagnostics.outlierCount,
            outlierHeavy: distributionDiagnostics.outlierHeavy,
            breakpointCount: optimized.breakpointCount,
            candidatesEvaluated: optimized.candidatesEvaluated,
            allBandsPopulated: optimized.allBandsPopulated,
            extremesPopulated: optimized.extremesPopulated,
            cutoffOutsideDistribution: doctorRows.length > 0 && (cutLine <= minimum || cutLine >= maximum),
            unstableJump,
        },
        ratioDivisor,
        formulas: {
            cutLine: 'linha_corte = (media_periodo * 0.30) + (mediana_periodo * 0.20) + (meta_diaria * 0.50)',
            interval: 'intervalo = desvio_padrao_amostral(realizado_doutores) * multiplicador_intervalo_otimizado',
            homogeneity: 'homogeneidade = 1 - (4 / 3) * soma((proporcao_nivel - 0.25) ^ 2)',
            ratioDivisor: 'divisor = (level0 * 0) + (level1 * 1) + (level2 * 2) + (level3 * 3)',
        },
        ratios,
        ranking,
    }
}

export function parseGerenciaTabKind(tabName) {
    const key = normalizeText(tabName)
    const compactKey = key.replace(/[^a-z0-9]+/g, ' ').trim()
    if (key === 'procedimento') return { category: 'catalog', sensitive: false, active: true }
    if (key === 'equipe') return { category: 'people', sensitive: true, active: true }
    if (key === 'horario') return { category: 'schedule', sensitive: false, active: true }
    if (['comercial', 'conversao', 'controle'].includes(key) || key.startsWith('meta ')) {
        return { category: 'commercial', sensitive: false, active: !key.includes('backup') }
    }
    if (['caixa', 'pagina35'].includes(key) || key.includes('novo hamburgo') || key === 'barrashoppingsul') {
        return { category: 'finance', sensitive: false, active: true }
    }
    if (key === 'inventario') return { category: 'inventory', sensitive: false, active: true }
    if (['relogio ponto', 'carreira', 'excelencia', 'experiencia'].includes(compactKey)) {
        return { category: 'people', sensitive: compactKey !== 'excelencia' && compactKey !== 'experiencia', active: true }
    }
    if (key === 'graficos') return { category: 'dashboard', sensitive: false, active: false }
    if (key === 'teste ab' || key === 'pagina27') return { category: 'support', sensitive: false, active: true }
    return { category: 'raw', sensitive: false, active: true }
}

export function buildRawRowsFromTab(tab) {
    const rows = []
    const values = Array.isArray(tab?.values) ? tab.values : []
    const formulas = Array.isArray(tab?.formulas) ? tab.formulas : []
    const styles = Array.isArray(tab?.styles) ? tab.styles : []
    const rowCount = Math.max(values.length, formulas.length)
    for (let r = 0; r < rowCount; r += 1) {
        const rowValues = Array.isArray(values[r]) ? values[r] : []
        const rowFormulas = Array.isArray(formulas[r]) ? formulas[r] : []
        const width = Math.max(rowValues.length, rowFormulas.length)
        const cells = []
        let hasData = false
        for (let c = 0; c < width; c += 1) {
            const value = rowValues[c] ?? ''
            const formula = rowFormulas[c] ?? ''
            const style = styles[r]?.[c] || null
            if (String(value ?? '').trim() || String(formula ?? '').trim()) hasData = true
            const cell = {
                col: c + 1,
                a1: `${spreadsheetColumnLabel(c)}${r + 1}`,
                value,
                formula,
            }
            if (style && Object.values(style).some((item) => item !== undefined && item !== null && String(item).trim() !== '')) {
                cell.style = style
            }
            cells.push(cell)
        }
        if (hasData) rows.push({ rowNumber: r + 1, cells })
    }
    return rows
}

function firstNonEmptyRow(values) {
    return (Array.isArray(values) ? values : []).find((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim())) || []
}

function compactHeader(row) {
    return (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim())
}

export function parseGerenciaProcedures(values) {
    const rows = Array.isArray(values) ? values : []
    const header = compactHeader(rows[0] || [])
    const codes = header.slice(1).map(normalizeCode).filter(Boolean)
    const procedures = []
    const procedureCodes = []
    for (let r = 1; r < rows.length; r += 1) {
        const row = rows[r] || []
        const procedureName = String(row[0] ?? '').trim()
        if (!procedureName || normalizeText(procedureName) === 'tratamento') continue
        procedures.push(procedureName)
        for (let c = 0; c < codes.length; c += 1) {
            if (parseBoolean(row[c + 1])) procedureCodes.push({ procedureName, code: codes[c] })
        }
    }
    return { codes, procedures, procedureCodes }
}

function normalizeCellStyle(style = {}) {
    return {
        backgroundColor: String(style.backgroundColor || style.background || '').trim(),
        fontColor: String(style.fontColor || '').trim(),
        fontFamily: String(style.fontFamily || '').trim(),
        fontSize: Number.isFinite(Number(style.fontSize)) ? Number(style.fontSize) : null,
        fontWeight: String(style.fontWeight || '').trim(),
        fontStyle: String(style.fontStyle || '').trim(),
    }
}

export function parseGerenciaEquipe(values, styles = []) {
    const rows = Array.isArray(values) ? values : []
    const professionals = []
    for (let r = 1; r < rows.length; r += 1) {
        const row = rows[r] || []
        const nameStyle = normalizeCellStyle(styles?.[r]?.[0] || {})
        const name = stringifyCellValue(row[0])
        if (!isMeaningfulProfessionalName(name)) continue
        professionals.push({
            name,
            status: stringifyCellValue(row[1]) || 'Ativo',
            units: splitList(row[2]),
            roles: splitList(row[3]),
            turnos: splitList(row[4]),
            role: splitList(row[3]).join(', '),
            shift: splitList(row[4]).join(', '),
            alias: String(row[5] ?? '').trim(),
            phone: String(row[6] ?? '').trim(),
            email: String(row[7] ?? '').trim(),
            instagram: String(row[8] ?? '').trim(),
            backgroundColor: nameStyle.backgroundColor,
            fontColor: nameStyle.fontColor,
            fontFamily: nameStyle.fontFamily,
            fontSize: nameStyle.fontSize,
            fontWeight: nameStyle.fontWeight,
            fontStyle: nameStyle.fontStyle,
        })
    }
    return professionals
}

export function buildScheduleDropdowns(professionals = []) {
    const byUnit = new Map()
    for (const unitConfig of GERENCIA_APPS_SCRIPT_CONFIG.scheduleUnits) {
        const names = professionals
            .filter((professional) => {
                if (String(professional.status || 'Ativo').trim() !== 'Ativo') return false
                const units = Array.isArray(professional.units) ? professional.units : splitList(professional.units)
                const roles = (Array.isArray(professional.roles) ? professional.roles : splitList(professional.role)).map(normalizeRole)
                if (units.length && !units.includes(unitConfig.unitName)) return false
                return roles.some((role) => role.startsWith('injetor'))
            })
            .map((professional) => String(professional.name || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        names.push(GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel)
        byUnit.set(unitConfig.unitSlug, {
            unitSlug: unitConfig.unitSlug,
            unitName: unitConfig.unitName,
            columns: unitConfig.columns,
            values: Array.from(new Set(names)),
        })
    }
    return Array.from(byUnit.values())
}

export function convertColorCodesToScores(colorArray) {
    const map = {
        '#6d9eeb': 3,
        '#93c47d': 2,
        '#ffd966': 1,
        '#e06666': 0,
        '#ffffff': 0,
    }
    if (!Array.isArray(colorArray) || colorArray.length === 0) return [[]]
    const rows = Array.isArray(colorArray[0]) ? colorArray : colorArray.map((value) => [value])
    return rows.map((row) => row.map((color) => {
        const key = String(color || '').trim().toLowerCase()
        return map[key] !== undefined ? map[key] : 'Erro'
    }))
}

export function getFilteredBackgroundColorsFromMatrix(cellRefs, colorsMatrix, baseCell = 'C3') {
    const refs = Array.isArray(cellRefs) ? cellRefs : [cellRefs]
    const colors = Array.isArray(colorsMatrix) ? colorsMatrix : []
    const baseMatch = String(baseCell || 'C3').replace(/\$/g, '').trim().match(/^([A-Z]+)(\d+)$/i)
    const baseColumn = baseMatch ? columnLetterToIndex(baseMatch[1]) : columnLetterToIndex('C')
    const baseRow = baseMatch ? Number(baseMatch[2]) : 3
    return refs.map((ref) => {
        const match = String(ref || '').replace(/\$/g, '').trim().match(/^([A-Z]+)(\d+)$/i)
        if (!match) return ['Erro']
        const colOffset = columnLetterToIndex(match[1]) - baseColumn
        const rowOffset = Number(match[2]) - baseRow
        const color = colors[rowOffset]?.[colOffset]
        return [color || 'Erro']
    })
}

function rowCellsToArray(row) {
    const cells = Array.isArray(row?.cells) ? row.cells : []
    const width = cells.reduce((max, cell) => Math.max(max, Number(cell.col || 0)), 0)
    const out = Array.from({ length: width }, () => ({ value: '', formula: '', style: null }))
    for (const cell of cells) {
        const idx = Number(cell.col || 0) - 1
        if (idx < 0) continue
        out[idx] = {
            value: cell.value ?? '',
            formula: cell.formula || '',
            style: cell.style || null,
        }
    }
    return out
}

function valueAt(row, index) {
    return row?.[index]?.value ?? ''
}

function findMonthColumnIndex(headerRow, monthNameUpper) {
    const target = normalizeText(monthNameUpper)
    for (let i = 0; i < headerRow.length; i += 1) {
        if (normalizeText(valueAt(headerRow, i)) === target) return i
    }
    return -1
}

function findWeekOffset(weeksRow, weekNumber) {
    const re = new RegExp(`\\b${weekNumber}\\s*[º°ª]?\\b`)
    for (let i = 0; i < weeksRow.length; i += 1) {
        const s = String(valueAt(weeksRow, i) || '')
        if (re.test(s)) return i
        if (s.includes(`${weekNumber}°`) || s.includes(`${weekNumber}º`) || s.includes(`${weekNumber}ª`)) return i
    }
    for (let i = 0; i < weeksRow.length; i += 1) {
        if (String(valueAt(weeksRow, i) || '').includes(String(weekNumber))) return i
    }
    return -1
}

function conversionReportRow(row, monthColumn, weekColumn, bxColumn, bzColumn) {
    const cells = []
    cells.push(row[0] || { value: '', formula: '', style: null })
    for (let c = monthColumn; c <= weekColumn; c += 1) {
        cells.push(row[c] || { value: '', formula: '', style: null })
    }
    cells.push(row[bxColumn] || { value: '', formula: '', style: null })
    cells.push(row[bzColumn] || { value: '', formula: '', style: null })
    return {
        label: String(cells[0]?.value ?? '').trim(),
        values: cells.map((cell) => cell.value ?? ''),
        cells,
    }
}

function conversionNumericValue(row, index, fallback = 0) {
    return parseDecimal(valueAt(row, index), fallback)
}

function conversionScoreFromColor(cell) {
    const color = String(cell?.style?.backgroundColor || cell?.style?.background || '').trim().toLowerCase()
    const converted = convertColorCodesToScores([[color]])?.[0]?.[0]
    return typeof converted === 'number' ? converted : null
}

function buildConversionDoctorRanking(rows, monthColumn, weekColumn, bxColumn, bzColumn) {
    const metricKeys = new Map([
        ['total', 'total'],
        ['meta mensal', 'monthlyGoal'],
        ['meta semanal', 'periodGoal'],
        ['meta diaria', 'dailyGoal'],
        ['media', 'average'],
        ['mediana', 'median'],
        ['razao superior', 'upperRatio'],
        ['razao inferior', 'lowerRatio'],
        ['razao interior', 'innerRatio'],
        ['razao exterior', 'outerRatio'],
        ['linha corte', 'cutLine'],
        ['intervalo', 'interval'],
    ])
    const ignored = new Set(GERENCIA_APPS_SCRIPT_CONFIG.conversion.ignoreLabels.map(normalizeText))
    const special = new Set(GERENCIA_APPS_SCRIPT_CONFIG.conversion.specialRows.map(normalizeText))
    const sections = []
    for (const unitName of GERENCIA_APPS_SCRIPT_CONFIG.conversion.unitsOrder) {
        const unitNorm = normalizeText(unitName)
        const metrics = {}
        const doctors = []
        for (let r = 2; r < rows.length; r += 1) {
            const row = rows[r] || []
            const label = String(valueAt(row, 0) || '').trim()
            const normalizedLabel = normalizeText(label)
            const unitCell = normalizeText(valueAt(row, 1))
            if (!label || unitCell !== unitNorm) continue
            const metricKey = metricKeys.get(normalizedLabel)
            if (metricKey) {
                metrics[metricKey] = {
                    label,
                    weekValue: conversionNumericValue(row, weekColumn, 0),
                    totalValue: conversionNumericValue(row, bxColumn, conversionNumericValue(row, weekColumn, 0)),
                    position: String(valueAt(row, bzColumn) || '').trim(),
                }
                continue
            }
            if (ignored.has(normalizedLabel) || special.has(normalizedLabel)) continue
            const weekValue = conversionNumericValue(row, weekColumn, 0)
            const totalValue = conversionNumericValue(row, bxColumn, weekValue)
            const rawScore = conversionNumericValue(row, bxColumn, Number.NaN)
            const colorScore = conversionScoreFromColor(row[weekColumn])
            const thresholdScore = (() => {
                const upper = Number(metrics.upperRatio?.weekValue || 0)
                const cutLine = Number(metrics.cutLine?.weekValue || 0)
                const lower = Number(metrics.lowerRatio?.weekValue || metrics.innerRatio?.weekValue || 0)
                if (upper > 0 && weekValue >= upper) return 3
                if (cutLine > 0 && weekValue >= cutLine) return 2
                if (lower > 0 && weekValue >= lower) return 1
                return weekValue > 0 ? 0 : 0
            })()
            const score = Number.isFinite(rawScore) && rawScore > 0 ? rawScore : (colorScore ?? thresholdScore)
            if (weekValue <= 0 && totalValue <= 0 && score <= 0) continue
            doctors.push({
                name: label,
                weekValue,
                totalValue,
                score,
                position: String(valueAt(row, bzColumn) || '').trim(),
            })
        }
        doctors.sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.weekValue || 0) - Number(a.weekValue || 0) || a.name.localeCompare(b.name, 'pt-BR'))
        if (doctors.length || Object.keys(metrics).length) {
            sections.push({
                unitName,
                unitSlug: normalizeUnit(unitName).slug,
                metrics,
                doctors: doctors.map((doctor, index) => ({ ...doctor, rank: index + 1 })),
            })
        }
    }
    const allDoctors = sections
        .flatMap((section) => section.doctors.map((doctor) => ({ ...doctor, unitName: section.unitName, unitSlug: section.unitSlug })))
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.weekValue || 0) - Number(a.weekValue || 0) || a.name.localeCompare(b.name, 'pt-BR'))
    return {
        sections,
        topDoctors: allDoctors.slice(0, 8).map((doctor, index) => ({ ...doctor, rank: index + 1 })),
    }
}

export function buildConversionTempExportMetadata(period) {
    const reports = GERENCIA_APPS_SCRIPT_CONFIG.reports
    const weekLabel = `${period.weekNumber}ª Semana`
    const monthFolder = String(period.targetMonth).padStart(2, '0')
    return {
        sheetName: GERENCIA_APPS_SCRIPT_CONFIG.sheets.tempExport,
        fileName: `${reports.fileNamePrefix} - ${weekLabel}`,
        folderId: reports.folderId,
        drivePath: `${period.targetYear}/${monthFolder}/${period.weekNumber}`,
        deleteAfterExport: reports.deleteTempAfterExport,
        pdf: {
            format: 'pdf',
            size: 'A4',
            portrait: reports.pdfPortrait,
            fitWidth: true,
            showSheetNames: false,
            printTitle: false,
            pageNumbers: false,
            gridlines: false,
            frozenRows: false,
            retries: reports.pdfExportRetries,
            backoffMs: reports.pdfExportBackoffMs,
        },
    }
}

export function buildConversionReportFromRawRows(rawRows = [], dateInput = new Date()) {
    const period = getReportPeriod(dateInput)
    const rows = [...(Array.isArray(rawRows) ? rawRows : [])]
        .sort((a, b) => Number(a.sourceRow || a.rowNumber || 0) - Number(b.sourceRow || b.rowNumber || 0))
        .map(rowCellsToArray)
    const warnings = []
    if (rows.length < 2) {
        return { period, sections: [], tempExport: buildConversionTempExportMetadata(period), warnings: ['Aba Conversão vazia ou não importada.'] }
    }
    const monthColumn = findMonthColumnIndex(rows[0], period.monthName)
    if (monthColumn < 0) {
        return { period, sections: [], tempExport: buildConversionTempExportMetadata(period), warnings: [`Mês ${period.monthName} não encontrado na linha 1 da aba Conversão.`] }
    }
    const weeksPerMonth = GERENCIA_APPS_SCRIPT_CONFIG.conversion.weeksPerMonth
    const weekOffset = findWeekOffset(rows[1].slice(monthColumn, monthColumn + weeksPerMonth), period.weekNumber)
    if (weekOffset < 0) {
        return { period, sections: [], tempExport: buildConversionTempExportMetadata(period), warnings: [`Semana ${period.weekNumber}ª não encontrada na linha 2 da aba Conversão.`] }
    }
    const weekColumn = monthColumn + weekOffset
    const bxColumn = columnLetterToIndex(GERENCIA_APPS_SCRIPT_CONFIG.conversion.columns.bx)
    const bzColumn = columnLetterToIndex(GERENCIA_APPS_SCRIPT_CONFIG.conversion.columns.bz)
    const ignore = new Set(GERENCIA_APPS_SCRIPT_CONFIG.conversion.ignoreLabels.map(normalizeText))
    const special = new Set(GERENCIA_APPS_SCRIPT_CONFIG.conversion.specialRows.map(normalizeText))
    const sections = []
    for (const unitName of GERENCIA_APPS_SCRIPT_CONFIG.conversion.unitsOrder) {
        const unitNorm = normalizeText(unitName)
        const sectionRows = [0, 1].map((index) => conversionReportRow(rows[index] || [], monthColumn, weekColumn, bxColumn, bzColumn))
        for (let r = 2; r < rows.length; r += 1) {
            const row = rows[r] || []
            const label = normalizeText(valueAt(row, 0))
            const unitCell = normalizeText(valueAt(row, 1))
            if (unitCell !== unitNorm) continue
            if (special.has(label)) {
                sectionRows.push(conversionReportRow(row, monthColumn, weekColumn, bxColumn, bzColumn))
                continue
            }
            if (ignore.has(label)) continue
            const hasPositive = row.slice(monthColumn, weekColumn + 1).some((cell) => parseDecimal(cell?.value, 0) > 0)
            if (!hasPositive) continue
            sectionRows.push(conversionReportRow(row, monthColumn, weekColumn, bxColumn, bzColumn))
        }
        if (sectionRows.length > 2) {
            sections.push({
                unitName,
                unitSlug: normalizeUnit(unitName).slug,
                rows: sectionRows,
            })
        }
    }
    return {
        period,
        source: {
            monthColumn: spreadsheetColumnLabel(monthColumn),
            weekColumn: spreadsheetColumnLabel(weekColumn),
            bxColumn: GERENCIA_APPS_SCRIPT_CONFIG.conversion.columns.bx,
            bzColumn: GERENCIA_APPS_SCRIPT_CONFIG.conversion.columns.bz,
        },
        tempExport: buildConversionTempExportMetadata(period),
        config: {
            fileNamePrefix: GERENCIA_APPS_SCRIPT_CONFIG.reports.fileNamePrefix,
            unitsOrder: GERENCIA_APPS_SCRIPT_CONFIG.conversion.unitsOrder,
            ignoreLabels: GERENCIA_APPS_SCRIPT_CONFIG.conversion.ignoreLabels,
            specialRows: GERENCIA_APPS_SCRIPT_CONFIG.conversion.specialRows,
        },
        sections,
        doctorRanking: buildConversionDoctorRanking(rows, monthColumn, weekColumn, bxColumn, bzColumn),
        warnings,
        summary: {
            sections: sections.length,
            rows: sections.reduce((acc, section) => acc + section.rows.length, 0),
        },
    }
}

const MONTH_NAMES = new Map([
    ['janeiro', 1],
    ['fevereiro', 2],
    ['marco', 3],
    ['abril', 4],
    ['maio', 5],
    ['junho', 6],
    ['julho', 7],
    ['agosto', 8],
    ['setembro', 9],
    ['outubro', 10],
    ['novembro', 11],
    ['dezembro', 12],
])

function parseMonthHeader(row) {
    for (let c = 0; c < (row || []).length - 1; c += 1) {
        const month = MONTH_NAMES.get(normalizeText(row[c]))
        const year = Number(row[c + 1])
        if (month && Number.isInteger(year) && year >= 2020 && year <= 2100) return { month, year }
    }
    return null
}

export function parseGerenciaHorario(values) {
    const rows = Array.isArray(values) ? values : []
    const blockStarts = []
    for (let r = 0; r < rows.length; r += 1) {
        const header = parseMonthHeader(rows[r] || [])
        if (header) blockStarts.push({ rowIndex: r, ...header })
    }
    const schedules = []
    for (let b = 0; b < blockStarts.length; b += 1) {
        const block = blockStarts[b]
        const nextRow = blockStarts[b + 1]?.rowIndex ?? rows.length
        for (let dayRow = block.rowIndex + 2; dayRow < nextRow; dayRow += 2) {
            const days = rows[dayRow] || []
            const doctors = rows[dayRow + 1] || []
            for (const [unitName, startCol] of [['Novo Hamburgo', 0], ['BarraShoppingSul', 7]]) {
                for (let c = startCol; c < startCol + 7; c += 1) {
                    const day = Number.parseInt(String(days[c] ?? '').trim(), 10)
                    if (!Number.isInteger(day) || day < 1 || day > 31) continue
                    const date = new Date(Date.UTC(block.year, block.month - 1, day))
                    if (date.getUTCFullYear() !== block.year || date.getUTCMonth() !== block.month - 1 || date.getUTCDate() !== day) continue
                    const unit = normalizeUnit(unitName)
                    schedules.push({
                        year: block.year,
                        date: `${block.year}-${String(block.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        unitSlug: unit.slug,
                        unitName: unit.name,
                        doctorName: String(doctors[c] ?? '').trim(),
                    })
                }
            }
        }
    }
    return schedules
}

export function parseGerenciaInventory(values) {
    const rows = Array.isArray(values) ? values : []
    const items = []
    for (let r = 1; r < rows.length; r += 1) {
        const row = rows[r] || []
        const product = String(row[0] ?? '').trim()
        if (!product) continue
        items.push({
            product,
            barraShoppingSul: parseDecimal(row[1], 0),
            novoHamburgo: parseDecimal(row[2], 0),
            sourceRow: r + 1,
        })
    }
    return items
}

export function parseGerenciaMetaRows(tabName, values) {
    const rows = Array.isArray(values) ? values : []
    return rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()))
        .map(({ row, index }) => ({
            tabName,
            sourceRow: index + 1,
            label: String(row[0] ?? row[1] ?? tabName).trim() || `${tabName} linha ${index + 1}`,
            values: row,
        }))
}

function parseMetaYear(tabName) {
    const match = String(tabName || '').match(/\b(20\d{2})\b/)
    return match ? Number(match[1]) : null
}

function normalizeGoalCell(value) {
    const effective = getEffectiveCellValue(value)
    if (effective == null) return ''
    return effective
}

function goalRowValues(row, width = 18) {
    return Array.from({ length: width }, (_, index) => normalizeGoalCell(row?.[index]))
}

function goalRowFormulas(row, width = 18) {
    return Array.from({ length: width }, (_, index) => String(row?.[index] || '').trim())
}

const GOAL_LEVEL_COLUMNS = [
    { key: 'first', label: '1ª META', index: 8, sourceCol: 9 },
    { key: 'second', label: '2ª META', index: 9, sourceCol: 10 },
    { key: 'third', label: '3ª META', index: 10, sourceCol: 11 },
    { key: 'super', label: 'SUPER META', index: 11, sourceCol: 12 },
]

function monthNumberFromLabel(value) {
    return MONTH_NAME_TO_NUMBER.get(normalizeText(value)) || null
}

function parseGerenciaGoalBlock({ tabName, year, values, formulas, startIndex }) {
    const unitLabel = normalizeGoalCell(values?.[startIndex]?.[0])
    const unit = normalizeUnit(unitLabel)
    if (!unit.slug || unit.slug === 'unknown') return { rows: [], monthlyGoals: [], monthlyGoalLevels: [] }
    const headerIndex = startIndex + 2
    const endIndex = startIndex + 15
    const rows = []
    const monthlyGoals = []
    const monthlyGoalLevels = []
    for (let r = headerIndex; r <= endIndex && r < values.length; r += 1) {
        const row = values[r] || []
        const label = String(normalizeGoalCell(row[0]) ?? '').trim()
        if (!label) continue
        const sourceRow = r + 1
        const rowValues = goalRowValues(row)
        const rowFormulas = goalRowFormulas(formulas?.[r] || [])
        rows.push({
            sourceTab: tabName,
            sourceRow,
            year,
            unitSlug: unit.slug,
            unitName: unit.name,
            label,
            values: rowValues,
            formulas: rowFormulas,
        })
        const month = monthNumberFromLabel(label)
        if (!month) continue
        const goalMonth = `${year}-${String(month).padStart(2, '0')}-01`
        for (const level of GOAL_LEVEL_COLUMNS) {
            const levelValue = parseCurrency(normalizeGoalCell(row[level.index]), NaN)
            if (!Number.isFinite(levelValue)) continue
            const goalLevel = {
                unitSlug: unit.slug,
                unitName: unit.name,
                month: goalMonth,
                levelKey: level.key,
                levelLabel: level.label,
                value: Math.round(levelValue * 100) / 100,
                sourceTab: tabName,
                sourceRow,
                sourceCol: level.sourceCol,
                sourcePayload: {
                    targetLevel: level.label,
                    rowLabel: label,
                    rowValues,
                    rowFormulas,
                },
            }
            monthlyGoalLevels.push(goalLevel)
            if (level.key === 'first') monthlyGoals.push(goalLevel)
        }
    }
    return { rows, monthlyGoals, monthlyGoalLevels }
}

export function parseGerenciaGoalTables(tabName, values, formulas = []) {
    const year = parseMetaYear(tabName)
    if (!year) return { rows: [], monthlyGoals: [], monthlyGoalLevels: [] }
    const normalizedName = normalizeText(tabName)
    if (!normalizedName.startsWith('meta ')) return { rows: [], monthlyGoals: [], monthlyGoalLevels: [] }
    const rows = Array.isArray(values) ? values : []
    const formulaRows = Array.isArray(formulas) ? formulas : []
    const out = { rows: [], monthlyGoals: [], monthlyGoalLevels: [] }
    for (let r = 0; r < rows.length; r += 1) {
        const label = normalizeText(normalizeGoalCell(rows[r]?.[0]))
        if (label !== 'novo hamburgo' && label !== 'barrashoppingsul') continue
        const block = parseGerenciaGoalBlock({ tabName, year, values: rows, formulas: formulaRows, startIndex: r })
        out.rows.push(...block.rows)
        out.monthlyGoals.push(...block.monthlyGoals)
        out.monthlyGoalLevels.push(...block.monthlyGoalLevels)
    }
    return out
}

export function parseGerenciaWorkbook(tabs, options = {}) {
    const spreadsheetId = String(options.spreadsheetId || GERENCIA_SOURCE_SHEET_ID).trim()
    const now = options.now || new Date()
    const out = {
        spreadsheetId,
        importedAt: now.toISOString(),
        tabs: [],
        rawRows: [],
        procedures: [],
        procedureCodes: [],
        professionals: [],
        schedules: [],
        managementItems: [],
        inventory: [],
        goalTableRows: [],
        monthlyGoals: [],
        monthlyGoalLevels: [],
    }
    for (const [tabName, tab] of Object.entries(tabs || {})) {
        const values = Array.isArray(tab?.values) ? tab.values : []
        const rows = buildRawRowsFromTab(tab)
        const kind = parseGerenciaTabKind(tabName)
        out.tabs.push({
            tabName,
            category: kind.category,
            sensitive: kind.sensitive,
            active: kind.active,
            rowCount: values.length,
            nonEmptyRows: rows.length,
            headers: compactHeader(firstNonEmptyRow(values)),
            formulaCount: rows.reduce((acc, row) => acc + row.cells.filter((cell) => String(cell.formula || '').trim()).length, 0),
        })
        out.rawRows.push(...rows.map((row) => ({ ...row, tabName, category: kind.category, sensitive: kind.sensitive })))

        if (normalizeText(tabName) === 'procedimento') {
            const parsed = parseGerenciaProcedures(values)
            out.procedures.push(...parsed.procedures)
            out.procedureCodes.push(...parsed.procedureCodes)
        } else if (normalizeText(tabName) === 'equipe') {
            out.professionals.push(...parseGerenciaEquipe(values, tab.styles || []))
        } else if (normalizeText(tabName) === 'horario') {
            out.schedules.push(...parseGerenciaHorario(values))
        } else if (normalizeText(tabName) === 'inventario') {
            out.inventory.push(...parseGerenciaInventory(values))
        }

        if (['commercial', 'finance', 'people', 'inventory', 'support', 'dashboard'].includes(kind.category)) {
            const rowsAsItems = parseGerenciaMetaRows(tabName, values)
            out.managementItems.push(...rowsAsItems.map((item) => ({
                category: kind.category,
                sourceTab: tabName,
                sourceRow: item.sourceRow,
                label: item.label,
                sensitive: kind.sensitive,
                active: kind.active,
                payload: { values: item.values },
            })))
        }

        const goalTables = parseGerenciaGoalTables(tabName, values, tab.formulas || [])
        out.goalTableRows.push(...goalTables.rows)
        out.monthlyGoals.push(...goalTables.monthlyGoals)
        out.monthlyGoalLevels.push(...goalTables.monthlyGoalLevels)
    }
    out.procedures = Array.from(new Set(out.procedures)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return out
}

export function isTemplateOrEmptyAttendance(row) {
    const date = String(row?.date ?? '').trim()
    const client = String(row?.clientName ?? '').trim()
    const procedure = String(row?.procedureName ?? '').trim()
    const year = Number(date.slice(0, 4))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || year < 2020 || year > 2030) return true
    if (!client) return true
    if (normalizeText(client) === 'nome completo') return true
    if (!procedure || normalizeText(procedure) === 'selecione') return true
    return false
}

export function normalizeAttendanceRow({ tabName, rowNumber, row, now = new Date() }) {
    const unit = normalizeUnit(tabName)
    const record = {
        unitSlug: unit.slug,
        unitName: unit.name,
        date: parseSheetDate(row?.[0], now),
        clientName: String(row?.[1] ?? '').trim(),
        procedureName: String(row?.[2] ?? '').trim(),
        code: normalizeCode(row?.[3]),
        quantity: parseDecimal(row?.[4], 0),
        discount: parseBoolean(row?.[5]),
        otherValue: parseCurrency(row?.[6], 0),
        roundValue: parseBoolean(row?.[7]),
        value: parseCurrency(row?.[8], NaN),
        injectorName: String(row?.[9] ?? '').trim(),
        consultantName: String(row?.[10] ?? '').trim(),
        observation: String(row?.[11] ?? '').trim(),
        sourceSheetId: SOURCE_SHEET_ID,
        sourceTab: tabName,
        sourceRow: rowNumber,
    }
    if (!Number.isFinite(record.value)) {
        const calculated = calculateAttendanceValue(record)
        record.value = calculated == null ? 0 : calculated
    }
    return record
}

export function buildImportRecords(tabs, now = new Date()) {
    const records = []
    const seen = new Set()
    for (const tabName of OPERATIONAL_TABS) {
        const values = tabs?.[tabName]
        if (!Array.isArray(values)) continue
        for (let index = 2; index < values.length; index += 1) {
            const rowNumber = index + 1
            const record = normalizeAttendanceRow({ tabName, rowNumber, row: values[index], now })
            if (isTemplateOrEmptyAttendance(record)) continue
            const key = `${record.sourceSheetId}|${record.sourceTab}|${record.sourceRow}`
            if (seen.has(key)) continue
            seen.add(key)
            records.push(record)
        }
    }
    return records
}

export function parseCacheRows(values) {
    const procedures = new Set()
    const codes = new Set()
    const professionals = new Map()
    const schedules = []
    const procedureCodes = []
    if (!Array.isArray(values)) return { procedures: [], codes: [], professionals: [], schedules: [], procedureCodes: [] }
    for (let index = 0; index < values.length; index += 1) {
        const row = values[index] || []
        const procedure = String(row[0] ?? '').trim()
        const code = normalizeCode(row[1])
        const name = String(row[3] ?? '').trim()
        const first = normalizeText(procedure)
        if (first === 'procedimentos' || first === 'procedimento') continue
        if (procedure) procedures.add(procedure)
        if (code) codes.add(code)
        if (name) {
            const roles = splitList(row[6])
            const turnos = splitList(row[7])
            professionals.set(normalizeText(name), {
                name,
                status: String(row[4] ?? '').trim() || 'Ativo',
                units: splitList(row[5]),
                roles,
                turnos,
                role: roles.join(', '),
                shift: turnos.join(', '),
                backgroundColor: String(row[8] ?? '').trim(),
                fontColor: String(row[9] ?? '').trim(),
            })
        }
        const year = Number(row[12])
        const key = String(row[13] ?? '').trim()
        const doctorName = String(row[14] ?? '').trim()
        const keyMatch = key.match(/^(\d{4}-\d{2}-\d{2})\|(.+)$/)
        if (Number.isInteger(year) && keyMatch) {
            const unit = normalizeUnit(keyMatch[2])
            schedules.push({
                year,
                date: keyMatch[1],
                unitSlug: unit.slug,
                unitName: unit.name,
                doctorName,
            })
        }
    }

    const matrixStart = 17
    const matrixRows = values
        .map((row) => (Array.isArray(row) ? row.slice(matrixStart) : []))
        .filter((row) => row.some((value) => String(value ?? '').trim()))
    if (matrixRows.length > 1) {
        const headerCodes = matrixRows[0].slice(1).map(normalizeCode)
        for (let r = 1; r < matrixRows.length; r += 1) {
            const procedureName = String(matrixRows[r][0] ?? '').trim()
            if (!procedureName) continue
            procedures.add(procedureName)
            for (let c = 0; c < headerCodes.length; c += 1) {
                const matrixCode = headerCodes[c]
                if (!matrixCode) continue
                codes.add(matrixCode)
                if (parseBoolean(matrixRows[r][c + 1])) {
                    procedureCodes.push({ procedureName, code: matrixCode })
                }
            }
        }
    }

    return {
        procedures: Array.from(procedures).sort((a, b) => a.localeCompare(b, 'pt-BR')),
        codes: Array.from(codes).sort(),
        professionals: Array.from(professionals.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        schedules: schedules.sort((a, b) => `${a.date}|${a.unitSlug}`.localeCompare(`${b.date}|${b.unitSlug}`)),
        procedureCodes,
    }
}

export function sanitizeLimit(value, fallback = 100, max = 500) {
    const num = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(num)) return fallback
    return Math.max(1, Math.min(max, num))
}

export function sanitizeOffset(value, fallback = 0) {
    const num = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(num)) return fallback
    return Math.max(0, num)
}
