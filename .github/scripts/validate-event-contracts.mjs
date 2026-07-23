import fs from 'node:fs';
import path from 'node:path';
import { EVENT_CONTRACT_VERSION, EVENT_TYPES } from '../../shared/events/v1.js';

const root = path.resolve(import.meta.dirname, '../..');
const catalogPath = path.join(root, 'ops/events/event-catalog.json');
const moduleCatalogPath = path.join(root, 'docs/architecture/module-catalog.json');
const errors = [];
const fail = (message) => errors.push(message);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const typePattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v1$/;

let catalog;
let modules;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  modules = new Set(JSON.parse(fs.readFileSync(moduleCatalogPath, 'utf8')).modules.map((module) => module.id));
} catch (error) {
  process.stderr.write(`Event contract validation failed: ${error.message}\n`);
  process.exit(1);
}

if (catalog.schemaVersion !== 1) fail('event catalog schemaVersion must be 1');
if (catalog.contractVersion !== EVENT_CONTRACT_VERSION) fail(`event catalog must use ${EVENT_CONTRACT_VERSION}`);
if (catalog.status !== 'foundation-disabled') fail('event infrastructure must remain foundation-disabled until a staged release is explicitly approved');
if (catalog.releaseGate?.flag !== 'EVENTS_OUTBOX_ENABLED' || catalog.releaseGate?.default !== 'false') fail('EVENTS_OUTBOX_ENABLED must remain disabled by default');
if (catalog.delivery?.guarantee !== 'at-least-once') fail('delivery guarantee must be at-least-once');
if (catalog.delivery?.maxAttempts !== 8 || JSON.stringify(catalog.delivery?.retrySeconds) !== JSON.stringify([30, 60, 120, 240, 480, 960, 1920, 3600])) fail('controlled retry schedule must be 8 bounded attempts');
if (!nonEmpty(catalog.delivery?.consumerRule) || !nonEmpty(catalog.delivery?.producerRule)) fail('catalog must state atomic producer and idempotent consumer rules');

const expectedTypes = new Set(Object.values(EVENT_TYPES));
const actualTypes = new Set();
for (const event of catalog.events ?? []) {
  if (!nonEmpty(event?.type) || !typePattern.test(event.type)) { fail(`invalid event type ${event?.type ?? '<missing>'}`); continue; }
  if (!expectedTypes.has(event.type)) fail(`event type ${event.type} is not exported by shared/events/v1.js`);
  if (actualTypes.has(event.type)) fail(`duplicate event type ${event.type}`);
  actualTypes.add(event.type);
  if (!modules.has(event.producer?.module) || !nonEmpty(event.producer?.component) || !nonEmpty(event.producer?.storage)) fail(`${event.type} must declare a known producer module, component and storage`);
  if (!Array.isArray(event.consumers) || event.consumers.length === 0 || event.consumers.some((consumer) => !modules.has(consumer?.module) || !nonEmpty(consumer?.component))) fail(`${event.type} must declare known idempotent consumer modules/components`);
  if (!nonEmpty(event.subject) || !Array.isArray(event.data) || event.data.length === 0 || event.data.some((field) => !/^[a-z][A-Za-z0-9]*$/.test(field))) fail(`${event.type} must declare a reference-only data schema`);
  if (!nonEmpty(event.fallback)) fail(`${event.type} must declare a fallback`);
}
for (const type of expectedTypes) if (!actualTypes.has(type)) fail(`shared event ${type} is missing from the catalog`);

const storageByModule = new Map();
for (const storage of catalog.storage ?? []) {
  if (!modules.has(storage?.module) || !nonEmpty(storage?.migration) || !nonEmpty(storage?.inbox) || !nonEmpty(storage?.deadLetter) || !nonEmpty(storage?.reconciliation)) {
    fail('each event storage record must name a known module, migration, inbox, DLQ and reconciliation table');
    continue;
  }
  if (storageByModule.has(storage.module)) fail(`duplicate storage record for ${storage.module}`);
  storageByModule.set(storage.module, storage);
  const migrationPath = path.join(root, storage.migration);
  if (!fs.existsSync(migrationPath)) { fail(`event migration missing: ${storage.migration}`); continue; }
  const source = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [storage.outbox, storage.inbox, storage.deadLetter, storage.reconciliation].filter(Boolean)) {
    const tableName = table.includes('.') ? table.split('.').at(-1) : table;
    if (!source.includes(tableName)) fail(`${storage.migration} does not create ${table}`);
  }
  if (/\bDROP\s+(?:TABLE|COLUMN)\b/i.test(source)) fail(`${storage.migration} must remain additive`);
}
for (const event of catalog.events ?? []) {
  const storage = storageByModule.get(event.producer?.module);
  if (!storage || storage.outbox !== event.producer.storage) fail(`${event.type} producer storage is not an approved outbox for ${event.producer?.module}`);
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`Event contract validation failed: ${error}\n`);
  process.exit(1);
}
process.stdout.write(`Event contract validation OK (${actualTypes.size} event types; delivery disabled by default).\n`);
