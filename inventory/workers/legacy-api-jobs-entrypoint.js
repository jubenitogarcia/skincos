import { WorkerEntrypoint } from 'cloudflare:workers';
import { normalizeLegacyApiNotificationsRefreshRequest } from '../src/legacy-api-jobs.js';
import { runNotificationsRefreshJob } from '../src/worker.js';

// This named entrypoint has no public HTTP handler. API can invoke it only
// through its Inventory service binding, with a small DTO.
export class InventoryLegacyJobsEntrypoint extends WorkerEntrypoint {
    async runNotificationsRefresh(input) {
        const job = normalizeLegacyApiNotificationsRefreshRequest(input);
        await runNotificationsRefreshJob({ env: this.env, unidade: job.unidade });
        return { ok: true, type: job.type, unidade: job.unidade };
    }
}
