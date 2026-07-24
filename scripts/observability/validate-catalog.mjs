import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../../ops/observability/catalog.json', import.meta.url), 'utf8'));
const errors = [];
const required = ['id', 'environment', 'health', 'readiness', 'latencyBudgetMs', 'impact', 'probableCause', 'dashboard'];

if (catalog.schemaVersion !== 2) errors.push('schemaVersion must be 2');
if (catalog.primaryMonitor?.type !== 'windows-scheduled-probe') errors.push('primary monitor must remain independent from GitHub and Cloudflare');
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
