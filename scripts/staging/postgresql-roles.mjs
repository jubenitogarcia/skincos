#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from './lib.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
if (!apply) {
  console.log(JSON.stringify({ mode: 'plan', target: 'PostgreSQL staging only', creates: ['NOLOGIN owner roles', 'NOLOGIN runtime roles', 'NOLOGIN migrator role', 'isolated database and schemas'], credentials: 'not created' }, null, 2));
  process.exit(0);
}
if (process.env.SKINCOS_STAGING_POSTGRES_APPLY !== '1') throw new Error('Refusing PostgreSQL mutation. Use SKINCOS_STAGING_POSTGRES_APPLY=1 only in an approved staging change window.');
if (!process.env.PG_STAGING_ADMIN_URL) throw new Error('PG_STAGING_ADMIN_URL is required and must be supplied by the approved secret manager.');
const bootstrap = path.join(root, 'platform/staging/postgresql/bootstrap.sql');
const validate = path.join(root, 'platform/staging/postgresql/validate.sql');
execFileSync('psql', ['--set', 'ON_ERROR_STOP=1', '--dbname', process.env.PG_STAGING_ADMIN_URL, '--file', bootstrap], { stdio: 'inherit' });
const output = execFileSync('psql', ['--tuples-only', '--no-align', '--dbname', process.env.PG_STAGING_ADMIN_URL, '--file', validate], { encoding: 'utf8' });
const lines = output.trim().split('\n').map((line) => line.trim()).filter(Boolean);
if (lines[0] !== 'ok' || lines[1] !== '3') throw new Error('PostgreSQL staging role validation failed');
console.log(JSON.stringify({ mode: 'applied', target: 'PostgreSQL staging only', credentials: 'not created' }, null, 2));
