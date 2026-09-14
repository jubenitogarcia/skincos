import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY,
  CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION,
  CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION,
  CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION,
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL,
  applyConfirmedProjectionDeltaV2Migration,
  confirmedProjectionDeltaV2MigrationPlan,
  reconcileConfirmedProjectionDeltaV2,
} from '../confirmedProjectionDeltaV2Migration.js'
import {
  ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from '../../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
  acceptAtendimentoConfirmedProjectionBaselineV2,
  createAtendimentoConfirmedProjectionBaselineV2Backfill,
  createAtendimentoConfirmedProjectionBaselineV2Batch,
  createAtendimentoConfirmedProjectionBaselineV2Prepared,
  createAtendimentoConfirmedProjectionBaselineV2Snapshot,
  createAtendimentoConfirmedProjectionBaselineV2Source,
  digestAtendimentoConfirmedProjectionBaselineV2,
  digestAtendimentoConfirmedProjectionBaselineV2Batch,
  markAtendimentoConfirmedProjectionBaselineV2Ready,
} from '../../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'

const PRODUCTION_URL = 'postgresql://skincos_clientes_migrator_login:test-only-password@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true'
const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const HMAC_KEY = `confirmed-projection-migration-v2-test-${'x'.repeat(40)}`
const SOURCE_ROW = Object.freeze({ identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'jardins', observed_at: '2026-09-14T12:00:00.000Z' })

function productionDestinationClient(handler) {
  let ownerActive = false
  return {
    async query(sql, params = []) {
      if (/set role skincos_clientes_owner/i.test(sql)) {
        ownerActive = true
        return { rows: [] }
      }
      if (/current_database\(\)/i.test(sql)) {
        return { rows: [{
          database_name: 'skincos_clientes_production',
          database_user: ownerActive ? 'skincos_clientes_owner' : 'skincos_clientes_migrator_login',
          session_user: 'skincos_clientes_migrator_login',
          read_only: 'off',
        }] }
      }
      return handler(sql, params)
    },
    release() {},
  }
}

function readyBaseline() {
  const source = createAtendimentoConfirmedProjectionBaselineV2Source({
    owner: 'atendimento',
    scope: 'confirmed-unit-memberships/v5',
    baselineKeyId: 'crm-staging-atendimento-confirmed-baseline-v2-1',
    deltaKeyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist: ['jardins'],
  })
  const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows: [SOURCE_ROW], capturedAt: '2026-09-14T12:01:00.000Z', watermark: 0 })
  const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({ rows: [SOURCE_ROW], capturedAt: snapshot.capturedAt, hmacKey: HMAC_KEY, keyId: source.baselineKeyId, target: TARGET })
  const backfill = createAtendimentoConfirmedProjectionBaselineV2Backfill({
    batches: [{ batchId: packet.batchId, batchDigest: digestAtendimentoConfirmedProjectionBaselineV2Batch(packet), capturedAt: packet.sourceSnapshot.capturedAt, cursorDigest: packet.sourceSnapshot.cursorDigest, fromOrdinal: 1, toOrdinal: 1, rowCount: 1, unitSlugs: packet.sourceSnapshot.unitSlugs, eventCount: 1 }],
    rowCount: 1,
    unitSlugs: ['jardins'],
  })
  const prepared = createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: TARGET, source, snapshot, backfill })
  const accepted = acceptAtendimentoConfirmedProjectionBaselineV2(prepared, [{
    contractVersion: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
    status: 'accepted',
    batchId: packet.batchId,
    eventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  }])
  const baseline = markAtendimentoConfirmedProjectionBaselineV2Ready(accepted, {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
    status: 'verified',
    manifestDigest: accepted.backfill.manifestDigest,
    membershipDigest: accepted.snapshot.membershipDigest,
    watermark: 0,
    verifiedBatchCount: 1,
    verifiedEventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  })
  return { baseline, packets: [packet] }
}

function storedHandoff({ baseline, packets }) {
  return {
    handoff_key: CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY,
    state: baseline.state,
    source_profile_json: JSON.stringify(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE),
    source_profile_digest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    baseline_digest: digestAtendimentoConfirmedProjectionBaselineV2(baseline),
    baseline_json: JSON.stringify(baseline),
    baseline_packets_json: JSON.stringify(packets),
    readback_membership_digest: baseline.readback?.membershipDigest ?? null,
    readback_watermark: baseline.readback?.watermark ?? null,
  }
}

