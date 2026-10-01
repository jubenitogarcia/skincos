/**
 * The one advisory-lock key shared by all identity graph writers.
 *
 * It deliberately has no dependency on any identity review surface so an
 * Atendimento-only source migration can coordinate with the established graph
 * without loading, querying, or inheriting a broader-domain contract.
 */
export const IDENTITY_GRAPH_LOCK_KEY = 'crm_atendimento.identity_graph_materialization'
