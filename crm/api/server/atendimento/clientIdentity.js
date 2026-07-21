const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e'])

export function normalizeClientName(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function formatCanonicalClientName(value) {
    return normalizeClientName(value)
        .split(' ')
        .filter(Boolean)
        .map((part, index) => index > 0 && PARTICLES.has(part)
            ? part
            : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ')
}

export function normalizedNameSimilarity(left, right) {
    const a = normalizeClientName(left)
    const b = normalizeClientName(right)
    if (a === b) return 1
    if (!a || !b) return 0
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let row = 1; row <= a.length; row += 1) {
        const current = [row]
        for (let column = 1; column <= b.length; column += 1) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
            )
        }
        previous = current
    }
    return 1 - (previous[b.length] / Math.max(a.length, b.length))
}

function meaningfulTokens(value) {
    return normalizeClientName(value).split(' ').filter((token) => token.length >= 4)
}

function intersect(left, right) {
    return [...left].filter((value) => right.has(value))
}

function chooseRepresentative(variants) {
    return [...variants.values()].sort((left, right) =>
        right.count - left.count
        || right.rawName.trim().split(/\s+/).length - left.rawName.trim().split(/\s+/).length
        || right.rawName.length - left.rawName.length
        || left.rawName.localeCompare(right.rawName, 'pt-BR'))[0]?.rawName || ''
}

function buildAttendanceClients(attendances) {
    const clientsByKey = new Map()
    const assignments = []
    for (const attendance of attendances) {
        const nameKey = normalizeClientName(attendance.clientName)
        if (!nameKey) continue
        let client = clientsByKey.get(nameKey)
        if (!client) {
            client = {
                nameKey,
                variants: new Map(),
                attendanceCount: 0,
                units: new Set(),
                unitProcedures: new Set(),
            }
            clientsByKey.set(nameKey, client)
        }
        const rawName = String(attendance.clientName || '').trim()
        const variant = client.variants.get(rawName) || { rawName, count: 0 }
        variant.count += 1
        client.variants.set(rawName, variant)
        client.attendanceCount += 1
        if (attendance.unitId) client.units.add(attendance.unitId)
        if (attendance.unitId && attendance.procedureId) {
            client.unitProcedures.add(`${attendance.unitId}|${attendance.procedureId}`)
        }
        assignments.push({ attendanceId: attendance.id, nameKey, originalName: rawName })
    }
    const clients = [...clientsByKey.values()].map((client) => ({
        ...client,
        canonicalName: formatCanonicalClientName(chooseRepresentative(client.variants)),
        aliases: [...client.variants.values()].sort((left, right) => right.count - left.count),
    }))
    return { clients, clientsByKey: new Map(clients.map((client) => [client.nameKey, client])), assignments }
}

function candidatePool(entities) {
    const index = new Map()
    for (const entity of entities) {
        for (const token of new Set(meaningfulTokens(entity.nameKey))) {
            if (!index.has(token)) index.set(token, new Set())
            index.get(token).add(entity)
        }
    }
    return index
}

function buildMergeSuggestions(clients) {
    const tokenIndex = candidatePool(clients)
    const suggestions = []
    const seen = new Set()
    for (const client of clients) {
        if (meaningfulTokens(client.nameKey).length < 2) continue
        const pool = new Set()
        for (const token of meaningfulTokens(client.nameKey)) {
            for (const candidate of tokenIndex.get(token) || []) pool.add(candidate)
        }
        for (const candidate of pool) {
            if (candidate.nameKey === client.nameKey || meaningfulTokens(candidate.nameKey).length < 2) continue
            const pair = [client.nameKey, candidate.nameKey].sort()
            const pairKey = pair.join('|')
            if (seen.has(pairKey)) continue
            seen.add(pairKey)
            const sharedUnitProcedures = intersect(client.unitProcedures, candidate.unitProcedures)
            if (!sharedUnitProcedures.length) continue
            const similarity = normalizedNameSimilarity(client.nameKey, candidate.nameKey)
            if (similarity < 0.85) continue
            suggestions.push({
                leftNameKey: pair[0],
                rightNameKey: pair[1],
                similarity,
                evidence: {
                    sharedUnits: intersect(client.units, candidate.units),
                    sharedUnitProcedureCount: sharedUnitProcedures.length,
                },
            })
        }
    }
    return suggestions.sort((left, right) => right.similarity - left.similarity)
}

function buildCaixaEntities(customers, sales) {
    const byId = new Map(customers.map((customer) => [customer.id, {
        id: customer.id,
        name: customer.name,
        nameKey: normalizeClientName(customer.name),
        units: new Set(),
        unitProcedures: new Set(),
    }]))
    for (const sale of sales) {
        const customer = byId.get(sale.customerId)
        if (!customer) continue
        if (sale.unitId) customer.units.add(sale.unitId)
        for (const procedureId of sale.procedureIds || []) {
            if (sale.unitId && procedureId) customer.unitProcedures.add(`${sale.unitId}|${procedureId}`)
        }
    }
    return [...byId.values()]
}

