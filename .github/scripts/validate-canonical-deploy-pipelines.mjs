import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'deployment', 'canonical-pipelines.json'), 'utf8'));
const publishPattern = /(?:\bwrangler\b[^\n]*(?:pages\s+)?deploy\b|cloudflare-workers\.sh\s+deploy(?:-all)?\b)/i;
let failed = false;
const fail = (message) => { failed = true; console.error(`canonical deploy pipelines: ${message}`); };
const seen = new Set();

for (const unit of manifest.units ?? []) {
  if (!unit.id || !unit.canonicalWorkflow) { fail('every unit requires id and canonicalWorkflow'); continue; }
  if (seen.has(unit.canonicalWorkflow)) fail(`canonical workflow is assigned twice: ${unit.canonicalWorkflow}`);
  seen.add(unit.canonicalWorkflow);
  const canonical = path.join(root, unit.canonicalWorkflow);
  if (!fs.existsSync(canonical)) fail(`${unit.id}: canonical workflow does not exist: ${unit.canonicalWorkflow}`);
  else {
    const source = fs.readFileSync(canonical, 'utf8');
    if (!publishPattern.test(source)) fail(`${unit.id}: canonical workflow has no deploy command`);
    if (!/concurrency:\s*[\s\S]*?group:/m.test(source)) fail(`${unit.id}: canonical workflow must declare concurrency`);
  }
  for (const relative of unit.retiredDuplicateWorkflows ?? []) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) { fail(`${unit.id}: retired workflow does not exist: ${relative}`); continue; }
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('RETIRED_DUPLICATE_DEPLOY_PIPELINE')) fail(`${unit.id}: retired workflow is not explicitly marked: ${relative}`);
    if (publishPattern.test(source)) fail(`${unit.id}: retired workflow can still publish: ${relative}`);
    if (/^\s{2}push:|^\s{2}schedule:/m.test(source)) fail(`${unit.id}: retired workflow still has an automatic trigger: ${relative}`);
  }
}
if (failed) process.exit(1);
console.log(`canonical deploy pipelines: validated ${manifest.units.length} operational units`);
