export const CLIENTES_SOURCE_JOB_CATALOG = Object.freeze([
    Object.freeze({ id: 'clientes.optouts.ingestion', type: 'source', sourceId: 'consent.harmonia_opt_outs', cadenceMs: 5 * 60 * 1000 }),
    Object.freeze({ id: 'clientes.source.refresh', type: 'source-family', cadenceMs: 5 * 60 * 1000 }),
    Object.freeze({ id: 'clientes.quality.refresh', type: 'quality', cadenceMs: 5 * 60 * 1000 }),
])
