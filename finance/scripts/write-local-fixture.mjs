#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const scenarios = {
  disabled: { enabled: false, modules: ['finance'], scopes: [] },
  'no-module': { enabled: true, modules: [], scopes: [] },
  'no-grant': { enabled: true, modules: ['finance'], scopes: [] },
  nh: { enabled: true, modules: ['finance'], scopes: ['finance-scope-novo-hamburgo'] },
  bss: { enabled: true, modules: ['finance'], scopes: ['finance-scope-barra-shopping-sul'] },
  both: { enabled: true, modules: ['finance'], scopes: ['finance-scope-novo-hamburgo', 'finance-scope-barra-shopping-sul'] },
};

const args = process.argv.slice(2);
const valueFor = (name) => args[args.indexOf(name) + 1] || '';
const scenarioName = valueFor('--scenario');
const output = valueFor('--output');
const actor = valueFor('--actor') || 'finance-local';
if (!scenarios[scenarioName] || !output) {
  console.error('Uso: write-local-fixture.mjs --scenario disabled|no-module|no-grant|nh|bss|both --output <arquivo.sql> [--actor identificador-local]');
  process.exit(1);
}
if (!/^[a-z0-9-]{3,80}$/.test(actor)) {
  console.error('O ator local deve usar apenas letras minúsculas, números e hífen.');
  process.exit(1);
}

const fixture = scenarios[scenarioName];
const username = actor;
const now = new Date().toISOString();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const modules = JSON.stringify(fixture.modules);
const units = JSON.stringify(fixture.scopes.map((scope) => scope.replace('finance-scope-', '')));
const grantRows = fixture.scopes.map((scope, index) =>
  `INSERT INTO finance_access_grants(id,username,scope_id,permission,created_at,created_by) VALUES(${quote(`${username}-grant-${index + 1}`)},${quote(username)},${quote(scope)},'operator',${quote(now)},'finance-local-runtime');`,
);

const sql = [
  'PRAGMA foreign_keys=ON;',
  `INSERT OR REPLACE INTO crm_users(username,email,display_name,password_hash,role,photo_url,allowed_units_json,allowed_modules_json,ativo,created_at,updated_at) VALUES(${quote(username)},${quote(`${username}@localhost`)},'Finance Local','local-runtime-no-password','GESTOR','',${quote(units)},${quote(modules)},1,${quote(now)},${quote(now)});`,
  `DELETE FROM finance_access_grants WHERE username=${quote(username)};`,
  ...grantRows,
  `UPDATE finance_settings SET value=${quote(fixture.enabled ? 'true' : 'false')},updated_at=${quote(now)} WHERE key='module_enabled';`,
].join('\n') + '\n';

const metadata = {
  scenario: scenarioName,
  username,
  allowedModules: fixture.modules,
  allowedUnits: fixture.scopes.map((scope) => scope.replace('finance-scope-', '')),
  grantedScopes: fixture.scopes,
  moduleEnabled: fixture.enabled,
  personalScopeGranted: false,
};

const outputPath = resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, sql, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(metadata)}\n`);
