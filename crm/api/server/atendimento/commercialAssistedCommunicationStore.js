import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { lockContactPhone } from '../contactPhoneLock.js'
import { requiredClientesSources } from '../clientes/sourceCatalog.js'
import { CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID } from '../clientes/sourceOperationsMigration.js'
import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'
import { COMMERCIAL_CANARY_LOCK_KEY, COMMERCIAL_CANARY_MIGRATION_ID } from './commercialCanaryMigration.js'
import {
    COMMERCIAL_ASSISTED_MIGRATION_ID,
    COMMERCIAL_ASSISTED_SAFETY_FLAGS,
    assertNoDirectPii,
    actorReference,
    assistedHmac,
    assistedHmacPurpose,
    canAdvanceAssistedState,
    confirmationRequired,
    maskPhone,
    normalizeIdempotencyKey,
    normalizeReason,
    normalizeTemplatePayload,
    normalizeUnit,
    normalizeUuid,
    normalizeWebhookPayload,
    offerContext,
    previewContextHash,
    renderMaskedPreview,
    verifyRawWebhookSignature,
    revealConfirmationRequired,
    templateContext,
} from './commercialAssistedCommunication.js'

const REQUIRED_SOURCE_IDS = Object.freeze(requiredClientesSources().map((source) => source.id).sort())
const SOURCE_OPERATION_LOCK_NAMESPACE = 'crm_atendimento.clientes_source_operations'
const PHONE_RE = /^\d{8,20}$/
const REARM_CONFIRMATION = 'REARMAR_CONTATO_ASSISTIDO'

function assistedError(code, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function text(value) {
    return String(value ?? '').trim()
}

function bool(value) {
    return value === true
}

function requirePool(pool) {
    if (!pool) throw assistedError('DATABASE_URL_not_configured', 503)
}

function hmacKey(configured) {
    const secret = text(configured || process.env.COMMERCIAL_ASSISTED_HMAC_KEY)
    if (Buffer.byteLength(secret, 'utf8') < 32) throw assistedError('COMMERCIAL_ASSISTED_HMAC_KEY_REQUIRED', 503)
    return secret
}

function assertCommercialManager(actor) {
    const subject = text(actor?.actorSubject)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,159}$/.test(subject)) throw assistedError('ACTOR_IDENTITY_REQUIRED', 401)
    const role = text(actor?.role).toUpperCase()
    if (role === 'GESTOR' || role === 'ADMIN' || actor?.isGlobalAdmin === true) return
    throw assistedError('FORBIDDEN', 403)
}

function unitScope(actor) {
    if (actor?.isGlobalAdmin === true || text(actor?.role).toUpperCase() === 'ADMIN') return null
    if (!Array.isArray(actor?.allowedUnits)) return []
    return [...new Set(actor.allowedUnits.map((unit) => text(unit).toLowerCase()).filter((unit) => /^[a-z0-9][a-z0-9._-]{0,119}$/.test(unit)))].sort()
}

function assertUnitScope(actor, unit) {
    const normalized = normalizeUnit(unit)
    const scope = unitScope(actor)
    if (scope !== null && (!scope.length || !scope.includes(normalized))) throw assistedError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return normalized
}

function assertGlobalScope(actor) {
    if (unitScope(actor) !== null) throw assistedError('COMMERCIAL_GLOBAL_SCOPE_REQUIRED', 403)
}

function actorRef(secret, actor) {
    try {
        return actorReference(secret, actor)
    } catch (error) {
        throw assistedError(error?.code || 'ACTOR_IDENTITY_REQUIRED', error?.statusCode || 401)
    }
}

function reasonReference(secret, reason) {
    return `reason:${assistedHmac(secret, assistedHmacPurpose('reason-v1'), { reason })}`
}

function phoneHash(secret, phone) {
    return assistedHmac(secret, assistedHmacPurpose('phone-v1'), { phone: String(phone).replace(/\D/g, '') })
}

function requestHash(secret, operation, actorReferenceValue, payload) {
    return assistedHmac(secret, assistedHmacPurpose('request-v1'), { operation, actorReference: actorReferenceValue, payload })
}

function correlationHash(secret, operation, payload) {
    return assistedHmac(secret, assistedHmacPurpose('correlation-v1'), { operation, payload })
}

function publicSafety() {
    return { ...COMMERCIAL_ASSISTED_SAFETY_FLAGS }
}

function mapAttempt(row = {}) {
    return {
        attemptId: text(row.id),
        actionId: text(row.action_id),
        status: text(row.status || 'confirmed'),
        recipientMasked: text(row.recipient_masked),
        createdAt: row.created_at || null,
        providerSend: false,
        externalDispatch: false,
        safety: publicSafety(),
    }
}

function mapTemplate(row = {}) {
    return {
        templateId: text(row.id),
        templateKey: text(row.template_key),
        revision: Number(row.revision || 0),
        unit: text(row.unit_slug),
        status: text(row.status),
        bodyTemplate: text(row.body_template),
        validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
        approvedAt: row.approved_at || null,
    }
}

function statusFromEvent(eventType) {
    if (eventType === 'destination_revealed') return 'handed_off'
    return text(eventType || 'confirmed')
}

async function appendEvent(client, { attemptId = null, eventType, actorReference: eventActor, correlation, payload = {}, occurredAt = null }) {
    assertNoDirectPii(payload, 'COMMERCIAL_ASSISTED_EVENT_PII_REJECTED')
    await client.query(`insert into crm_atendimento.commercial_assisted_events(
        attempt_id,event_type,actor_reference,correlation_hash,occurred_at,payload)
        values ($1::uuid,$2,$3,$4,$5::timestamptz,$6::jsonb)`, [
        attemptId || null,
        eventType,
        eventActor,
        correlation,
        occurredAt || new Date().toISOString(),
        JSON.stringify(payload),
    ])
}

const ASSISTED_APPEND_ONLY_TABLES = Object.freeze([
    ['commercial_assisted_offer_snapshots', 'snapshots'],
    ['commercial_assisted_templates', 'templates'],
    ['commercial_assisted_attempts', 'attempts'],
    ['commercial_assisted_events', 'events'],
    ['commercial_assisted_webhook_receipts', 'receipts'],
    ['commercial_assisted_control_mutations', 'controls'],
])

function assistedIntegrityReadinessStatement() {
    const checks = ASSISTED_APPEND_ONLY_TABLES.flatMap(([table, key]) => [
        `exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.${table}') and tgname='commercial_assisted_${table.slice('commercial_assisted_'.length)}_immutable' and tgenabled='O' and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as ${key}_immutable`,
        `exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.${table}') and tgname='commercial_assisted_${table.slice('commercial_assisted_'.length)}_no_truncate' and tgenabled='O' and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as ${key}_no_truncate`,
    ])
    checks.push(`exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_actions') and tgname='commercial_assisted_action_context_immutable' and tgenabled='O' and tgfoid=to_regprocedure('crm_atendimento.enforce_commercial_assisted_action_context_v2()')) as action_context_guard`)
    return `select ${checks.join(', ')}`
}

