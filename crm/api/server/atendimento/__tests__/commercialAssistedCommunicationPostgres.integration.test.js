import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createPgPool } from '../../harmonia/store/pg.js'
import { __testables as migrationTestables } from '../commercialAssistedCommunicationMigration.js'

const integrationUrl = String(process.env.CRM_ASSISTED_PG_TEST_DATABASE_URL || '').trim()

function allowedIntegrationTarget(value) {
    if (process.env.CRM_ASSISTED_PG_TEST_ENABLED !== '1' || !value) return false
    try {
        const url = new URL(value)
        const database = decodeURIComponent(url.pathname || '').replace(/^\//, '')
        return url.protocol === 'postgresql:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && /(?:^|[_-])test$/i.test(database)
    } catch {
        return false
    }
}

const enabled = allowedIntegrationTarget(integrationUrl)
const actor = `actor:${'a'.repeat(64)}`
const reason = `reason:${'b'.repeat(64)}`
const hash = 'c'.repeat(64)
const unitId = '11111111-1111-4111-8111-111111111111'
const offerId = '22222222-2222-4222-8222-222222222222'
const identityId = '33333333-3333-4333-8333-333333333333'
const actionId = '44444444-4444-4444-8444-444444444444'

test('PostgreSQL integration fixture binds the explicit action-context trigger without opening a database', async () => {
    const migration = await readFile(fileURLToPath(new URL('../commercialAssistedCommunicationMigration.js', import.meta.url)), 'utf8')
    assert.match(migration, /commercial_assisted_action_context_immutable/)
    assert.match(migration, /commercial_assisted_json_is_safe_v2/)
})

async function bootstrapPrerequisites(client) {
    const statements = [
        'create schema if not exists crm_atendimento', 'create schema if not exists crm_caixa', 'create schema if not exists harmonia',
        'create table if not exists crm_atendimento.schema_migrations(id text primary key, applied_at timestamptz, rolled_back_at timestamptz, details jsonb)',
        'create table if not exists crm_atendimento.units(id uuid primary key, slug text unique not null)',
        'create table if not exists crm_atendimento.global_client_identities(id uuid primary key)',
        'create table if not exists crm_atendimento.global_client_identity_members(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_actions(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_offers(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_offer_procedures(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_contact_permissions(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_contact_permission_events(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_policy_config(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_canary_cohorts(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_canary_cohort_members(id uuid primary key)',
        'create table if not exists crm_atendimento.commercial_canary_identity_validations(id uuid primary key)',
        'create table if not exists crm_atendimento.clientes_source_operation_checkpoints(id uuid primary key)',
        'create table if not exists crm_atendimento.app_client_registrations(id uuid primary key)',
        'create table if not exists crm_atendimento.supplemental_lead_profiles(id uuid primary key)',
        'create table if not exists crm_atendimento.attendance_client_links(id uuid primary key)',
        'create table if not exists crm_atendimento.attendances(id uuid primary key)',
        'create table if not exists crm_atendimento.procedures(id uuid primary key)',
        'create table if not exists harmonia.contacts(id uuid primary key)',
        'create table if not exists crm_caixa.customers(id uuid primary key)',
        'create table if not exists crm_caixa.sales(id uuid primary key)',
        'create table if not exists crm_caixa.sale_items(id uuid primary key)',
    ]
    for (const statement of statements) await client.query(statement)
}

test('PostgreSQL contract rejects direct/nested PII, preserves snapshots, serializes source locks and deduplicates STOP receipts', { skip: enabled ? false : 'set CRM_ASSISTED_PG_TEST_ENABLED=1 and a loopback *_test DATABASE_URL' }, async () => {
    const pool = createPgPool(integrationUrl)
    const client = await pool.connect()
    let second = null
    try {
        await client.query('begin')
        await bootstrapPrerequisites(client)
        for (const statement of migrationTestables.STATEMENTS) await client.query(statement)
        await client.query('insert into crm_atendimento.units(id,slug) values ($1,$2)', [unitId, 'centro'])
        await client.query('insert into crm_atendimento.commercial_offers(id) values ($1)', [offerId])
        await client.query('insert into crm_atendimento.global_client_identities(id) values ($1)', [identityId])
        await client.query('insert into crm_atendimento.commercial_actions(id) values ($1)', [actionId])
        const snapshot = await client.query(`insert into crm_atendimento.commercial_assisted_offer_snapshots(
            offer_id,offer_revision,unit_id,unit_slug,context_hash,context,captured_by)
            values ($1,1,$2,'centro',$3,$4::jsonb,$5) returning id`, [offerId, unitId, hash, JSON.stringify({ schemaVersion: 'fixture', offerId, title: 'Oferta sint?tica' }), actor])
        const snapshotId = snapshot.rows[0].id
        await assert.rejects(() => client.query('update crm_atendimento.commercial_assisted_offer_snapshots set context=$2::jsonb where id=$1', [snapshotId, JSON.stringify({ title: 'alterado' })]), /append-only/i)
        await assert.rejects(() => client.query(`insert into crm_atendimento.commercial_assisted_offer_snapshots(
            offer_id,offer_revision,unit_id,unit_slug,context_hash,context,captured_by)
            values ($1,2,$2,'centro',$3,$4::jsonb,$5)`, [offerId, unitId, 'd'.repeat(64), JSON.stringify({ safe: { phone: '000000000000' } }), actor]), /check constraint/i)
        await assert.rejects(() => client.query(`insert into crm_atendimento.commercial_assisted_templates(
            template_key,revision,unit_id,status,body_template,created_by,reason_reference,idempotency_key,request_hash)
            values ('fixture-template',1,$1,'draft','fixture@example.invalid',$2,$3,'fixture-template-key',$4)`, [unitId, actor, reason, hash]), /check constraint/i)
        await client.query(`update crm_atendimento.commercial_actions set assisted_offer_snapshot_id=$2,
            assisted_offer_context_hash=$3,assisted_offer_revision=1,assisted_offer_unit_slug='centro',
            assisted_offer_actor_ref=$4,assisted_offer_recorded_at=now() where id=$1`, [actionId, snapshotId, hash, actor])
        await assert.rejects(() => client.query(`update crm_atendimento.commercial_actions set assisted_offer_context_hash=$2 where id=$1`, [actionId, 'e'.repeat(64)]), /immutable/i)

        second = await pool.connect()
        const lockA = await client.query(`select pg_try_advisory_lock(hashtext($1),hashtext($2)) as acquired`, ['crm_atendimento.clientes_source_operations', 'consent.harmonia_opt_outs'])
        const lockB = await second.query(`select pg_try_advisory_lock(hashtext($1),hashtext($2)) as acquired`, ['crm_atendimento.clientes_source_operations', 'consent.harmonia_opt_outs'])
        assert.equal(lockA.rows[0].acquired, true)
        assert.equal(lockB.rows[0].acquired, false)
        await client.query(`select pg_advisory_unlock(hashtext($1),hashtext($2))`, ['crm_atendimento.clientes_source_operations', 'consent.harmonia_opt_outs'])

        const template = await client.query(`insert into crm_atendimento.commercial_assisted_templates(
            template_key,revision,unit_id,status,body_template,created_by,reason_reference,idempotency_key,request_hash)
            values ('fixture-safe',1,$1,'draft','Texto seguro',$2,$3,'fixture-safe-key',$4) returning id`, [unitId, actor, reason, 'f'.repeat(64)])
        const attempt = await client.query(`insert into crm_atendimento.commercial_assisted_attempts(
            actor_reference,idempotency_key,request_hash,identity_id,action_id,unit_id,offer_snapshot_id,template_id,
            offer_context_hash,template_context_hash,preview_context_hash,recipient_phone_hash,recipient_masked)
            values ($1,'fixture-attempt-key',$2,$3,$4,$5,$6,$7,$2,$2,$2,$2,'???? 0000') returning id`, [actor, hash, identityId, actionId, unitId, snapshotId, template.rows[0].id])
        const receipt = [hash, attempt.rows[0].id, 'stop', 'f'.repeat(64)]
        await client.query(`insert into crm_atendimento.commercial_assisted_webhook_receipts(event_hash,attempt_id,event_type,event_payload_hash) values ($1,$2,$3,$4)`, receipt)
        await assert.rejects(() => client.query(`insert into crm_atendimento.commercial_assisted_webhook_receipts(event_hash,attempt_id,event_type,event_payload_hash) values ($1,$2,$3,$4)`, receipt), /duplicate key/i)
    } finally {
        if (second) second.release()
        try { await client.query('rollback') } catch { /* test target may have disconnected */ }
        client.release()
        await pool.end()
    }
})
