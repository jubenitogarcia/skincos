import fs from 'node:fs';
const root = process.cwd();
const catalog = JSON.parse(fs.readFileSync(`${root}/ops/observability/catalog.json`, 'utf8'));
const required = ['api', 'inventory', 'finance', 'timekeeping', 'crm', 'atendimento'];
const ids = new Set(catalog.units?.map((unit) => unit.id));
const fail = (message) => { console.error(`observability catalog validation failed: ${message}`); process.exitCode = 1; };
if (catalog.externalMonitoring?.forbiddenAsPrimary?.includes('Cloudflare') !== true || catalog.externalMonitoring?.forbiddenAsPrimary?.includes('GitHub Actions') !== true) fail('external monitoring policy must not make GitHub or Cloudflare primary');
for (const id of required) { const unit = catalog.units.find((item) => item.id === id); if (!ids.has(id) || !unit?.endpoint || !unit?.readiness || !unit?.dashboard || !unit?.alert?.impact) fail(`${id} must declare endpoint, readiness, dashboard and impact`); }
if (!process.exitCode) console.log(`Observability catalog validation OK (${catalog.units.length} units).`);
