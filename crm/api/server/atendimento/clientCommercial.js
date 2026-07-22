const DAY_MS = 24 * 60 * 60 * 1000

function number(value) {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
}

function isoDate(value) {
    if (!value) return ''
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const raw = String(value).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function toUtc(value) {
    const raw = isoDate(value)
    if (!raw) return null
    const date = new Date(`${raw}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]
}

function percentile(values, ratio) {
    const sorted = values.map(number).filter((value) => value > 0).sort((left, right) => left - right)
    if (!sorted.length) return 0
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))
    return sorted[index]
}

export function elapsedDays(from, asOf) {
    const start = toUtc(from)
    const end = toUtc(asOf)
    if (!start || !end || start > end) return null
    return Math.floor((end.getTime() - start.getTime()) / DAY_MS)
}

/**
 * Sales are deliberately absent from the recency calculation. A sale can be an
 * advance payment, while the attendance date is the only evidence of a visit.
 */
export function buildCommercialProfile(row = {}, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
    const lastAttendance = isoDate(row.lastAttendance || row.last_attendance)
    const recencyDays = elapsedDays(lastAttendance, asOf)
    const saleCount = number(row.saleCount || row.sale_count)
    const lifetimeSales = number(row.lifetimeSales || row.lifetime_sales)
    const visitCount = number(row.visitCount || row.visit_count)
    const procedureCount = number(row.procedureCount || row.procedure_count)
    const sourceTypes = unique(row.sourceTypes || row.source_types)
    return {
        identityId: String(row.identityId || row.identity_id || '').trim(),
        name: String(row.name || row.canonical_name || '').trim(),
        phone: String(row.phone || '').trim(),
        email: String(row.email || '').trim(),
        sourceTypes,
        identityQuality: sourceTypes.length >= 2 ? 'confirmed_multi_source' : 'confirmed_single_source',
        units: unique(row.units),
        lastAttendance: lastAttendance || null,
        recencyDays,
        visitCount,
        procedureCount,
        completedProcedures: unique(row.completedProcedures || row.completed_procedures),
        saleCount,
        lifetimeSales,
        sales12m: number(row.sales12m || row.sales_12m),
        ticketAverage: saleCount > 0 ? Math.round((lifetimeSales / saleCount) * 100) / 100 : 0,
        purchasedProcedures: unique(row.purchasedProcedures || row.purchased_procedures),
        pendingSaleItems: number(row.pendingSaleItems || row.pending_sale_items),
        hasRecordedAttendance: !!lastAttendance,
        dataWarnings: [
            ...(lastAttendance ? [] : ['sem_atendimento_registrado']),
            ...(number(row.futureAttendanceCount || row.future_attendance_count) > 0 ? ['atendimentos_futuros_excluidos'] : []),
            ...(number(row.pendingSaleItems || row.pending_sale_items) > 0 ? ['itens_de_venda_sem_classificacao'] : []),
        ],
    }
}

function segment(key, label, priority, nextAction, evidence) {
    return { key, label, priority, nextAction, evidence }
}

export function segmentCommercialProfiles(rows = [], { asOf = new Date().toISOString().slice(0, 10), thresholds = [90, 180, 365] } = {}) {
    const profiles = rows.map((row) => buildCommercialProfile(row, { asOf }))
    const [returnRisk, longAbsence, veryLongAbsence] = [...thresholds].map(number).sort((left, right) => left - right)
    const salesP75 = percentile(profiles.map((profile) => profile.lifetimeSales), 0.75)
    const visitsP75 = percentile(profiles.map((profile) => profile.visitCount), 0.75)

    return profiles.map((profile) => {
        const segments = []
        const inactive = profile.recencyDays != null && profile.recencyDays >= returnRisk
        if (inactive) {
            const period = profile.recencyDays >= veryLongAbsence ? veryLongAbsence
                : profile.recencyDays >= longAbsence ? longAbsence
                    : returnRisk
            segments.push(segment(
                'return_at_risk',
                'Retorno em risco',
                period >= veryLongAbsence ? 'high' : period >= longAbsence ? 'medium' : 'normal',
                'Revisar retorno e convidar para uma avaliação',
                { daysWithoutAttendance: profile.recencyDays, thresholdDays: period },
            ))
        }
        if (!profile.hasRecordedAttendance && profile.saleCount > 0) {
            segments.push(segment(
                'no_recorded_attendance',
                'Sem atendimento registrado',
                'normal',
                'Confirmar histórico antes de qualquer contato comercial',
                { sales: profile.saleCount },
            ))
        }
        if (inactive && salesP75 > 0 && profile.lifetimeSales >= salesP75) {
            segments.push(segment(
                'high_value_inactive',
                'Alto valor inativo',
                'high',
                'Fazer contato consultivo e personalizado',
                { lifetimeSales: profile.lifetimeSales, benchmark: salesP75, daysWithoutAttendance: profile.recencyDays },
            ))
        }
        if (profile.visitCount >= visitsP75 && visitsP75 > 0 && (profile.recencyDays == null || profile.recencyDays < longAbsence)) {
            segments.push(segment(
                'frequent',
                'Assíduo',
                'normal',
                'Manter relacionamento e revisar preferências',
                { visits: profile.visitCount, benchmark: visitsP75 },
            ))
        }
        if (profile.lifetimeSales >= salesP75 && profile.visitCount >= visitsP75 && salesP75 > 0 && visitsP75 > 0 && (profile.recencyDays == null || profile.recencyDays < longAbsence)) {
            segments.push(segment(
                'balanced_vip',
                'VIP equilibrado',
                'normal',
                'Priorizar relacionamento e experiência personalizada',
                { lifetimeSales: profile.lifetimeSales, visits: profile.visitCount },
            ))
        }
        if (inactive && profile.saleCount <= 1 && profile.visitCount <= 1 && profile.hasRecordedAttendance) {
            segments.push(segment(
                'first_return',
                'Primeiro retorno',
                'normal',
                'Convidar para continuidade de cuidado',
                { sales: profile.saleCount, visits: profile.visitCount, daysWithoutAttendance: profile.recencyDays },
            ))
        }
        if (inactive && profile.lifetimeSales > 0 && profile.visitCount > 0) {
            segments.push(segment(
                'reactivation_potential',
                'Potencial de reativação',
                salesP75 > 0 && profile.lifetimeSales >= salesP75 ? 'high' : 'medium',
                'Priorizar contato assistido com contexto do histórico',
                { lifetimeSales: profile.lifetimeSales, visits: profile.visitCount, daysWithoutAttendance: profile.recencyDays },
            ))
        }
        const priorityOrder = { high: 3, medium: 2, normal: 1 }
        const highestPriority = segments.reduce((highest, item) => Math.max(highest, priorityOrder[item.priority] || 0), 0)
        return {
            ...profile,
            segments,
            priority: highestPriority >= 3 ? 'high' : highestPriority === 2 ? 'medium' : 'normal',
            recommendedAction: segments[0]?.nextAction || 'Sem ação comercial sugerida',
        }
    }).sort((left, right) => {
        const order = { high: 3, medium: 2, normal: 1 }
        return (order[right.priority] - order[left.priority])
            || (right.recencyDays || -1) - (left.recencyDays || -1)
            || right.lifetimeSales - left.lifetimeSales
    })
}

export function summarizeCommercialProfiles(profiles = []) {
    const bySegment = new Map()
    for (const profile of profiles) {
        for (const item of profile.segments || []) bySegment.set(item.key, (bySegment.get(item.key) || 0) + 1)
    }
    const buyers = profiles.filter((profile) => profile.saleCount > 0)
    const totalSales = buyers.reduce((sum, profile) => sum + profile.lifetimeSales, 0)
    const totalPurchases = buyers.reduce((sum, profile) => sum + profile.saleCount, 0)
    return {
        profiles: profiles.length,
        returnAtRisk: bySegment.get('return_at_risk') || 0,
        highValueInactive: bySegment.get('high_value_inactive') || 0,
        frequent: bySegment.get('frequent') || 0,
        balancedVip: bySegment.get('balanced_vip') || 0,
        reactivationPotential: bySegment.get('reactivation_potential') || 0,
        averageTicket: totalPurchases ? Math.round((totalSales / totalPurchases) * 100) / 100 : 0,
    }
}
