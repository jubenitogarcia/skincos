import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/module-catalog.json'), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'ops/module-governance/promotion-evidence.json'), 'utf8'));
const states = ['experimental', 'staging', 'pilot', 'operational', 'critical'];
const errors = []; const fail = (message) => errors.push(message);
if (catalog.schemaVersion !== 2) fail('module catalog schemaVersion must be 2');
if (JSON.stringify(catalog.maturityModel?.states) !== JSON.stringify(states)) fail('catalog must declare the official maturity states in order');
if (evidence.schemaVersion !== 2) fail('promotion evidence schemaVersion must be 2');
for (const state of states) if (!Array.isArray(evidence.criteria?.[state]) || evidence.criteria[state].length === 0) fail(`missing criteria for ${state}`);
for (const module of catalog.modules ?? []) {
  if (!states.includes(module.maturity)) { fail(`${module.id} has non-official maturity ${module.maturity}`); continue; }
  const required = evidence.criteria[module.maturity] || [];
  const record = module.maturity === 'experimental' ? evidence.defaults?.experimental : evidence.promotions?.[module.id];
  if (!record) { fail(`${module.id} at ${module.maturity} lacks reviewed promotion evidence`); continue; }
  for (const criterion of required) if (typeof record[criterion] !== 'string' || record[criterion].trim().length < 8) fail(`${module.id} at ${module.maturity} lacks ${criterion} evidence`);
  if (module.maturity !== 'experimental' && record.state !== module.maturity) fail(`${module.id} evidence state must match catalog maturity`);
  if (['operational', 'critical'].includes(module.maturity)) {
    const proof = record.recoveryProof;
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      fail(`${module.id} at ${module.maturity} lacks structured recoveryProof`);
      continue;
    }
    for (const field of ['drillId', 'scope', 'evidenceRef', 'restoredAt', 'dataChecks', 'functionalCheck']) {
      if (typeof proof[field] !== 'string' || proof[field].trim().length < 8) fail(`${module.id} recoveryProof lacks ${field}`);
    }
    if (!Number.isFinite(proof.rtoSeconds) || proof.rtoSeconds <= 0) fail(`${module.id} recoveryProof lacks a measured rtoSeconds`);
    if (module.maturity === 'critical') {
      if (proof.offsite !== true) fail(`${module.id} critical recoveryProof must attest an offsite restore`);
      if (typeof proof.keyEscrowRef !== 'string' || proof.keyEscrowRef.trim().length < 8) fail(`${module.id} critical recoveryProof lacks keyEscrowRef`);
    }
  }
}
if (errors.length) { for (const error of errors) console.error(`module maturity validation failed: ${error}`); process.exit(1); }
console.log(`Module maturity validation OK (${catalog.modules.length} modules).`);