function evidenceFor(attendanceClient, caixaCustomer) {
    const sharedUnits = intersect(attendanceClient.units, caixaCustomer.units)
    const sharedUnitProcedures = intersect(attendanceClient.unitProcedures, caixaCustomer.unitProcedures)
    return { sharedUnits, sharedUnitProcedureCount: sharedUnitProcedures.length }
}

function buildCaixaLinks(attendanceClients, caixaCustomers) {
    const exactIndex = new Map()
    for (const customer of caixaCustomers) {
        if (!exactIndex.has(customer.nameKey)) exactIndex.set(customer.nameKey, [])
        exactIndex.get(customer.nameKey).push(customer)
    }
    const tokenIndex = candidatePool(caixaCustomers)
    const links = []
    for (const client of attendanceClients) {
        const exact = exactIndex.get(client.nameKey) || []
        if (exact.length) {
            const ranked = exact.map((customer) => ({ customer, evidence: evidenceFor(client, customer) }))
                .sort((left, right) => right.evidence.sharedUnitProcedureCount - left.evidence.sharedUnitProcedureCount
                    || right.evidence.sharedUnits.length - left.evidence.sharedUnits.length)
            const best = ranked[0]
            const ties = ranked.filter((item) => item.evidence.sharedUnitProcedureCount === best.evidence.sharedUnitProcedureCount
                && item.evidence.sharedUnits.length === best.evidence.sharedUnits.length)
            for (const item of ranked) {
                const hasProcedure = item.evidence.sharedUnitProcedureCount > 0
                const hasUnit = item.evidence.sharedUnits.length > 0
                links.push({
                    attendanceNameKey: client.nameKey,
                    caixaCustomerId: item.customer.id,
                    method: hasProcedure ? 'exact_name_unit_procedure' : hasUnit ? 'exact_name_unit' : 'exact_name',
                    confidence: hasProcedure ? 1 : hasUnit ? 0.92 : 0.86,
                    status: hasProcedure && ties.length === 1 && item.customer.id === best.customer.id ? 'auto_confirmed' : ties.length > 1 ? 'ambiguous' : 'suggested',
                    evidence: item.evidence,
                })
            }
            continue
        }

        const pool = new Set()
        for (const token of meaningfulTokens(client.nameKey)) {
            for (const candidate of tokenIndex.get(token) || []) pool.add(candidate)
        }
        const ranked = [...pool].map((customer) => ({
            customer,
            similarity: normalizedNameSimilarity(client.nameKey, customer.nameKey),
            evidence: evidenceFor(client, customer),
        })).filter((item) => item.similarity >= 0.85 && item.evidence.sharedUnitProcedureCount > 0)
            .sort((left, right) => right.similarity - left.similarity
                || right.evidence.sharedUnitProcedureCount - left.evidence.sharedUnitProcedureCount)
        if (!ranked.length) continue
        const best = ranked[0]
        const uniqueBest = !ranked[1] || best.similarity - ranked[1].similarity >= 0.03
        links.push({
            attendanceNameKey: client.nameKey,
            caixaCustomerId: best.customer.id,
            method: 'fuzzy_name_unit_procedure',
            confidence: best.similarity,
            status: uniqueBest ? 'suggested' : 'ambiguous',
            evidence: { ...best.evidence, nameSimilarity: best.similarity },
        })
    }
    return links
}

export function buildClientIdentityPlan({ attendances = [], caixaCustomers = [], caixaSales = [] } = {}) {
    const attendance = buildAttendanceClients(attendances)
    const caixa = buildCaixaEntities(caixaCustomers, caixaSales)
    const mergeSuggestions = buildMergeSuggestions(attendance.clients)
    const caixaLinks = buildCaixaLinks(attendance.clients, caixa)
    const summary = {
        attendances: attendance.assignments.length,
        canonicalAttendanceClients: attendance.clients.length,
        exactDuplicatesUnified: Math.max(0, attendance.assignments.length - attendance.clients.length),
        aliases: attendance.clients.reduce((sum, client) => sum + client.aliases.length, 0),
        spellingReviewSuggestions: mergeSuggestions.length,
        caixaLinks: caixaLinks.length,
        linkedAttendanceClients: new Set(caixaLinks.map((link) => link.attendanceNameKey)).size,
        caixaExactNameLinks: caixaLinks.filter((link) => link.method.startsWith('exact_name')).length,
        caixaFuzzyNameLinks: caixaLinks.filter((link) => link.method === 'fuzzy_name_unit_procedure').length,
        caixaAutoConfirmed: caixaLinks.filter((link) => link.status === 'auto_confirmed').length,
        caixaSuggested: caixaLinks.filter((link) => link.status === 'suggested').length,
        caixaAmbiguous: caixaLinks.filter((link) => link.status === 'ambiguous').length,
    }
    return { ...attendance, caixaCustomers: caixa, mergeSuggestions, caixaLinks, summary }
}
