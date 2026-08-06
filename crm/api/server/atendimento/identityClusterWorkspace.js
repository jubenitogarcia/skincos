import { createHash } from 'node:crypto'

export const IDENTITY_CLUSTER_PRESENTATION_SCHEMA = 'crm-identity-cluster/v1'

export const IDENTITY_CLUSTER_SOURCE_TYPES = Object.freeze([
    'attendance_client',
    'caixa_customer',
    'app_registration',
    'lead_profile',
])

export const IDENTITY_CLUSTER_SOURCE_LABELS = Object.freeze({
    attendance_client: 'Atendimento',
    caixa_customer: 'Caixa',
    app_registration: 'Cadastro do app',
    lead_profile: 'Leads e planilhas',
})

const STRONG_METHODS = new Set([
    'exact_phone',
    'exact_email',
    'exact_name_phone',
    'exact_name_phone_sales_unit',
    'phone_sales_attendance_anchor',
    'spelling_same_caixa_customer',
])

const FIELD_LABELS = Object.freeze({
    name: 'Nome',
    phone: 'Telefone validado',
    email: 'E-mail validado',
    unit: 'Unidade',
    cpf: 'Documento validado',
})

const CONTACT_FIELDS = new Set(['phone', 'email'])
const TECHNICAL_KEYS = new Set(['id', 'identityId', 'sourceId', 'targetId', 'componentKey', 'runId'])

function text(value) {
    return String(value ?? '').trim()
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]
}