test('pins the shared v5 CTE and only the four isolated Atendimento relations', () => {
  const plan = confirmedProjectionDeltaV2MigrationPlan()
  assert.deepEqual(plan.sourceRelationAllowlist, ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS)
  assert.equal(plan.sourceSemantics, 'atendimento/crm-core/confirmed-unit-membership-source/v5')
  assert.match(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL, /canonical_memberships/i)
  assert.match(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL, /attendance_link\.status = 'confirmed'/i)
  assert.equal(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL.startsWith(ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE), true)
  assert.doesNotMatch(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL, /(?:global_client|crm_caixa|sale|registration|supplemental_lead)/i)
  assert.equal(plan.stateIdentityRelation, 'crm_atendimento.crm_core_identities')
})

test('keeps the additive SQL companion aligned with the v5 profile and isolated identity FK', async () => {
  const sqlPath = fileURLToPath(new URL('../migrations/20260914_atendimento_crm_core_confirmed_projection_delta_v2.up.sql', import.meta.url))
  const sql = await readFile(sqlPath, 'utf8')
  assert.match(sql, /crm_core_confirmed_projection_delta_v2_outbox/i)
  assert.match(sql, /references crm_atendimento\.crm_core_identities\(id\)/i)
  assert.match(sql, new RegExp(digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(), 'i'))
  assert.doesNotMatch(sql, /references crm_atendimento\.global_client_identities\(id\)/i)
})

test('applies only additive state plus read-only exporter grants in a guarded production-source transaction', async () => {
  const calls = []
  const client = productionDestinationClient(async (sql, params) => {
    calls.push({ sql, params })
    if (/to_regclass/i.test(sql)) return { rows: [{ relation_0: true, relation_1: true, relation_2: true, relation_3: true, relation_4: true }] }
    return { rows: [], rowCount: 0 }
  })
  const report = await applyConfirmedProjectionDeltaV2Migration({ pool: { connect: async () => client }, databaseUrl: PRODUCTION_URL, target: 'production' })
  assert.equal(report.applied, true)
  assert.equal(report.runtimeRole, 'crm_core_projection_exporter')
  assert.equal(report.appendOnly, true)
  assert.ok(calls.some(({ sql }) => new RegExp(`create table if not exists ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION.replace('.', '\\.')}\\b`, 'i').test(sql)))
  assert.ok(calls.some(({ sql }) => new RegExp(`create table if not exists ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION.replace('.', '\\.')}\\b`, 'i').test(sql)))
  assert.ok(calls.some(({ sql }) => /grant select .*crm_core_confirmed_projection_delta_v2_outbox to crm_core_projection_exporter/i.test(sql)))
  assert.equal(calls.some(({ sql }) => /grant (?:insert|update|delete|all)/i.test(sql)), false)
})

test('refuses an unadmitted new unit before writing membership or outbox state', async () => {
  const { baseline, packets } = readyBaseline()
  const calls = []
  const client = productionDestinationClient(async (sql, params) => {
    calls.push({ sql, params })
    if (new RegExp(`from ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION.replace('.', '\\.')}`, 'i').test(sql)) return { rows: [storedHandoff({ baseline, packets })] }
    if (/confirmed_projection_delta_v2_source/i.test(sql)) return { rows: [{ ...SOURCE_ROW, unit_slug: 'pinheiros' }] }
    if (new RegExp(`from ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION.replace('.', '\\.')}`, 'i').test(sql)) return { rows: [] }
    return { rows: [], rowCount: 0 }
  })
  await assert.rejects(
    () => reconcileConfirmedProjectionDeltaV2({ pool: { connect: async () => client }, databaseUrl: PRODUCTION_URL, target: 'production' }),
    /UNIT_SCOPE_UNADMITTED/,
  )
  assert.equal(calls.some(({ sql }) => new RegExp(`insert into ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION.replace('.', '\\.')}`, 'i').test(sql)), false)
})
