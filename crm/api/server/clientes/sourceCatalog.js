export const CLIENTES_SOURCE_CATALOG = Object.freeze([
    {
        id: 'atendimento.local_mirror',
        domain: 'atendimento',
        label: 'Atendimento local mirror',
        cadenceMs: 30 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'postgresql_snapshot',
        env: 'ATENDIMENTO_SOURCE_DATABASE_URL',
    },
    {
        id: 'atendimento.google_sheet',
        domain: 'atendimento',
        label: 'Atendimento Google Sheet',
        cadenceMs: 30 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'google_sheet',
        env: 'ATENDIMENTO_GOOGLE_SA_FILE',
    },
    {
        id: 'cadastro.gerencia_google_sheet',
        domain: 'cadastro',
        label: 'Gerência/roster Google Sheet',
        cadenceMs: 30 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'google_sheet',
        env: 'ATENDIMENTO_GOOGLE_SA_FILE',
    },
    {
        id: 'vendas.caixa_google_sheet',
        domain: 'vendas',
        label: 'Caixa sales Google Sheet',
        cadenceMs: 60 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'google_sheet',
        env: 'ATENDIMENTO_GOOGLE_SA_FILE',
    },
    {
        id: 'cadastro.app_registrations',
        domain: 'cadastro',
        label: 'App registration materialization',
        cadenceMs: 60 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'postgresql_aggregate',
        env: 'DATABASE_URL',
    },
    {
        id: 'leads.supplemental_google_sheet',
        domain: 'leads',
        label: 'Supplemental leads Google Sheet',
        cadenceMs: 60 * 60 * 1000,
        required: false,
        snapshotRequired: true,
        sourceKind: 'google_sheet',
        env: 'SUPPLEMENTAL_LEADS_GOOGLE_SHEET_ID',
    },
    {
        id: 'consent.harmonia_opt_outs',
        domain: 'consent',
        label: 'Harmonia opt-out state',
        cadenceMs: 5 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'postgresql_aggregate',
        env: 'DATABASE_URL',
    },
    {
        id: 'blocks.commercial_permissions',
        domain: 'blocks',
        label: 'Commercial contact blocks',
        cadenceMs: 5 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'postgresql_aggregate',
        env: 'DATABASE_URL',
    },
    {
        id: 'identity.global_graph',
        domain: 'identity',
        label: 'Global client identity graph',
        cadenceMs: 15 * 60 * 1000,
        required: true,
        snapshotRequired: true,
        sourceKind: 'postgresql_aggregate',
        env: 'DATABASE_URL',
    },
])

const byId = new Map(CLIENTES_SOURCE_CATALOG.map((source) => [source.id, source]))

export function getClientesSourceDefinition(sourceId) {
    return byId.get(String(sourceId || '').trim()) || null
}

export function sourceIds() {
    return CLIENTES_SOURCE_CATALOG.map((source) => source.id)
}
