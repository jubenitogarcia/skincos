import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const fail = (message) => { process.stderr.write(`PostgreSQL governance validation failed: ${message}\n`); process.exitCode = 1; };
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
for (const file of ['crm/api/server/db.ts', 'crm/api/server/storage.js', 'crm/api/server/harmonia/store/pg.js', 'crm/api/server/replitAuth.js', 'crm/api/server/replitAuth.ts']) {
  const source = read(file);
  if (/rejectUnauthorized\s*:\s*false/.test(source)) fail(`${file} disables PostgreSQL certificate validation`);
  if (/createTableIfMissing\s*:\s*true/.test(source)) fail(`${file} performs implicit session-table migration`);
}
const routes = read('crm/api/server/harmonia/routes.js');
if (/store\.migrate\(\)/.test(routes)) fail('Harmonia router still executes migrations during startup');
const atendimento = read('crm/api/server/atendimento/store.js');
if (/withPgTransaction\(pgPool,\s*migrateAtendimento\)/.test(atendimento)) fail('Atendimento store still executes migrations during startup');
for (const file of ['crm/api/migrations/harmonia/20260723_adopt_existing_schema.sql', 'crm/api/migrations/atendimento/20260723_adopt_existing_schema.sql', 'crm/api/migrations/caixa/20260723_adopt_existing_schema.sql', 'ops/postgres/roles/0001_service_roles.sql']) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing audited PostgreSQL artifact ${file}`);
}
const migrationWorkflow = read('.github/workflows/postgres-migrations.yml');
for (const token of ['workflow_dispatch:', 'POSTGRES_MIGRATIONS_DATABASE_URL', 'APPLY_POSTGRES_MIGRATION', 'postgres-migrations-${{ inputs.domain }}-${{ inputs.target }}']) {
  if (!migrationWorkflow.includes(token)) fail(`PostgreSQL migration workflow is missing ${token}`);
}
const pool = read('crm/api/server/harmonia/store/pg.js');
for (const token of ['rejectUnauthorized: true', 'connectionTimeoutMillis', 'statement_timeout=', 'lock_timeout=', 'idle_in_transaction_session_timeout=', 'maxLifetimeSeconds']) if (!pool.includes(token)) fail(`pool policy is missing ${token}`);
if (!process.exitCode) process.stdout.write('PostgreSQL governance validation OK.\n');
