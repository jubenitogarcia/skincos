import { createHash } from 'node:crypto'
import { buildConfirmedGlobalIdentityComponents } from './clientRegistrationIdentity.js'
import { IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID } from './identityReviewMigration.js'

function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function projectionMemberKey(sourceType, sourceId) {
    return `${String(sourceType || '').trim()}\u0000${String(sourceId || '').trim()}`
}

export function buildCanonicalClientAliasLinks({ canonicalClients = [], canonicalAliases = [] } = {}) {
    const aliases = [
        ...canonicalAliases,
        ...canonicalClients.map((client) => ({
            sourceClientId: client?.id,
            targetClientId: client?.mergedIntoId ?? client?.merged_into_id,
        })),
    ]
    const byPair = new Map()
    for (const alias of aliases) {
        const sourceClientId = normalizedLinkValue(alias?.sourceClientId ?? alias?.source_client_id ?? alias?.sourceId)
        const targetClientId = normalizedLinkValue(alias?.targetClientId ?? alias?.target_client_id ?? alias?.targetId)
        if (!sourceClientId || !targetClientId || sourceClientId === targetClientId) continue
        byPair.set(`${sourceClientId}\u0000${targetClientId}`, { sourceClientId, targetClientId })
    }
    return [...byPair.values()].sort((left, right) => left.sourceClientId.localeCompare(right.sourceClientId)
        || left.targetClientId.localeCompare(right.targetClientId))
}

function canonicalAliasComponentResolver(canonicalAliases) {
    const parent = new Map()
    const add = (value) => {
        const normalized = normalizedLinkValue(value)
        if (normalized && !parent.has(normalized)) parent.set(normalized, normalized)
        return normalized
    }
    const find = (value) => {
        const normalized = add(value)
        if (!normalized) return ''
        const parentValue = parent.get(normalized)
        if (parentValue === normalized) return normalized
        const root = find(parentValue)
        parent.set(normalized, root)
        return root
    }
    for (const alias of canonicalAliases) {
        const sourceClientId = add(alias?.sourceClientId)
        const targetClientId = add(alias?.targetClientId)
        if (sourceClientId && targetClientId && sourceClientId !== targetClientId) {
            parent.set(find(sourceClientId), find(targetClientId))
        }
    }
    return (value) => find(value)
}

export function createCanonicalClientAliasResolver({ canonicalClients = [], canonicalAliases = [] } = {}) {
    return canonicalAliasComponentResolver(buildCanonicalClientAliasLinks({ canonicalClients, canonicalAliases }))
}

const TERMINAL_IDENTITY_LINK_STATUSES = new Set(['confirmed', 'rejected'])
const AUTOMATIC_IDENTITY_LINK_STATUSES = new Set(['auto_confirmed', 'auto_confirmed_spelling'])
const PROTECTED_IDENTITY_LINK_STATUSES = new Set([
    ...TERMINAL_IDENTITY_LINK_STATUSES,
    ...AUTOMATIC_IDENTITY_LINK_STATUSES,
])

function normalizedLinkValue(value) {
    return String(value ?? '').trim()
}

