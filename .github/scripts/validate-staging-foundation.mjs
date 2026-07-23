import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const foundation = path.join(root, 'platform/staging-foundation');
const inventory = JSON.parse(fs.readFileSync(path.join(foundation, 'staging-resource-inventory.json'), 'utf8'));
const expectedDomains = ['identity', 'inventory', 'finance'];
const errors = [];
const fail = (message) => errors.push(message);

if (inventory.schemaVersion !== 1) fail('inventory schemaVersion must be 1');
if (inventory.environment !== 'staging') fail('inventory must be restricted to staging');
if (inventory.defaultFeatureFlags?.module_enabled !== false) fail('module_enabled must default to false');
if (inventory.privacy?.personalDataPresent !== false) fail('inventory must declare no personal data');

const domains = inventory.cloudflare?.domains || [];
if (domains.map((domain) => domain.id).sort().join(',') !== [...expectedDomains].sort().join(',')) fail('inventory must contain exactly identity, inventory and finance');

for (const domain of domains) {
  if (!domain.owner) fail(`${domain.id} has no owner`);
  if (!domain.worker?.name || !domain.worker?.url?.startsWith('https://')) fail(`${domain.id} lacks a Worker name or HTTPS URL`);
  if ((domain.worker.routes || []).length !== 0) fail(`${domain.id} staging foundation must not mount a custom route`);
  if (!domain.d1?.id || !domain.r2?.name || !domain.kv?.id) fail(`${domain.id} must declare isolated D1, R2 and KV resources`);
  if (!domain.queue?.name || !domain.queue?.deadLetterQueue || domain.queue.maxRetries < 1) fail(`${domain.id} must declare a source queue and DLQ`);
  if (JSON.stringify(domain.secrets) !== JSON.stringify(['STAGING_CONTROL_TOKEN'])) fail(`${domain.id} may only declare the staging control secret`);

  const config = fs.readFileSync(path.join(foundation, domain.worker.config), 'utf8');
  for (const required of [domain.worker.name, domain.d1.id, domain.r2.name, domain.kv.id, domain.queue.name, domain.queue.deadLetterQueue, 'workers_dev = true']) {
    if (!config.includes(required)) fail(`${domain.id} Wrangler config is missing ${required}`);
  }
}

const fixtures = fs.readFileSync(path.join(foundation, 'fixtures.sql'), 'utf8');
if (!fixtures.includes('CHECK (contains_personal_data = 0)')) fail('fixtures must enforce non-personal test data');
if (fixtures.toLowerCase().includes('@') || fixtures.toLowerCase().includes('phone')) fail('fixtures may not contain contact data');

if (errors.length) {
  for (const error of errors) console.error(`staging foundation validation failed: ${error}`);
  process.exit(1);
}
console.log(`Staging foundation validation OK (${domains.length} isolated domains).`);
