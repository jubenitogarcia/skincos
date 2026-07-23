import { createHash } from 'node:crypto'
import { normalizeClientEmail, normalizeClientPhone } from './clientRegistrationIdentity.js'
import { normalizeClientName } from './clientIdentity.js'

const compact = (value) => String(value ?? '').trim()
const unique = (values) => [...new Set(values.filter(Boolean))].sort()

function headerKey(value) {
    return normalizeClientName(value).replace(/[^a-z0-9]/g, '')
}

function cell(row, keys) {
    for (const [header, value] of Object.entries(row || {})) {
        if (keys.includes(headerKey(header)) && compact(value)) return compact(value)
    }
    return ''
}

function allCells(row, predicate) {
    return Object.entries(row || {}).filter(([header]) => predicate(headerKey(header))).map(([, value]) => compact(value)).filter(Boolean)
}

function phones(row) {
    return unique(allCells(row, (key) => /^(telefone|telefones|celular|whatsapp|fone)/.test(key))
        .flatMap((value) => String(value).match(/\d[\d().\s+-]{7,}\d/g) || [value]).map(normalizeClientPhone))
}

function emails(row) {
    return unique(allCells(row, (key) => /^(email|emails)/.test(key)).flatMap((value) =>
        String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [value]).map(normalizeClientEmail))
}

export function normalizeLeadUnit(value) {
    const key = normalizeClientName(value).replace(/[^a-z0-9]/g, '')
    if (key === 'barrashoppingsul') return 'barra-shopping-sul'
    if (key === 'novohamburgo') return 'novo-hamburgo'
    return key.replace(/[^a-z0-9]+/g, '-')
}

function inferUnit(tabName, row) {
    const explicit = cell(row, ['unidade', 'unit'])
    if (explicit) return normalizeLeadUnit(explicit)
    if (tabName === 'Novo Hamburgo') return 'novo-hamburgo'
    if (tabName === 'BarraShoppingSul') return 'barra-shopping-sul'
    return ''
}

function leadName(row) {
    const direct = cell(row, ['nomecompleto', 'cliente', 'nome'])
    if (direct) return direct
    return [cell(row, ['primeironome', 'firstname']), cell(row, ['sobrenome', 'ultimonome', 'lastname'])].filter(Boolean).join(' ')
}

function stableProfileId(spreadsheetId, sourceRows) {
    // The first source row is a stable anchor: a later duplicate must enrich the
    // same profile rather than create a second one on every re-import.
    const source = sourceRows.map((item) => `${item.tab}:${item.row}`).sort()[0]
    return `lead-${createHash('sha256').update(`${spreadsheetId}|${source}`).digest('hex').slice(0, 24)}`
}

class UnionFind {
    constructor(values) { this.parent = new Map(values.map((value) => [value, value])) }
    find(value) { const parent = this.parent.get(value); if (parent === value) return value; const root = this.find(parent); this.parent.set(value, root); return root }
    join(left, right) { const a = this.find(left); const b = this.find(right); if (a !== b) this.parent.set(b, a) }
}

export function buildSupplementalLeadProfiles({ spreadsheetId, tabs = {} } = {}) {
    const rows = []
    for (const [tab, values] of Object.entries(tabs)) {
        const [headers = [], ...records] = values
        records.forEach((record, offset) => {
            const row = Object.fromEntries(headers.map((header, index) => [header, record[index] ?? '']))
            const name = leadName(row)
            const nameKey = normalizeClientName(name)
            const rowPhones = phones(row); const rowEmails = emails(row)
            if (!nameKey && !rowPhones.length && !rowEmails.length) return
            rows.push({ tab, row: offset + 2, name, nameKey, phones: rowPhones, emails: rowEmails, unit: inferUnit(tab, row), birthday: cell(row, ['nascimento', 'datanascimento', 'aniversario']) })
        })
    }
    const union = new UnionFind(rows.map((_, index) => index))
    const contacts = new Map()
    rows.forEach((row, index) => {
        if (!row.nameKey) return
        for (const contact of [...row.phones.map((value) => `p:${value}`), ...row.emails.map((value) => `e:${value}`)]) {
            const key = `${row.nameKey}|${contact}`
            if (contacts.has(key)) union.join(index, contacts.get(key)); else contacts.set(key, index)
        }
    })
    const groups = new Map()
    rows.forEach((row, index) => { const root = union.find(index); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(row) })
    return [...groups.values()].map((items) => {
        const names = unique(items.map((item) => item.name)); const name = names.sort((a, b) => b.length - a.length || a.localeCompare(b, 'pt-BR'))[0] || ''
        const sourceRows = items.map((item) => ({ tab: item.tab, row: item.row }))
        return {
            id: stableProfileId(spreadsheetId, sourceRows), name, nameKey: normalizeClientName(name), names,
            phones: unique(items.flatMap((item) => item.phones)), emails: unique(items.flatMap((item) => item.emails)),
            units: unique(items.map((item) => item.unit)), birthdays: unique(items.map((item) => item.birthday)), sourceRows,
        }
    }).sort((a, b) => a.id.localeCompare(b.id))
}

