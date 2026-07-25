import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const scripts = ['bootstrap.mjs', 'reconcile.mjs', 'teardown.mjs'];
const errors = [];
const fail = (message) => errors.push(message);

for (const file of scripts) {
  const source = fs.readFileSync(path.join(root, 'scripts/staging', file), 'utf8');
  if (source.includes('skincos.com.br') || source.includes('--env production')) fail(`${file} must not reference production`);
  if (!source.includes("parseDomain(argv)")) fail(`${file} must require an explicit domain`);
  if (!source.includes("SKINCOS_STAGING_")) fail(`${file} must require an explicit staging acknowledgement`);
}
const bootstrap = fs.readFileSync(path.join(root, 'scripts/staging/bootstrap.mjs'), 'utf8');
if (bootstrap.includes('secret put') || bootstrap.includes('STAGING_CONTROL_TOKEN=')) fail('bootstrap must never write a secret value');
if (!bootstrap.includes("module_enabled', 'false'")) fail('bootstrap must explicitly disable module_enabled');
const control = fs.readFileSync(path.join(root, 'platform/staging/control-worker.js'), 'utf8');
if (!control.includes("flag === 'false'")) fail('control readiness must fail if module_enabled is not false');

for (const [script, args] of [['bootstrap.mjs', ['--domain', 'identity']], ['reconcile.mjs', ['--domain', 'inventory']], ['teardown.mjs', ['--domain', 'finance']]]) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/staging', script), ...args], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.includes('"mode": "plan"')) fail(`${script} default mode must be a non-mutating plan`);
}
if (errors.length) {
  errors.forEach((error) => console.error(`staging script validation failed: ${error}`));
  process.exit(1);
}
console.log('Staging bootstrap, reconciliation and teardown guards validated.');
