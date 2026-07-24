#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const file = 'ops/module-governance/finance-staging-canary-policy.json';
const policy = JSON.parse(await readFile(file, 'utf8'));
const fail = (message) => { throw new Error(`${file}: ${message}`); };
if (policy.schemaVersion !== 1 || policy.module !== 'finance' || policy.environment !== 'staging') fail('must be schema v1 Finance staging policy');
if (policy.syntheticOnly !== true) fail('must remain synthetic-only');
if (!Array.isArray(policy.cohort?.pilotActors) || policy.cohort.pilotActors.length !== 1 || policy.cohort.pilotActors[0] !== 'finance-staging-monitor') fail('must permit only the registered synthetic actor');
if (!Array.isArray(policy.cohort?.pilotUnits) || policy.cohort.pilotUnits.length !== 1 || policy.cohort.pilotUnits[0] !== 'novo-hamburgo') fail('must permit only Novo Hamburgo staging unit');
if (!Number.isInteger(policy.cohort?.percentage) || policy.cohort.percentage < 1 || policy.cohort.percentage > 100) fail('percentage must be an integer 1..100');
for (const key of ['minimumSamples', 'errors', 'p95LatencyMs', 'authenticationFailures', 'journeyFailures', 'dataDivergences', 'auditFailures', 'dependencyFailures']) {
  if (!Number.isFinite(Number(policy.limits?.[key])) || Number(policy.limits[key]) < 0) fail(`limits.${key} must be non-negative`);
}
if (policy.abort?.state !== 'disabled' || policy.abort?.moduleEnabled !== false) fail('abort must disable the module and module_enabled');
console.log(`Validated Finance synthetic canary policy for ${policy.cohort.pilotActors[0]}.`);
