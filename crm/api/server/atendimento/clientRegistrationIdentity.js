import { buildClientIdentityPlan, normalizeClientName, normalizedNameSimilarity } from './clientIdentity.js'

function compact(value) {
    return String(value ?? '').trim()
}

export function normalizeClientPhone(value) {
    let digits = compact(value).replace(/\D/g, '')
    if (digits.startsWith('0055')) digits = digits.slice(2)
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`
    return digits.length >= 12 && digits.length <= 13 ? digits : ''
}

export function normalizeClientEmail(value) {
    return compact(value).toLowerCase()
}

export function normalizeClientCpf(value) {
    const digits = compact(value).replace(/\D/g, '')
    return digits.length === 11 ? digits : ''
}

function values(value, expression) {
    return [...new Set((String(value ?? '').match(expression) || []).map((item) => item.trim()).filter(Boolean))]
}

function phones(...rawValues) {
    return [...new Set(rawValues.flatMap((value) => values(value, /\d[\d().\s+-]{7,}\d/g))
        .map(normalizeClientPhone).filter(Boolean))]
}

function emails(...rawValues) {
    return [...new Set(rawValues.flatMap((value) => values(value, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig))
        .map(normalizeClientEmail).filter(Boolean))]
}

function chooseName(variants) {
    return [...variants].sort((left, right) => right.length - left.length || left.localeCompare(right, 'pt-BR'))[0] || ''
}

function sameValues(left, right) {
    return [...left].filter((value) => right.has(value))
}

function registrationUnit(value) {
    const key = normalizeClientName(value).replace(/\s/g, '')
    if (key === 'barrashoppingsul') return 'barra-shopping-sul'
    if (key === 'novohamburgo') return 'novo-hamburgo'
    return key.replace(/[^a-z0-9]+/g, '-')
}

export function buildAppRegistrationCustomers(rows = []) {
    const customersById = new Map()
    for (const [index, row] of rows.entries()) {
        const name = compact(row.Cliente ?? row.clientName)
        const nameKey = normalizeClientName(name)
        const sourceId = compact(row['Cliente ID'] ?? row.clientId) || `missing-id-${index + 1}`
        if (!nameKey) continue
        let customer = customersById.get(sourceId)
        if (!customer) {
            customer = {
                id: sourceId,
                names: new Set(),
                nameKeys: new Set(),
                phones: new Set(),
                emails: new Set(),
                cpfs: new Set(),
                units: new Set(),
                sourceRows: 0,
            }
            customersById.set(sourceId, customer)
        }
        customer.sourceRows += 1
        customer.names.add(name)
        customer.nameKeys.add(nameKey)
        phones(row.Telefone ?? row.phone, row.Telefones ?? row.phones).forEach((value) => customer.phones.add(value))
        emails(row.Email ?? row.email, row.Emails ?? row.emails).forEach((value) => customer.emails.add(value))
        const cpf = normalizeClientCpf(row.CPF ?? row.cpf)
        if (cpf) customer.cpfs.add(cpf)
        const unit = registrationUnit(row.Unidade ?? row.unit)
        if (unit) customer.units.add(unit)
    }
    return [...customersById.values()].map((customer) => {
        const name = chooseName(customer.names)
        return {
            ...customer,
            name,
            nameKey: normalizeClientName(name),
            names: [...customer.names].sort(),
            nameKeys: [...customer.nameKeys].sort(),
            phones: [...customer.phones].sort(),
            emails: [...customer.emails].sort(),
            cpfs: [...customer.cpfs].sort(),
            units: [...customer.units].sort(),
        }
    })
}

function buildCaixaCustomers(customers, sales) {
    const byId = new Map(customers.map((item) => [item.id, {
        id: item.id,
        name: compact(item.name),
        nameKey: normalizeClientName(item.name),
        phones: new Set([normalizeClientPhone(item.phoneKey ?? item.phone_key ?? item.phone)] .filter(Boolean)),
        units: new Set(),
    }]))
    for (const sale of sales) {
        const customer = byId.get(sale.customerId ?? sale.customer_id)
        if (!customer) continue
        const unit = compact(sale.unitSlug ?? sale.unit_slug ?? sale.unitId ?? sale.unit_id)
        if (unit) customer.units.add(unit)
    }
    return [...byId.values()].map((customer) => ({ ...customer, phones: [...customer.phones], units: [...customer.units] }))
}

function indexBy(items, valuesFor) {
    const index = new Map()
    for (const item of items) {
        for (const value of valuesFor(item)) {
            if (!value) continue
            if (!index.has(value)) index.set(value, [])
            index.get(value).push(item)
        }
    }
    return index
}

function bestByUnit(candidates, units) {
    return candidates.map((candidate) => ({
        candidate,
        sharedUnits: sameValues(new Set(units), new Set(candidate.units)),
    })).sort((left, right) => right.sharedUnits.length - left.sharedUnits.length
        || left.candidate.id.localeCompare(right.candidate.id))
}

function linkRegistrationsToCaixa(registrations, caixaCustomers) {
    const byPhone = indexBy(caixaCustomers, (customer) => customer.phones)
    const byName = indexBy(caixaCustomers, (customer) => [customer.nameKey])
    const links = []
    for (const registration of registrations) {
        const phoneCandidates = [...new Set(registration.phones.flatMap((phone) => byPhone.get(phone) || []))]
        const matchingName = phoneCandidates.filter((candidate) => registration.nameKeys.includes(candidate.nameKey))
        if (matchingName.length === 1) {
            links.push({ registrationId: registration.id, caixaCustomerId: matchingName[0].id, method: 'exact_name_phone', confidence: 1, status: 'auto_confirmed', evidence: { sharedPhones: sameValues(new Set(registration.phones), new Set(matchingName[0].phones)), sharedUnits: sameValues(new Set(registration.units), new Set(matchingName[0].units)) } })
            continue
        }
        if (phoneCandidates.length) {
            const ranked = bestByUnit(phoneCandidates, registration.units)
            const best = ranked[0]
            const tied = ranked.filter((item) => item.sharedUnits.length === best.sharedUnits.length)
            for (const item of ranked) links.push({
                registrationId: registration.id,
                caixaCustomerId: item.candidate.id,
                method: matchingName.length > 1 ? 'phone_name_collision' : 'exact_phone',
                confidence: 0.96,
                status: tied.length === 1 ? 'suggested' : 'ambiguous',
                evidence: { sharedPhones: sameValues(new Set(registration.phones), new Set(item.candidate.phones)), sharedUnits: item.sharedUnits, nameSimilarity: normalizedNameSimilarity(registration.nameKey, item.candidate.nameKey) },
            })
            continue
        }
        const exactNames = [...new Set(registration.nameKeys.flatMap((nameKey) => byName.get(nameKey) || []))]
        if (exactNames.length) {
            const ranked = bestByUnit(exactNames, registration.units)
            const best = ranked[0]
            const tied = ranked.filter((item) => item.sharedUnits.length === best.sharedUnits.length)
            for (const item of ranked) links.push({ registrationId: registration.id, caixaCustomerId: item.candidate.id, method: 'exact_name', confidence: item.sharedUnits.length ? 0.9 : 0.84, status: tied.length === 1 ? 'suggested' : 'ambiguous', evidence: { sharedUnits: item.sharedUnits } })
        }
    }
    return links
}

function linkRegistrationsToAttendance(registrations, attendanceClients, caixaLinks, attendanceCaixaLinks) {
    const byName = indexBy(attendanceClients, (client) => [client.nameKey])
    const linkedCaixa = new Map()
    for (const link of caixaLinks.filter((item) => item.status === 'auto_confirmed')) linkedCaixa.set(link.registrationId, link.caixaCustomerId)
    const attendanceByCaixa = new Map()
    for (const link of attendanceCaixaLinks.filter((item) => item.status === 'auto_confirmed')) {
        if (!attendanceByCaixa.has(link.caixaCustomerId)) attendanceByCaixa.set(link.caixaCustomerId, [])
        attendanceByCaixa.get(link.caixaCustomerId).push(link.attendanceNameKey)
    }
    const links = []
    for (const registration of registrations) {
        const anchoredCaixa = linkedCaixa.get(registration.id)
        const anchoredClients = [...new Set(attendanceByCaixa.get(anchoredCaixa) || [])]
        if (anchoredClients.length === 1) {
            const attendance = attendanceClients.find((client) => client.nameKey === anchoredClients[0])
            links.push({ registrationId: registration.id, attendanceNameKey: attendance.nameKey, method: 'phone_sales_attendance_anchor', confidence: 1, status: 'auto_confirmed', evidence: { caixaCustomerId: anchoredCaixa, sharedUnits: sameValues(new Set(registration.units), attendance.units) } })
            continue
        }
        const exact = [...new Set(registration.nameKeys.flatMap((nameKey) => byName.get(nameKey) || []))]
        if (exact.length === 1) {
            const attendance = exact[0]
            const sharedUnits = sameValues(new Set(registration.units), attendance.units)
            links.push({ registrationId: registration.id, attendanceNameKey: attendance.nameKey, method: sharedUnits.length ? 'exact_name_unit' : 'exact_name', confidence: sharedUnits.length ? 0.9 : 0.84, status: 'suggested', evidence: { sharedUnits } })
        } else if (exact.length > 1) {
            for (const attendance of exact) links.push({ registrationId: registration.id, attendanceNameKey: attendance.nameKey, method: 'exact_name_collision', confidence: 0.84, status: 'ambiguous', evidence: {} })
        }
    }
    return links
}

function summarize(links) {
    return {
        total: links.length,
        linkedSources: new Set(links.map((link) => link.registrationId)).size,
        autoConfirmed: links.filter((link) => link.status === 'auto_confirmed').length,
        suggested: links.filter((link) => link.status === 'suggested').length,
        ambiguous: links.filter((link) => link.status === 'ambiguous').length,
    }
}

export function buildClientRegistrationIdentityPlan({ registrationRows = [], caixaCustomers = [], caixaSales = [], attendances = [] } = {}) {
    const registrations = buildAppRegistrationCustomers(registrationRows)
    const caixa = buildCaixaCustomers(caixaCustomers, caixaSales)
    const attendancePlan = buildClientIdentityPlan({ attendances, caixaCustomers, caixaSales })
    const registrationCaixaLinks = linkRegistrationsToCaixa(registrations, caixa)
    const registrationAttendanceLinks = linkRegistrationsToAttendance(registrations, attendancePlan.clients, registrationCaixaLinks, attendancePlan.caixaLinks)
    const contactCoverage = {
        phone: registrations.filter((item) => item.phones.length).length,
        email: registrations.filter((item) => item.emails.length).length,
        cpf: registrations.filter((item) => item.cpfs.length).length,
    }
    return {
        registrations,
        registrationCaixaLinks,
        registrationAttendanceLinks,
        summary: {
            registrationRows: registrationRows.length,
            appCustomers: registrations.length,
            appCustomersInBothUnits: registrations.filter((item) => item.units.length > 1).length,
            contactCoverage,
            caixa: summarize(registrationCaixaLinks),
            attendance: summarize(registrationAttendanceLinks),
            policy: {
                dateDistanceUsed: false,
                automaticConfirmation: 'only exact name plus phone, or a unique phone-to-sales-to-attendance anchor',
                phoneConflicts: 'never unified automatically',
                nameOnly: 'suggested for review',
            },
        },
    }
}
