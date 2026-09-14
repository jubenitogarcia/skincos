import {
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  createAtendimentoUnitScopedProjectionSource,
} from './atendimentoProjectionExporter.mjs'
import {
  ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
  ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION = ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION

// This source is limited to relations whose lifecycle is owned and observable
// in Atendimento. Finance-owned Caixa sales are intentionally not included:
// they need their own owner contract and admission before they can influence a
// CRM Core projection. App registration and supplemental lead imports are also
// intentionally excluded: their source contract says absence is not retirement
// evidence, so exporting them here could retain a revoked unit.
// A unit only becomes exportable after it resolves to a canonical
// `crm_atendimento.units` row; an identity without such evidence has no output
// row and can never fall back to a global/wildcard scope.
export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS = Object.freeze({
  version: ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
  membership: 'explicitly confirmed attendance evidence resolved through canonical units',
  sourceRelationAllowlist: ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
  excludedDomains: Object.freeze(['finance']),
  deferredSources: 'Finance Caixa sale evidence, app registration and supplemental lead remain excluded until their owner provides a dedicated source contract plus complete-snapshot retirement evidence or explicit tombstones',
  duplicateEvidence: 'one identity/unit row, with the latest observed source timestamp',
  divergentUnits: 'valid multi-unit membership; emit one row for each canonical unit slug',
  missingEvidence: 'no projection row; there is no global or wildcard fallback',
  revision: 'snapshot-only: updated_at is cursor material, while CRM Core event revision remains 1 for the initial backfill and exact replay',
})

// Keep every source branch data-minimal. The final projection only selects the
// opaque identity UUID, a timestamp, and the canonical unit slug; names,
// phones, email, and sale/attendance payloads never cross this boundary.
// Mutable importer/materializer timestamps are deliberately excluded: their
// idempotent upserts happen on every refresh and are not membership evidence.
const MEMBERSHIP_CTE = `${ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE}, projection_rows AS (
  SELECT identity_id,
    observed_at,
    identity_id::text AS id,
    to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
    unit_slug
  FROM canonical_memberships
)`

const ROWS_SELECT = `SELECT id, updated_at, unit_slug
FROM projection_rows`

export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE = createAtendimentoUnitScopedProjectionSource({
  contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  countSql: `${MEMBERSHIP_CTE}
SELECT count(*)::int AS row_count
FROM projection_rows`,
  rowsSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  firstPageSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  nextPageSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
WHERE (observed_at, identity_id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text)
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $4`,
})
