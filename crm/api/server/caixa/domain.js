export const CAIXA_SOURCE_SHEET_ID = '1Pamrzgz32_1dQO8jjqpGMTCSK-H4lSwt_SJrLlE0fZM'
export const CAIXA_TABS = ['BarraShoppingSul', 'Novo Hamburgo']

export function normalizeText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function normalizePhone(value) {
    let digits = String(value ?? '').replace(/\D/g, '')
    if (digits.startsWith('0055')) digits = digits.slice(2)
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`
    return digits.length >= 12 && digits.length <= 13 ? digits : ''
}

export function parseCurrency(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
    const raw = String(value ?? '').trim().replace(/R\$\s?/gi, '').replace(/\./g, '').replace(',', '.')
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : NaN
}

export function parseSheetDate(value) {
    const raw = String(value ?? '').trim()
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!match) return ''
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

export function parseSheetTime(value) {
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})/)
    if (!match) return ''
    const hour = Number(match[1]); const minute = Number(match[2])
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00` : ''
}

export function normalizeUnit(tabName) {
    const key = normalizeText(tabName)
    if (key === 'novohamburgo' || key === 'novo hamburgo') return { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }
    if (key === 'barrashoppingsul' || key === 'barra shopping sul') return { slug: 'barrashoppingsul', name: 'BarraShoppingSul' }
    return { slug: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: String(tabName ?? '').trim() }
}

export function splitServiceLines(value) {
    const lines = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return lines.length ? lines : ['']
}

export function inferProcedureName(rawService) {
    const key = normalizeText(rawService)
    if (!key || key === 'indefinido') return null
    if (key.includes('botox') || key.includes('protocolo botox')) return 'Botox'
    if (key === 'diamond') return 'Diamond'
    if (key.includes('elleva x')) return 'Elleva X'
    if (key.includes('elleva')) return 'Elleva'
    if (key.includes('lavieen')) return 'Lavieen'
    if (key.includes('sculptra')) return 'Sculptra'
    if (key.includes('radiesse')) return 'Radiesse'
    if (key.includes('skinbooster')) return 'Skinbooster'
    if (key.includes('hialuronidase')) return 'Hialuronidase'
    if (key.includes('intradermoterapia')) return 'Intradermoterapia'
    if (key.includes('microagulhamento')) return 'Microagulhamento'
    if (key.includes('peeling')) return 'Peeling'
    if (key.includes('alopecia') || key.includes('alop') || key.includes('capilar')) return 'Alopécia'
    if (key.includes('celulite')) return 'Celulite'
    if (key.includes('lipo') && key.includes('papada')) return 'Lipo Papada'
    if (key.includes('fio de pdo espiculado')) return 'Barbed'
    if (key.includes('fio de pdo filler')) return 'Filler'
    if (['bigode chines', 'facial', 'labial', 'labiomentual', 'malar', 'mandibula', 'mento', 'olheiras', 'temporas', 'glabela', 'codigo de barras', 'acido hialuronico'].some((term) => key.includes(term))) return 'Preenchimento'
    return null
}

export function buildCaixaRecords(tabs, spreadsheetId = CAIXA_SOURCE_SHEET_ID) {
    const records = []
    for (const tabName of CAIXA_TABS) {
        const rows = Array.isArray(tabs?.[tabName]) ? tabs[tabName] : []
        const unit = normalizeUnit(tabName)
        for (let index = 1; index < rows.length; index += 1) {
            const row = rows[index] || []
            const date = parseSheetDate(row[0]); const clientName = String(row[2] ?? '').trim(); const total = parseCurrency(row[4])
            if (!date || !clientName || !Number.isFinite(total)) continue
            const rawService = String(row[5] ?? '').trim()
            const grouped = new Map()
            for (const rawName of splitServiceLines(rawService)) {
                const serviceKey = normalizeText(rawName)
                const current = grouped.get(serviceKey)
                grouped.set(serviceKey, current ? { ...current, quantity: current.quantity + 1 } : { rawName, serviceKey, inferredProcedureName: inferProcedureName(rawName), quantity: 1 })
            }
            records.push({ sourceSheetId: spreadsheetId, sourceTab: tabName, sourceRow: index + 1, unit, date, time: parseSheetTime(row[1]), clientName, clientKey: normalizeText(clientName), phoneRaw: String(row[3] ?? '').trim(), phoneKey: normalizePhone(row[3]), total, rawService, items: Array.from(grouped.values()).map((item, position) => ({ ...item, position })) })
        }
    }
    return records
}
