import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/module-catalog.json'), 'utf8'));
const readiness = JSON.parse(fs.readFileSync(path.join(root, 'ops/module-governance/release-readiness.json'), 'utf8'));
const requiredCandidateFields = ['id', 'order', 'targetState', 'status', 'featureFlag', 'pilotGroup', 'initialData', 'training', 'fallback', 'support', 'successCriteria', 'rollback', 'requiredEvidence'];
const requiredReleasedFields = ['id', 'featureFlag', 'pilotGroup', 'initialData', 'training', 'fallback', 'support', 'successCriteria', 'rollback'];
const states = ['experimental', 'staging', 'pilot', 'operational', 'critical'];
const errors = []; const fail = (message) => errors.push(message);

if (readiness.schemaVersion !== 1) fail('release readiness schemaVersion must be 1');
const moduleIds = new Set(catalog.modules.map((module) => module.id));
const classifications = new Map();
for (const item of readiness.classification ?? []) {
  if (!moduleIds.has(item.id)) fail(`classification references unknown module ${item.id}`);
  if (classifications.has(item.id)) fail(`duplicate classification for ${item.id}`);
  classifications.set(item.id, item);
  for (const field of ['currentUse', 'reason']) if (typeof item[field] !== 'string' || item[field].trim().length < 8) fail(`${item.id} classification lacks ${field}`);
  if (!['hold', 'next-candidate', 'candidate-after-finance', 'not-a-product-release'].includes(item.decision)) fail(`${item.id} has invalid release decision ${item.decision}`);
}
for (const id of moduleIds) if (!classifications.has(id)) fail(`missing classification for ${id}`);
for (const candidate of readiness.releaseCandidates ?? []) {
  for (const field of requiredCandidateFields) {
    const value = candidate[field];
    if (field === 'requiredEvidence') { if (!Array.isArray(value) || value.length < 3) fail(`${candidate.id} lacks sufficient requiredEvidence`); }
    else if (typeof value !== 'string' && field !== 'order') fail(`${candidate.id} lacks ${field}`);
  }
  if (!moduleIds.has(candidate.id)) fail(`candidate references unknown module ${candidate.id}`);
  if (!states.includes(candidate.targetState) || candidate.targetState === 'experimental') fail(`${candidate.id} targetState must be staging, pilot, operational or critical`);
  if (!candidate.status.startsWith('blocked-')) fail(`${candidate.id} must remain explicitly blocked until reviewed evidence is recorded`);
}
const releasedIds = new Set();
for (const released of readiness.releasedModules ?? []) {
  if (releasedIds.has(released.id)) fail(`duplicate released package for ${released.id}`);
  releasedIds.add(released.id);
  for (const field of requiredReleasedFields) if (typeof released[field] !== 'string' || released[field].trim().length < 8) fail(`${released.id} released package lacks ${field}`);
  const catalogModule = catalog.modules.find((module) => module.id === released.id);
  if (!catalogModule) fail(`released package references unknown module ${released.id}`);
  else if (!['pilot', 'operational', 'critical'].includes(catalogModule.maturity)) fail(`${released.id} cannot be released while catalog maturity is ${catalogModule.maturity}`);
}
for (const module of catalog.modules) if (['pilot', 'operational', 'critical'].includes(module.maturity) && !releasedIds.has(module.id)) fail(`${module.id} at ${module.maturity} requires a complete releasedModules package`);
if (errors.length) { for (const error of errors) console.error(`release readiness validation failed: ${error}`); process.exit(1); }
console.log(`Release readiness validation OK (${classifications.size} classifications, ${(readiness.releaseCandidates ?? []).length} candidates, ${(readiness.releasedModules ?? []).length} released).`);
