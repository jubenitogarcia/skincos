import { normalizeUnitScope } from '../../shared/identity-contract/index.js';

// Narrow, serializable contract used only by API's retained legacy JobQueue
// Durable Object.  The Inventory Worker keeps ownership of the business work.
export const LEGACY_API_NOTIFICATIONS_REFRESH = 'NOTIFICATIONS_REFRESH';
export const LEGACY_API_JOBS_RPC_CAPABILITY = 'legacy-api-jobs-rpc/v1';

export function normalizeLegacyApiNotificationsRefreshJob(job) {
    const type = String(job?.type || '').trim().toUpperCase();
    if (type !== LEGACY_API_NOTIFICATIONS_REFRESH) {
        throw new Error('LEGACY_API_JOB_TYPE_UNSUPPORTED');
    }

    const rawUnidade = job?.unidade;
    if (rawUnidade === undefined || rawUnidade === null || String(rawUnidade).trim() === '') {
        return { type, unidade: null };
    }

    if (typeof rawUnidade !== 'string') {
        throw new TypeError('LEGACY_API_JOB_UNIDADE_INVALID');
    }

    const unidade = rawUnidade.trim();
    if (unidade.length > 160) {
        throw new RangeError('LEGACY_API_JOB_UNIDADE_TOO_LONG');
    }

    const canonicalUnidade = normalizeUnitScope(unidade);
    if (!canonicalUnidade) {
        throw new Error('LEGACY_API_JOB_UNIDADE_INVALID');
    }

    return { type, unidade: canonicalUnidade };
}

export function normalizeLegacyApiNotificationsRefreshRequest(input) {
    if (input === null || Array.isArray(input) || typeof input !== 'object') {
        throw new TypeError('LEGACY_API_JOB_REQUEST_INVALID');
    }

    return normalizeLegacyApiNotificationsRefreshJob({
        type: LEGACY_API_NOTIFICATIONS_REFRESH,
        unidade: input.unidade,
    });
}