export async function commercialAssistedReadiness(db) {
    const result = await db.query(`select
        to_regclass('crm_atendimento.commercial_assisted_offer_snapshots') is not null as offer_snapshots,
        to_regclass('crm_atendimento.commercial_assisted_templates') is not null as templates,
        to_regclass('crm_atendimento.commercial_assisted_attempts') is not null as attempts,
        to_regclass('crm_atendimento.commercial_assisted_events') is not null as events,
        to_regclass('crm_atendimento.commercial_assisted_webhook_receipts') is not null as webhook_receipts,
        to_regclass('crm_atendimento.commercial_assisted_control_mutations') is not null as control_mutations,
        to_regclass('crm_atendimento.commercial_assisted_handoffs') is not null as handoffs,
        to_regclass('crm_atendimento.commercial_assisted_emergency_controls') is not null as emergency_controls,
        to_regclass('crm_atendimento.schema_migrations') is not null as registry,
        coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_contact_permissions'),'SELECT'),false) as permissions_read,
        coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.clientes_source_operation_checkpoints'),'SELECT'),false) as sources_read,
        coalesce(has_table_privilege(current_user,to_regclass('harmonia.contacts'),'SELECT'),false) as harmonia_read,
        coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_actions'),'SELECT'),false) as actions_read,
        coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_offers'),'SELECT'),false) as offers_read,
        (coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_canary_cohorts'),'SELECT'),false)
            and coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_canary_cohort_members'),'SELECT'),false)
            and coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_canary_identity_validations'),'SELECT'),false)) as canary_read,
        coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.global_client_identity_members'),'SELECT'),false) as identity_members_read,
        (coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.commercial_offer_procedures'),'SELECT'),false)
            and coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.procedures'),'SELECT'),false)
            and coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.attendance_client_links'),'SELECT'),false)
            and coalesce(has_table_privilege(current_user,to_regclass('crm_atendimento.attendances'),'SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sales'),'id','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sales'),'customer_id','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sales'),'unit_id','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sale_items'),'sale_id','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sale_items'),'procedure_id','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.sale_items'),'mapping_status','SELECT'),false)) as offer_dependencies_read,
        (coalesce(has_column_privilege(current_user,to_regclass('crm_caixa.customers'),'phone_key','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_atendimento.app_client_registrations'),'phone_keys','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('crm_atendimento.supplemental_lead_profiles'),'phone_keys','SELECT'),false)
            and coalesce(has_column_privilege(current_user,to_regclass('harmonia.contacts'),'phone_raw','SELECT'),false)) as phone_sources_read,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_offer_snapshots')
            and tgname='commercial_assisted_offer_snapshots_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as snapshots_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_templates')
            and tgname='commercial_assisted_templates_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as templates_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_attempts')
            and tgname='commercial_assisted_attempts_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as attempts_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_events')
            and tgname='commercial_assisted_events_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as events_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_webhook_receipts')
            and tgname='commercial_assisted_webhook_receipts_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as receipts_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_assisted_control_mutations')
            and tgname='commercial_assisted_control_mutations_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as controls_immutable`)
    const integrity = await db.query(assistedIntegrityReadinessStatement())
    const row = { ...(result.rows[0] || {}), ...(integrity.rows[0] || {}) }
    const relationsReady = ['offer_snapshots', 'templates', 'attempts', 'events', 'webhook_receipts', 'control_mutations', 'handoffs', 'emergency_controls', 'registry']
        .every((key) => bool(row[key]))
    const appendOnlyReady = ['snapshots_immutable', 'snapshots_no_truncate', 'templates_immutable', 'templates_no_truncate',
        'attempts_immutable', 'attempts_no_truncate', 'events_immutable', 'events_no_truncate',
        'receipts_immutable', 'receipts_no_truncate', 'controls_immutable', 'controls_no_truncate', 'action_context_guard'].every((key) => bool(row[key]))
    const dependenciesReady = [
        'permissions_read', 'sources_read', 'harmonia_read', 'actions_read',
        'offers_read', 'canary_read', 'identity_members_read', 'offer_dependencies_read', 'phone_sources_read',
    ].every((key) => bool(row[key]))
    let migrationReady = false
    let canaryReady = false
    let sourceOperationsReady = false
    if (relationsReady) {
        const migration = await db.query(`select id from crm_atendimento.schema_migrations
            where id=any($1::text[]) and rolled_back_at is null`, [[COMMERCIAL_ASSISTED_MIGRATION_ID, COMMERCIAL_CANARY_MIGRATION_ID, CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID]])
        const ids = new Set(migration.rows.map((entry) => String(entry.id)))
        migrationReady = ids.has(COMMERCIAL_ASSISTED_MIGRATION_ID)
        canaryReady = ids.has(COMMERCIAL_CANARY_MIGRATION_ID)
        sourceOperationsReady = ids.has(CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID)
    }
    return {
        ready: relationsReady && appendOnlyReady && dependenciesReady && migrationReady && canaryReady && sourceOperationsReady,
        migrationId: COMMERCIAL_ASSISTED_MIGRATION_ID,
        relationsReady,
        appendOnlyReady,
        dependenciesReady,
        migrationReady,
        canaryReady,
        sourceOperationsReady,
        safety: publicSafety(),
    }
}

async function assertReady(db) {
    const readiness = await commercialAssistedReadiness(db)
    if (!readiness.ready) throw assistedError('COMMERCIAL_ASSISTED_NOT_READY')
    return readiness
}

