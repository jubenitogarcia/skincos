import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'ops/chaos/controlled-chaos.json'), 'utf8'));
const register = JSON.parse(fs.readFileSync(path.join(root, 'ops/chaos/interference-register.json'), 'utf8'));
const expected = ['Identity', 'Inventory', 'Finance', 'PostgreSQL', 'D1', 'Queues', 'WhatsApp', 'External integrations', 'Cloudflare bindings'];
const errors = []; const fail = (message) => errors.push(message);

if (suite.schemaVersion !== 1 || suite.mode !== 'local-in-memory-only') fail('controlled chaos suite must remain schema v1 and local-in-memory-only');
if (!Array.isArray(suite.safety) || suite.safety.length < 3) fail('controlled chaos suite lacks safety controls');
const dependencies = new Set((suite.scenarios ?? []).map((item) => item.dependency));
for (const dependency of expected) if (!dependencies.has(dependency)) fail(`missing chaos scenario for ${dependency}`);
for (const scenario of suite.scenarios ?? []) {
  for (const field of ['id', 'dependency', 'affectedFlow', 'controlFlow', 'expected']) {
    const minimum = field === 'dependency' ? 2 : 8;
    if (typeof scenario[field] !== 'string' || scenario[field].trim().length < minimum) fail(`${scenario.id || 'unknown'} lacks ${field}`);
  }
}
if (register.schemaVersion !== 1 || !Array.isArray(register.items)) fail('interference register must be schema v1 with items');
for (const item of register.items ?? []) if (!['P0', 'P1', 'P2', 'P3'].includes(item.priority) || !['fixed', 'open', 'accepted'].includes(item.status) || typeof item.correction !== 'string') fail(`invalid interference record ${item.id || 'unknown'}`);
if (errors.length) { for (const error of errors) console.error(`controlled chaos validation failed: ${error}`); process.exit(1); }
console.log(`Controlled chaos validation OK (${suite.scenarios.length} scenarios, ${register.items.length} registered interferences).`);