function indexBy(items, valuesFor) {
    const index = new Map()
    for (const item of items) for (const value of valuesFor(item)) {
        if (!value) continue
        if (!index.has(value)) index.set(value, [])
        index.get(value).push(item)
    }
    return index
}

function shared(left, right) { return left.filter((value) => right.includes(value)) }

function buildLinks(profiles, candidates, type) {
    const byEmail = indexBy(candidates, (item) => item.emails || [])
    const byPhone = indexBy(candidates, (item) => item.phones || [])
    const links = []
    for (const profile of profiles) {
        const emailCandidates = [...new Set(profile.emails.flatMap((email) => byEmail.get(email) || []))]
        if (emailCandidates.length === 1) {
            links.push({ profileId: profile.id, targetId: emailCandidates[0].id, method: 'exact_email', confidence: 1, status: 'auto_confirmed', evidence: { sharedEmails: shared(profile.emails, emailCandidates[0].emails || []) } })
            continue
        }
        const phoneCandidates = [...new Set(profile.phones.flatMap((phone) => byPhone.get(phone) || []))]
        const named = phoneCandidates.filter((candidate) => candidate.nameKey === profile.nameKey)
        if (named.length === 1) {
            links.push({ profileId: profile.id, targetId: named[0].id, method: 'exact_name_phone', confidence: 1, status: 'auto_confirmed', evidence: { sharedPhones: shared(profile.phones, named[0].phones || []) } })
            continue
        }
        const candidatesToReview = phoneCandidates.length ? phoneCandidates : candidates.filter((candidate) => candidate.nameKey && candidate.nameKey === profile.nameKey)
        for (const candidate of candidatesToReview) links.push({
            profileId: profile.id, targetId: candidate.id, method: phoneCandidates.length ? 'exact_phone' : 'exact_name',
            confidence: phoneCandidates.length ? 0.96 : 0.84,
            status: candidatesToReview.length === 1 ? 'suggested' : 'ambiguous',
            evidence: { sharedPhones: shared(profile.phones, candidate.phones || []), sharedEmails: shared(profile.emails, candidate.emails || []), sharedUnits: shared(profile.units, candidate.units || []) },
        })
    }
    return links
}

export function buildSupplementalLeadIdentityPlan({ profiles = [], appRegistrations = [], caixaCustomers = [] } = {}) {
    const appLinks = buildLinks(profiles, appRegistrations, 'app')
        .map((item) => ({ ...item, registrationId: item.targetId, targetId: undefined }))
    const caixaLinks = buildLinks(profiles, caixaCustomers, 'caixa')
        .map((item) => ({ ...item, caixaCustomerId: item.targetId, targetId: undefined }))
    const summarize = (links) => ({ total: links.length, linkedProfiles: new Set(links.map((item) => item.profileId)).size, autoConfirmed: links.filter((item) => item.status === 'auto_confirmed').length, suggested: links.filter((item) => item.status === 'suggested').length, ambiguous: links.filter((item) => item.status === 'ambiguous').length })
    return { profiles, appLinks, caixaLinks, summary: { profiles: profiles.length, contactCoverage: { phone: profiles.filter((item) => item.phones.length).length, email: profiles.filter((item) => item.emails.length).length }, app: summarize(appLinks), caixa: summarize(caixaLinks), policy: { automaticConfirmation: 'unique exact email or unique exact name plus phone', phoneConflicts: 'never unified automatically', nameOnly: 'suggested for review' } } }
}
