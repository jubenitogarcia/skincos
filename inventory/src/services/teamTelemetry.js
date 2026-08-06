const EVENT_RE = /^[A-Z0-9_:-]{3,100}$/;
const OUTCOME_RE = /^[A-Z0-9_:-]{2,40}$/;

function boundedCount(value, maximum = 500) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.trunc(number))) : 0;
}
/**
 * Aggregate-only telemetry for the unified team flow.
 *
 * This helper intentionally accepts no entity id, name, email or phone. Audit
 * logs remain the source for the actor/entity trail; this table is only for
 * operational volume and outcome indicators.
 */
export async function recordTeamTelemetry({ env, eventName, actorRole, outcome = 'SUCCESS', itemCount = 0, unitCount = 0 }) {
  if (!env?.DB) return false;
  const event = String(eventName || '').trim().toUpperCase();
  const role = String(actorRole || 'UNKNOWN').trim().toUpperCase();
  const result = String(outcome || 'UNKNOWN').trim().toUpperCase();
  if (!EVENT_RE.test(event) || !OUTCOME_RE.test(result)) return false;
  try {
    await env.DB.prepare(`INSERT INTO crm_team_telemetry
      (id, event_name, actor_role, outcome, item_count, unit_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), event, role.slice(0, 40), result, boundedCount(itemCount), boundedCount(unitCount, 100), new Date().toISOString())
      .run();
    return true;
  } catch {
    // Telemetry must never turn a successful business operation into a failure.
    return false;
  }
}
