import {
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  createAtendimentoUnitScopedProjectionSource,
} from './atendimentoProjectionExporter.mjs'

export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION = 'atendimento/crm-core/confirmed-unit-membership-source/v3'

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
  membership: 'active attendance evidence resolved through canonical units',
  excludedDomains: Object.freeze(['finance']),
  deferredSources: 'Finance Caixa sale evidence, app registration and supplemental lead remain excluded until their owner provides a dedicated source contract plus complete-snapshot retirement evidence or explicit tombstones',
  duplicateEvidence: 'one identity/unit row, with the latest observed source timestamp',
  divergentUnits: 'valid multi-unit membership; emit one row for each canonical unit slug',
  missingEvidence: 'no projection row; there is no global or wildcard fallback',
  revision: 'snapshot-only: updated_at is cursor material, while CRM Core event revision remains 1 for the initial backfill and exact replay',
})

// This validates the UUID separators as well as the hexadecimal groups before
// the source text is cast. A permissive "36 hex-or-dash characters" predicate
// could still let an invalid legacy source_id abort an otherwise read-only
// snapshot at PostgreSQL cast time.
const UUID_TEXT_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

// Keep every source branch data-minimal. The final projection only selects the
// opaque identity UUID, a timestamp, and the canonical unit slug; names,
// phones, email, and sale/attendance payloads never cross this boundary.
// Mutable importer/materializer timestamps are deliberately excluded: their
// idempotent upserts happen on every refresh and are not membership evidence.
const MEMBERSHIP_CTE = `WITH unit_membership_evidence AS (
  SELECT member.identity_id,
    unit.slug AS unit_slug,
    GREATEST(
      attendance_link.created_at,
      attendance.created_at
    ) AS observed_at
  FROM crm_atendimento.global_client_identity_members member
  JOIN crm_atendimento.attendance_client_links attendance_link
    ON attendance_link.client_id = CASE
      WHEN member.source_id ~ '${UUID_TEXT_PATTERN}' THEN member.source_id::uuid
      ELSE NULL
    END
  JOIN crm_atendimento.attendances attendance
    ON attendance.id = attendance_link.attendance_id
  JOIN crm_atendimento.units unit ON unit.id = attendance.unit_id
  WHERE member.source_type = 'attendance_client'
    AND member.source_id ~ '${UUID_TEXT_PATTERN}'
    AND attendance.deleted_at IS NULL
), unit_memberships AS (
  SELECT identity_id, unit_slug, max(observed_at) AS observed_at
  FROM unit_membership_evidence
  GROUP BY identity_id, unit_slug
), projection_rows AS (
  SELECT identity_id,
    observed_at,
    identity_id::text AS id,
    to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
    unit_slug
  FROM unit_memberships
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
