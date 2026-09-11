/**
 * Dependency-free contract shared by source schema, source preflight, and
 * repository-level catalog validation. Keeping it free of runtime/database
 * imports lets governance checks run without loading service dependencies.
 */
export const ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID = '20260910_atendimento_crm_core_identity_materialization_v1'
export const ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT = 'atendimento/crm-core/identity-materialization/v2'
export const ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION = 'atendimento/crm-core/confirmed-unit-membership-source/v5'
export const LEGACY_CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_ID = '20260805_client_identity_materialization_schema_v1'

// These relations intentionally do not reuse the Clientes identity graph.
// The CRM Core projection source is a separate, Atendimento-owned graph with
// a smaller contract and no Finance/Caixa dependencies.
export const ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION = 'crm_atendimento.crm_core_identity_clients'
export const ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION = 'crm_atendimento.crm_core_attendance_client_links'
export const ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION = 'crm_atendimento.crm_core_identities'
export const ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION = 'crm_atendimento.crm_core_identity_members'
export const ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION = 'crm_atendimento.crm_core_identity_materialization_runs'

export const ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.attendances',
    'crm_atendimento.units',
])

export const ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS = Object.freeze([
    ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION,
    ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
])

export const ATENDIMENTO_CRM_CORE_IDENTITY_PROJECTION_SOURCE_RELATIONS = Object.freeze([
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.attendance_client_links',
    'crm_atendimento.attendances',
    'crm_atendimento.units',
])

// `20260908_crm_core_projection_delta_v1` consumes the legacy list above.
// The current isolated source contract must be named separately so changing it
// cannot rewrite a historical migration's relation graph by import alone.
export const ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS = Object.freeze([
    ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
    ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
    'crm_atendimento.attendances',
    'crm_atendimento.units',
])

export const ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY = Object.freeze({
    version: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    sourceType: 'attendance_client',
    componentKeyTemplate: 'attendance-client:<canonical-client-uuid>',
    approvedLinkMethods: Object.freeze(['operator_attested', 'stable_source_reference', 'reviewed_reconciliation']),
    uuidFromNameAllowed: false,
    nameBasedAutomaticLinkAllowed: false,
    ambiguousLinkPolicy: 'exclude-until-reviewed',
    reassignmentPolicy: 'review-required',
    revisionPolicy: 'monotonic',
    sameRevisionEvidencePolicy: 'review-required',
    ordering: Object.freeze(['attendanceId', 'canonicalClientId']),
})

// This is a source-level capability contract, not a PostgreSQL GRANT. The
// migration deliberately creates neither the role nor its permissions. A
// future custody flow must provision this dedicated principal out of band and
// call the opt-in writer API with an explicit UUID run id and UUID-only links.
export const ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT = Object.freeze({
    version: 'atendimento/crm-core/identity-materialization-writer/v1',
    databaseRole: 'crm_core_identity_materializer',
    automaticExecutionAllowed: false,
    input: 'explicit-uuid-run-id-and-links-only',
    reads: Object.freeze([
        ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
        ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
        ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    ]),
    writes: Object.freeze([
        ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION,
        ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
        ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
        ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
        ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    ]),
    ledger: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    grants: 'none-created-by-source-migration',
})
