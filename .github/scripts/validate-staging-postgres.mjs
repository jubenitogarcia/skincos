import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const bootstrap = fs.readFileSync(path.join(root, 'platform/staging/postgresql/bootstrap.sql'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts/staging/postgresql-roles.mjs'), 'utf8');
const errors = [];
const roles = ['identity', 'inventory', 'finance'];
for (const domain of roles) {
  if (!bootstrap.includes(`skincos_staging_${domain}_owner NOLOGIN NOINHERIT`)) errors.push(`${domain} owner role must be NOLOGIN NOINHERIT`);
  if (!bootstrap.includes(`skincos_staging_${domain}_runtime NOLOGIN NOINHERIT`)) errors.push(`${domain} runtime role must be NOLOGIN NOINHERIT`);
  if (!bootstrap.includes(`CREATE SCHEMA IF NOT EXISTS ${domain}`)) errors.push(`${domain} schema is missing`);
}
if (!bootstrap.includes('REVOKE ALL ON DATABASE skincos_staging FROM PUBLIC')) errors.push('PUBLIC database access must be revoked');
if (!runner.includes('SKINCOS_STAGING_POSTGRES_APPLY') || !runner.includes('PG_STAGING_ADMIN_URL')) errors.push('PostgreSQL application must require acknowledgement and external admin credentials');
if (/password\s*=|postgresql:\/\/[^$]/i.test(`${bootstrap}\n${runner}`)) errors.push('PostgreSQL files must not contain credentials');
const result = spawnSync(process.execPath, [path.join(root, 'scripts/staging/postgresql-roles.mjs')], { encoding: 'utf8' });
if (result.status !== 0 || !result.stdout.includes('"mode": "plan"')) errors.push('PostgreSQL roles command must default to a non-mutating plan');
if (errors.length) {
  errors.forEach((error) => console.error(`staging PostgreSQL validation failed: ${error}`));
  process.exit(1);
}
console.log('Staging PostgreSQL role template and guard validated.');
