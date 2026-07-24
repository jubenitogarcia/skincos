import { createFinanceHandler } from './api/worker.js';
import { canUseCanary, readModuleAvailability, moduleUnavailableResponse } from '../shared/module-availability/worker.js';
import { verifySignedDomainContext } from '../shared/service-adapters/signed-domain-context.js';
import { dependencyState, operationalLog, operationalStatus } from '../shared/observability/contract.js';

const handler = createFinanceHandler();
const requestIdFor = (request) => String(request.headers.get('x-request-id') || crypto.randomUUID()).trim();
const healthPath = (path) => path === '/health' || path === '/readiness';
async function d1Ready(env) {
  if (!env?.DB) return false;
  try { await env.DB.prepare('SELECT 1 AS ready').first(); return true; } catch { return false; }
}

export async function handleFinance(request, env, ctx) {
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  const version = env?.APP_VERSION || env?.VERSION_METADATA?.id || 'unreleased';
  const availability = await readModuleAvailability(env, 'finance');
  const path = new URL(request.url).pathname;
  if (healthPath(path)) {
    const d1 = await d1Ready(env);
    const ready = d1 && ['active', 'canary'].includes(availability.state);
    const status = path === '/readiness' && !ready ? 503 : 200;
    console.log(operationalLog({ domain: 'finance', version, environment: env?.ENVIRONMENT, requestId, durationMs: Date.now() - startedAt, status, route: path }));
    return new Response(JSON.stringify({ ...operationalStatus({ unit: 'finance', version, environment: env?.ENVIRONMENT, ready, requestId, dependencies: { d1: dependencyState(d1), module_control: dependencyState(Boolean(env?.MODULE_CONTROL), { required: false }) } }), availability }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-module-state': availability.state, 'x-request-id': requestId } });
  }
  if (!['active', 'canary'].includes(availability.state)) return moduleUnavailableResponse('finance', availability, requestId);
  const auth = await verifySignedDomainContext(request, String(env?.FINANCE_SERVICE_AUTH_SECRET || ''), 'finance');
  if (!auth) return new Response(JSON.stringify({ ok: false, error: 'SERVICE_IDENTITY_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } });
  if (!canUseCanary(availability, auth.actor)) return new Response(JSON.stringify({ ok: false, error: 'FINANCE_CANARY_NOT_GRANTED', module: 'finance' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-skincos-module-state': 'canary', 'x-request-id': requestId } });
  const response = await handler(request, env, ctx, auth);
  const headers = new Headers(response.headers); headers.set('x-request-id', requestId); headers.set('x-skincos-module-state', availability.state);
  console.log(operationalLog({ domain: 'finance', version, environment: env?.ENVIRONMENT, requestId, durationMs: Date.now() - startedAt, status: response.status, route: path }));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default { fetch: handleFinance };
