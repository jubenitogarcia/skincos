const freezeSource = (source) => Object.freeze({ ...source, requiredFor: Object.freeze([...(source.requiredFor || [])]) })

/**
 * Inventory of every source that feeds Clientes decisions.  The catalogue is
 * deliberately metadata-only: source ids, capabilities and schedules are
 * allowlisted here; connector URLs, spreadsheet ids and any customer data
 * remain in the private runtime.
 */
export const CLIENTES_SOURCE_CATALOG = Object.freeze([
    freezeSource({
        id: 'atendimento.local_mirror',
        domain: 'atendimento',
        label: 'Espelho de Atendimento',
        cadenceMs: 30 * 60_000,
        required: true,
        requiredFor: ['identity', 'atendimento'],
        kind: 'postgresql_snapshot',
        configuration: 'ATENDIMENTO_SOURCE_DATABASE_URL',
    }),
    freezeSource({
        id: 'atendimento.google_sheet',
        domain: 'atendimento',
        label: 'Planilha de Atendimento',
        cadenceMs: 30 * 60_000,
        required: true,
        requiredFor: ['identity', 'atendimento'],
        kind: 'google_sheet_snapshot',
        configuration: 'ATENDIMENTO_GOOGLE_SA_FILE',
    }),
    freezeSource({
        id: 'cadastro.gerencia_google_sheet',
        domain: 'cadastro',
        label: 'Cadastro de Gerência',
        cadenceMs: 30 * 60_000,
        required: true,
        requiredFor: ['identity', 'cadastro'],
        kind: 'google_sheet_snapshot',
        configuration: 'ATENDIMENTO_GOOGLE_SA_FILE',
    }),
    freezeSource({
        id: 'vendas.caixa_google_sheet',
        domain: 'vendas',
        label: 'Vendas de Caixa',
        cadenceMs: 60 * 60_000,
        required: true,
        requiredFor: ['sales', 'identity'],
        kind: 'google_sheet_snapshot',
        configuration: 'ATENDIMENTO_GOOGLE_SA_FILE',
    }),
    freezeSource({
        id: 'cadastro.app_registrations',
        domain: 'cadastro',
        label: 'Cadastro do aplicativo',
        cadenceMs: 60 * 60_000,
        required: true,
        requiredFor: ['identity', 'cadastro'],
        kind: 'external_connector_required',
        configuration: 'APP_REGISTRATION_SOURCE_CONNECTOR',
    }),
    freezeSource({
        id: 'leads.supplemental_google_sheet',
        domain: 'leads',
        label: 'Leads suplementares',
        cadenceMs: 60 * 60_000,
        required: false,
        requiredFor: ['identity_enrichment'],
        kind: 'external_connector_required',
        configuration: 'SUPPLEMENTAL_LEADS_SOURCE_CONNECTOR',
    }),
    freezeSource({
        id: 'consent.harmonia_opt_outs',
        domain: 'consent',
        label: 'Opt-outs do Harmonia',
        cadenceMs: 5 * 60_000,
        required: true,
        requiredFor: ['consent', 'contact_blocks'],
        kind: 'postgresql_aggregate',
        configuration: 'DATABASE_URL',
    }),
    freezeSource({
        id: 'blocks.commercial_permissions',
        domain: 'blocks',
        label: 'Permissões comerciais',
        cadenceMs: 5 * 60_000,
        required: true,
        requiredFor: ['consent', 'contact_blocks'],
        kind: 'postgresql_aggregate',
        configuration: 'DATABASE_URL',
    }),
    freezeSource({
        id: 'identity.global_graph',
        domain: 'identity',
        label: 'Grafo global de identidades',
        cadenceMs: 15 * 60_000,
        required: true,
        requiredFor: ['identity', 'commercial_eligibility'],
        kind: 'postgresql_aggregate',
        configuration: 'DATABASE_URL',
    }),
])

const sourceById = new Map(CLIENTES_SOURCE_CATALOG.map((source) => [source.id, source]))

export function getClientesSourceDefinition(sourceId) {
    return sourceById.get(String(sourceId || '').trim()) || null
}

export function clientesSourceIds() {
    return CLIENTES_SOURCE_CATALOG.map((source) => source.id)
}

export function requiredClientesSources() {
    return CLIENTES_SOURCE_CATALOG.filter((source) => source.required)
}
