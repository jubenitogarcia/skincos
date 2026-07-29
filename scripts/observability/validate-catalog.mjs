import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../../ops/observability/catalog.json', import.meta.url), 'utf8'));
const errors = [];
const required = ['id', 'environment', 'health', 'readiness', 'latencyBudgetMs', 'impact', 'probableCause', 'dashboard'];

if (catalog.schemaVersion !== 4) errors.push('schemaVersion must be 4');
if (catalog.primaryMonitor?.type !== 'windows-scheduled-probe') errors.push('primary monitor must remain independent from GitHub and Cloudflare');
if (!Number.isInteger(catalog.primaryMonitor?.retentionDays) || catalog.primaryMonitor.retentionDays < 7) errors.push('primary monitor must retain metrics for at least 7 days');
if (!Number.isInteger(catalog.primaryMonitor?.healthMaxAgeSeconds) || catalog.primaryMonitor.healthMaxAgeSeconds < 120) errors.push('primary monitor must define a safe stale-health threshold');
const notificationPolicy = catalog.primaryMonitor?.notificationPolicy;
if (!Number.isInteger(notificationPolicy?.alertAfterConsecutiveFailures) || notificationPolicy.alertAfterConsecutiveFailures < 2) errors.push('notification policy must require at least two consecutive failed probes');
if (!Number.isInteger(notificationPolicy?.recoverAfterConsecutiveHealthyRuns) || notificationPolicy.recoverAfterConsecutiveHealthyRuns < 2) errors.push('notification policy must require at least two consecutive healthy probes before recovery');
if (!Number.isInteger(notificationPolicy?.desktopAlertCooldownSeconds) || notificationPolicy.desktopAlertCooldownSeconds < 60) errors.push('notification policy must define a safe desktop alert cooldown');
if (!Number.isInteger(notificationPolicy?.desktopMessageTimeoutSeconds) || notificationPolicy.desktopMessageTimeoutSeconds < 10 || notificationPolicy.desktopMessageTimeoutSeconds > 120) errors.push('notification policy must define a desktop message timeout between 10 and 120 seconds');
if (notificationPolicy?.desktopNotifyRecovery !== false) errors.push('notification policy must keep desktop recovery notifications disabled');
if (!Array.isArray(catalog.units) || catalog.units.length === 0) errors.push('units must not be empty');
for (const unit of catalog.units || []) {
  for (const field of required) if (unit[field] === undefined || unit[field] === '') errors.push(`${unit.id || '<unknown>'}: missing ${field}`);
  if (!['production', 'staging'].includes(unit.environment)) errors.push(`${unit.id}: environment must be production or staging`);
  if (typeof unit.enabled !== 'boolean') errors.push(`${unit.id}: enabled must be boolean`);
  if (!unit.enabled && !unit.disabledReason) errors.push(`${unit.id}: disabled unit must explain disabledReason`);
  if (!Number.isInteger(unit.latencyBudgetMs) || unit.latencyBudgetMs < 1) errors.push(`${unit.id}: latencyBudgetMs must be positive integer`);
}
for (const journey of catalog.syntheticJourneys || []) {
  if (!journey.id || !journey.environment || typeof journey.enabled !== 'boolean') errors.push('synthetic journey is incomplete');
  if (!journey.enabled && !journey.reason) errors.push(`${journey.id}: disabled journey must state reason`);
}
if (errors.length) {
  console.error(`observability catalog validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Observability catalog validation OK (${catalog.units.length} units; ${(catalog.syntheticJourneys || []).length} synthetic journeys).`);