async function lockBoundary(client, identityId) {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_CANARY_LOCK_KEY])
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-assisted:${identityId}`])
}

async function readSourceHealth(client) {
    const result = await client.query(`select source_id,last_status,validated_snapshot_complete,reconciliation_required,validated_at
        from crm_atendimento.clientes_source_operation_checkpoints
        where source_id=any($1::text[]) for share`, [REQUIRED_SOURCE_IDS])
    const rows = result.rows || []
    const bySource = new Map(rows.map((row) => [String(row.source_id), row]))
    const complete = REQUIRED_SOURCE_IDS.every((sourceId) => bySource.has(sourceId))
    const healthy = complete && REQUIRED_SOURCE_IDS.every((sourceId) => {
        const row = bySource.get(sourceId) || {}
        const observedAt = row.validated_at ? new Date(row.validated_at).getTime() : 0
        return row.last_status === 'complete' && row.validated_snapshot_complete === true && row.reconciliation_required !== true &&
            Number.isFinite(observedAt) && observedAt >= Date.now() - 24 * 60 * 60 * 1000
    })
    const snapshotsComplete = complete && REQUIRED_SOURCE_IDS.every((sourceId) => bySource.get(sourceId)?.validated_snapshot_complete === true)
    return { status: healthy ? 'healthy' : 'stale', snapshotComplete: snapshotsComplete, observedSources: bySource.size }
}

async function lockAndReadSourceHealth(client) {
    for (const sourceId of REQUIRED_SOURCE_IDS) {
        const lock = await client.query(`select pg_try_advisory_xact_lock(hashtext($1),hashtext($2)) as acquired`, [SOURCE_OPERATION_LOCK_NAMESPACE, sourceId])
        if (lock.rows[0]?.acquired !== true) throw assistedError('COMMERCIAL_ASSISTED_SOURCE_OPERATION_BUSY', 503)
    }
    // The proof is read only after every source lock has been acquired.
    return readSourceHealth(client)
}

async function readEmergencyControls(client, unit) {
    const result = await client.query(`select scope_key, emergency_off, revision
        from crm_atendimento.commercial_assisted_emergency_controls
        where scope_key=any($1::text[]) for share`, [['global', `unit:${unit}`]])
    const byScope = new Map(result.rows.map((row) => [String(row.scope_key), row]))
    const global = byScope.get('global')
    if (!global) throw assistedError('COMMERCIAL_ASSISTED_EMERGENCY_CONTROL_NOT_READY')
    const scoped = byScope.get(`unit:${unit}`)
    if (global.emergency_off === true || scoped?.emergency_off === true) throw assistedError('COMMERCIAL_ASSISTED_EMERGENCY_OFF')
    return {
        globalRevision: Number(global.revision || 0),
        unitRevision: Number(scoped?.revision || 0),
    }
}

async function readAction(client, actionId) {
    // Acquire the graph boundary before the row lock. Identity review and
    // canary mutation already serialize on this key; doing it in the inverse
    // order would permit a deadlock between a revalidation and graph change.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
    const result = await client.query(`select action.id::text as id, action.identity_id::text as identity_id, action.status,
        unit.id::text as unit_id, unit.slug as unit_slug,
        action.assisted_offer_snapshot_id::text as assisted_offer_snapshot_id
        from crm_atendimento.commercial_actions action
        join crm_atendimento.units unit on unit.id=action.unit_id
        where action.id=$1::uuid for update of action`, [actionId])
    const action = result.rows[0]
    if (!action?.id || !action.unit_id || !action.unit_slug) throw assistedError('COMMERCIAL_ASSISTED_ACTION_NOT_FOUND', 404)
    if (!['open', 'contacted', 'responded', 'scheduled'].includes(String(action.status))) throw assistedError('COMMERCIAL_ASSISTED_ACTION_NOT_ACTIVE')
    return action
}

async function assertCanary(client, identityId, unit, policyVersion) {
    const result = await client.query(`select validation.validation_type, validation.revision, validation.expires_at,
            cohort.policy_version, member.source_freshness, member.eligibility_status
        from crm_atendimento.commercial_canary_cohort_members member
        join crm_atendimento.commercial_canary_cohorts cohort on cohort.id=member.cohort_id
        join crm_atendimento.commercial_canary_identity_validations validation
          on validation.identity_id=member.identity_id and validation.unit_slug=member.unit_slug
        where member.identity_id=$1::uuid and member.unit_slug=$2 and cohort.status='active'
        for share of member,cohort,validation`, [identityId, unit])
    const row = result.rows[0]
    if (!row || row.policy_version !== policyVersion || row.source_freshness !== 'healthy' || row.eligibility_status !== 'eligible' ||
        !['synthetic', 'explicit_approved'].includes(String(row.validation_type)) ||
        (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) {
        throw assistedError('COMMERCIAL_ASSISTED_CANARY_REQUIRED')
    }
    return { validationType: row.validation_type, validationRevision: Number(row.revision || 0) }
}

async function readPermission(client, identityId) {
    const result = await client.query(`select status, expires_at, revision
        from crm_atendimento.commercial_contact_permissions
        where identity_id=$1::uuid and channel='whatsapp' for share`, [identityId])
    const permission = result.rows[0]
    if (!permission || permission.status !== 'granted') throw assistedError('COMMERCIAL_ASSISTED_PERMISSION_REQUIRED')
    if (permission.expires_at && new Date(permission.expires_at).getTime() <= Date.now()) {
        throw assistedError('COMMERCIAL_ASSISTED_PERMISSION_EXPIRED')
    }
    return { revision: Number(permission.revision || 0), expiresAt: permission.expires_at || null }
}

async function correlatedPhones(client, identityId, unit) {
    const result = await client.query(`with phone_candidates as (
        select customer.phone_key::text as phone_key
          from crm_atendimento.global_client_identity_members member
          join crm_caixa.customers customer on customer.id=member.source_id::uuid
          join crm_caixa.sales sale on sale.customer_id=customer.id
          join crm_atendimento.units sale_unit on sale_unit.id=sale.unit_id
         where member.identity_id=$1::uuid and member.source_type='caixa_customer'
           and member.source_id ~ '^[0-9a-fA-F-]{36}$' and sale_unit.slug=$2
        union
        select phone.phone_key::text as phone_key
          from crm_atendimento.global_client_identity_members member
          join crm_atendimento.app_client_registrations app on app.source_client_id=member.source_id
          cross join lateral jsonb_array_elements_text(coalesce(app.phone_keys,'[]'::jsonb)) phone(phone_key)
          cross join lateral jsonb_array_elements_text(coalesce(app.unit_slugs,'[]'::jsonb)) scope(unit_slug)
         where member.identity_id=$1::uuid and member.source_type='app_registration' and scope.unit_slug=$2
        union
        select phone.phone_key::text as phone_key
          from crm_atendimento.global_client_identity_members member
          join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=member.source_id
          cross join lateral jsonb_array_elements_text(coalesce(lead.phone_keys,'[]'::jsonb)) phone(phone_key)
          cross join lateral jsonb_array_elements_text(coalesce(lead.unit_slugs,'[]'::jsonb)) scope(unit_slug)
         where member.identity_id=$1::uuid and member.source_type='lead_profile' and scope.unit_slug=$2
    ) select distinct regexp_replace(phone_key,'\\D','','g') as phone_key
      from phone_candidates where regexp_replace(phone_key,'\\D','','g') ~ '^\\d{8,20}$'`, [identityId, unit])
    const phones = [...new Set(result.rows.map((row) => text(row.phone_key).replace(/\D/g, '')).filter((phone) => PHONE_RE.test(phone)))].sort()
    if (phones.length !== 1) throw assistedError('COMMERCIAL_ASSISTED_PHONE_UNCORRELATED')
    return phones[0]
}

async function assertNoOptOut(client, phone) {
    const result = await client.query(`select opted_out_at from harmonia.contacts where phone_raw=$1 for update`, [phone])
    if (result.rows.some((row) => row.opted_out_at != null)) throw assistedError('COMMERCIAL_ASSISTED_OPT_OUT_RECORDED')
}

async function assertCooldown(client, { identityId, actionId, days }) {
    const result = await client.query(`select id from crm_atendimento.commercial_actions
        where identity_id=$1::uuid and id<>$2::uuid and contacted_at >= now()-($3::int*interval '1 day')
        order by contacted_at desc limit 1`, [identityId, actionId, days])
    if (result.rows[0]?.id) throw assistedError('COMMERCIAL_ASSISTED_COOLDOWN_ACTIVE')
}

async function readPolicy(client) {
    const result = await client.query(`select commercial_contact_writes_enabled, active_contact_cooldown_days,
        md5(concat_ws('|',active_contact_cooldown_days::text,return_risk_thresholds::text,commercial_contact_writes_enabled::text,
            commercial_contact_canary_identity_ids::text,extract(epoch from updated_at)::text)) as policy_version
        from crm_atendimento.commercial_policy_config where singleton=true for share`)
    const policy = result.rows[0]
    if (!policy || policy.commercial_contact_writes_enabled !== true) throw assistedError('COMMERCIAL_CONTACT_ROLLOUT_DISABLED')
    return { cooldownDays: Number(policy.active_contact_cooldown_days || 30), policyVersion: text(policy.policy_version) }
}

async function readOffer(client, offerId, unit, identityId) {
    const offerResult = await client.query(`select offer.*, unit.slug as unit_slug
        from crm_atendimento.commercial_offers offer
        join crm_atendimento.units unit on unit.id=offer.unit_id
        where offer.id=$1::uuid and offer.status='active' and offer.approved_by is not null and offer.approved_at is not null
          and unit.slug=$2 and (offer.validity_start is null or offer.validity_start<=current_date)
          and (offer.validity_end is null or offer.validity_end>=current_date)
        for share of offer`, [offerId, unit])
    const offer = offerResult.rows[0]
    if (!offer) throw assistedError('COMMERCIAL_ASSISTED_OFFER_UNAVAILABLE')
    const procedures = await client.query(`select procedure.id::text as id, procedure.name, offer_procedure.quantity, offer_procedure.quantity_unit
        from crm_atendimento.commercial_offer_procedures offer_procedure
        join crm_atendimento.procedures procedure on procedure.id=offer_procedure.procedure_id
        where offer_procedure.offer_id=$1::uuid order by offer_procedure.display_order,procedure.name for share of offer_procedure,procedure`, [offerId])
    const compatible = await client.query(`select exists(
        select 1 from crm_atendimento.commercial_offer_procedures offer_procedure
        where offer_procedure.offer_id=$1::uuid and (
            exists(select 1 from crm_atendimento.global_client_identity_members member
                join crm_atendimento.attendance_client_links client_link on client_link.client_id=member.source_id::uuid
                join crm_atendimento.attendances attendance on attendance.id=client_link.attendance_id
                where member.identity_id=$2::uuid and member.source_type='attendance_client'
                  and attendance.unit_id=$3::uuid and attendance.deleted_at is null
                  and attendance.procedure_id=offer_procedure.procedure_id)
            or exists(select 1 from crm_atendimento.global_client_identity_members member
                join crm_caixa.sales sale on sale.customer_id=member.source_id::uuid
                join crm_caixa.sale_items item on item.sale_id=sale.id and item.mapping_status='mapped'
                where member.identity_id=$2::uuid and member.source_type='caixa_customer'
                  and member.source_id ~ '^[0-9a-fA-F-]{36}$' and sale.unit_id=$3::uuid
                  and item.procedure_id=offer_procedure.procedure_id)
        )) as compatible`, [offerId, identityId, offer.unit_id])
    if (compatible.rows[0]?.compatible !== true) throw assistedError('COMMERCIAL_ASSISTED_OFFER_PROCEDURE_INCOMPATIBLE')
    return offerContext({ ...offer, procedures: procedures.rows })
}

async function readTemplate(client, templateId, unit) {
    const result = await client.query(`select template.*, unit.slug as unit_slug
        from crm_atendimento.commercial_assisted_templates template
        join crm_atendimento.units unit on unit.id=template.unit_id
        where template.id=$1::uuid and unit.slug=$2 and template.status='approved'
          and (template.valid_from is null or template.valid_from<=current_date)
          and (template.valid_until is null or template.valid_until>=current_date)
          and not exists(select 1 from crm_atendimento.commercial_assisted_templates newer
              where newer.template_key=template.template_key and newer.unit_id=template.unit_id and newer.revision>template.revision)
        for share of template`, [templateId, unit])
    if (!result.rows[0]) throw assistedError('COMMERCIAL_ASSISTED_TEMPLATE_UNAVAILABLE')
    return templateContext(result.rows[0])
}

async function campaignForAction(client, actionId, identityId, unitId) {
    const available = await client.query(`select to_regclass('crm_atendimento.commercial_campaign_members') as members`)
    if (!available.rows[0]?.members) return null
    const campaign = await client.query(`select campaign_id::text as campaign_id
        from crm_atendimento.commercial_campaign_members
        where action_id=$1::uuid and identity_id=$2::uuid and unit_id=$3::uuid
        order by created_at desc limit 1`, [actionId, identityId, unitId])
    return campaign.rows[0]?.campaign_id || null
}

async function buildContext(client, { actionId, offerId, templateId, actor, secret }) {
    const action = await readAction(client, actionId)
    assertUnitScope(actor, action.unit_slug)
    await lockBoundary(client, action.identity_id)
    const policy = await readPolicy(client)
    const [canary, permission, sources, emergency] = await Promise.all([
        assertCanary(client, action.identity_id, action.unit_slug, policy.policyVersion),
        readPermission(client, action.identity_id),
        lockAndReadSourceHealth(client),
        readEmergencyControls(client, action.unit_slug),
    ])
    if (sources.status !== 'healthy' || !sources.snapshotComplete) throw assistedError('COMMERCIAL_ASSISTED_SOURCES_STALE')
    const phone = await correlatedPhones(client, action.identity_id, action.unit_slug)
    const recipientPhoneHash = phoneHash(secret, phone)
    await lockContactPhone(client, phone)
    await assertNoOptOut(client, phone)
    await assertCooldown(client, { identityId: action.identity_id, actionId: action.id, days: policy.cooldownDays })
    const [offer, template, campaignId] = await Promise.all([
        readOffer(client, offerId, action.unit_slug, action.identity_id),
        readTemplate(client, templateId, action.unit_slug),
        campaignForAction(client, action.id, action.identity_id, action.unit_id),
    ])
    const previewHash = previewContextHash({
        actionId: action.id,
        identityId: action.identity_id,
        unit: action.unit_slug,
        offerContextHash: offer.contextHash,
        templateContextHash: template.contextHash,
        recipientPhoneHash,
        permissionRevision: permission.revision,
        sourceFreshness: sources.status,
        canaryValidation: `${canary.validationType}:${canary.validationRevision}`,
        policyVersion: policy.policyVersion,
        emergencyRevision: `${emergency.globalRevision}:${emergency.unitRevision}`,
    })
    return {
        action,
        policy,
        canary,
        permission,
        sources,
        emergency,
        phone,
        recipientPhoneHash,
        recipientMasked: maskPhone(phone),
        offer,
        template,
        campaignId,
        previewHash,
    }
}

async function snapshotOffer(client, { offer, action, actorReference: capturedBy }) {
    await client.query(`insert into crm_atendimento.commercial_assisted_offer_snapshots(
        offer_id,offer_revision,unit_id,unit_slug,validity_start,validity_end,context_hash,context,captured_by)
        values ($1::uuid,$2,$3::uuid,$4,$5::date,$6::date,$7,$8::jsonb,$9)
        on conflict(offer_id,offer_revision,context_hash) do nothing`, [
        offer.context.offerId,
        offer.context.revision,
        action.unit_id,
        action.unit_slug,
        offer.context.validityStart,
        offer.context.validityEnd,
        offer.contextHash,
        JSON.stringify(offer.context),
        capturedBy,
    ])
    const result = await client.query(`select id::text as id from crm_atendimento.commercial_assisted_offer_snapshots
        where offer_id=$1::uuid and offer_revision=$2 and context_hash=$3 for share`, [
        offer.context.offerId,
        offer.context.revision,
        offer.contextHash,
    ])
    if (!result.rows[0]?.id) throw assistedError('COMMERCIAL_ASSISTED_OFFER_SNAPSHOT_UNAVAILABLE')
    return result.rows[0].id
}

async function persistActionOfferContext(client, { action, snapshotId, offer, campaignId, actorReference: value }) {
    if (action.assisted_offer_snapshot_id && action.assisted_offer_snapshot_id !== snapshotId) {
        throw assistedError('COMMERCIAL_ASSISTED_ACTION_CONTEXT_CONFLICT')
    }
    await client.query(`update crm_atendimento.commercial_actions set
        assisted_offer_snapshot_id=coalesce(assisted_offer_snapshot_id,$2::uuid),
        assisted_offer_context_hash=coalesce(assisted_offer_context_hash,$3),
        assisted_offer_revision=coalesce(assisted_offer_revision,$4),
        assisted_offer_unit_slug=coalesce(assisted_offer_unit_slug,$5),
        assisted_offer_validity_end=coalesce(assisted_offer_validity_end,$6::date),
        assisted_campaign_id=coalesce(assisted_campaign_id,$7::uuid),
        assisted_offer_actor_ref=coalesce(assisted_offer_actor_ref,$8),
        assisted_offer_recorded_at=coalesce(assisted_offer_recorded_at,now())
        where id=$1::uuid`, [
        action.id,
        snapshotId,
        offer.contextHash,
        offer.context.revision,
        action.unit_slug,
        offer.context.validityEnd,
        campaignId,
        value,
    ])
}

async function priorAttempt(client, actorReferenceValue, idempotencyKey, hash) {
    const result = await client.query(`select id,action_id,status,recipient_masked,created_at,request_hash
        from crm_atendimento.commercial_assisted_attempts
        where actor_reference=$1 and idempotency_key=$2 for key share`, [actorReferenceValue, idempotencyKey])
    const row = result.rows[0]
    if (!row) return null
    if (row.request_hash !== hash) throw assistedError('COMMERCIAL_ASSISTED_IDEMPOTENCY_CONFLICT')
    return { ...mapAttempt(row), idempotent: true }
}

async function currentState(client, attemptId) {
    const result = await client.query(`select event_type from crm_atendimento.commercial_assisted_events
        where attempt_id=$1::uuid and event_type in ('confirmed','destination_revealed','delivered','read','replied','failed','stop')
        order by event_order desc limit 1 for share`, [attemptId])
    return statusFromEvent(result.rows[0]?.event_type || 'confirmed')
}

async function setSafetyStop(client, { identityId, actorReference: value, eventHash }) {
    const prior = await client.query(`select status,revision from crm_atendimento.commercial_contact_permissions
        where identity_id=$1::uuid and channel='whatsapp' for update`, [identityId])
    const previous = prior.rows[0] || {}
    if (String(previous.status || '').toLowerCase() === 'denied') return Number(previous.revision || 0)
    const persisted = await client.query(`insert into crm_atendimento.commercial_contact_permissions(
        identity_id,channel,status,evidence_source,evidence_reference,expires_at,recorded_by)
        values ($1::uuid,'whatsapp','denied','assisted_whatsapp_stop',$2,null,$3)
        on conflict(identity_id,channel) do update set status='denied', evidence_source=excluded.evidence_source,
          evidence_reference=excluded.evidence_reference, expires_at=null, recorded_by=excluded.recorded_by,
          revision=crm_atendimento.commercial_contact_permissions.revision+1, updated_at=now()
        returning revision`, [identityId, `stop:${eventHash}`, value])
    await client.query(`insert into crm_atendimento.commercial_contact_permission_events(
        identity_id,channel,previous_status,status,evidence_source,evidence_reference,expires_at,recorded_by,trace_id)
        values ($1::uuid,'whatsapp',$2,'denied','assisted_whatsapp_stop',$3,null,$4,$5::uuid)`, [
        identityId,
        previous.status || null,
        `stop:${eventHash}`,
        value,
        randomUUID(),
    ])
    return Number(persisted.rows[0]?.revision || 0)
}

export function createCommercialAssistedCommunicationStore({ pool, databaseUrl, auditHmacKey } = {}) {
    const pgPool = pool || createPgPool(databaseUrl || process.env.DATABASE_URL)
    const secret = () => hmacKey(auditHmacKey)

    return {
        async readiness(actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            return commercialAssistedReadiness(pgPool)
        },

        async availableOffers(query = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const actionId = normalizeUuid(query.actionId, 'COMMERCIAL_ASSISTED_ACTION_INVALID')
            return withPgTransaction(pgPool, async (client) => {
                const action = await readAction(client, actionId)
                assertUnitScope(actor, action.unit_slug)
                const rows = await client.query(`select offer.*, unit.slug as unit_slug
                    from crm_atendimento.commercial_offers offer
                    join crm_atendimento.units unit on unit.id=offer.unit_id
                    where unit.slug=$1 and offer.status='active' and offer.approved_by is not null and offer.approved_at is not null
                      and (offer.validity_start is null or offer.validity_start<=current_date)
                      and (offer.validity_end is null or offer.validity_end>=current_date)
                    order by offer.updated_at desc`, [action.unit_slug])
                const offers = []
                for (const row of rows.rows) {
                    try {
                        const context = await readOffer(client, row.id, action.unit_slug, action.identity_id)
                        offers.push({ ...context.context, contextHash: context.contextHash })
                    } catch (error) {
                        if (error?.code !== 'COMMERCIAL_ASSISTED_OFFER_PROCEDURE_INCOMPATIBLE') throw error
                    }
                }
                return { actionId: action.id, unit: action.unit_slug, offers, safety: publicSafety() }
            })
        },

        async listTemplates(query = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const unit = assertUnitScope(actor, query.unit)
            const result = await pgPool.query(`select template.*, unit.slug as unit_slug
                from crm_atendimento.commercial_assisted_templates template
                join crm_atendimento.units unit on unit.id=template.unit_id
                where unit.slug=$1 and template.status='approved'
                  and (template.valid_from is null or template.valid_from<=current_date)
                  and (template.valid_until is null or template.valid_until>=current_date)
                  and not exists(select 1 from crm_atendimento.commercial_assisted_templates newer
                    where newer.template_key=template.template_key and newer.unit_id=template.unit_id and newer.revision>template.revision)
                order by template.template_key,template.revision desc`, [unit])
            return { unit, templates: result.rows.map(mapTemplate), safety: publicSafety() }
        },

        async createTemplate(payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const normalized = normalizeTemplatePayload(payload)
            if (normalized.status === 'approved' && actor?.isGlobalAdmin !== true) {
                throw assistedError('COMMERCIAL_ASSISTED_TEMPLATE_APPROVAL_FORBIDDEN', 403)
            }
            const unit = assertUnitScope(actor, normalized.unit)
            const key = normalizeIdempotencyKey(payload.idempotencyKey)
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            const hash = requestHash(keySecret, 'template_create', value, { ...normalized, reason: reasonReference(keySecret, normalized.reason) })
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-assisted-template:${unit}:${normalized.templateKey}`])
                const prior = await client.query(`select id,revision,template_key,status,request_hash from crm_atendimento.commercial_assisted_templates
                    where created_by=$1 and idempotency_key=$2 for key share`, [value, key])
                if (prior.rows[0]) {
                    if (prior.rows[0].request_hash !== hash) throw assistedError('COMMERCIAL_ASSISTED_IDEMPOTENCY_CONFLICT')
                    return { template: { templateId: prior.rows[0].id, templateKey: prior.rows[0].template_key, revision: Number(prior.rows[0].revision), status: prior.rows[0].status }, idempotent: true, safety: publicSafety() }
                }
                const unitRow = await client.query(`select id::text as id from crm_atendimento.units where slug=$1 for share`, [unit])
                if (!unitRow.rows[0]?.id) throw assistedError('COMMERCIAL_ASSISTED_UNIT_NOT_FOUND', 404)
                const revision = await client.query(`select coalesce(max(revision),0)::int+1 as revision
                    from crm_atendimento.commercial_assisted_templates where unit_id=$1::uuid and template_key=$2`, [unitRow.rows[0].id, normalized.templateKey])
                const inserted = await client.query(`insert into crm_atendimento.commercial_assisted_templates(
                    template_key,revision,unit_id,status,body_template,valid_from,valid_until,approved_by,approved_at,created_by,reason_reference,idempotency_key,request_hash)
                    values ($1,$2,$3::uuid,$4,$5,$6::date,$7::date,case when $4='approved' then $8 else null end,
                      case when $4='approved' then now() else null end,$8,$9,$10,$11)
                    returning id::text as id,revision,status`, [
                    normalized.templateKey,
                    Number(revision.rows[0]?.revision || 1),
                    unitRow.rows[0].id,
                    normalized.status,
                    normalized.bodyTemplate,
                    normalized.validFrom,
                    normalized.validUntil,
                    value,
                    reasonReference(keySecret, normalized.reason),
                    key,
                    hash,
                ])
                const row = inserted.rows[0]
                await appendEvent(client, {
                    eventType: normalized.status === 'approved' ? 'template_approved' : 'template_created',
                    actorReference: value,
                    correlation: correlationHash(keySecret, 'template_create', { id: row.id, revision: row.revision }),
                    payload: { templateKey: normalized.templateKey, revision: Number(row.revision), unit, status: row.status, providerSend: false },
                })
                return { template: { templateId: row.id, templateKey: normalized.templateKey, revision: Number(row.revision), status: row.status }, idempotent: false, safety: publicSafety() }
            })
        },

        async preview(payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const actionId = normalizeUuid(payload.actionId, 'COMMERCIAL_ASSISTED_ACTION_INVALID')
            const offerId = normalizeUuid(payload.offerId, 'COMMERCIAL_ASSISTED_OFFER_INVALID')
            const templateId = normalizeUuid(payload.templateId, 'COMMERCIAL_ASSISTED_TEMPLATE_INVALID')
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            try {
                return await withPgTransaction(pgPool, async (client) => {
                    const context = await buildContext(client, { actionId, offerId, templateId, actor, secret: keySecret })
                    await appendEvent(client, {
                        eventType: 'previewed',
                        actorReference: value,
                        correlation: correlationHash(keySecret, 'preview', { actionId, offerId, templateId, previewHash: context.previewHash }),
                        payload: { actionId, offerId, templateId, unit: context.action.unit_slug, recipientMasked: context.recipientMasked, providerSend: false },
                    })
                    return {
                        eligible: true,
                        previewContextHash: context.previewHash,
                        actionId,
                        unit: context.action.unit_slug,
                        recipientMasked: context.recipientMasked,
                        offer: { ...context.offer.context, contextHash: context.offer.contextHash },
                        template: { templateId, templateKey: context.template.context.templateKey, revision: context.template.context.revision },
                        messagePreview: renderMaskedPreview(context.template.context, context.offer.context),
                        sourceFreshness: context.sources.status,
                        snapshotComplete: context.sources.snapshotComplete,
                        permissionExpiresAt: context.permission.expiresAt,
                        canaryValidation: context.canary.validationType,
                        safety: publicSafety(),
                    }
                })
            } catch (error) {
                if (Number(error?.statusCode) && Number(error.statusCode) < 500) {
                    return { eligible: false, blockReason: error.code || error.message, providerSend: false, externalDispatch: false, safety: publicSafety() }
                }
                throw error
            }
        },

        async confirm(payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            confirmationRequired(payload.confirmation)
            const actionId = normalizeUuid(payload.actionId, 'COMMERCIAL_ASSISTED_ACTION_INVALID')
            const offerId = normalizeUuid(payload.offerId, 'COMMERCIAL_ASSISTED_OFFER_INVALID')
            const templateId = normalizeUuid(payload.templateId, 'COMMERCIAL_ASSISTED_TEMPLATE_INVALID')
            const previewHash = text(payload.previewContextHash)
            if (!/^[a-f0-9]{64}$/.test(previewHash)) throw assistedError('COMMERCIAL_ASSISTED_PREVIEW_CONTEXT_INVALID', 400)
            const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey)
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            const hash = requestHash(keySecret, 'confirm', value, { actionId, offerId, templateId, previewHash })
            return withPgTransaction(pgPool, async (client) => {
                const action = await readAction(client, actionId)
                await lockBoundary(client, action.identity_id)
                const prior = await priorAttempt(client, value, idempotencyKey, hash)
                if (prior) return prior
                const context = await buildContext(client, { actionId, offerId, templateId, actor, secret: keySecret })
                if (context.previewHash !== previewHash) throw assistedError('COMMERCIAL_ASSISTED_PREVIEW_STALE')
                const snapshotId = await snapshotOffer(client, { offer: context.offer, action: context.action, actorReference: value })
                await persistActionOfferContext(client, { action: context.action, snapshotId, offer: context.offer, campaignId: context.campaignId, actorReference: value })
                const inserted = await client.query(`insert into crm_atendimento.commercial_assisted_attempts(
                    actor_reference,idempotency_key,request_hash,identity_id,action_id,unit_id,offer_snapshot_id,template_id,
                    offer_context_hash,template_context_hash,preview_context_hash,recipient_phone_hash,recipient_masked,campaign_id,provider_send,external_dispatch)
                    values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11,$12,$13,$14::uuid,false,false)
                    returning id,action_id,status,recipient_masked,created_at`, [
                    value,
                    idempotencyKey,
                    hash,
                    context.action.identity_id,
                    context.action.id,
                    context.action.unit_id,
                    snapshotId,
                    context.template.context.templateId,
                    context.offer.contextHash,
                    context.template.contextHash,
                    previewHash,
                    context.recipientPhoneHash,
                    context.recipientMasked,
                    context.campaignId,
                ])
                const attempt = inserted.rows[0]
                await appendEvent(client, {
                    attemptId: attempt.id,
                    eventType: 'confirmed',
                    actorReference: value,
                    correlation: correlationHash(keySecret, 'confirm', { attemptId: attempt.id, hash }),
                    payload: {
                        actionId,
                        offerContextHash: context.offer.contextHash,
                        templateContextHash: context.template.contextHash,
                        unit: context.action.unit_slug,
                        campaignPresent: !!context.campaignId,
                        permissionRevision: context.permission.revision,
                        sourceFreshness: context.sources.status,
                        snapshotComplete: context.sources.snapshotComplete,
                        providerSend: false,
                        externalDispatch: false,
                    },
                })
                return { ...mapAttempt(attempt), idempotent: false, humanConfirmed: true, dispatchResult: 'not_dispatched', safety: publicSafety() }
            })
        },

        async issueHandoff(payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            confirmationRequired(payload.confirmation)
            const attemptId = normalizeUuid(payload.attemptId, 'COMMERCIAL_ASSISTED_ATTEMPT_INVALID')
            const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey)
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            const hash = requestHash(keySecret, 'handoff_issue', value, { attemptId })
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
                const attemptResult = await client.query(`select attempt.id::text as id,attempt.action_id::text as action_id,
                    attempt.identity_id::text as identity_id,offer_snapshot.offer_id::text as offer_id,attempt.template_id::text as template_id
                    from crm_atendimento.commercial_assisted_attempts attempt
                    join crm_atendimento.commercial_assisted_offer_snapshots offer_snapshot on offer_snapshot.id=attempt.offer_snapshot_id
                    where attempt.id=$1::uuid and attempt.actor_reference=$2 for update of attempt for share of offer_snapshot`, [attemptId, value])
                const attempt = attemptResult.rows[0]
                if (!attempt) throw assistedError('COMMERCIAL_ASSISTED_ATTEMPT_NOT_FOUND', 404)
                const context = await buildContext(client, { actionId: attempt.action_id, offerId: attempt.offer_id, templateId: attempt.template_id, actor, secret: keySecret })
                const existing = await client.query(`select id::text as id,state,attempt_id::text as attempt_id,issue_request_hash from crm_atendimento.commercial_assisted_handoffs
                    where actor_reference=$1 and issue_idempotency_key=$2 for key share`, [value, idempotencyKey])
                if (existing.rows[0]) {
                    if (existing.rows[0].issue_request_hash !== hash || existing.rows[0].attempt_id !== attemptId) {
                        throw assistedError('COMMERCIAL_ASSISTED_IDEMPOTENCY_CONFLICT')
                    }
                    return { attemptId, handoffAlreadyIssued: true, providerSend: false, externalDispatch: false, safety: publicSafety() }
                }
                if (await currentState(client, attemptId) !== 'confirmed') throw assistedError('COMMERCIAL_ASSISTED_HANDOFF_UNAVAILABLE')
                const active = await client.query(`select id::text as id from crm_atendimento.commercial_assisted_handoffs
                    where attempt_id=$1::uuid and actor_reference=$2 and state='issued' and expires_at>now() for update`, [attemptId, value])
                if (active.rows[0]?.id) throw assistedError('COMMERCIAL_ASSISTED_HANDOFF_ALREADY_ACTIVE')
                const token = randomBytes(32).toString('base64url')
                const tokenHash = assistedHmac(keySecret, assistedHmacPurpose('handoff-token-v1'), { token })
                const handoff = await client.query(`insert into crm_atendimento.commercial_assisted_handoffs(
                    attempt_id,actor_reference,issue_idempotency_key,issue_request_hash,token_hash,expires_at)
                    values ($1::uuid,$2,$3,$4,$5,now()+interval '5 minutes') returning id::text as id,expires_at`, [
                    attemptId,
                    value,
                    idempotencyKey,
                    hash,
                    tokenHash,
                ])
                await appendEvent(client, {
                    attemptId,
                    eventType: 'handoff_issued',
                    actorReference: value,
                    correlation: correlationHash(keySecret, 'handoff_issue', { attemptId, handoffId: handoff.rows[0]?.id, previewHash: context.previewHash }),
                    payload: { expiresAt: handoff.rows[0]?.expires_at || null, providerSend: false, externalDispatch: false },
                })
                return {
                    attemptId,
                    handoffToken: token,
                    expiresAt: handoff.rows[0]?.expires_at || null,
                    destinationMasked: context.recipientMasked,
                    providerSend: false,
                    externalDispatch: false,
                    safety: publicSafety(),
                }
            })
        },

        async revealHandoff(token, payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            revealConfirmationRequired(payload.confirmation)
            normalizeReason(payload.reason, 'COMMERCIAL_ASSISTED_REVEAL_REASON_INVALID')
            const suppliedToken = text(token)
            if (!/^[A-Za-z0-9_-]{32,128}$/.test(suppliedToken)) throw assistedError('COMMERCIAL_ASSISTED_HANDOFF_TOKEN_INVALID', 400)
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            const tokenHash = assistedHmac(keySecret, assistedHmacPurpose('handoff-token-v1'), { token: suppliedToken })
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
                const handoffResult = await client.query(`select handoff.id::text as handoff_id,handoff.attempt_id::text as attempt_id,handoff.state,handoff.expires_at,
                    attempt.action_id::text as action_id,attempt.identity_id::text as identity_id,attempt.recipient_phone_hash,
                    offer_snapshot.offer_id::text as offer_id,attempt.template_id::text as template_id
                    from crm_atendimento.commercial_assisted_handoffs handoff
                    join crm_atendimento.commercial_assisted_attempts attempt on attempt.id=handoff.attempt_id
                    join crm_atendimento.commercial_assisted_offer_snapshots offer_snapshot on offer_snapshot.id=attempt.offer_snapshot_id
                    where handoff.token_hash=$1 and handoff.actor_reference=$2 for update of handoff,attempt for share of offer_snapshot`, [tokenHash, value])
                const handoff = handoffResult.rows[0]
                if (!handoff || handoff.state !== 'issued' || new Date(handoff.expires_at).getTime() <= Date.now()) {
                    throw assistedError('COMMERCIAL_ASSISTED_HANDOFF_UNAVAILABLE')
                }
                const context = await buildContext(client, { actionId: handoff.action_id, offerId: handoff.offer_id, templateId: handoff.template_id, actor, secret: keySecret })
                if (context.recipientPhoneHash !== handoff.recipient_phone_hash) throw assistedError('COMMERCIAL_ASSISTED_PHONE_CHANGED')
                await client.query(`update crm_atendimento.commercial_assisted_handoffs
                    set state='revealed', consumed_at=now(), consumed_by=$2 where id=$1::uuid and state='issued'`, [handoff.handoff_id, value])
                await appendEvent(client, {
                    attemptId: handoff.attempt_id,
                    eventType: 'destination_revealed',
                    actorReference: value,
                    correlation: correlationHash(keySecret, 'handoff_reveal', { attemptId: handoff.attempt_id, handoffId: handoff.handoff_id }),
                    payload: { reasonReference: reasonReference(keySecret, text(payload.reason)), providerSend: false, externalDispatch: false },
                })
                // This is the only PII-bearing response in the feature. It is a
                // direct, one-time POST response after RBAC, literal confirmation
                // and an append-only reveal event; no URL, log or persisted field
                // receives the phone number.
                return { attemptId: handoff.attempt_id, destination: context.phone, destinationMasked: context.recipientMasked, providerSend: false, externalDispatch: false, safety: publicSafety() }
            })
        },

        async emergencyControls(query = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const scope = text(query.unit)
            if (scope) assertUnitScope(actor, scope)
            else assertGlobalScope(actor)
            const keys = scope ? ['global', `unit:${normalizeUnit(scope)}`] : ['global']
            const controls = await pgPool.query(`select scope_key,unit_slug,emergency_off,revision,updated_at
                from crm_atendimento.commercial_assisted_emergency_controls where scope_key=any($1::text[]) order by scope_key`, [keys])
            const projected = controls.rows.map((row) => ({ scope: row.scope_key, unit: row.unit_slug || null, emergencyOff: row.emergency_off === true, revision: Number(row.revision || 0), updatedAt: row.updated_at || null }))
            if (scope && !projected.some((control) => control.scope === `unit:${normalizeUnit(scope)}`)) {
                // Unit controls are opt-in rows. Expose their conservative
                // virtual starting revision without turning a GET into a write.
                projected.push({ scope: `unit:${normalizeUnit(scope)}`, unit: normalizeUnit(scope), emergencyOff: false, revision: 1, updatedAt: null })
            }
            return { controls: projected, safety: publicSafety() }
        },

        async setEmergencyControl(payload = {}, actor) {
            requirePool(pgPool)
            assertCommercialManager(actor)
            await assertReady(pgPool)
            const emergencyOff = payload.emergencyOff === true
            const unit = text(payload.unit)
            if (unit) assertUnitScope(actor, unit)
            else assertGlobalScope(actor)
            if (!emergencyOff && text(payload.confirmation) !== REARM_CONFIRMATION) throw assistedError('COMMERCIAL_ASSISTED_REARM_CONFIRMATION_REQUIRED', 409)
            const expectedRevision = Number(payload.expectedRevision)
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw assistedError('COMMERCIAL_ASSISTED_EMERGENCY_VERSION_REQUIRED', 409)
            const reason = normalizeReason(payload.reason, 'COMMERCIAL_ASSISTED_EMERGENCY_REASON_INVALID')
            const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey)
            const scopeKey = unit ? `unit:${normalizeUnit(unit)}` : 'global'
            const keySecret = secret()
            const value = actorRef(keySecret, actor)
            const hash = requestHash(keySecret, 'emergency_control', value, { scopeKey, emergencyOff, expectedRevision, reason: reasonReference(keySecret, reason) })
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-assisted-emergency:${scopeKey}`])
                const prior = await client.query(`select resulting_revision,emergency_off,request_hash
                    from crm_atendimento.commercial_assisted_control_mutations
                    where actor_reference=$1 and idempotency_key=$2 for key share`, [value, idempotencyKey])
                if (prior.rows[0]) {
                    if (prior.rows[0].request_hash !== hash) throw assistedError('COMMERCIAL_ASSISTED_IDEMPOTENCY_CONFLICT')
                    const current = await client.query(`select updated_at from crm_atendimento.commercial_assisted_emergency_controls where scope_key=$1 for share`, [scopeKey])
                    return { scope: scopeKey, emergencyOff: prior.rows[0].emergency_off === true, revision: Number(prior.rows[0].resulting_revision), updatedAt: current.rows[0]?.updated_at || null, idempotent: true, providerSend: false, externalDispatch: false, safety: publicSafety() }
                }
                if (unit) {
                    await client.query(`insert into crm_atendimento.commercial_assisted_emergency_controls(
                        scope_key,unit_slug,emergency_off,reason_reference,updated_by)
                        values ($1,$2,false,$3,$4) on conflict(scope_key) do nothing`, [
                        scopeKey,
                        normalizeUnit(unit),
                        reasonReference(keySecret, reason),
                        value,
                    ])
                }
                const current = await client.query(`select revision from crm_atendimento.commercial_assisted_emergency_controls where scope_key=$1 for update`, [scopeKey])
                const revision = Number(current.rows[0]?.revision || 0)
                if (revision !== expectedRevision) throw assistedError('COMMERCIAL_ASSISTED_EMERGENCY_CONFLICT')
                const updated = await client.query(`update crm_atendimento.commercial_assisted_emergency_controls
                    set emergency_off=$2,revision=revision+1,reason_reference=$3,updated_by=$4,updated_at=now()
                    where scope_key=$1 returning revision,updated_at`, [scopeKey, emergencyOff, reasonReference(keySecret, reason), value])
                await client.query(`insert into crm_atendimento.commercial_assisted_control_mutations(
                    scope_key,actor_reference,idempotency_key,request_hash,resulting_revision,emergency_off)
                    values ($1,$2,$3,$4,$5,$6)`, [
                    scopeKey,
                    value,
                    idempotencyKey,
                    hash,
                    Number(updated.rows[0]?.revision || 0),
                    emergencyOff,
                ])
                await appendEvent(client, {
                    eventType: emergencyOff ? 'emergency_off' : 'emergency_rearmed',
                    actorReference: value,
                    correlation: correlationHash(keySecret, 'emergency_control', { scopeKey, idempotencyKey, hash }),
                    payload: { scope: scopeKey, emergencyOff, providerSend: false, externalDispatch: false },
                })
                return { scope: scopeKey, emergencyOff, revision: Number(updated.rows[0]?.revision || 0), updatedAt: updated.rows[0]?.updated_at || null, idempotent: false, providerSend: false, externalDispatch: false, safety: publicSafety() }
            })
        },

        async processWebhook(input = {}) {
            requirePool(pgPool)
            await assertReady(pgPool)
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_INPUT_INVALID', 400)
            const allowed = new Set(['rawBody', 'timestamp', 'signature'])
            if (Object.keys(input).some((key) => !allowed.has(key))) throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_INPUT_INVALID', 400)
            const rawBody = input.rawBody
            const keySecret = secret()
            if (!verifyRawWebhookSignature({ rawBody, timestamp: input.timestamp, signature: input.signature, secret: keySecret })) {
                throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_SIGNATURE_INVALID', 401)
            }
            let event
            try { event = normalizeWebhookPayload(JSON.parse(rawBody.toString('utf8'))) } catch (error) {
                if (error?.code) throw error
                throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_PAYLOAD_INVALID', 400)
            }
            const service = 'service:commercial-assisted-webhook'
            const eventHash = assistedHmac(keySecret, assistedHmacPurpose('webhook-event-v1'), { eventId: event.eventId })
            const eventPayloadHash = createHash('sha256').update(rawBody).digest('hex')
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
                const receipt = await client.query(`insert into crm_atendimento.commercial_assisted_webhook_receipts(event_hash,attempt_id,event_type,event_payload_hash)
                    values ($1,$2::uuid,$3,$4) on conflict(event_hash) do nothing returning event_hash`, [eventHash, event.attemptId, event.eventType, eventPayloadHash])
                if (!receipt.rows[0]?.event_hash) {
                    const prior = await client.query(`select attempt_id::text as attempt_id,event_type,event_payload_hash
                        from crm_atendimento.commercial_assisted_webhook_receipts where event_hash=$1 for share`, [eventHash])
                    const saved = prior.rows[0]
                    if (!saved || saved.attempt_id !== event.attemptId || saved.event_type !== event.eventType || saved.event_payload_hash !== eventPayloadHash) throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_REPLAY_CONFLICT')
                    return { accepted: true, deduplicated: true, providerSend: false, externalDispatch: false, safety: publicSafety() }
                }
                const attempt = await client.query(`select attempt.id::text as id,attempt.identity_id::text as identity_id,attempt.action_id::text as action_id,
                    unit.slug as unit_slug, offer_snapshot.offer_id::text as offer_id,attempt.template_id::text as template_id
                    from crm_atendimento.commercial_assisted_attempts attempt
                    join crm_atendimento.units unit on unit.id=attempt.unit_id
                    join crm_atendimento.commercial_assisted_offer_snapshots offer_snapshot on offer_snapshot.id=attempt.offer_snapshot_id
                    where attempt.id=$1::uuid for update of attempt for share of offer_snapshot`, [event.attemptId])
                const row = attempt.rows[0]
                if (!row) throw assistedError('COMMERCIAL_ASSISTED_ATTEMPT_NOT_FOUND', 404)
                const current = await currentState(client, row.id)
                if (!canAdvanceAssistedState(current, event.eventType)) throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_TRANSITION_INVALID')
                if (event.eventType !== 'stop' && current === 'confirmed') throw assistedError('COMMERCIAL_ASSISTED_WEBHOOK_HANDOFF_REQUIRED')
                let permissionRevision = null
                if (event.eventType === 'stop') {
                    try {
                        const phone = await correlatedPhones(client, row.identity_id, row.unit_slug)
                        await lockContactPhone(client, phone)
                    } catch (error) {
                        if (error?.code !== 'COMMERCIAL_ASSISTED_PHONE_UNCORRELATED') throw error
                    }
                    await lockBoundary(client, row.identity_id)
                    permissionRevision = await setSafetyStop(client, { identityId: row.identity_id, actorReference: service, eventHash })
                }
                await appendEvent(client, { attemptId: row.id, eventType: event.eventType, actorReference: service, correlation: eventHash,
                    occurredAt: event.occurredAt, payload: { source: 'signed_webhook', eventHash, eventPayloadHash, stopApplied: event.eventType === 'stop', permissionRevision, providerSend: false, externalDispatch: false } })
                return { accepted: true, deduplicated: false, eventType: event.eventType, stopApplied: event.eventType === 'stop', providerSend: false, externalDispatch: false, safety: publicSafety() }
            })
        },
    }
}

export const __testables = {
    REQUIRED_SOURCE_IDS,
    REARM_CONFIRMATION,
    actorRef,
    campaignForAction,
    lockAndReadSourceHealth,
    correlatedPhones,
    mapAttempt,
    phoneHash,
    publicSafety,
    requestHash,
    SOURCE_OPERATION_LOCK_NAMESPACE,
    statusFromEvent,
    unitScope,
}
