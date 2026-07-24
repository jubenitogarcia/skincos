import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const manifestPath = path.join(root, 'platform/staging/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];
const fail = (message) => errors.push(message);
const expectedDomains = ['finance', 'identity', 'inventory'];
const requiredBindings = ['DB', 'DATA_BUCKET', 'EVENT_QUEUE', 'FLAGS'];
const prohibitedKey = /(?:account|database|namespace|zone|version|deployment)_?id/i;
const prohibitedValue = /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|https?:\/\/|\.workers\.dev|skincos\.com\.br)/i;

function scan(value, location = 'manifest') {
  if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${location}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === '$schema') continue;
      if (prohibitedKey.test(key)) fail(`${location}.${key} must not contain a remote resource identifier`);
      scan(nested, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && prohibitedValue.test(value)) fail(`${location} must not contain a remote identifier or route`);
}

if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
if (manifest.environment !== 'staging') fail('environment must be staging');
if (manifest.safety?.customRoutesAllowed !== false) fail('custom routes must remain disabled');
if (manifest.safety?.productionDataAllowed !== false) fail('production data must remain prohibited');
if (manifest.safety?.defaultFeatureFlags?.module_enabled !== false) fail('module_enabled must default to false');
if (manifest.safety?.requiredApplyAcknowledgement !== 'SKINCOS_STAGING_APPLY=1') fail('apply acknowledgement must be explicit');

const domains = manifest.domains || [];
if (domains.map((domain) => domain.id).sort().join(',') !== expectedDomains.join(',')) fail('domains must be exactly finance, identity and inventory');
for (const domain of domains) {
  for (const field of ['owner', 'worker', 'd1', 'kv', 'r2', 'queue', 'deadLetterQueue']) if (!domain[field]) fail(`${domain.id}.${field} is required`);
  if (domain.queue === domain.deadLetterQueue) fail(`${domain.id} source queue and DLQ must be distinct`);
  if (domain.bindings?.slice().sort().join(',') !== requiredBindings.slice().sort().join(',')) fail(`${domain.id} must declare only the standard isolated bindings`);
  if (JSON.stringify(domain.secretNames) !== JSON.stringify(['STAGING_CONTROL_TOKEN'])) fail(`${domain.id} must declare only the secret name, never a value`);
}

for (const resource of ['worker', 'd1', 'kv', 'r2', 'queue', 'deadLetterQueue']) {
  const values = domains.map((domain) => domain[resource]);
  if (new Set(values).size !== values.length) fail(`${resource} names must be unique by domain`);
}
if ((manifest.postgresql?.domains || []).map((domain) => domain.id).sort().join(',') !== expectedDomains.join(',')) fail('PostgreSQL roles must exist for every isolated domain');

scan(manifest);
if (errors.length) {
  errors.forEach((error) => console.error(`staging manifest validation failed: ${error}`));
  process.exit(1);
}
console.log(`Staging manifest validation OK (${domains.length} isolated domains, no remote identifiers).`);
