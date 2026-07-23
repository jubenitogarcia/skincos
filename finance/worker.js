import { createFinanceHandler } from './api/worker.js';
import { readModuleAvailability, moduleHealthResponse, moduleUnavailableResponse } from '../shared/module-availability/worker.js';
import { verifySignedDomainContext } from '../shared/service-adapters/signed-domain-context.js';
import { dependencyState, operationalStatus } from '../shared/observability/contract.js';

const handler = createFinanceHandler();
const requestIdFor = (request) => String(request.headers.get('x-request-id') || crypto.randomUUID()).trim();
const healthPath = (path) => path === '/health' || path === '/readiness';

export async function handleFinance(request, env, ctx) {
  const requestId = requestIdFor(request);
  const availability = await readModuleAvailability(env, 'finance');
  const path = new URL(request.url).pathname;
  if (healthPath(path)) {
    const ready = Boolean(env?.DB) && availability.state === 'active';
    return new Response(JSON.stringify({ ...operationalStatus({ unit: 'finance', version: env?.APP_VERSION, environment: env?.ENVIRONMENT, ready, requestId, dependencies: { d1: dependencyState(Boolean(env?.DB)), module_control: dependencyState(Boolean(env?.MODULE_CONTROL), { required: false }) } }), availability }), { status: path === '/readiness' && !ready ? 503 : 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-module-state': availability.state, 'x-request-id': requestId } });
  }
  if (availability.state !== 'active') return moduleUnavailableResponse('finance', availability, requestId);
  const auth = await verifySignedDomainContext(request, String(env?.FINANCE_SERVICE_AUTH_SECRET || ''), 'finance');
  if (!auth) return new Response(JSON.stringify({ ok: false, error: 'SERVICE_IDENTITY_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } });
  const response = await handler(request, env, ctx, auth);
  const headers = new Headers(response.headers); headers.set('x-request-id', requestId); headers.set('x-skincos-module-state', availability.state);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default { fetch: handleFinance };
