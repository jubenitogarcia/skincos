export const IDENTITY_MATERIALIZATION_LOCK_TIMEOUT = '3s'
export const IDENTITY_MATERIALIZATION_STATEMENT_TIMEOUT = '60s'

function materializationError(code, options = {}) {
    const error = new Error(code)
    error.code = code
    if (options.retryable) {
        error.retryable = true
        error.statusCode = 409
        error.retryAfterSeconds = 3
    }
    if (options.cause) error.cause = options.cause
    return error
}

export async function configureIdentityMaterializationTimeouts(client) {
    await client.query(`set local lock_timeout = '${IDENTITY_MATERIALIZATION_LOCK_TIMEOUT}'`)
    await client.query(`set local statement_timeout = '${IDENTITY_MATERIALIZATION_STATEMENT_TIMEOUT}'`)
}

// The materializers are deliberately retryable when an operational write has
// the identity graph or a row lock.  Import schedulers can back off instead of
// queuing indefinitely behind commercial work.
export function asRecoverableIdentityMaterializationError(error) {
    if (error?.code === '55P03') {
        return materializationError('IDENTITY_MATERIALIZATION_LOCK_TIMEOUT_RETRY', { retryable: true, cause: error })
    }
    if (error?.code === '57014') {
        return materializationError('IDENTITY_MATERIALIZATION_STATEMENT_TIMEOUT_RETRY', { retryable: true, cause: error })
    }
    return error
}

function tableExists(value) {
    return value === true || value === 't' || value === 'true' || value === 1 || value === '1'
}

// Supplemental lead tables are an additive source.  A registration-only
// deployment must keep projecting its confirmed graph, but a partial lead
// schema must never be silently ignored because that could split a known
// lead-to-registration or lead-to-Caixa component.
export async function loadOptionalSupplementalLeadSources(client) {
    const availability = await client.query(`select
        to_regclass('crm_atendimento.supplemental_lead_profiles') is not null as profiles,
        to_regclass('crm_atendimento.supplemental_lead_profile_app_links') is not null as app_links,
        to_regclass('crm_atendimento.supplemental_lead_profile_caixa_links') is not null as caixa_links`)
    const tables = availability.rows[0] || {}
    const profiles = tableExists(tables.profiles)
    const appLinks = tableExists(tables.app_links)
    const caixaLinks = tableExists(tables.caixa_links)

    if (!profiles && !appLinks && !caixaLinks) {
        return { availability: 'absent', profiles: [], appLinks: [], caixaLinks: [] }
    }
    if (!profiles || !appLinks || !caixaLinks) {
        throw materializationError('IDENTITY_MATERIALIZATION_SUPPLEMENTAL_LEAD_SCHEMA_INCOMPLETE')
    }

    // A checked-out pg client serializes protocol messages. Keep these reads
    // explicit and sequential so pg 9 does not reject concurrent query calls.
    const leadProfiles = await client.query(`select source_profile_id as id,canonical_name as name from crm_atendimento.supplemental_lead_profiles`)
    const leadAppLinks = await client.query(`select source_profile_id as "profileId",app_registration_id as "registrationId",status
        from crm_atendimento.supplemental_lead_profile_app_links`)
    const leadCaixaLinks = await client.query(`select source_profile_id as "profileId",caixa_customer_id::text as "caixaCustomerId",status
        from crm_atendimento.supplemental_lead_profile_caixa_links`)
    return {
        availability: 'available',
        profiles: leadProfiles.rows,
        appLinks: leadAppLinks.rows,
        caixaLinks: leadCaixaLinks.rows,
    }
}
