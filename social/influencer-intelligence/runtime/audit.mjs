import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function safeScalar(value, max = 160) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  return String(value).replace(/[\r\n\t]/g, ' ').slice(0, max);
}

export function redactAuditEvent(input = {}) {
  return Object.freeze({
    event_version: 'influencer-intelligence/runtime-audit/v1',
    request_id: safeScalar(input.request_id, 120),
    operation: safeScalar(input.operation, 80),
    caller: safeScalar(input.caller, 40),
    actor_scope: safeScalar(input.actor_scope, 160),
    grant: input.grant ? 'module.influencer-intelligence.access' : null,
    ok: input.ok === true,
    error_code: safeScalar(input.error_code, 80),
    status: safeScalar(input.status, 40),
    duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, Math.round(input.duration_ms)) : null,
    at: safeScalar(input.at, 40),
  });
}

export function createJsonlAuditSink(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('audit path is required');
  return async (event) => {
    const record = `${JSON.stringify(redactAuditEvent(event))}\n`;
    await mkdir(dirname(path), { recursive: true, mode: 0o750 });
    await appendFile(path, record, { encoding: 'utf8', mode: 0o640 });
  };
}
