import { normalizeText, normalizeUnit, splitList } from './domain.js'

export const PROFESSIONAL_IDENTITY_VERSION = 'professional-identity/v1'

// These are the only legacy aliases approved by the current roster review.
// Adding an alias is an identity decision: it must be reviewed, auditable and
// never inferred from similar text alone.
export const CONFIRMED_PROFESSIONAL_ALIAS_RULES = Object.freeze([
    {
        canonicalName: 'Raul Rosário Júnior',
        aliases: ['Raul Júnior'],
        source: 'roster-confirmed-2026-07',
    },
    {
        canonicalName: 'Rafaela Machado Ferreira',
        aliases: ['Rafaela Ferreira'],
        source: 'roster-confirmed-2026-07',
    },
])

const INVALID_IDENTITY_KEYS = new Set(['', '[object object]', 'object object', 'injetor', 'consultor', 'selecione', 'sem atendimento'])

export function normalizeProfessionalAliasKey(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function isValidProfessionalIdentityName(value) {
    return !INVALID_IDENTITY_KEYS.has(normalizeProfessionalAliasKey(value))
}

function normalizedRoles(row) {
    const source = Array.isArray(row?.roles) && row.roles.length ? row.roles : row?.role
    return splitList(source).map(normalizeText)
}

function normalizedUnits(row) {
    return (Array.isArray(row?.units) ? row.units : splitList(row?.units))
        .map((unit) => normalizeUnit(unit).slug)
        .filter(Boolean)
}

export function professionalIdentityFromRow(row = {}) {
    const canonicalId = String(row.canonical_id || row.canonicalId || row.id || '').trim()
    const canonicalName = String(row.canonical_name || row.canonicalName || row.name || '').trim()
    return {
        id: String(row.id || '').trim(),
        canonicalId,
        canonicalName,
        name: String(row.name || '').trim(),
        nameKey: normalizeProfessionalAliasKey(row.name),
        aliases: Array.from(new Set([
            row.name,
            ...(Array.isArray(row.aliases) ? row.aliases : []),
            row.alias,
        ].map(normalizeProfessionalAliasKey).filter(Boolean))),
        status: String(row.status || 'Ativo').trim() || 'Ativo',
        units: normalizedUnits(row),
        roles: normalizedRoles(row),
        identityVersion: String(row.identity_version || row.identityVersion || PROFESSIONAL_IDENTITY_VERSION),
    }
}

function identityError(code, candidates = []) {
    const error = new Error(code)
    error.code = code
    error.statusCode = code === 'UNKNOWN_PROFESSIONAL' ? 404 : 400
    error.candidates = candidates.map((candidate) => ({
        id: candidate.canonicalId,
        name: candidate.canonicalName,
    }))
    return error
}

function uniqueCanonicalCandidates(candidates) {
    const byCanonicalId = new Map()
    for (const candidate of candidates) {
        if (!candidate.canonicalId || !isValidProfessionalIdentityName(candidate.canonicalName)) continue
        const current = byCanonicalId.get(candidate.canonicalId)
        if (!current || candidate.id === candidate.canonicalId) byCanonicalId.set(candidate.canonicalId, candidate)
    }
    return Array.from(byCanonicalId.values())
}

export function resolveProfessionalIdentity({ professionalId, professionalName, unit, expectedRole, allowTextResolution = false, allowInactive = false } = {}, rows = []) {
    const identities = (Array.isArray(rows) ? rows : []).map(professionalIdentityFromRow)
    const requestedId = String(professionalId || '').trim()
    const requestedNameKey = normalizeProfessionalAliasKey(professionalName)
    let candidates

    if (requestedId) {
        candidates = uniqueCanonicalCandidates(identities.filter((identity) => identity.id === requestedId || identity.canonicalId === requestedId))
        if (requestedNameKey && candidates.length === 1 && !candidates[0].aliases.includes(requestedNameKey) && normalizeProfessionalAliasKey(candidates[0].canonicalName) !== requestedNameKey) {
            throw identityError('PROFESSIONAL_IDENTITY_MISMATCH', candidates)
        }
    } else if (!requestedNameKey) {
        return null
    } else if (!allowTextResolution) {
        throw identityError('PROFESSIONAL_ID_REQUIRED')
    } else {
        candidates = uniqueCanonicalCandidates(identities.filter((identity) => identity.aliases.includes(requestedNameKey)))
    }

    if (!candidates?.length) throw identityError('UNKNOWN_PROFESSIONAL')
    if (candidates.length > 1) throw identityError('AMBIGUOUS_PROFESSIONAL', candidates)
    const professional = candidates[0]
    if (!allowInactive && normalizeText(professional.status) !== 'ativo') throw identityError('INACTIVE_PROFESSIONAL', candidates)
    const unitSlug = normalizeUnit(unit?.slug || unit?.name || unit).slug
    if (professional.units.length && unitSlug && !professional.units.includes(unitSlug)) throw identityError('PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT', candidates)
    const wantedRole = normalizeText(expectedRole)
    if (wantedRole && professional.roles.length && !professional.roles.includes(wantedRole)) throw identityError('PROFESSIONAL_ROLE_MISMATCH', candidates)
    return professional
}

function hasNamePrefixMatch(left, right) {
    const leftTokens = normalizeProfessionalAliasKey(left).split(' ').filter(Boolean)
    const rightTokens = normalizeProfessionalAliasKey(right).split(' ').filter(Boolean)
    if (leftTokens.length < 1 || rightTokens.length < 2) return false
    return leftTokens.every((token, index) => rightTokens[index] === token)
        || rightTokens.every((token, index) => leftTokens[index] === token)
}

export function buildProfessionalIdentityDiagnosis(rows = [], { scheduleNames = [] } = {}) {
    const identities = (Array.isArray(rows) ? rows : []).map(professionalIdentityFromRow)
        .filter((identity) => identity.id)
    const byNameKey = new Map()
    const byAliasKey = new Map()
    for (const identity of identities) {
        if (identity.nameKey) {
            const list = byNameKey.get(identity.nameKey) || []
            list.push(identity)
            byNameKey.set(identity.nameKey, list)
        }
        for (const alias of identity.aliases) {
            const list = byAliasKey.get(alias) || []
            list.push(identity)
            byAliasKey.set(alias, list)
        }
    }
    const exactDuplicateNames = Array.from(byNameKey.entries())
        .filter(([, members]) => uniqueCanonicalCandidates(members).length > 1)
        .map(([key, members]) => ({ key, candidates: uniqueCanonicalCandidates(members) }))
    const aliasCollisions = Array.from(byAliasKey.entries())
        .filter(([, members]) => uniqueCanonicalCandidates(members).length > 1)
        .map(([key, members]) => ({ key, candidates: uniqueCanonicalCandidates(members) }))
    const abbreviatedCandidates = []
    for (let leftIndex = 0; leftIndex < identities.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < identities.length; rightIndex += 1) {
            const left = identities[leftIndex]
            const right = identities[rightIndex]
            if (left.canonicalId === right.canonicalId || !hasNamePrefixMatch(left.name, right.name)) continue
            abbreviatedCandidates.push({
                kind: 'abbreviated-name',
                confidence: 'ambiguous',
                sourceId: left.id,
                sourceName: left.name,
                targetId: right.id,
                targetName: right.name,
                reason: 'Nome abreviado/prefixado exige confirmação humana; não é mesclado automaticamente.',
            })
        }
    }
    const unresolvedScheduleNames = Array.from(new Set((Array.isArray(scheduleNames) ? scheduleNames : [])
        .map((value) => String(value || '').trim()).filter(Boolean)))
        .filter((name) => isValidProfessionalIdentityName(name))
        .filter((name) => !uniqueCanonicalCandidates(identities.filter((identity) => identity.aliases.includes(normalizeProfessionalAliasKey(name)))).length)
        .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    const invalidRecords = identities.filter((identity) => !isValidProfessionalIdentityName(identity.name))
        .map((identity) => ({ id: identity.id, name: identity.name, status: identity.status }))
    return {
        identityVersion: PROFESSIONAL_IDENTITY_VERSION,
        summary: {
            professionals: identities.length,
            inactive: identities.filter((identity) => normalizeText(identity.status) !== 'ativo').length,
            multiUnit: identities.filter((identity) => identity.units.length > 1).length,
            exactDuplicateNames: exactDuplicateNames.length,
            aliasCollisions: aliasCollisions.length,
            ambiguousMergeProposals: abbreviatedCandidates.length,
            invalidRecords: invalidRecords.length,
            unresolvedScheduleNames: unresolvedScheduleNames.length,
        },
        exactDuplicateNames,
        aliasCollisions,
        mergeProposals: abbreviatedCandidates,
        invalidRecords,
        unresolvedScheduleNames,
    }
}
