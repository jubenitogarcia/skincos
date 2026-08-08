import { createHash } from 'node:crypto'

// This module is intentionally a presentation boundary.  It receives a small,
// allowlisted graph projection from the store and never serializes source
// `context` or `evidence` blobs.  Raw contacts remain transient in the store
// and can only be returned by the separately audited reveal operation.
export const IDENTITY_CLUSTER_PRESENTATION_SCHEMA = 'crm-identity-cluster/v2'

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

// The graph is only as current as the sources that can alter one of its
// members. These are source-operation identifiers, never connector URLs or
// external IDs. `identity.global_graph` is deliberately required for every
// member type: a fresh individual source cannot make an out-of-date identity
// projection safe to review in bulk.
export const IDENTITY_CLUSTER_SOURCE_OPERATION_REQUIREMENTS = Object.freeze({
    attendance_client: Object.freeze(['atendimento.local_mirror', 'atendimento.google_sheet', 'identity.global_graph']),
    caixa_customer: Object.freeze(['vendas.caixa_google_sheet', 'identity.global_graph']),
    app_registration: Object.freeze(['cadastro.app_registrations', 'identity.global_graph']),
    lead_profile: Object.freeze(['leads.supplemental_google_sheet', 'identity.global_graph']),
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
    return `${local.slice(0, 1)}•••@${domain.slice(0, 1)}•••`
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    return value
}

export function identityClusterFingerprint(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function sourceOperationCheckpoint(checkpoints, sourceId) {
    if (checkpoints instanceof Map) return checkpoints.get(sourceId) || null
    if (!checkpoints || typeof checkpoints !== 'object') return null
    return checkpoints[sourceId] || null
}

/**
 * A source row's `updated_at` describes the record, not the freshness of the
 * source snapshot. Bulk identity review therefore consumes only the durable
 * source-operation checkpoint. Missing or partial source evidence remains
 * intentionally non-current and prevents a deterministic batch action.
 */
export function identityClusterSourceFreshness(sourceType, checkpoints = {}, now = new Date()) {
    const requiredSources = IDENTITY_CLUSTER_SOURCE_OPERATION_REQUIREMENTS[text(sourceType)]
    if (!requiredSources?.length) return 'unknown'
    for (const sourceId of requiredSources) {
        const checkpoint = sourceOperationCheckpoint(checkpoints, sourceId)
        if (!checkpoint) return 'unknown'
        const lastStatus = text(checkpoint.lastStatus || checkpoint.last_status).toLowerCase()
        const validatedAt = checkpoint.validatedAt || checkpoint.validated_at || null
        const snapshotComplete = checkpoint.validatedSnapshotComplete ?? checkpoint.validated_snapshot_complete
        const reconciliationRequired = checkpoint.reconciliationRequired ?? checkpoint.reconciliation_required
        const observedAt = Date.parse(validatedAt || '')
        if (snapshotComplete !== true || reconciliationRequired === true || !['complete', 'skipped'].includes(lastStatus)
            || !Number.isFinite(observedAt) || now.getTime() - observedAt > 48 * 60 * 60 * 1000) return 'stale'
    }
    return 'current'
}

class DisjointSet {
    constructor(values = []) {
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
        if (a === b) return
        if (a < b) this.parent.set(b, a)
        else this.parent.set(a, b)
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

function normalizedContactValues(values, type) {
    return unique(values).map((value) => type === 'phone' ? digits(value) : text(value).toLowerCase()).filter(Boolean)
}

function explicitMatchingFields(member) {
    const fields = []
    const phoneKeys = unique(member.phoneKeys)
    const emailKeys = unique(member.emailKeys)
    const cpfKeys = unique(member.cpfKeys)
    const units = unique(member.units)
    if (member.name) fields.push({ field: 'name', label: FIELD_LABELS.name, status: 'present' })
    if (phoneKeys.length) fields.push({ field: 'phone', label: FIELD_LABELS.phone, status: member.validatedPhone ? 'validated' : 'present', values: phoneKeys.map(maskPhone).filter(Boolean) })
    if (emailKeys.length) fields.push({ field: 'email', label: FIELD_LABELS.email, status: member.validatedEmail ? 'validated' : 'present', values: emailKeys.map(maskEmail).filter(Boolean) })
    if (cpfKeys.length) fields.push({ field: 'cpf', label: FIELD_LABELS.cpf, status: member.validatedCpf ? 'validated' : 'present' })
    if (units.length) fields.push({ field: 'unit', label: FIELD_LABELS.unit, status: 'present', values: units })
    return fields
}

function explicitEvidence(edge) {
    const method = text(edge.method)
    const matchedFields = unique(edge.matchedFields).filter((field) => Object.hasOwn(FIELD_LABELS, field))
    const sharedUnits = unique(edge.sharedUnits)
    const strong = edge.validatedMatch === true || STRONG_METHODS.has(method) || matchedFields.some((field) => CONTACT_FIELDS.has(field))
    const methodLabel = {
        exact_phone: 'Telefone validado igual',
        exact_email: 'E-mail validado igual',
        exact_name_phone: 'Nome e telefone validados',
        exact_name_phone_sales_unit: 'Nome, telefone, venda e unidade validados',
        phone_sales_attendance_anchor: 'Telefone ancorado em venda e atendimento',
        fuzzy_name_unit_procedure: 'Nome aproximado com contexto de unidade/procedimento',
        exact_name_unit: 'Nome e unidade coincidentes',
        exact_name: 'Nome coincidente',
    }[method] || 'Vínculo de fonte registrado'
    const parts = [
        matchedFields.length ? `campos: ${matchedFields.map((field) => FIELD_LABELS[field]).join(', ')}` : '',
        sharedUnits.length ? `unidades: ${sharedUnits.join(', ')}` : '',
        Number.isInteger(edge.candidateCount) ? `candidatos: ${edge.candidateCount}` : '',
    ].filter(Boolean)
    return {
        kind: 'source_link',
        label: methodLabel,
        strength: strong ? 'strong' : 'weak',
        confidence: Number.isFinite(Number(edge.confidence)) ? Math.max(0, Math.min(1, Number(edge.confidence))) : 0,
        source: sourceLabel(edge.sourceType),
        target: sourceLabel(edge.targetType),
        summary: parts.join(' · ') || 'Evidência registrada na fonte',
    }
}

function normalizeMember(member) {
    const sourceType = text(member?.sourceType)
    return {
        sourceType,
        sourceId: text(member?.sourceId),
        identityId: text(member?.identityId),
        identityCreatedAt: member?.identityCreatedAt || null,
        name: text(member?.name || member?.canonicalName || member?.identityName) || 'Sem nome informado',
        identityName: text(member?.identityName || member?.name || member?.canonicalName) || 'Identidade sem nome',
        aliases: unique(member?.aliases),
        units: unique(member?.units || member?.unitSlugs),
        phoneKeys: unique(member?.phoneKeys),
        emailKeys: unique(member?.emailKeys),
        cpfKeys: unique(member?.cpfKeys),
        // A source row itself never upgrades a contact to validated.  That
        // claim is derived only from allowlisted deterministic edge methods.
        validatedPhone: member?.validatedPhone === true,
        validatedEmail: member?.validatedEmail === true,
        validatedCpf: member?.validatedCpf === true,
        updatedAt: member?.updatedAt || null,
        sourceFreshness: text(member?.sourceFreshness || 'unknown'),
        changedAfterDecision: member?.changedAfterDecision === true,
        sourceFingerprint: text(member?.sourceFingerprint),
    }
}

function normalizeEdge(edge) {
    const confidence = Number(edge?.confidence)
    return {
        reviewType: text(edge?.reviewType),
        sourceType: text(edge?.sourceType),
        sourceId: text(edge?.sourceId),
        targetType: text(edge?.targetType),
        targetId: text(edge?.targetId),
        status: text(edge?.status),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
        method: text(edge?.method),
        matchedFields: unique(edge?.matchedFields).filter((field) => Object.hasOwn(FIELD_LABELS, field)),
        sharedUnits: unique(edge?.sharedUnits),
        candidateCount: Number.isInteger(Number(edge?.candidateCount)) ? Number(edge.candidateCount) : null,
        validatedMatch: edge?.validatedMatch === true,
        sourceVersion: text(edge?.sourceVersion),
        changedAfterDecision: edge?.changedAfterDecision === true,
    }
}

function latestDecisionForEdge(decisions, edge) {
    const key = edgeKey(edge)
    return (decisions || []).filter((decision) => edgeKey({
        reviewType: decision.reviewType,
        sourceType: edge.sourceType,
        sourceId: decision.sourceId,
        targetType: edge.targetType,
        targetId: edge.targetId,
    }) === key).sort((left, right) => Number(right.eventOrder || 0) - Number(left.eventOrder || 0)
        || String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null
}

function sourceChanged(edge, decision, members) {
    if (!decision) return false
    if (decision.sourceVersion && edge.sourceVersion && decision.sourceVersion !== edge.sourceVersion) return true
    if (edge.changedAfterDecision || members.some((member) => member.changedAfterDecision)) return true
    const decisionAt = new Date(decision.createdAt || 0).getTime()
    return Number.isFinite(decisionAt) && members.some((member) => {
        const updatedAt = new Date(member.updatedAt || 0).getTime()
        return Number.isFinite(updatedAt) && updatedAt > decisionAt
    })
}

function conflictRows(members) {
    const names = new Set()
    const phones = new Set()
    const emails = new Set()
    for (const member of members) {
        if (normalized(member.name)) names.add(normalized(member.name))
        normalizedContactValues(member.phoneKeys, 'phone').forEach((value) => phones.add(value))
        normalizedContactValues(member.emailKeys, 'email').forEach((value) => emails.add(value))
    }
    const conflicts = []
    if (names.size > 1) conflicts.push({ field: 'name', label: FIELD_LABELS.name, severity: 'weak', summary: 'Nomes divergentes entre fontes; trate como evidência fraca.' })
    if (phones.size > 1) conflicts.push({ field: 'phone', label: FIELD_LABELS.phone, severity: 'strong', summary: 'Telefones divergentes impedem revisão em lote.' })
    if (emails.size > 1) conflicts.push({ field: 'email', label: FIELD_LABELS.email, severity: 'strong', summary: 'E-mails divergentes impedem revisão em lote.' })
    return conflicts
}

function edgeHasValidatedContact(edge) {
    return edge.validatedMatch === true || STRONG_METHODS.has(text(edge.method)) || edge.matchedFields.some((field) => CONTACT_FIELDS.has(field))
}

function sharedValidatedContactField(edges) {
    if (edges.some((edge) => edgeHasValidatedContact(edge) && (edge.method.includes('phone') || edge.matchedFields.includes('phone')))) return 'phone'
    if (edges.some((edge) => edgeHasValidatedContact(edge) && (edge.method.includes('email') || edge.matchedFields.includes('email')))) return 'email'
    return null
}

export function classifyIdentityClusterBulkEligibility({ edges = [], conflicts = [], decisions = [], undoBlocked = false, stale = false } = {}) {
    const sharedContactField = sharedValidatedContactField(edges)
    const reasons = []
    if (!sharedContactField) reasons.push('no_shared_validated_contact')
    if (conflicts.some((conflict) => conflict.severity === 'strong')) reasons.push('strong_conflict')
    if (!edges.length || !edges.every((edge) => edge.candidateCount === 1)) reasons.push('candidate_not_unique')
    if (!edges.length || !edges.every((edge) => ['pending', 'suggested'].includes(edge.status) && edgeHasValidatedContact(edge))) reasons.push('edge_not_deterministic')
    if (decisions.some((decision) => ['confirmed', 'rejected'].includes(text(decision.decision)))) reasons.push('incompatible_prior_decision')
    if (undoBlocked) reasons.push('commercial_or_consent_history')
    if (stale) reasons.push('source_stale_or_changed_after_decision')
    return { eligible: reasons.length === 0, mode: reasons.length === 0 ? 'bulk_safe' : 'individual_only', sharedContactField, reasons }
}

function identitySummary(members) {
    const groups = new Map()
    for (const member of members) {
        if (!member.identityId) continue
        if (!groups.has(member.identityId)) groups.set(member.identityId, [])
        groups.get(member.identityId).push(member)
    }
    return [...groups.entries()].map(([id, rows]) => ({
        id,
        name: rows[0]?.identityName || rows[0]?.name || 'Identidade sem nome',
        sourceCount: rows.length,
        sourceLabels: unique(rows.map((row) => sourceLabel(row.sourceType))),
        hasAttendance: rows.some((row) => row.sourceType === 'attendance_client'),
        createdAt: rows.map((row) => row.identityCreatedAt).filter(Boolean).sort()[0] || null,
    })).sort((left, right) => Number(right.hasAttendance) - Number(left.hasAttendance)
        || String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || left.name.localeCompare(right.name))
}

function publicIdentity(identity) {
    return identity ? { name: identity.name, sourceCount: identity.sourceCount, sourceLabels: identity.sourceLabels } : null
}

function publicDecision(decision, edge, members) {
    return {
        reviewType: edge.reviewType,
        decision: ['confirmed', 'rejected', 'reversed'].includes(text(decision.decision)) ? text(decision.decision) : 'recorded',
        resultingStatus: ['pending', 'suggested', 'ambiguous', 'confirmed', 'rejected', 'auto_confirmed'].includes(text(decision.resultingStatus))
            ? text(decision.resultingStatus)
            : 'recorded',
        recordedAt: decision.createdAt || null,
        stale: sourceChanged(edge, decision, members),
    }
}

function automaticLinkStatus(value) {
    const status = text(value)
    return ['pending', 'suggested', 'ambiguous', 'confirmed', 'rejected', 'auto_confirmed'].includes(status) ? status : 'recorded'
}

function automaticLinkTransition(value) {
    const transition = text(value)
    return ['automatic_activated', 'automatic_deactivated', 'confirmed', 'rejected', 'reversed'].includes(transition) ? transition : 'recorded'
}

export function buildIdentityReviewClusterPresentation({
    members: inputMembers = [],
    edges: inputEdges = [],
    decisions = [],
    lineage = [],
    automaticLinkHistory = [],
    historyByIdentity = {},
    unitScope = null,
    includeInternals = false,
} = {}) {
    const members = inputMembers.map(normalizeMember)
        .filter((member) => IDENTITY_CLUSTER_SOURCE_TYPES.includes(member.sourceType) && member.sourceId)
    const memberMap = new Map(members.map((member) => [memberKey(member), member]))
    const dsu = new DisjointSet(members.map(memberKey))
    const materialized = new Map()
    for (const member of members) {
        if (!member.identityId) continue
        if (!materialized.has(member.identityId)) materialized.set(member.identityId, [])
        materialized.get(member.identityId).push(memberKey(member))
    }
    for (const memberKeys of materialized.values()) for (const key of memberKeys.slice(1)) dsu.union(memberKeys[0], key)
    const edges = inputEdges.map(normalizeEdge).filter((edge) => memberMap.has(`${edge.sourceType}:${edge.sourceId}`)
        && memberMap.has(`${edge.targetType}:${edge.targetId}`))
    // A rejected proposal is historical evidence, not a graph edge. It may
    // be shown only when its endpoints are already connected through another
    // active relationship; it must never create a cross-unit component.
    const connectingEdges = edges.filter((edge) => edge.status !== 'rejected')
    for (const edge of connectingEdges) dsu.union(`${edge.sourceType}:${edge.sourceId}`, `${edge.targetType}:${edge.targetId}`)
    const groups = new Map()
    for (const member of members) {
        const root = dsu.find(memberKey(member))
        if (!groups.has(root)) groups.set(root, { members: [], edges: [] })
        groups.get(root).members.push(member)
    }
    for (const edge of connectingEdges) groups.get(dsu.find(`${edge.sourceType}:${edge.sourceId}`))?.edges.push(edge)
    for (const edge of edges.filter((item) => item.status === 'rejected')) {
        const sourceRoot = dsu.find(`${edge.sourceType}:${edge.sourceId}`)
        const targetRoot = dsu.find(`${edge.targetType}:${edge.targetId}`)
        if (sourceRoot === targetRoot) groups.get(sourceRoot)?.edges.push(edge)
    }

    const allowed = unitScope == null ? null : new Set(unique(unitScope))
    const clusters = []
    for (const group of groups.values()) {
        const units = unique(group.members.flatMap((member) => member.units))
        // A scoped manager must not learn that a cross-unit cluster exists.
        if (allowed && (!units.length || units.some((unit) => !allowed.has(unit)))) continue
        const identities = identitySummary(group.members)
        const groupDecisions = group.edges.map((edge) => ({ decision: latestDecisionForEdge(decisions, edge), edge }))
            .filter(({ decision }) => decision)
        const stale = group.members.some((member) => member.sourceFreshness !== 'current' || member.changedAfterDecision)
            || groupDecisions.some(({ decision, edge }) => sourceChanged(edge, decision, group.members))
        const conflicts = conflictRows(group.members)
        const histories = identities.map((identity) => historyByIdentity[identity.id] || {})
        const undoReasons = []
        if (histories.some((history) => Number(history.actions || 0) > 0)) undoReasons.push('commercial_actions_present')
        if (histories.some((history) => Number(history.permissions || 0) > 0 || Number(history.permissionEvents || 0) > 0)) undoReasons.push('consent_history_present')
        if (histories.some((history) => Number(history.auditIdentityEvents || 0) > 0)) undoReasons.push('identity_audit_history_present')
        const clusterEdges = group.edges.map((edge) => ({ edge, presentation: explicitEvidence(edge) }))
        const decisionHistory = groupDecisions.map(({ decision, edge }) => publicDecision(decision, edge, group.members))
        const clusterKey = identityClusterFingerprint({
            members: group.members.map((member) => [member.sourceType, member.sourceId]).sort(),
            edges: group.edges.map(edgeKey).sort(),
        }).slice(0, 32)
        const version = identityClusterFingerprint({
            members: group.members.map((member) => [member.sourceType, member.sourceId, member.sourceFingerprint, member.updatedAt]).sort(),
            edges: group.edges.map((edge) => [edgeKey(edge), edge.status, edge.sourceVersion]).sort(),
        })
        const survivor = identities[0] || null
        const bulkReview = classifyIdentityClusterBulkEligibility({
            edges: group.edges,
            conflicts,
            decisions: groupDecisions.map(({ decision }) => decision),
            undoBlocked: undoReasons.length > 0,
            stale,
        })
        const currentDecision = stale ? 'stale'
            : decisionHistory.some((decision) => decision.decision === 'confirmed') ? 'confirmed'
                : decisionHistory.some((decision) => decision.decision === 'rejected') ? 'rejected' : 'pending'
        const memberPresentations = group.members.map((member) => ({
            source: member.sourceType,
            sourceLabel: sourceLabel(member.sourceType),
            name: member.name,
            aliases: member.aliases,
            units: member.units,
            matchingFields: explicitMatchingFields(member),
            freshness: member.sourceFreshness,
            stale: member.changedAfterDecision || member.sourceFreshness !== 'current',
            contact: { phone: member.phoneKeys.map(maskPhone).filter(Boolean), email: member.emailKeys.map(maskEmail).filter(Boolean), masked: true },
        }))
        const memberBySource = IDENTITY_CLUSTER_SOURCE_TYPES.map((source) => ({
            source,
            sourceLabel: sourceLabel(source),
            count: memberPresentations.filter((member) => member.source === source).length,
        })).filter((entry) => entry.count)
        const clusterIdentityIds = new Set(identities.map((identity) => identity.id))
        clusters.push({
            schemaVersion: IDENTITY_CLUSTER_PRESENTATION_SCHEMA,
            clusterKey,
            version,
            summary: { memberCount: group.members.length, identityCount: identities.length, sourceCount: memberBySource.length, unitCount: units.length },
            members: memberPresentations,
            membersBySource: memberBySource,
            units,
            matchingFields: unique(group.edges.flatMap((edge) => edge.matchedFields)),
            conflicts,
            evidence: {
                strong: clusterEdges.filter(({ presentation }) => presentation.strength === 'strong').map(({ presentation }) => presentation),
                weak: clusterEdges.filter(({ presentation }) => presentation.strength === 'weak').map(({ presentation }) => presentation),
            },
            confidence: clusterEdges.length ? Math.round((clusterEdges.reduce((sum, { edge }) => sum + edge.confidence, 0) / clusterEdges.length) * 100) / 100 : 0,
            decision: { state: currentDecision, count: decisionHistory.length, lastAt: decisionHistory.map((decision) => decision.recordedAt).filter(Boolean).sort().at(-1) || null },
            decisionHistory,
            materializations: groupDecisions.filter(({ decision }) => decision.materializationRunId || decision.runMode || decision.runStatus)
                .map(({ decision }) => ({ mode: text(decision.runMode || (decision.decision === 'confirmed' ? 'confirm' : decision.decision === 'reversed' ? 'reverse' : 'reject')), status: text(decision.runStatus || 'applied'), recordedAt: decision.runCreatedAt || decision.createdAt || null, membersMoved: Number(decision.runMembersMoved || 0) })),
            automaticLinks: group.edges.map((edge) => {
                const presentation = explicitEvidence(edge)
                return {
                    source: presentation.source,
                    target: presentation.target,
                    status: automaticLinkStatus(edge.status),
                    evidenceLabel: presentation.label,
                    confidence: presentation.confidence,
                    history: (automaticLinkHistory || []).filter((row) => edgeKey(row) === edgeKey(edge)).map((row) => ({
                        transition: automaticLinkTransition(row.transition),
                        resultingStatus: automaticLinkStatus(row.resultingStatus),
                        recordedAt: row.createdAt || null,
                    })),
                }
            }),
            sourceChanges: group.members.filter((member) => member.changedAfterDecision || groupDecisions.some(({ decision, edge }) => sourceChanged(edge, decision, [member])))
                .map((member) => ({ source: sourceLabel(member.sourceType), name: member.name, changedAt: member.updatedAt || null })),
            staleState: stale ? 'stale' : 'current',
            lineage: (lineage || []).filter((row) => clusterIdentityIds.has(text(row.predecessorIdentityId)) || clusterIdentityIds.has(text(row.successorIdentityId)))
                .map((row) => ({ relation: text(row.relation), recordedAt: row.createdAt || null })),
            impact: {
                membersToMove: group.members.filter((member) => !survivor || member.identityId !== survivor.id).map((member) => ({ sourceLabel: sourceLabel(member.sourceType), name: member.name })),
                survivorIdentity: publicIdentity(survivor),
                retiredIdentities: identities.slice(1).map(publicIdentity),
                commercialHistoryPresent: undoReasons.includes('commercial_actions_present'),
                consentHistoryPresent: undoReasons.includes('consent_history_present'),
                predictedAction: currentDecision === 'pending' && !conflicts.some((conflict) => conflict.severity === 'strong') ? 'merge_if_confirmed' : 'review_only',
            },
            undo: {
                blocked: undoReasons.length > 0,
                reasons: undoReasons,
                blockingHistory: {
                    commercialActions: histories.reduce((sum, history) => sum + Number(history.actions || 0), 0),
                    consentPermissions: histories.reduce((sum, history) => sum + Number(history.permissions || 0), 0),
                    consentEvents: histories.reduce((sum, history) => sum + Number(history.permissionEvents || 0), 0),
                    identityAuditEvents: histories.reduce((sum, history) => sum + Number(history.auditIdentityEvents || 0), 0),
                },
            },
            bulkReview,
            privacy: { contactsMasked: true, technicalIdsHidden: true, revealRequired: true },
            _identityIds: identities.map((identity) => identity.id),
            _members: group.members,
            _edges: group.edges,
        })
    }
    const ordered = clusters.sort((left, right) => Number(right.bulkReview.eligible) - Number(left.bulkReview.eligible)
        || right.confidence - left.confidence || left.clusterKey.localeCompare(right.clusterKey))
    return includeInternals ? ordered : ordered.map(stripIdentityClusterInternals)
}

export function stripIdentityClusterInternals(cluster) {
    if (!cluster) return null
    const { _identityIds, _members, _edges, ...safe } = cluster
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

export function assertIdentityClusterConfirmation(payload = {}) {
    const reason = text(payload.reason).replace(/\s+/g, ' ')
    const expectedVersion = text(payload.expectedVersion)
    if (reason.length < 3 || reason.length > 1000) throw Object.assign(new Error('IDENTITY_CLUSTER_REASON_REQUIRED'), { statusCode: 400 })
    if (payload.confirmation !== 'REVIEW_CLUSTER') throw Object.assign(new Error('IDENTITY_CLUSTER_CONFIRMATION_REQUIRED'), { statusCode: 400 })
    if (expectedVersion && expectedVersion.length > 200) throw Object.assign(new Error('IDENTITY_CLUSTER_VERSION_INVALID'), { statusCode: 400 })
    return { reason, expectedVersion }
}

export function explicitRevealFields(payload = {}) {
    const fields = unique(payload.fields).filter((field) => CONTACT_FIELDS.has(field))
    if (!fields.length) throw Object.assign(new Error('IDENTITY_CLUSTER_REVEAL_FIELD_REQUIRED'), { statusCode: 400 })
    return fields
}