function normalized(value) {
    return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function digits(value) {
    return text(value).replace(/\D/g, '')
}

export function maskPhone(value) {
    const raw = digits(value)
    if (!raw) return ''
    if (raw.length <= 4) return '••••'
    return `${raw.slice(0, 2)}••••${raw.slice(-2)}`
}

export function maskEmail(value) {
    const raw = text(value).toLowerCase()
    const at = raw.indexOf('@')
    if (at <= 0 || at === raw.length - 1) return raw ? '••••' : ''
    const local = raw.slice(0, at)
    const domain = raw.slice(at + 1)
    const visibleLocal = local.length === 1 ? '•' : `${local.slice(0, 1)}•••`
    const visibleDomain = domain.length <= 2 ? '••' : `${domain.slice(0, 1)}•••`
    return `${visibleLocal}@${visibleDomain}`
}

export function digestClusterValue(value) {
    return createHash('sha256').update(text(value)).digest('hex')
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    return value
}

function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

class DisjointSet {
    constructor(values) {
        this.parent = new Map(values.map((value) => [value, value]))
    }

    find(value) {
        if (!this.parent.has(value)) this.parent.set(value, value)
        const parent = this.parent.get(value)
        if (parent === value) return value
        const root = this.find(parent)
        this.parent.set(value, root)
        return root
    }

    union(left, right) {
        const a = this.find(left)
        const b = this.find(right)
        if (a !== b) {
            if (a < b) this.parent.set(b, a)
            else this.parent.set(a, b)
        }
    }
}

function memberKey(member) {
    return `${text(member?.sourceType)}:${text(member?.sourceId)}`
}

function edgeKey(edge) {
    return `${text(edge?.reviewType)}:${text(edge?.sourceType)}:${text(edge?.sourceId)}:${text(edge?.targetType)}:${text(edge?.targetId)}`
}

function sourceLabel(sourceType) {
    return IDENTITY_CLUSTER_SOURCE_LABELS[text(sourceType)] || 'Fonte não classificada'
}

function explicitMatchingFields(member) {
    const fields = []
    const phoneKeys = unique(member?.phoneKeys || member?.phones)
    const emailKeys = unique(member?.emailKeys || member?.emails)
    const cpfKeys = unique(member?.cpfKeys || member?.cpfs)
    const units = unique(member?.units || member?.unitSlugs)
    if (member?.name || member?.canonicalName) fields.push({ field: 'name', label: FIELD_LABELS.name, status: 'present' })
    if (phoneKeys.length) fields.push({ field: 'phone', label: FIELD_LABELS.phone, status: member?.validatedPhone === false ? 'unvalidated' : 'validated', values: phoneKeys.map(maskPhone) })
    if (emailKeys.length) fields.push({ field: 'email', label: FIELD_LABELS.email, status: member?.validatedEmail === false ? 'unvalidated' : 'validated', values: emailKeys.map(maskEmail) })
    if (cpfKeys.length) fields.push({ field: 'cpf', label: FIELD_LABELS.cpf, status: member?.validatedCpf === false ? 'unvalidated' : 'validated' })
    if (units.length) fields.push({ field: 'unit', label: FIELD_LABELS.unit, status: 'present', values: units })
    return fields
}

function explicitEvidence(edge) {
    const method = text(edge?.method)
    const evidence = edge?.evidence && typeof edge.evidence === 'object' ? edge.evidence : {}
    const matchedFields = unique(edge?.matchedFields || evidence.matchedFields || evidence.sharedFields)
    const sharedUnits = unique(edge?.sharedUnits || evidence.sharedUnits)
    const strong = edge?.strong === true || STRONG_METHODS.has(method) || matchedFields.some((field) => CONTACT_FIELDS.has(field))
    const label = method === 'exact_phone' ? 'Telefone validado igual'
        : method === 'exact_email' ? 'E-mail validado igual'
            : method === 'exact_name_phone' ? 'Nome e telefone validados'
                : method === 'exact_name_phone_sales_unit' ? 'Nome, telefone, venda e unidade validados'
                    : method === 'phone_sales_attendance_anchor' ? 'Telefone ancorado em venda e atendimento'
                        : method === 'fuzzy_name_unit_procedure' ? 'Nome aproximado com contexto de unidade/procedimento'
                            : method === 'exact_name_unit' ? 'Nome e unidade coincidentes'
                                : method === 'exact_name' ? 'Nome coincidente'
                                    : method || 'Vínculo de fonte'
    const summary = [
        matchedFields.length ? `campos: ${matchedFields.map((field) => FIELD_LABELS[field] || field).join(', ')}` : '',
        sharedUnits.length ? `unidades: ${sharedUnits.join(', ')}` : '',
        edge?.candidateCount != null ? `candidatos: ${Number(edge.candidateCount)}` : '',
    ].filter(Boolean).join(' · ')
    return {
        kind: 'source_link',
        label,
        strength: strong ? 'strong' : 'weak',
        confidence: Math.max(0, Math.min(1, Number(edge?.confidence || 0))),
        source: sourceLabel(edge?.sourceType),
        target: sourceLabel(edge?.targetType),
        summary: summary || 'Evidência registrada na fonte',
    }
}

function normalizeMember(member) {
    const sourceType = text(member?.sourceType)
    const name = text(member?.name || member?.canonicalName || member?.identityName) || 'Sem nome informado'
    return {
        sourceType,
        sourceId: text(member?.sourceId),
        identityId: text(member?.identityId),
        identityCreatedAt: member?.identityCreatedAt || null,
        name,
        identityName: text(member?.identityName || name),
        aliases: unique(member?.aliases),
        units: unique(member?.units || member?.unitSlugs),
        phoneKeys: unique(member?.phoneKeys || member?.phones),
        emailKeys: unique(member?.emailKeys || member?.emails),
        cpfKeys: unique(member?.cpfKeys || member?.cpfs),
        validatedPhone: member?.validatedPhone !== false,
        validatedEmail: member?.validatedEmail !== false,
        validatedCpf: member?.validatedCpf !== false,
        updatedAt: member?.updatedAt || null,
        sourceFreshness: text(member?.sourceFreshness || 'unknown'),
        changedAfterDecision: member?.changedAfterDecision === true,
        sourceFingerprint: text(member?.sourceFingerprint),
    }
}

function latestDecisionForEdge(decisions, edge) {
    const key = edgeKey(edge)
    const exact = (decisions || []).filter((decision) => edgeKey({
        reviewType: decision.reviewType,
        sourceType: edge.sourceType,
        sourceId: decision.sourceId,
        targetType: edge.targetType,
        targetId: edge.targetId,
    }) === key)
    return exact.sort((left, right) => Number(right.eventOrder || 0) - Number(left.eventOrder || 0)
        || String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null
}

function edgeForDecision(decision, edges) {
    return (edges || []).find((edge) => edge.sourceId === decision.sourceId
        && edge.targetId === decision.targetId
        && edge.reviewType === decision.reviewType) || null
}

function sourceChangedForMember(member, edges, decisions) {
    const key = memberKey(member)
    return (edges || []).some((edge) => {
        if (`${edge.sourceType}:${edge.sourceId}` !== key && `${edge.targetType}:${edge.targetId}` !== key) return false
        const decision = latestDecisionForEdge(decisions, edge)
        return sourceChanged(edge, decision, [member])
    })
}

function sourceChanged(edge, decision, members) {
    if (!decision) return false
    if (decision.sourceVersion && edge.sourceVersion && decision.sourceVersion !== edge.sourceVersion) return true
    if (members.some((member) => member.changedAfterDecision)) return true
    if (edge.changedAfterDecision === true) return true
    if (decision.createdAt) {
        const decisionTime = new Date(decision.createdAt).getTime()
        if (Number.isFinite(decisionTime) && members.some((member) => {
            const updated = new Date(member.updatedAt || 0).getTime()
            return Number.isFinite(updated) && updated > decisionTime
        })) return true
    }
    return false
}

function conflictRows(members) {
    const rows = []
    const names = new Map()
    const phones = new Map()
    const emails = new Map()
    for (const member of members) {
        const name = normalized(member.name)
        if (name) names.set(name, (names.get(name) || 0) + 1)
        for (const value of member.phoneKeys) phones.set(digits(value), (phones.get(digits(value)) || 0) + 1)
        for (const value of member.emailKeys) emails.set(text(value).toLowerCase(), (emails.get(text(value).toLowerCase()) || 0) + 1)
    }
    if (names.size > 1) rows.push({ field: 'name', label: FIELD_LABELS.name, severity: 'weak', summary: 'Nomes divergentes entre fontes; trate como evidência fraca.' })
    if (phones.size > 1) rows.push({ field: 'phone', label: FIELD_LABELS.phone, severity: 'strong', summary: 'Telefones divergentes impedem revisão em lote.' })
    if (emails.size > 1) rows.push({ field: 'email', label: FIELD_LABELS.email, severity: 'strong', summary: 'E-mails divergentes impedem revisão em lote.' })
    return rows
}

function hasValidatedSharedContact(members) {
    for (const field of ['phoneKeys', 'emailKeys']) {
    const counts = new Map()
        for (const member of members) {
            if (field === 'phoneKeys' && member.validatedPhone === false) continue
            if (field === 'emailKeys' && member.validatedEmail === false) continue
            const values = unique(member[field]).map((value) => field === 'phoneKeys' ? digits(value) : text(value).toLowerCase()).filter(Boolean)
            for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
        }
        if ([...counts.values()].some((count) => count >= 2)) return field === 'phoneKeys' ? 'phone' : 'email'
    }
    return null
}

export function classifyIdentityClusterBulkEligibility({ members = [], edges = [], conflicts = [], decisions = [], undoBlocked = false, stale = false } = {}) {
    const sharedContactField = hasValidatedSharedContact(members)
    const strongConflict = conflicts.some((conflict) => conflict.severity === 'strong')
    const uniqueCandidate = edges.length > 0 && edges.every((edge) => Number(edge.candidateCount || 1) === 1)
    const deterministicEdges = edges.length > 0 && edges.every((edge) => {
        const method = text(edge.method)
        const evidence = edge.evidence && typeof edge.evidence === 'object' ? edge.evidence : {}
        const matched = unique(edge.matchedFields || evidence.matchedFields || evidence.sharedFields)
        return edge.status === 'suggested' || edge.status === 'ambiguous' || edge.status === 'pending'
            ? (edge.validatedMatch === true || STRONG_METHODS.has(method) || matched.some((field) => CONTACT_FIELDS.has(field)))
            : false
    })
    const incompatibleDecision = decisions.some((decision) => decision.decision === 'confirmed' || decision.decision === 'rejected')
    const reasons = []
    if (!sharedContactField) reasons.push('no_shared_validated_contact')
    if (strongConflict) reasons.push('strong_conflict')
    if (!uniqueCandidate) reasons.push('candidate_not_unique')
    if (!deterministicEdges) reasons.push('edge_not_deterministic')
    if (incompatibleDecision) reasons.push('incompatible_prior_decision')
    if (undoBlocked) reasons.push('commercial_or_consent_history')
    if (stale) reasons.push('source_stale_or_changed_after_decision')
    return {
        eligible: reasons.length === 0,
        mode: reasons.length === 0 ? 'bulk_safe' : 'individual_only',
        sharedContactField,
        reasons,
    }
}

function identitySummary(members) {
    const groups = new Map()
    for (const member of members) {
        if (!groups.has(member.identityId)) groups.set(member.identityId, [])
        groups.get(member.identityId).push(member)
    }
    const identities = [...groups.entries()].filter(([id]) => id).map(([id, rows]) => ({
        name: rows[0]?.identityName || rows[0]?.name || 'Identidade sem nome',
        sourceCount: rows.length,
        sourceLabels: unique(rows.map((row) => sourceLabel(row.sourceType))),
        hasAttendance: rows.some((row) => row.sourceType === 'attendance_client'),
        createdAt: rows.map((row) => row.identityCreatedAt).filter(Boolean).sort()[0] || null,
        _id: id,
    }))
    identities.sort((left, right) => Number(right.hasAttendance) - Number(left.hasAttendance) || String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || left.name.localeCompare(right.name))
    return identities
}

function safeIdentity(identity) {
    if (!identity) return null
    return { name: identity.name, sourceCount: identity.sourceCount, sourceLabels: identity.sourceLabels }
}

export function buildIdentityReviewClusterPresentation({
    members: inputMembers = [],
    edges: inputEdges = [],
    decisions = [],
    lineage = [],
    automaticLinkHistory = [],
    historyByIdentity = {},
    unitScope = null,
    now = new Date(),
    includeInternals = false,
} = {}) {
    const members = inputMembers.map(normalizeMember).filter((member) => IDENTITY_CLUSTER_SOURCE_TYPES.includes(member.sourceType) && member.sourceId)
    const memberMap = new Map(members.map((member) => [memberKey(member), member]))
    const keys = members.map(memberKey)
    const dsu = new DisjointSet(keys)
    const identityMembers = new Map()
    for (const member of members) {
        if (!member.identityId) continue
        if (!identityMembers.has(member.identityId)) identityMembers.set(member.identityId, [])
        identityMembers.get(member.identityId).push(memberKey(member))
    }
    for (const group of identityMembers.values()) for (const key of group.slice(1)) dsu.union(group[0], key)
    const edges = inputEdges.map((edge) => ({
        reviewType: text(edge.reviewType), sourceType: text(edge.sourceType), sourceId: text(edge.sourceId),
        targetType: text(edge.targetType), targetId: text(edge.targetId), status: text(edge.status),
        confidence: Number(edge.confidence || 0), method: text(edge.method), evidence: edge.evidence || {},
        matchedFields: unique(edge.matchedFields), sharedUnits: unique(edge.sharedUnits), candidateCount: edge.candidateCount,
        validatedMatch: edge.validatedMatch === true, strong: edge.strong === true, sourceVersion: text(edge.sourceVersion),
        changedAfterDecision: edge.changedAfterDecision === true,
    })).filter((edge) => memberMap.has(`${edge.sourceType}:${edge.sourceId}`) && memberMap.has(`${edge.targetType}:${edge.targetId}`))
    for (const edge of edges) dsu.union(`${edge.sourceType}:${edge.sourceId}`, `${edge.targetType}:${edge.targetId}`)
    const grouped = new Map()
    for (const member of members) {
        const root = dsu.find(memberKey(member))
        if (!grouped.has(root)) grouped.set(root, { members: [], edges: [] })
        grouped.get(root).members.push(member)
    }
    for (const edge of edges) {
        const root = dsu.find(`${edge.sourceType}:${edge.sourceId}`)
        if (!grouped.has(root)) grouped.set(root, { members: [], edges: [] })
        grouped.get(root).edges.push(edge)
    }
    const allowed = unitScope == null ? null : new Set(unique(unitScope))
    const clusters = []
    for (const group of grouped.values()) {
        const clusterUnits = unique(group.members.flatMap((member) => member.units))
        if (allowed && (!clusterUnits.length || clusterUnits.some((unit) => !allowed.has(unit)))) continue
        const groupDecisions = group.edges.map((edge) => latestDecisionForEdge(decisions, edge)).filter(Boolean)
        const stale = group.members.some((member) => member.changedAfterDecision || member.sourceFreshness !== 'current')
            || group.edges.some((edge) => sourceChanged(edge, latestDecisionForEdge(decisions, edge), group.members))
        const conflicts = conflictRows(group.members)
        const histories = identitySummary(group.members).map((identity) => ({ identity, history: historyByIdentity[identity._id] || {} }))
        const undoReasons = []
        if (histories.some(({ history }) => Number(history.actions || 0) > 0)) undoReasons.push('commercial_actions_present')
        if (histories.some(({ history }) => Number(history.permissions || 0) > 0 || Number(history.permissionEvents || 0))) undoReasons.push('consent_history_present')
        if (histories.some(({ history }) => Number(history.auditIdentityEvents || 0) > 0)) undoReasons.push('identity_audit_history_present')
        const undoBlocked = undoReasons.length > 0
        const clusterEdges = group.edges.map((edge) => ({ ...edge, evidence: explicitEvidence(edge) }))
        const strongEvidence = clusterEdges.filter((edge) => edge.evidence.strength === 'strong').map((edge) => edge.evidence)
        const weakEvidence = clusterEdges.filter((edge) => edge.evidence.strength === 'weak').map((edge) => edge.evidence)
        const confidence = clusterEdges.length ? Math.round((clusterEdges.reduce((sum, edge) => sum + edge.confidence, 0) / clusterEdges.length) * 100) / 100 : 0
        const identities = identitySummary(group.members)
        const decisionHistory = groupDecisions.map((decision) => {
            const relatedEdge = edgeForDecision(decision, group.edges)
            return {
                reviewType: text(decision.reviewType),
                decision: text(decision.decision),
                resultingStatus: text(decision.resultingStatus),
                recordedAt: decision.createdAt || null,
                stale: relatedEdge ? sourceChanged(relatedEdge, decision, group.members) : false,
            }
        })
        const materializations = groupDecisions
            .filter((decision) => decision.materializationRunId || decision.runMode || decision.runStatus)
            .map((decision) => ({
                mode: text(decision.runMode || (decision.decision === 'confirmed' ? 'confirm' : decision.decision === 'reversed' ? 'reverse' : 'reject')),
                status: text(decision.runStatus || 'applied'),
                recordedAt: decision.runCreatedAt || decision.createdAt || null,
                membersMoved: Number(decision.runMembersMoved || 0),
            }))
        const automaticLinks = group.edges.map((edge) => ({
            source: sourceLabel(edge.sourceType),
            target: sourceLabel(edge.targetType),
            status: text(edge.status),
            method: text(edge.method) || 'link',
            confidence: Math.max(0, Math.min(1, Number(edge.confidence || 0))),
            history: automaticLinkHistory.filter((row) => edgeKey(row) === edgeKey(edge)).map((row) => ({
                transition: text(row.transition),
                resultingStatus: text(row.resultingStatus),
                origin: text(row.origin),
                recordedAt: row.createdAt || null,
            })),
        }))
        const sourceChanges = group.members.filter((member) => member.changedAfterDecision || sourceChangedForMember(member, group.edges, groupDecisions)).map((member) => ({
            source: sourceLabel(member.sourceType),
            name: member.name,
            changedAt: member.updatedAt || null,
        }))
        const blockingHistory = histories.reduce((summary, { history }) => ({
            commercialActions: summary.commercialActions + Number(history.actions || 0),
            consentPermissions: summary.consentPermissions + Number(history.permissions || 0),
            consentEvents: summary.consentEvents + Number(history.permissionEvents || 0),
            identityAuditEvents: summary.identityAuditEvents + Number(history.auditIdentityEvents || 0),
        }), { commercialActions: 0, consentPermissions: 0, consentEvents: 0, identityAuditEvents: 0 })
        const survivorId = identities[0]?._id || ''
        const membersToMove = group.members
            .filter((member) => survivorId ? member.identityId !== survivorId : true)
            .map((member) => ({ sourceLabel: sourceLabel(member.sourceType), name: member.name }))
        const currentDecision = stale ? 'stale'
            : groupDecisions.some((decision) => decision.decision === 'confirmed') ? 'confirmed'
                : groupDecisions.some((decision) => decision.decision === 'rejected') ? 'rejected' : 'pending'
        const clusterKey = fingerprint({ members: group.members.map((member) => [member.sourceType, member.sourceId]).sort(), edges: group.edges.map(edgeKey).sort() }).slice(0, 32)
        const version = fingerprint({
            members: group.members.map((member) => [member.sourceType, member.sourceId, member.sourceFingerprint, member.updatedAt]).sort(),
            edges: group.edges.map((edge) => [edgeKey(edge), edge.status, edge.sourceVersion]).sort(),
        })
        const memberPresentations = group.members.map((member) => ({
            source: member.sourceType,
            sourceLabel: sourceLabel(member.sourceType),
            name: member.name,
            aliases: member.aliases,
            units: member.units,
            matchingFields: explicitMatchingFields(member),
            freshness: member.sourceFreshness || 'unknown',
            stale: member.changedAfterDecision,
            contact: {
                phone: member.phoneKeys.map(maskPhone).filter(Boolean),
                email: member.emailKeys.map(maskEmail).filter(Boolean),
                masked: true,
            },
        }))
        const memberBySource = IDENTITY_CLUSTER_SOURCE_TYPES.map((sourceType) => ({
            source: sourceType,
            sourceLabel: sourceLabel(sourceType),
            count: memberPresentations.filter((member) => member.source === sourceType).length,
        })).filter((entry) => entry.count)
        const lineageRows = lineage.filter((row) => {
            const ids = identities.map((identity) => identity._id)
            return ids.includes(text(row.predecessorIdentityId)) || ids.includes(text(row.successorIdentityId))
        }).map((row) => ({ relation: text(row.relation), recordedAt: row.createdAt || null }))
        const bulkReview = classifyIdentityClusterBulkEligibility({ members: group.members, edges: group.edges, conflicts, decisions: groupDecisions, undoBlocked, stale })
        clusters.push({
            schemaVersion: IDENTITY_CLUSTER_PRESENTATION_SCHEMA,
            clusterKey,
            version,
            summary: { memberCount: group.members.length, identityCount: identities.length, sourceCount: memberBySource.length, unitCount: clusterUnits.length },
            members: memberPresentations,
            membersBySource: memberBySource,
            units: clusterUnits,
            matchingFields: unique(clusterEdges.flatMap((edge) => edge.matchedFields)),
            conflicts,
            evidence: { strong: strongEvidence, weak: weakEvidence },
            confidence,
            decision: { state: currentDecision, count: groupDecisions.length, lastAt: groupDecisions.map((decision) => decision.createdAt).filter(Boolean).sort().at(-1) || null },
            decisionHistory,
            materializations,
            automaticLinks,
            sourceChanges,
            staleState: stale ? 'stale' : 'current',
            lineage: lineageRows,
            impact: {
                membersToMove: group.members.length > 1 ? membersToMove : [],
                survivorIdentity: safeIdentity(identities[0]),
                retiredIdentities: identities.slice(1).map(safeIdentity),
                commercialHistoryPresent: undoBlocked,
                consentHistoryPresent: undoReasons.includes('consent_history_present'),
                predictedAction: currentDecision === 'pending' && !conflicts.some((conflict) => conflict.severity === 'strong') ? 'merge_if_confirmed' : 'review_only',
            },
            undo: { blocked: undoBlocked, reasons: undoReasons, blockingHistory },
            bulkReview,
            privacy: { contactsMasked: true, technicalIdsHidden: true, revealRequired: true },
            _identityIds: identities.map((identity) => identity._id),
            _edgeKeys: group.edges.map(edgeKey),
            _members: group.members,
            _edges: group.edges,
            _now: now.toISOString(),
        })
    }
    const ordered = clusters.sort((left, right) => Number(right.bulkReview.eligible) - Number(left.bulkReview.eligible) || right.confidence - left.confidence || left.clusterKey.localeCompare(right.clusterKey))
    return includeInternals ? ordered : ordered.map(stripIdentityClusterInternals)
}

export function stripIdentityClusterInternals(cluster) {
    if (!cluster) return null
    const safe = { ...cluster }
    for (const key of ['_identityIds', '_edgeKeys', '_members', '_edges', '_now']) delete safe[key]
    return safe
}

export function buildIdentityClusterBulkPreview(clusters = []) {
    const eligible = clusters.filter((cluster) => cluster?.bulkReview?.eligible)
    const blocked = clusters.filter((cluster) => !cluster?.bulkReview?.eligible)
    return {
        schemaVersion: IDENTITY_CLUSTER_PRESENTATION_SCHEMA,
        clusterCount: clusters.length,
        eligibleCount: eligible.length,
        blockedCount: blocked.length,
        memberCount: clusters.reduce((sum, cluster) => sum + Number(cluster?.summary?.memberCount || 0), 0),
        eligibleMembers: eligible.reduce((sum, cluster) => sum + Number(cluster?.summary?.memberCount || 0), 0),
        blockedReasons: [...new Set(blocked.flatMap((cluster) => cluster?.bulkReview?.reasons || []))].sort(),
        clusters: clusters.map((cluster) => ({ clusterKey: cluster.clusterKey, version: cluster.version, eligible: cluster.bulkReview.eligible, reasons: cluster.bulkReview.reasons })),
    }
}

export function assertExplicitIdentityClusterPayload(payload = {}) {
    const reason = text(payload.reason).replace(/\s+/g, ' ')
    if (reason.length < 3 || reason.length > 1000) throw Object.assign(new Error('IDENTITY_CLUSTER_REASON_REQUIRED'), { statusCode: 400 })
    if (payload.confirmation !== 'REVIEW_CLUSTER') throw Object.assign(new Error('IDENTITY_CLUSTER_CONFIRMATION_REQUIRED'), { statusCode: 400 })
    const expectedVersion = text(payload.expectedVersion)
    if (!expectedVersion || expectedVersion.length > 200) throw Object.assign(new Error('IDENTITY_CLUSTER_VERSION_REQUIRED'), { statusCode: 400 })
    return { reason, expectedVersion }
}

export function explicitRevealFields(payload = {}) {
    const fields = unique(payload.fields).filter((field) => CONTACT_FIELDS.has(field))
    if (!fields.length) throw Object.assign(new Error('IDENTITY_CLUSTER_REVEAL_FIELD_REQUIRED'), { statusCode: 400 })
    return fields
}

export function redactIdentityClusterRecord(record = {}) {
    const safe = {}
    for (const [key, value] of Object.entries(record)) {
        if (TECHNICAL_KEYS.has(key) || CONTACT_FIELDS.has(key)) continue
        safe[key] = value
    }
    return safe
}