function normalizedEvidence(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// Reconciliation plans are built from a fresh source snapshot, but a human
// decision or earlier accepted automatic edge can already exist for the same
// source endpoint. Never let a new automatic edge point that source at another
// target: it would make the graph builder join identities around a decision it
// did not make. The caller must invoke this while holding the shared identity
// graph lock and persist the returned links (rather than the original proposals).
//
// More than one automatic target in one source snapshot is also ambiguous.  We
// demote all of those new automatic proposals rather than picking one based on
// iteration order.  Existing terminal rows are never changed by this helper.
export function guardAutoConfirmedIdentityLinkProposals({
    proposals = [],
    persistedLinks = [],
    getSourceId,
    getTargetId,
    normalizeSourceId = normalizedLinkValue,
    normalizeTargetId = normalizedLinkValue,
    demotedStatus = 'ambiguous',
} = {}) {
    if (typeof getSourceId !== 'function' || typeof getTargetId !== 'function'
        || typeof normalizeSourceId !== 'function' || typeof normalizeTargetId !== 'function') {
        throw new TypeError('IDENTITY_LINK_GUARD_SOURCE_AND_TARGET_RESOLVERS_REQUIRED')
    }

    const protectedTargetsBySource = new Map()
    for (const link of persistedLinks) {
        if (!PROTECTED_IDENTITY_LINK_STATUSES.has(normalizedLinkValue(link?.status))) continue
        const sourceId = normalizedLinkValue(normalizeSourceId(getSourceId(link)))
        const targetId = normalizedLinkValue(normalizeTargetId(getTargetId(link)))
        if (!sourceId || !targetId) continue
        if (!protectedTargetsBySource.has(sourceId)) protectedTargetsBySource.set(sourceId, new Set())
        protectedTargetsBySource.get(sourceId).add(targetId)
    }

    const automaticProposalTargetsBySource = new Map()
    for (const link of proposals) {
        if (!AUTOMATIC_IDENTITY_LINK_STATUSES.has(normalizedLinkValue(link?.status))) continue
        const sourceId = normalizedLinkValue(normalizeSourceId(getSourceId(link)))
        const targetId = normalizedLinkValue(normalizeTargetId(getTargetId(link)))
        if (!sourceId || !targetId) continue
        if (!automaticProposalTargetsBySource.has(sourceId)) automaticProposalTargetsBySource.set(sourceId, new Set())
        automaticProposalTargetsBySource.get(sourceId).add(targetId)
    }

    return proposals.map((link) => {
        const originalStatus = normalizedLinkValue(link?.status)
        if (!AUTOMATIC_IDENTITY_LINK_STATUSES.has(originalStatus)) return link
        const sourceId = normalizedLinkValue(normalizeSourceId(getSourceId(link)))
        const targetId = normalizedLinkValue(normalizeTargetId(getTargetId(link)))
        if (!sourceId || !targetId) return link

        const terminalTargets = protectedTargetsBySource.get(sourceId) || new Set()
        const automaticProposalTargets = automaticProposalTargetsBySource.get(sourceId) || new Set()
        const conflictsWithTerminalTarget = [...terminalTargets].some((terminalTargetId) => terminalTargetId !== targetId)
        const hasMultipleAutomaticTargets = automaticProposalTargets.size > 1
        if (!conflictsWithTerminalTarget && !hasMultipleAutomaticTargets) return link

        const terminalTargetIds = [...terminalTargets].sort()
        const automaticProposalTargetIds = [...automaticProposalTargets].sort()
        return {
            ...link,
            status: demotedStatus,
            evidence: {
                ...normalizedEvidence(link.evidence),
                identityLinkGuard: {
                    originalStatus,
                    reason: conflictsWithTerminalTarget ? 'terminal_target_conflict' : 'multiple_automatic_targets',
                    terminalTargetIds,
                    automaticProposalTargetIds,
                },
            },
        }
    })
}

// A source row can still point at physical canonical S after S was merged into
// T.  Rewriting a later automatic A -> T proposal back to that persisted S
// keeps exactly one physical link.  That is essential for a future reviewed
// undo: otherwise the new A -> T row survives after S -> T is reversed and
// quietly keeps the graph joined.  Rejections remain fail-closed.
export function preserveCanonicalAliasEquivalentLinkTargets({
    proposals = [],
    persistedLinks = [],
    canonicalClients = [],
    canonicalAliases = [],
    getSourceId,
    getTargetId,
    getStatus = (link) => link?.status,
    setTargetId,
    demotedStatus = 'ambiguous',
} = {}) {
    if (typeof getSourceId !== 'function' || typeof getTargetId !== 'function' || typeof setTargetId !== 'function') {
        throw new TypeError('CANONICAL_ALIAS_LINK_PRESERVATION_RESOLVERS_REQUIRED')
    }
    const aliases = buildCanonicalClientAliasLinks({ canonicalClients, canonicalAliases })
    const canonicalComponent = canonicalAliasComponentResolver(aliases)
    const persistedBySourceAndComponent = new Map()
    for (const link of persistedLinks) {
        const sourceId = normalizedLinkValue(getSourceId(link))
        const targetId = normalizedLinkValue(getTargetId(link))
        const status = normalizedLinkValue(getStatus(link))
        if (!sourceId || !targetId || !status) continue
        const componentId = canonicalComponent(targetId)
        if (!componentId) continue
        const key = `${sourceId}\u0000${componentId}`
        if (!persistedBySourceAndComponent.has(key)) persistedBySourceAndComponent.set(key, [])
        persistedBySourceAndComponent.get(key).push({ targetId, status })
    }
    return proposals.map((proposal) => {
        const originalStatus = normalizedLinkValue(getStatus(proposal))
        if (!AUTOMATIC_IDENTITY_LINK_STATUSES.has(originalStatus)) return proposal
        const sourceId = normalizedLinkValue(getSourceId(proposal))
        const targetId = normalizedLinkValue(getTargetId(proposal))
        const componentId = canonicalComponent(targetId)
        if (!sourceId || !targetId || !componentId) return proposal
        const existing = persistedBySourceAndComponent.get(`${sourceId}\u0000${componentId}`) || []
        const rejected = existing.filter((item) => item.status === 'rejected')
        if (rejected.length) {
            return {
                ...proposal,
                status: demotedStatus,
                evidence: {
                    ...normalizedEvidence(proposal.evidence),
                    canonicalAliasLinkGuard: {
                        originalStatus,
                        reason: 'terminal_alias_rejection',
                        persistedTargetIds: rejected.map((item) => item.targetId).sort(),
                    },
                },
            }
        }
        const acceptedByTarget = new Map(existing
            .filter((item) => item.status === 'confirmed' || AUTOMATIC_IDENTITY_LINK_STATUSES.has(item.status))
            .map((item) => [item.targetId, item]))
        const accepted = [...acceptedByTarget.values()].sort((left, right) => left.targetId.localeCompare(right.targetId))
        if (accepted.length !== 1) {
            if (accepted.length < 2) return proposal
            return {
                ...proposal,
                status: demotedStatus,
                evidence: {
                    ...normalizedEvidence(proposal.evidence),
                    canonicalAliasLinkGuard: {
                        originalStatus,
                        reason: 'multiple_physical_alias_targets',
                        persistedTargetIds: accepted.map((item) => item.targetId),
                    },
                },
            }
        }
        const physicalTargetId = accepted[0].targetId
        if (physicalTargetId === targetId) return proposal
        return {
            ...setTargetId(proposal, physicalTargetId),
            evidence: {
                ...normalizedEvidence(proposal.evidence),
                canonicalAliasLinkGuard: {
                    originalStatus,
                    reason: 'preserved_physical_alias_target',
                    proposedTargetId: targetId,
                    persistedTargetId: physicalTargetId,
                },
            },
        }
    })
}

// All source reconcilers build the same graph from persisted rows.  Keeping
// this assembly in one place prevents a newer importer from dropping an older
// source type (for example, a confirmed lead -> app link).
export function buildPersistedConfirmedIdentityComponents({
    registrations = [],
    leadProfiles = [],
    canonicalClients = [],
    canonicalAliases = [],
    caixaCustomers = [],
    registrationCaixaLinks = [],
    registrationAttendanceLinks = [],
    attendanceCaixaLinks = [],
    leadProfileRegistrationLinks = [],
    leadProfileCaixaLinks = [],
} = {}) {
    const aliases = buildCanonicalClientAliasLinks({ canonicalClients, canonicalAliases })
    const activeCanonicalNames = new Map(canonicalClients
        .filter((client) => !normalizedLinkValue(client?.mergedIntoId ?? client?.merged_into_id))
        .map((client) => [normalizedLinkValue(client?.id), normalizedLinkValue(client?.name)]))
    const components = buildConfirmedGlobalIdentityComponents({
        registrations,
        leadProfiles,
        canonicalClients,
        canonicalAliasLinks: aliases,
        caixaCustomers,
        registrationCaixaLinks,
        registrationAttendanceLinks,
        attendanceCaixaLinks,
        leadProfileRegistrationLinks,
        leadProfileCaixaLinks,
    })
    // Prefer the live canonical record for a merged component.  Retired S is
    // still a physical member for attendance coverage, but must not become the
    // label presented to commercial users when its survivor T has a name.
    return components.map((component) => {
        const activeAttendanceName = component.members
            .filter((member) => member.sourceType === 'attendance_client')
            .map((member) => activeCanonicalNames.get(member.sourceId) || '')
            .find(Boolean)
        return activeAttendanceName ? { ...component, preferredName: activeAttendanceName } : component
    })
}

function identityProjectionError(code) {
    const error = new Error(code)
    error.code = code
    error.statusCode = 409
    return error
}

async function assertCommercialHistoryGuardAvailable(client) {
    const result = await client.query(`select
        to_regclass('crm_atendimento.commercial_actions') as actions,
        to_regclass('crm_atendimento.commercial_contact_permissions') as permissions,
        to_regclass('crm_atendimento.commercial_contact_permission_events') as permission_events,
        to_regclass('crm_atendimento.commercial_policy_config') as policy,
        to_regclass('crm_atendimento.audit_events') as audit_events,
        exists(select 1 from information_schema.columns
            where table_schema='crm_atendimento' and table_name='commercial_policy_config'
              and column_name='commercial_contact_canary_identity_ids') as canary_column`)
    const row = result.rows[0] || {}
    if (!row.actions || !row.permissions || !row.permission_events || !row.policy || !row.audit_events || !row.canary_column) {
        throw identityProjectionError('IDENTITY_PROJECTION_COMMERCIAL_GUARD_UNAVAILABLE')
    }
}

async function assertNoCommercialIdentityHistory(client, identityIds) {
    const ids = uniqueStrings(identityIds)
    if (!ids.length) return
    const result = await client.query(`select
        (select count(*)::int from crm_atendimento.commercial_actions where identity_id=any($1::uuid[])) as actions,
        (select count(*)::int from crm_atendimento.commercial_contact_permissions where identity_id=any($1::uuid[])) as permissions,
        (select count(*)::int from crm_atendimento.commercial_contact_permission_events where identity_id=any($1::uuid[])) as permission_events,
        (select count(*)::int from crm_atendimento.commercial_policy_config
            where commercial_contact_canary_identity_ids && $1::uuid[]) as canary_entries,
        (select count(*)::int from crm_atendimento.audit_events
            where coalesce(payload->>'identityId','')=any($1::text[])) as audit_identity_events`, [ids])
    const row = result.rows[0] || {}
    if (Number(row.actions || 0) || Number(row.permissions || 0) || Number(row.permission_events || 0)
        || Number(row.canary_entries || 0) || Number(row.audit_identity_events || 0)) {
        throw identityProjectionError('IDENTITY_PROJECTION_COMMERCIAL_HISTORY_PRESENT')
    }
}

// The caller must already hold IDENTITY_GRAPH_LOCK_KEY.  This guard takes the
// same per-identity locks as commercial writes before a source importer can
// reassign a member, so consent, cadence, canary and audit evidence never get
// silently detached from a customer by a refreshed upstream source.
export async function assertIdentityProjectionCanBeMaterialized(client, components) {
    const desiredMembers = components.flatMap((component) => component.members.map((member) => ({
        source_type: String(member.sourceType || '').trim(),
        source_id: String(member.sourceId || '').trim(),
        component_key: String(component.componentKey || '').trim(),
    }))).filter((member) => member.source_type && member.source_id && member.component_key)
    if (!desiredMembers.length) return { impactedIdentityIds: [], previousIdentityByMember: {} }

    const componentKeys = uniqueStrings(desiredMembers.map((member) => member.component_key))
    const currentMembers = await client.query(`with desired as (
        select source_type,source_id,component_key
        from jsonb_to_recordset($1::jsonb) as x(source_type text,source_id text,component_key text)
    )
    select d.source_type,d.source_id,d.component_key,m.identity_id::text as current_identity_id
    from desired d
    left join crm_atendimento.global_client_identity_members m
      on m.source_type=d.source_type and m.source_id=d.source_id
    order by d.source_type,d.source_id`, [JSON.stringify(desiredMembers)])
    const currentTargets = await client.query(`select id::text,component_key
        from crm_atendimento.global_client_identities
        where component_key=any($1::text[]) for update`, [componentKeys])
    const targetByComponent = new Map(currentTargets.rows.map((row) => [String(row.component_key), String(row.id)]))
    const previousIdentityByMember = Object.fromEntries(currentMembers.rows
        .map((member) => [
            projectionMemberKey(member.source_type, member.source_id),
            String(member.current_identity_id || '').trim(),
        ])
        .filter(([, identityId]) => identityId))
    const impactedIdentityIds = new Set()
    for (const member of currentMembers.rows) {
        const currentIdentityId = String(member.current_identity_id || '').trim()
        const targetIdentityId = targetByComponent.get(String(member.component_key || '')) || ''
        if (currentIdentityId && currentIdentityId !== targetIdentityId) impactedIdentityIds.add(currentIdentityId)
        if (targetIdentityId && currentIdentityId !== targetIdentityId) impactedIdentityIds.add(targetIdentityId)
    }
    const impacted = [...impactedIdentityIds].sort()
    if (!impacted.length) return { impactedIdentityIds: [], previousIdentityByMember }

    for (const identityId of impacted) {
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`crm_atendimento.commercial-contact:${identityId}`])
    }
    await assertCommercialHistoryGuardAvailable(client)
    await assertNoCommercialIdentityHistory(client, impacted)
    return { impactedIdentityIds: impacted, previousIdentityByMember }
}

