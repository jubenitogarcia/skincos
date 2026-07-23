import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const policyPath = path.join(root, 'ops/resilience/dependency-policy.json');
const catalogPath = path.join(root, 'docs/architecture/module-catalog.json');
const errors = [];
const fail = (message) => errors.push(message);

let policy;
let catalog;
try {
  policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
} catch (error) {
  process.stderr.write(`Dependency resilience validation failed: ${error.message}\n`);
  process.exit(1);
}

if (policy.schemaVersion !== 1) fail('dependency policy schemaVersion must be 1');
for (const key of ['optionalTimeoutMs', 'failureThreshold', 'cooldownMs']) if (!Number.isSafeInteger(policy.defaults?.[key]) || policy.defaults[key] < 1) fail(`defaults.${key} must be a positive integer`);
if (typeof policy.defaults?.delivery !== 'string' || !policy.defaults.delivery.includes('pendingSynchronization=true')) fail('defaults.delivery must require a pending synchronization signal');

const modules = new Map(catalog.modules.map((module) => [module.id, module]));
for (const [id, module] of modules) {
  const configured = policy.modules?.[id];
  if (!configured) { fail(`missing resilience policy for ${id}`); continue; }
  const declaredHard = [...(module.dependencies?.hard ?? [])].sort();
  const declaredOptional = [...(module.dependencies?.optional ?? [])].sort();
  if (JSON.stringify([...(configured.hard ?? [])].sort()) !== JSON.stringify(declaredHard)) fail(`${id} hard dependencies drift from module catalog`);
  const optionalNames = Object.keys(configured.optional ?? {}).sort();
  if (JSON.stringify(optionalNames) !== JSON.stringify(declaredOptional)) fail(`${id} optional dependencies drift from module catalog`);
  for (const [dependency, behavior] of Object.entries(configured.optional ?? {})) {
    if (!['none', 'safe-read-only'].includes(behavior.cache) || typeof behavior.degraded !== 'string' || typeof behavior.pendingSynchronization !== 'string') fail(`${id} -> ${dependency} must declare safe cache, degraded response and pending synchronization`);
  }
}
for (const id of Object.keys(policy.modules ?? {})) if (!modules.has(id)) fail(`policy contains unknown module ${id}`);

if (errors.length) {
  for (const error of errors) process.stderr.write(`Dependency resilience validation failed: ${error}\n`);
  process.exit(1);
}
process.stdout.write(`Dependency resilience validation OK (${modules.size} modules classified).\n`);