async function identityReviewLedgerIsAvailable(client) {
    const availability = await client.query(`select
        to_regclass('crm_atendimento.schema_migrations') as registry,
        to_regclass('crm_atendimento.identity_materialization_runs') as runs,
        to_regclass('crm_atendimento.identity_member_history') as member_history,
        to_regclass('crm_atendimento.identity_lineage') as lineage,
        to_regclass('crm_atendimento.audit_events') as audit_events`)
    const row = availability.rows[0] || {}
    if (!row.registry || !row.runs || !row.member_history || !row.lineage || !row.audit_events) return false
    const migration = await client.query(`select id from crm_atendimento.schema_migrations
        where id=$1 and rolled_back_at is null`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
    return !!migration.rows[0]?.id
}

function projectionIdentityIdByComponent(resultingIdentityIds, componentKey) {
    if (resultingIdentityIds instanceof Map) return String(resultingIdentityIds.get(componentKey) || '').trim()
    if (resultingIdentityIds && typeof resultingIdentityIds === 'object') return String(resultingIdentityIds[componentKey] || '').trim()
    return ''
}

// Source materializers predate the reviewed workflow, so their ledger is
// optional for backwards compatibility.  Once the workflow migration is live,
// every physical-member move introduced by a persisted projection gets the
// same append-only lineage and audit evidence as a manager-reviewed merge.
export async function recordIdentityProjectionMaterialization(client, {
    origin,
    components = [],
    resultingIdentityIds = new Map(),
    previousIdentityByMember = {},
} = {}) {
    const changes = []
    for (const component of components) {
        const nextIdentityId = projectionIdentityIdByComponent(resultingIdentityIds, component.componentKey)
        if (!nextIdentityId) continue
        for (const member of component.members || []) {
            const sourceType = normalizedLinkValue(member?.sourceType)
            const sourceId = normalizedLinkValue(member?.sourceId)
            if (!sourceType || !sourceId) continue
            const previousIdentityId = String(previousIdentityByMember[projectionMemberKey(sourceType, sourceId)] || '').trim()
            if (previousIdentityId === nextIdentityId) continue
            changes.push({
                sourceType,
                sourceId,
                previousIdentityId,
                nextIdentityId,
                changeKind: previousIdentityId ? 'moved' : 'created',
            })
        }
    }
    if (!changes.length) return { available: false, recorded: false, membersCreated: 0, membersMoved: 0 }
    if (!await identityReviewLedgerIsAvailable(client)) {
        return { available: false, recorded: false, membersCreated: 0, membersMoved: 0 }
    }

    const orderedChanges = changes.sort((left, right) => left.sourceType.localeCompare(right.sourceType)
        || left.sourceId.localeCompare(right.sourceId))
    const membersCreated = orderedChanges.filter((change) => change.changeKind === 'created').length
    const membersMoved = orderedChanges.length - membersCreated
    const lineagePairs = new Map()
    for (const change of orderedChanges) {
        if (!change.previousIdentityId) continue
        lineagePairs.set(`${change.previousIdentityId}\u0000${change.nextIdentityId}`, {
            predecessorIdentityId: change.previousIdentityId,
            successorIdentityId: change.nextIdentityId,
            relation: 'merged_into',
        })
    }
    for (const successorIdentityId of new Set([...lineagePairs.values()].map((pair) => pair.successorIdentityId))) {
        lineagePairs.set(`${successorIdentityId}\u0000${successorIdentityId}`, {
            predecessorIdentityId: successorIdentityId,
            successorIdentityId,
            relation: 'retained',
        })
    }
    const inputFingerprint = createHash('sha256').update(JSON.stringify({
        origin: String(origin || 'persisted_identity_projection'),
        changes: orderedChanges,
    })).digest('hex')
    const summary = {
        origin: String(origin || 'persisted_identity_projection'),
        membersCreated,
        membersMoved,
        predecessorIdentityIds: uniqueStrings(orderedChanges.map((change) => change.previousIdentityId)),
        successorIdentityIds: uniqueStrings(orderedChanges.map((change) => change.nextIdentityId)),
    }
    const run = await client.query(`insert into crm_atendimento.identity_materialization_runs(
            mode,status,input_fingerprint,summary,actor)
        values('confirm','applied',$1,$2::jsonb,$3::jsonb) returning id::text`, [
        inputFingerprint,
        JSON.stringify(summary),
        JSON.stringify({ id: 'system:identity-projection', role: 'SYSTEM', origin: summary.origin }),
    ])
    const runId = String(run.rows[0]?.id || '').trim()
    if (!runId) throw identityProjectionError('IDENTITY_PROJECTION_LEDGER_RUN_MISSING')
    await client.query(`insert into crm_atendimento.identity_member_history(
            materialization_run_id,source_type,source_id,previous_identity_id,next_identity_id,change_kind)
        select $1::uuid,x.source_type,x.source_id,nullif(x.previous_identity_id,'')::uuid,
            x.next_identity_id::uuid,x.change_kind
        from jsonb_to_recordset($2::jsonb) as x(
            source_type text,source_id text,previous_identity_id text,next_identity_id text,change_kind text)`, [
        runId,
        JSON.stringify(orderedChanges.map((change) => ({
            source_type: change.sourceType,
            source_id: change.sourceId,
            previous_identity_id: change.previousIdentityId,
            next_identity_id: change.nextIdentityId,
            change_kind: change.changeKind,
        }))),
    ])
    const lineage = [...lineagePairs.values()].sort((left, right) => left.predecessorIdentityId.localeCompare(right.predecessorIdentityId)
        || left.successorIdentityId.localeCompare(right.successorIdentityId))
    if (lineage.length) {
        await client.query(`insert into crm_atendimento.identity_lineage(
                materialization_run_id,predecessor_identity_id,successor_identity_id,relation)
            select $1::uuid,x.predecessor_identity_id::uuid,x.successor_identity_id::uuid,x.relation
            from jsonb_to_recordset($2::jsonb) as x(
                predecessor_identity_id text,successor_identity_id text,relation text)`, [
            runId,
            JSON.stringify(lineage.map((pair) => ({
                predecessor_identity_id: pair.predecessorIdentityId,
                successor_identity_id: pair.successorIdentityId,
                relation: pair.relation,
            }))),
        ])
    }
    await client.query(`insert into crm_atendimento.audit_events(event_type,actor,attendance_id,payload)
        values($1,$2::jsonb,null,$3::jsonb)`, [
        'client-identity.projection.materialized',
        JSON.stringify({ id: 'system:identity-projection', role: 'SYSTEM', origin: summary.origin }),
        JSON.stringify({ materializationRunId: runId, ...summary }),
    ])
    return { available: true, recorded: true, runId, membersCreated, membersMoved, lineage: lineage.length }
}
